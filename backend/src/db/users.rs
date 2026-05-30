use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub cc_user_id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    #[serde(skip)]
    pub oauth_token_enc: Vec<u8>,
    #[serde(skip)]
    pub oauth_secret_enc: Vec<u8>,
    #[serde(skip)]
    pub oauth_nonce: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpStatus {
    pub enabled: bool,
    pub has_token: bool,
    pub token_prefix: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
}

pub async fn upsert(
    pool: &PgPool,
    cc_user_id: &str,
    email: Option<&str>,
    display_name: Option<&str>,
    oauth_token_enc: &[u8],
    oauth_secret_enc: &[u8],
    oauth_nonce: &[u8],
) -> Result<User, sqlx::Error> {
    sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users
            (cc_user_id, email, display_name, oauth_token_enc, oauth_secret_enc, oauth_nonce, last_login_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (cc_user_id) DO UPDATE SET
            email = EXCLUDED.email,
            display_name = EXCLUDED.display_name,
            oauth_token_enc = EXCLUDED.oauth_token_enc,
            oauth_secret_enc = EXCLUDED.oauth_secret_enc,
            oauth_nonce = EXCLUDED.oauth_nonce,
            updated_at = now(),
            last_login_at = now()
        RETURNING *
        "#,
    )
    .bind(cc_user_id)
    .bind(email)
    .bind(display_name)
    .bind(oauth_token_enc)
    .bind(oauth_secret_enc)
    .bind(oauth_nonce)
    .fetch_one(pool)
    .await
}

pub async fn find_by_id(pool: &PgPool, user_id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

pub async fn get_mcp_status(pool: &PgPool, user_id: Uuid) -> Result<McpStatus, sqlx::Error> {
    #[allow(clippy::type_complexity)]
    let row: (
        bool,
        Option<Vec<u8>>,
        Option<String>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    ) = sqlx::query_as(
        "SELECT mcp_enabled, mcp_token_hash, mcp_token_prefix, mcp_token_created_at, mcp_token_last_used_at \
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(McpStatus {
        enabled: row.0,
        has_token: row.1.is_some(),
        token_prefix: row.2,
        created_at: row.3,
        last_used_at: row.4,
    })
}

pub async fn set_mcp_enabled(
    pool: &PgPool,
    user_id: Uuid,
    enabled: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET mcp_enabled = $1, updated_at = now() WHERE id = $2")
        .bind(enabled)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_mcp_token(
    pool: &PgPool,
    user_id: Uuid,
    hash: &[u8],
    prefix: &str,
) -> Result<DateTime<Utc>, sqlx::Error> {
    let row: (DateTime<Utc>,) = sqlx::query_as(
        "UPDATE users SET \
            mcp_token_hash = $1, \
            mcp_token_prefix = $2, \
            mcp_token_created_at = now(), \
            mcp_token_last_used_at = NULL, \
            updated_at = now() \
         WHERE id = $3 \
         RETURNING mcp_token_created_at",
    )
    .bind(hash)
    .bind(prefix)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn clear_mcp_token(pool: &PgPool, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE users SET \
            mcp_token_hash = NULL, \
            mcp_token_prefix = NULL, \
            mcp_token_created_at = NULL, \
            mcp_token_last_used_at = NULL, \
            updated_at = now() \
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Look up a user by their MCP token hash. Only returns rows where MCP is enabled.
/// Used by the `/mcp` Bearer middleware.
pub async fn find_by_mcp_token_hash(
    pool: &PgPool,
    hash: &[u8],
) -> Result<Option<Uuid>, sqlx::Error> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM users WHERE mcp_token_hash = $1 AND mcp_enabled = TRUE",
    )
    .bind(hash)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

pub async fn touch_mcp_last_used(pool: &PgPool, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET mcp_token_last_used_at = now() WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}
