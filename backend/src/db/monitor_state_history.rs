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
/// Used by Phase 6 workflow engine for `state == X for 5m` conditions.
pub async fn state_held_for(
    pool: &PgPool,
    monitor_id: Uuid,
    state: &str,
    seconds: i64,
) -> Result<bool, sqlx::Error> {
    let row: Option<(DateTime<Utc>, String)> = sqlx::query_as(
        r#"
        SELECT changed_at, state FROM monitor_state_history
        WHERE monitor_id = $1
        ORDER BY changed_at DESC
        LIMIT 1
        "#,
    )
    .bind(monitor_id)
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

pub async fn purge_older_than(
    pool: &PgPool,
    cutoff: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    let res = sqlx::query("DELETE FROM monitor_state_history WHERE changed_at < $1")
        .bind(cutoff)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}
