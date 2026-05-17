use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WebhookConfig {
    pub id: Uuid,
    pub user_id: Uuid,
    pub cc_org_id: String,
    #[serde(skip)]
    pub token: String,
    pub cc_webhook_id: Option<String>,
    pub subscribed_events: Vec<String>,
    pub last_received_at: Option<DateTime<Utc>>,
    pub failure_count: i32,
    pub created_at: DateTime<Utc>,
}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
    token: &str,
    cc_webhook_id: Option<&str>,
    subscribed_events: &[String],
) -> Result<WebhookConfig, sqlx::Error> {
    sqlx::query_as::<_, WebhookConfig>(
        r#"
        INSERT INTO webhook_configs (user_id, cc_org_id, token, cc_webhook_id, subscribed_events)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, cc_org_id) DO UPDATE SET
            token = EXCLUDED.token,
            cc_webhook_id = EXCLUDED.cc_webhook_id,
            subscribed_events = EXCLUDED.subscribed_events,
            failure_count = 0
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .bind(token)
    .bind(cc_webhook_id)
    .bind(subscribed_events)
    .fetch_one(pool)
    .await
}

pub async fn find_by_token(
    pool: &PgPool,
    token: &str,
) -> Result<Option<WebhookConfig>, sqlx::Error> {
    sqlx::query_as::<_, WebhookConfig>("SELECT * FROM webhook_configs WHERE token = $1")
        .bind(token)
        .fetch_optional(pool)
        .await
}

pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> Result<Vec<WebhookConfig>, sqlx::Error> {
    sqlx::query_as::<_, WebhookConfig>("SELECT * FROM webhook_configs WHERE user_id = $1")
        .bind(user_id)
        .fetch_all(pool)
        .await
}

pub async fn touch_last_received(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE webhook_configs SET last_received_at = now(), failure_count = 0 WHERE id = $1",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}
