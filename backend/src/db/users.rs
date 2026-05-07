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
