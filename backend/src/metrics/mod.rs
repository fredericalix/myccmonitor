//! Warp10 metrics fetcher used by the Phase 4 monitor poller.
//! Each backend instance keeps a per-(user, org) in-memory cache of the
//! Warp10 read token (TTL 4 hours; CC issues tokens valid ~5 days, but a
//! shorter cache window is cheap insurance against stale-key drift).

pub mod templates;
pub mod tokens;
pub mod warp10_client;

use crate::api::cc_client::CcClient;
use crate::config::Config;
use crate::metrics::templates::{cpu_ram_last_script, split_cpu_ram};
use crate::metrics::tokens::TokenCache;
use crate::metrics::warp10_client::execute_warpscript;
use std::collections::HashMap;
use uuid::Uuid;

/// Fetch the latest CPU% + Memory% for a batch of CC resources (apps or addons)
/// belonging to the same org. Returns `{ cc_resource_id -> (cpu?, mem?) }`.
/// Resources with no recent samples in Warp10 are absent from the map.
pub async fn fetch_cpu_mem(
    cfg: &Config,
    http: &reqwest::Client,
    cc: &CcClient<'_>,
    cache: &TokenCache,
    user_id: Uuid,
    cc_org_id: &str,
    label_name: &str,
    cc_resource_ids: &[String],
) -> anyhow::Result<HashMap<String, (Option<f32>, Option<f32>)>> {
    if cc_resource_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let token = tokens::ensure_token(cache, cc, user_id, cc_org_id).await?;
    let script = cpu_ram_last_script(&token, label_name, cc_resource_ids);
    let value = execute_warpscript(http, &cfg.warp10_endpoint, &script).await?;
    Ok(split_cpu_ram(&value, label_name))
}
