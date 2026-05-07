use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;

/// Try to record a dedup key with a TTL. Returns `true` if newly inserted
/// (i.e. *not* a duplicate). Returns `false` if the key already exists
/// and is still within its window.
pub async fn try_record(
    pool: &PgPool,
    key: &str,
    ttl: Duration,
) -> Result<bool, sqlx::Error> {
    let expires_at: DateTime<Utc> = Utc::now() + ttl;
    let inserted = sqlx::query_scalar::<_, bool>(
        r#"
        WITH ins AS (
            INSERT INTO webhook_dedup (key, expires_at)
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE
                SET expires_at = EXCLUDED.expires_at
                WHERE webhook_dedup.expires_at < now()  -- expired entry: refresh + treat as new
            RETURNING xmax = 0 AS inserted
        )
        SELECT COALESCE((SELECT inserted FROM ins), false)
        "#,
    )
    .bind(key)
    .bind(expires_at)
    .fetch_one(pool)
    .await?;
    Ok(inserted)
}

pub async fn purge_expired(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let res = sqlx::query("DELETE FROM webhook_dedup WHERE expires_at < now()")
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}
