use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Alert {
    pub id: Uuid,
    pub user_id: Uuid,
    pub monitor_id: Option<Uuid>,
    pub rule_id: Option<Uuid>,
    pub level: String,
    pub message: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub notified_at: Option<DateTime<Utc>>,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

pub async fn insert(
    pool: &PgPool,
    user_id: Uuid,
    monitor_id: Option<Uuid>,
    rule_id: Option<Uuid>,
    level: &str,
    message: Option<&str>,
    payload: Option<serde_json::Value>,
) -> Result<Uuid, sqlx::Error> {
    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO alerts (user_id, monitor_id, rule_id, level, message, payload)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(monitor_id)
    .bind(rule_id)
    .bind(level)
    .bind(message)
    .bind(payload)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn list_recent_for_user(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<Alert>, sqlx::Error> {
    sqlx::query_as::<_, Alert>(
        "SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}
