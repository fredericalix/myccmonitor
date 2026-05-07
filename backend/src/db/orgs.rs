use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Org {
    pub id: Uuid,
    pub user_id: Uuid,
    pub cc_org_id: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub refreshed_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct OrgInput<'a> {
    pub cc_org_id: &'a str,
    pub name: Option<&'a str>,
    pub avatar_url: Option<&'a str>,
}

pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> Result<Vec<Org>, sqlx::Error> {
    sqlx::query_as::<_, Org>(
        "SELECT * FROM orgs WHERE user_id = $1 ORDER BY name NULLS LAST, cc_org_id",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Refresh the user's org cache: upsert the given list, then delete any rows
/// for this user that aren't in it (so an org the user lost access to disappears).
pub async fn replace_for_user(
    pool: &PgPool,
    user_id: Uuid,
    fresh: &[OrgInput<'_>],
) -> Result<Vec<Org>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    for input in fresh {
        sqlx::query(
            r#"
            INSERT INTO orgs (user_id, cc_org_id, name, avatar_url, refreshed_at)
            VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (user_id, cc_org_id) DO UPDATE SET
                name = EXCLUDED.name,
                avatar_url = EXCLUDED.avatar_url,
                refreshed_at = now()
            "#,
        )
        .bind(user_id)
        .bind(input.cc_org_id)
        .bind(input.name)
        .bind(input.avatar_url)
        .execute(&mut *tx)
        .await?;
    }

    let cc_ids: Vec<&str> = fresh.iter().map(|i| i.cc_org_id).collect();
    sqlx::query("DELETE FROM orgs WHERE user_id = $1 AND cc_org_id <> ALL($2)")
        .bind(user_id)
        .bind(&cc_ids)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    list_for_user(pool, user_id).await
}

pub async fn find_by_user_and_cc_id(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<Option<Org>, sqlx::Error> {
    sqlx::query_as::<_, Org>("SELECT * FROM orgs WHERE user_id = $1 AND cc_org_id = $2")
        .bind(user_id)
        .bind(cc_org_id)
        .fetch_optional(pool)
        .await
}
