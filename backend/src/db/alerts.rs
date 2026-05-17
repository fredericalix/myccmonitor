use sqlx::PgPool;
use uuid::Uuid;

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
