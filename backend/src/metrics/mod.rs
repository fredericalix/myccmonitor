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
use crate::metrics::templates::{
    MetricsTuple, extract_classes, find_classes_script, metrics_last_script, split_metrics,
};
use crate::metrics::tokens::TokenCache;
use crate::metrics::warp10_client::execute_warpscript;
use std::collections::HashMap;
use uuid::Uuid;

/// Max ids per Warp10 request. Verified in prod 2026-05-09: 12-id chunks
/// produce 31 KB scripts that still time out at 60 s — Warp10 is slow on
/// `mapper.rate` over 5 m of counter data even on small batches. Drop to
/// 3 to keep each script under ~10 KB and Warp10 round-trip well under
/// the timeout. Reqwest's connection pool reuses sockets so the extra
/// requests are cheap.
const WARP10_BATCH_SIZE: usize = 3;

/// Fetch the latest cpu / mem / disk / net_in / net_out for a batch of CC
/// resources (apps and addons) belonging to the same org. CC's Warp10 keys
/// both kinds under the `app_id` label — for addons, the value must be the
/// addon's `realId`, not its `id`. Caller passes those ids in `metrics_ids`.
/// Returns `{ metrics_id -> MetricsTuple }`. Resources with no recent samples
/// in Warp10 are absent from the map.
///
/// Splits `metrics_ids` into chunks of `WARP10_BATCH_SIZE` and runs the chunks
/// in parallel — keeps each request small enough to fit comfortably under the
/// 60 s HTTP timeout while letting the wall-clock cost scale with N/12 not N.
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
    let chunks: Vec<&[String]> = metrics_ids.chunks(WARP10_BATCH_SIZE).collect();
    let endpoint = &cfg.warp10_endpoint;

    // Fire all chunk requests in parallel. One slow chunk can't mask the
    // others; one failing chunk doesn't lose the rest.
    let futures = chunks.into_iter().map(|chunk| {
        let script = metrics_last_script(&token, label_name, chunk);
        async move {
            let value = execute_warpscript(http, endpoint, &script).await?;
            Ok::<HashMap<String, MetricsTuple>, anyhow::Error>(
                split_metrics(&value, label_name),
            )
        }
    });
    let results = futures::future::join_all(futures).await;

    let mut out: HashMap<String, MetricsTuple> = HashMap::new();
    let mut had_success = false;
    let mut last_err: Option<anyhow::Error> = None;
    for r in results {
        match r {
            Ok(map) => {
                had_success = true;
                out.extend(map);
            }
            Err(e) => {
                tracing::warn!(error = ?e, "fetch_metrics chunk failed");
                last_err = Some(e);
            }
        }
    }
    // If every chunk failed, surface the last error so the caller still sees a
    // failure. If at least one succeeded, return the partial map — better to
    // paint metrics for some monitors than none.
    if !had_success {
        if let Some(e) = last_err {
            return Err(e);
        }
    }
    Ok(out)
}

/// Enumerate every Warp10 metric class CC has data for, scoped to a single
/// resource id over the last hour. Powers the per-monitor debug endpoint —
/// lets us see why some apps never show disk/net (CC just doesn't emit
/// those classes for them) without guessing.
pub async fn fetch_classes(
    cfg: &Config,
    http: &reqwest::Client,
    cc: &CcClient<'_>,
    cache: &TokenCache,
    user_id: Uuid,
    cc_org_id: &str,
    label_name: &str,
    metrics_id: &str,
) -> anyhow::Result<Vec<String>> {
    let token = tokens::ensure_token(cache, cc, user_id, cc_org_id).await?;
    let script = find_classes_script(&token, label_name, metrics_id);
    let value = execute_warpscript(http, &cfg.warp10_endpoint, &script).await?;
    Ok(extract_classes(&value))
}
