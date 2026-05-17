use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct RuleFiring {
    pub id: Uuid,
    pub rule_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub fired_at: DateTime<Utc>,
    pub trigger_kind: String,
    pub trigger_ref: Option<Uuid>,
    pub outcome: String,
    pub actions_executed: Option<serde_json::Value>,
    pub error_message: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub async fn insert(
    pool: &PgPool,
    rule_id: Uuid,
    user_id: Uuid,
    trigger_kind: &str,
    trigger_ref: Option<Uuid>,
    outcome: &str,
    actions_executed: Option<serde_json::Value>,
    error_message: Option<String>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        INSERT INTO rule_firings (rule_id, user_id, trigger_kind, trigger_ref, outcome, actions_executed, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(rule_id)
    .bind(user_id)
    .bind(trigger_kind)
    .bind(trigger_ref)
    .bind(outcome)
    .bind(actions_executed)
    .bind(error_message)
    .fetch_one(pool)
    .await
}

pub async fn list_recent_for_rule(
    pool: &PgPool,
    user_id: Uuid,
    rule_id: Uuid,
    limit: i64,
) -> Result<Vec<RuleFiring>, sqlx::Error> {
    sqlx::query_as::<_, RuleFiring>(
        "SELECT * FROM rule_firings WHERE rule_id = $1 AND user_id = $2 ORDER BY fired_at DESC LIMIT $3",
    )
    .bind(rule_id)
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

