//! In-memory cache of CC Warp10 read tokens, scoped per (user, org).
//! TTL 4 hours; CC tokens are valid ~5 days but a shorter window keeps us
//! resilient to clock drift and rotated user OAuth tokens.

use crate::api::cc_client::CcClient;
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use uuid::Uuid;

const TOKEN_TTL: Duration = Duration::hours(4);

#[derive(Default)]
pub struct TokenCache {
    inner: DashMap<(Uuid, String), (String, DateTime<Utc>)>,
}

impl TokenCache {
    pub fn new() -> Self {
        Self::default()
    }
}

pub async fn ensure_token(
    cache: &TokenCache,
    cc: &CcClient<'_>,
    user_id: Uuid,
    cc_org_id: &str,
) -> anyhow::Result<String> {
    let now = Utc::now();
    if let Some(entry) = cache.inner.get(&(user_id, cc_org_id.to_string())) {
        let (token, expires) = entry.value();
        if expires > &now {
            return Ok(token.clone());
        }
    }
    let token = cc.get_metrics_token(cc_org_id).await?;
    cache.inner.insert(
        (user_id, cc_org_id.to_string()),
        (token.clone(), now + TOKEN_TTL),
    );
    Ok(token)
}
