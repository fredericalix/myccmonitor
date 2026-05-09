//! Warp10 metrics fetcher used by the Phase 4 poller, extended in Phase 11e
//! to fetch disk + network alongside cpu + mem.
//!
//! Each backend instance keeps a per-(user, org) in-memory cache of the
//! Warp10 read token (TTL 4 hours; CC issues tokens valid ~5 days, but a
//! shorter cache window is cheap insurance against stale-key drift).

pub mod templates;
pub mod tokens;
pub mod warp10_client;

use crate::api::cc_client::CcClient;
use crate::config::Config;
use crate::metrics::templates::{MetricsTuple, metrics_last_script, split_metrics};
use crate::metrics::tokens::TokenCache;
use crate::metrics::warp10_client::execute_warpscript;
use std::collections::HashMap;
use uuid::Uuid;

/// Fetch the latest cpu / mem / disk / net_in / net_out for a batch of CC
/// resources (apps and addons) belonging to the same org. CC's Warp10 keys
/// both kinds under the `app_id` label — for addons, the value must be the
/// addon's `realId`, not its `id`. Caller passes those ids in `metrics_ids`.
/// Returns `{ metrics_id -> MetricsTuple }`. Resources with no recent samples
/// in Warp10 are absent from the map.
pub async fn fetch_metrics(
    cfg: &Config,
    http: &reqwest::Client,
    cc: &CcClient<'_>,
    cache: &TokenCache,
    user_id: Uuid,
    cc_org_id: &str,
    label_name: &str,
    metrics_ids: &[String],
) -> anyhow::Result<HashMap<String, MetricsTuple>> {
    if metrics_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let token = tokens::ensure_token(cache, cc, user_id, cc_org_id).await?;
    let script = metrics_last_script(&token, label_name, metrics_ids);
    let value = execute_warpscript(http, &cfg.warp10_endpoint, &script).await?;
    Ok(split_metrics(&value, label_name))
}
