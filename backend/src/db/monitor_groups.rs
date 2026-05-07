use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MonitorGroup {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub auto_rules: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Auto-grouping rules: all conjunctive (AND). Phase 5 supports a regex on
/// `monitors.display_name` and a whitelist of kinds. Tags / env shortcuts can
/// land in a follow-up; the JSONB column accepts unknown fields.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AutoRules {
    #[serde(default)]
    pub name_pattern: Option<String>,
    #[serde(default)]
    pub kinds: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateGroup {
    pub name: String,
    pub description: Option<String>,
    pub auto_rules: Option<AutoRules>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateGroup {
    pub name: Option<String>,
    pub description: Option<String>,
    pub auto_rules: Option<AutoRules>,
}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    input: &CreateGroup,
) -> Result<MonitorGroup, sqlx::Error> {
    let auto_rules_json = input
        .auto_rules
        .as_ref()
        .map(|r| serde_json::to_value(r).expect("AutoRules is always serialisable"));
    sqlx::query_as::<_, MonitorGroup>(
        r#"
        INSERT INTO monitor_groups (user_id, name, description, auto_rules)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(&input.name)
    .bind(input.description.as_deref())
    .bind(auto_rules_json)
    .fetch_one(pool)
    .await
}

pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<MonitorGroup>, sqlx::Error> {
    sqlx::query_as::<_, MonitorGroup>(
        "SELECT * FROM monitor_groups WHERE user_id = $1 ORDER BY name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn find(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<Option<MonitorGroup>, sqlx::Error> {
    sqlx::query_as::<_, MonitorGroup>(
        "SELECT * FROM monitor_groups WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn update(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    input: &UpdateGroup,
) -> Result<Option<MonitorGroup>, sqlx::Error> {
    let auto_rules_json = input
        .auto_rules
        .as_ref()
        .map(|r| serde_json::to_value(r).expect("AutoRules is always serialisable"));
    sqlx::query_as::<_, MonitorGroup>(
        r#"
        UPDATE monitor_groups SET
            name = COALESCE($3, name),
            description = COALESCE($4, description),
            auto_rules = COALESCE($5, auto_rules),
            updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(input.name.as_deref())
    .bind(input.description.as_deref())
    .bind(auto_rules_json)
    .fetch_optional(pool)
    .await
}

pub async fn delete(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<u64, sqlx::Error> {
    let res = sqlx::query("DELETE FROM monitor_groups WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

pub async fn add_member(
    pool: &PgPool,
    user_id: Uuid,
    group_id: Uuid,
    monitor_id: Uuid,
) -> Result<bool, sqlx::Error> {
    // Verify both belong to the same user.
    let ok: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT EXISTS (SELECT 1 FROM monitor_groups WHERE id = $1 AND user_id = $3)
           AND EXISTS (SELECT 1 FROM monitors WHERE id = $2 AND user_id = $3)
        "#,
    )
    .bind(group_id)
    .bind(monitor_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    if !ok.unwrap_or(false) {
        return Ok(false);
    }
    sqlx::query(
        r#"
        INSERT INTO monitor_group_members (group_id, monitor_id)
        VALUES ($1, $2)
        ON CONFLICT (group_id, monitor_id) DO NOTHING
        "#,
    )
    .bind(group_id)
    .bind(monitor_id)
    .execute(pool)
    .await?;
    Ok(true)
}

pub async fn remove_member(
    pool: &PgPool,
    user_id: Uuid,
    group_id: Uuid,
    monitor_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(
        r#"
        DELETE FROM monitor_group_members
        WHERE group_id = $1 AND monitor_id = $2
          AND EXISTS (SELECT 1 FROM monitor_groups WHERE id = $1 AND user_id = $3)
        "#,
    )
    .bind(group_id)
    .bind(monitor_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

pub async fn list_manual_member_ids(
    pool: &PgPool,
    group_id: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT monitor_id FROM monitor_group_members WHERE group_id = $1",
    )
    .bind(group_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}
