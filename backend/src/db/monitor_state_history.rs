use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn insert(
    pool: &PgPool,
    monitor_id: Uuid,
    state: &str,
    message: Option<&str>,
    changed_at: DateTime<Utc>,
    source: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO monitor_state_history (monitor_id, state, message, changed_at, source)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (monitor_id, changed_at) DO NOTHING
        "#,
    )
    .bind(monitor_id)
    .bind(state)
    .bind(message)
    .bind(changed_at)
    .bind(source)
    .execute(pool)
    .await?;
    Ok(())
}

/// True iff the monitor has continuously held `state` for at least
/// `seconds` seconds, based on the most recent state-transition history entry.
/// Used by the workflow engine for `state == X for 5m` conditions. The
/// `EXISTS` clause scopes the lookup to `user_id` so a crafted rule can never
/// probe another tenant's state-change timing (CLAUDE.md §15).
pub async fn state_held_for(
    pool: &PgPool,
    user_id: Uuid,
    monitor_id: Uuid,
    state: &str,
    seconds: i64,
) -> Result<bool, sqlx::Error> {
    let row: Option<(DateTime<Utc>, String)> = sqlx::query_as(
        r#"
        SELECT h.changed_at, h.state FROM monitor_state_history h
        WHERE h.monitor_id = $1
          AND EXISTS (SELECT 1 FROM monitors WHERE id = $1 AND user_id = $2)
        ORDER BY h.changed_at DESC
        LIMIT 1
        "#,
    )
    .bind(monitor_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    match row {
        Some((changed_at, last_state)) if last_state == state => {
            let elapsed = Utc::now().signed_duration_since(changed_at).num_seconds();
            Ok(elapsed >= seconds)
        }
        _ => Ok(false),
    }
}
