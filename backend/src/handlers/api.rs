//! Authenticated API routes under /api/*.
//! Phase 2: list orgs, set up webhook.

use crate::api::{CcClient, SUBSCRIBED_EVENTS};
use crate::auth::AuthenticatedUser;
use crate::db::metric_samples::{self, MetricSample};
use crate::db::monitors::{self, Monitor};
use crate::db::orgs::{self, Org, OrgInput};
use crate::db::webhook_configs::{self, WebhookConfig};
use crate::error::AppError;
use crate::metrics;
use crate::monitors::sync;
use crate::state::AppState;
use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::routing::{get, post};
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::Serialize;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/orgs", get(list_orgs))
        .route("/api/orgs/{cc_org_id}/webhook", post(setup_webhook))
        .route("/api/orgs/{cc_org_id}/monitors", get(list_monitors))
        .route("/api/orgs/{cc_org_id}/snapshots", get(list_snapshots))
        .route(
            "/api/orgs/{cc_org_id}/monitors/{monitor_id}/debug",
            get(monitor_debug),
        )
}

/// Five Warp10 classes the poller queries on every cycle. Re-listed here so
/// the debug payload can compute `missing_classes = expected ∖ warp10` and
/// answer "why is disk/net null for this app?" in one round-trip.
const EXPECTED_WARP10_CLASSES: &[&str] = &[
    "cpu.usage_user",
    "mem.used_percent",
    "disk.used_percent",
    "net.bytes_recv",
    "net.bytes_sent",
];

#[derive(Serialize)]
struct MonitorDebugResponse {
    monitor: Monitor,
    cc_metrics_id: Option<String>,
    /// Every class Warp10 actually has data for over the last hour, scoped
    /// to this monitor's metrics id. Includes system classes the poller
    /// doesn't consume — useful for debugging.
    warp10_classes: Vec<String>,
    expected_classes: &'static [&'static str],
    /// `expected_classes ∖ warp10_classes`. If non-empty, those classes are
    /// genuinely not emitted by CC for this app — the bars will stay "n/a".
    missing_classes: Vec<String>,
    latest_sample: Option<MetricSample>,
    last_poll_at: Option<DateTime<Utc>>,
    note: Option<&'static str>,
}

async fn monitor_debug(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path((cc_org_id, monitor_id)): Path<(String, Uuid)>,
) -> Result<Json<MonitorDebugResponse>, AppError> {
    // Multi-tenant: org ownership AND monitor.user_id == auth.id (the latter
    // is enforced by find_by_id_for_user). Defense in depth: also verify
    // monitor.cc_org_id == cc_org_id so a leaked monitor_id can't be queried
    // through a foreign org URL.
    let _org = orgs::find_by_user_and_cc_id(&state.pool, auth.id, &cc_org_id)
        .await?
        .ok_or(AppError::Forbidden)?;
    let monitor = monitors::find_by_id_for_user(&state.pool, auth.id, monitor_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("monitor {monitor_id} not found")))?;
    if monitor.cc_org_id.as_deref() != Some(cc_org_id.as_str()) {
        return Err(AppError::Forbidden);
    }

    let last_poll_at = monitor.last_poll_at;
    let latest_sample = metric_samples::latest(&state.pool, monitor.id).await?;

    // Synthetic monitors and any monitor without a metrics id can't be
    // probed against Warp10. Return early with an explanation rather than
    // making a useless API call.
    let Some(metrics_id) = monitor.cc_metrics_id.clone() else {
        return Ok(Json(MonitorDebugResponse {
            monitor,
            cc_metrics_id: None,
            warp10_classes: Vec::new(),
            expected_classes: EXPECTED_WARP10_CLASSES,
            missing_classes: EXPECTED_WARP10_CLASSES.iter().map(|s| s.to_string()).collect(),
            latest_sample,
            last_poll_at,
            note: Some("monitor has no Warp10 mapping (synthetic or pre-migration row)"),
        }));
    };

    let cc = CcClient::new(
        &state.http,
        &state.cfg,
        &auth.access_token,
        &auth.access_secret,
    );
    let warp10_classes = metrics::fetch_classes(
        &state.cfg,
        &state.http,
        &cc,
        &state.warp10_token_cache,
        auth.id,
        &cc_org_id,
        "app_id",
        &metrics_id,
    )
    .await
    .map_err(|e| AppError::CcApi(format!("warp10 FIND: {e}")))?;

    let warp10_set: std::collections::HashSet<&str> =
        warp10_classes.iter().map(String::as_str).collect();
    let missing_classes: Vec<String> = EXPECTED_WARP10_CLASSES
        .iter()
        .filter(|c| !warp10_set.contains(*c))
        .map(|s| s.to_string())
        .collect();

    Ok(Json(MonitorDebugResponse {
        monitor,
        cc_metrics_id: Some(metrics_id),
        warp10_classes,
        expected_classes: EXPECTED_WARP10_CLASSES,
        missing_classes,
        latest_sample,
        last_poll_at,
        note: None,
    }))
}

