use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Monitor {
    pub id: Uuid,
    pub user_id: Uuid,
    pub cc_org_id: Option<String>,
    pub kind: String,
    pub cc_resource_id: Option<String>,
    pub display_name: String,
    pub enabled: bool,
    pub poll_interval_seconds: i32,
    pub current_state: String,
    pub current_message: Option<String>,
    pub current_state_since: Option<DateTime<Utc>>,
    pub last_poll_at: Option<DateTime<Utc>>,
    pub acknowledged: bool,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct MonitorInput<'a> {
    pub cc_org_id: Option<&'a str>,
    pub kind: &'a str,
    pub cc_resource_id: Option<&'a str>,
    pub display_name: &'a str,
    pub metadata: Option<serde_json::Value>,
    /// CC's view of the resource's state (`"ok"` / `"critical"` / `"unknown"`).
    /// On INSERT this seeds `current_state`. On CONFLICT it self-heals only
    /// when the existing row is still `unknown` and the new mapping isn't —
    /// webhook-set states are never clobbered.
    pub initial_state: &'a str,
}

/// Upsert a CC-backed monitor (cc_application or cc_addon) by
/// (user_id, cc_org_id, kind, cc_resource_id). Returns the row.
pub async fn upsert_cc(
    pool: &PgPool,
    user_id: Uuid,
    input: MonitorInput<'_>,
) -> Result<Monitor, sqlx::Error> {
    sqlx::query_as::<_, Monitor>(
        r#"
        INSERT INTO monitors
            (user_id, cc_org_id, kind, cc_resource_id, display_name, metadata,
             current_state, current_state_since)
        VALUES ($1, $2, $3, $4, $5, $6, $7,
                CASE WHEN $7 <> 'unknown' THEN now() ELSE NULL END)
        ON CONFLICT (user_id, cc_org_id, kind, cc_resource_id)
        WHERE cc_resource_id IS NOT NULL
        DO UPDATE SET
            display_name = EXCLUDED.display_name,
            metadata = EXCLUDED.metadata,
            current_state = CASE
                WHEN monitors.current_state = 'unknown' AND EXCLUDED.current_state <> 'unknown'
                THEN EXCLUDED.current_state
                ELSE monitors.current_state
            END,
            current_state_since = CASE
                WHEN monitors.current_state = 'unknown' AND EXCLUDED.current_state <> 'unknown'
                THEN now()
                ELSE monitors.current_state_since
            END,
            updated_at = now()
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(input.cc_org_id)
    .bind(input.kind)
    .bind(input.cc_resource_id)
    .bind(input.display_name)
    .bind(input.metadata)
    .bind(input.initial_state)
    .fetch_one(pool)
    .await
}

pub async fn list_for_org(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<Vec<Monitor>, sqlx::Error> {
    sqlx::query_as::<_, Monitor>(
        r#"
        SELECT * FROM monitors
        WHERE user_id = $1 AND cc_org_id = $2
        ORDER BY kind, display_name
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_all(pool)
    .await
}

pub async fn find_by_id_for_user(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<Option<Monitor>, sqlx::Error> {
    sqlx::query_as::<_, Monitor>("SELECT * FROM monitors WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

pub async fn find_by_cc_resource(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
    cc_resource_id: &str,
) -> Result<Option<Monitor>, sqlx::Error> {
    sqlx::query_as::<_, Monitor>(
        r#"
        SELECT * FROM monitors
        WHERE user_id = $1 AND cc_org_id = $2 AND cc_resource_id = $3
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .bind(cc_resource_id)
    .fetch_optional(pool)
    .await
}

/// Drop CC monitors for an org that aren't in `keep_ids` — used after sync to
/// remove resources that no longer exist on CC. Synthetics are never touched.
pub async fn delete_missing_in(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
    kept_ids: &[String],
) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(
        r#"
        DELETE FROM monitors
        WHERE user_id = $1
          AND cc_org_id = $2
          AND kind IN ('cc_application', 'cc_addon')
          AND cc_resource_id <> ALL ($3)
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .bind(kept_ids)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Delete one CC monitor by resource id (used on APPLICATION_DELETION /
/// ADDON_DELETION webhook events).
pub async fn delete_by_cc_resource(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
    cc_resource_id: &str,
) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(
        r#"
        DELETE FROM monitors
        WHERE user_id = $1 AND cc_org_id = $2 AND cc_resource_id = $3
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .bind(cc_resource_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Update current_state if it actually changed; return the new state and
/// the moment it changed. The caller is responsible for the corresponding
/// monitor_state_history insert and ws_broadcast notify.
pub async fn set_state_if_changed(
    pool: &PgPool,
    monitor_id: Uuid,
    new_state: &str,
    new_message: Option<&str>,
) -> Result<Option<(String, DateTime<Utc>)>, sqlx::Error> {
    let row: Option<(String, DateTime<Utc>)> = sqlx::query_as(
        r#"
        UPDATE monitors
        SET current_state = $2,
            current_message = $3,
            current_state_since = now(),
            updated_at = now()
        WHERE id = $1
          AND current_state <> $2
        RETURNING current_state, current_state_since
        "#,
    )
    .bind(monitor_id)
    .bind(new_state)
    .bind(new_message)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
