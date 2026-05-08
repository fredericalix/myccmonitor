use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct NotificationChannel {
    pub id: Uuid,
    pub user_id: Uuid,
    pub kind: String,
    pub name: String,
    pub config: serde_json::Value,
    pub enabled: bool,
    pub failure_count: i32,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_failure_at: Option<DateTime<Utc>>,
    pub last_failure_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertChannel {
    pub kind: String,
    pub name: String,
    pub config: serde_json::Value,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    input: &UpsertChannel,
) -> Result<NotificationChannel, sqlx::Error> {
    sqlx::query_as::<_, NotificationChannel>(
        r#"
        INSERT INTO notification_channels (user_id, kind, name, config, enabled)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(&input.kind)
    .bind(&input.name)
    .bind(&input.config)
    .bind(input.enabled)
    .fetch_one(pool)
    .await
}

pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<NotificationChannel>, sqlx::Error> {
    sqlx::query_as::<_, NotificationChannel>(
        "SELECT * FROM notification_channels WHERE user_id = $1 ORDER BY name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn find(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<Option<NotificationChannel>, sqlx::Error> {
    sqlx::query_as::<_, NotificationChannel>(
        "SELECT * FROM notification_channels WHERE id = $1 AND user_id = $2",
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
    input: &UpsertChannel,
) -> Result<Option<NotificationChannel>, sqlx::Error> {
    sqlx::query_as::<_, NotificationChannel>(
        r#"
        UPDATE notification_channels SET
            kind = $3,
            name = $4,
            config = $5,
            enabled = $6,
            updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(&input.kind)
    .bind(&input.name)
    .bind(&input.config)
    .bind(input.enabled)
    .fetch_optional(pool)
    .await
}

pub async fn delete(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<u64, sqlx::Error> {
    let res = sqlx::query("DELETE FROM notification_channels WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

pub async fn record_success(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE notification_channels
        SET last_success_at = now(), failure_count = 0, last_failure_message = NULL
        WHERE id = $1
        "#,
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn record_failure(
    pool: &PgPool,
    id: Uuid,
    msg: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE notification_channels
        SET last_failure_at = now(),
            failure_count = failure_count + 1,
            last_failure_message = $2
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(msg)
    .execute(pool)
    .await?;
    Ok(())
}