async fn list_snapshots(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(cc_org_id): Path<String>,
) -> Result<Json<Vec<MetricSample>>, AppError> {
    // Multi-tenant: verify org ownership before reading; the SQL JOIN below
    // filters by user_id too as defense in depth.
    let _org = orgs::find_by_user_and_cc_id(&state.pool, auth.id, &cc_org_id)
        .await?
        .ok_or(AppError::Forbidden)?;
    let rows = metric_samples::latest_for_org(&state.pool, auth.id, &cc_org_id).await?;
    Ok(Json(rows))
}

async fn list_monitors(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(cc_org_id): Path<String>,
) -> Result<Json<Vec<Monitor>>, AppError> {
    let _org = orgs::find_by_user_and_cc_id(&state.pool, auth.id, &cc_org_id)
        .await?
        .ok_or(AppError::Forbidden)?;

    let cc = CcClient::new(
        &state.http,
        &state.cfg,
        &auth.access_token,
        &auth.access_secret,
    );
    let monitors = sync::sync_org(&state.pool, &cc, auth.id, &cc_org_id)
        .await
        .map_err(|e| AppError::CcApi(format!("sync_org: {e}")))?;
    Ok(Json(monitors))
}

#[derive(Serialize)]
struct Me {
    user_id: uuid::Uuid,
    cc_user_id: String,
    email: Option<String>,
    display_name: Option<String>,
}

async fn me(auth: AuthenticatedUser) -> Json<Me> {
    Json(Me {
        user_id: auth.id,
        cc_user_id: auth.user.cc_user_id,
        email: auth.user.email,
        display_name: auth.user.display_name,
    })
}

async fn list_orgs(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<Org>>, AppError> {
    let cc = CcClient::new(
        &state.http,
        &state.cfg,
        &auth.access_token,
        &auth.access_secret,
    );
    let cc_orgs = cc
        .list_organisations()
        .await
        .map_err(|e| AppError::CcApi(format!("list_organisations: {e}")))?;

    let inputs: Vec<OrgInput<'_>> = cc_orgs
        .iter()
        .map(|o| OrgInput {
            cc_org_id: &o.id,
            name: Some(o.name.as_str()),
            avatar_url: o.avatar.as_deref(),
        })
        .collect();

    let orgs = orgs::replace_for_user(&state.pool, auth.id, &inputs).await?;
    Ok(Json(orgs))
}

async fn setup_webhook(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(cc_org_id): Path<String>,
) -> Result<Json<WebhookConfig>, AppError> {
    // Belt-and-braces: refuse if the user doesn't own this org in our cache.
    // (Without a cached org row, GET /api/orgs hasn't been called yet — call
    // it first; this also guards against handing a token to an org the user
    // can't actually access via their own CC token.)
    let _org = orgs::find_by_user_and_cc_id(&state.pool, auth.id, &cc_org_id)
        .await?
        .ok_or_else(|| AppError::Forbidden)?;

    let cc = CcClient::new(
        &state.http,
        &state.cfg,
        &auth.access_token,
        &auth.access_secret,
    );

    // Idempotent: every webhook we have ever created on this org points at
    // `{public_base_url}/webhooks/cc/{token}`. Wipe anything matching that
    // prefix before creating a fresh one — bulletproof against orphans from
    // before this fix shipped, rows where `cc_webhook_id` is NULL, and
    // duplicates from a double-click.
    let our_prefix = format!(
        "{}/webhooks/cc/",
        state.cfg.public_base_url.trim_end_matches('/')
    );
    match cc.list_webhooks(&cc_org_id).await {
        Ok(hooks) => {
            for hook in hooks {
                let is_ours = hook.urls.iter().any(|u| u.url.starts_with(&our_prefix));
                if !is_ours {
                    continue;
                }
                if let Err(e) = cc.delete_webhook(&cc_org_id, &hook.id).await {
                    tracing::warn!(
                        error = ?e,
                        %cc_org_id,
                        webhook_id = %hook.id,
                        "failed to delete stale CC webhook; proceeding anyway"
                    );
                } else {
                    tracing::info!(
                        %cc_org_id,
                        webhook_id = %hook.id,
                        "deleted stale CC webhook"
                    );
                }
            }
        }
        Err(e) => {
            tracing::warn!(
                error = ?e,
                %cc_org_id,
                "failed to list CC webhooks before create; proceeding"
            );
        }
    }

    // 32 random bytes → b64url, 43 chars.
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);

    let target_url = format!(
        "{}/webhooks/cc/{}",
        state.cfg.public_base_url.trim_end_matches('/'),
        token
    );

    let cc_hook = cc
        .create_webhook(&cc_org_id, "myccmonitor", &target_url, SUBSCRIBED_EVENTS)
        .await
        .map_err(|e| AppError::CcApi(format!("create_webhook: {e}")))?;

    let events: Vec<String> = SUBSCRIBED_EVENTS.iter().map(|s| s.to_string()).collect();
    let cfg = webhook_configs::create(
        &state.pool,
        auth.id,
        &cc_org_id,
        &token,
        Some(&cc_hook.id),
        &events,
    )
    .await?;

    Ok(Json(cfg))
}
