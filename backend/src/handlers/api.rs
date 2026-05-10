//! Authenticated API routes under /api/*.
//! Phase 2: list orgs, set up webhook.

use crate::api::{CcClient, SUBSCRIBED_EVENTS};
use crate::auth::AuthenticatedUser;
use crate::db::metric_samples::{self, MetricSample};
use crate::db::monitors::{self, Monitor};
use crate::db::orgs::{self, Org, OrgInput};
use crate::db::webhook_configs::{self, WebhookConfig};
use crate::error::AppError;
use crate::monitors::sync;
use crate::state::AppState;
use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::routing::{get, post};
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
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

/// Five metrics the poller writes to `metric_samples` on every cycle. The
/// debug endpoint compares this set against what the table actually has on
/// the last 30 min to answer "why is disk/net empty for this app?".
const EXPECTED_METRICS: &[&str] = &["cpu", "mem", "disk", "net_in", "net_out"];
const DEBUG_WINDOW_MINUTES: i64 = 30;

#[derive(Serialize)]
struct MonitorDebugResponse {
    monitor: Monitor,
    cc_metrics_id: Option<String>,
    /// Number of poll samples written for this monitor in the analysis
    /// window. 0 means the poller hasn't written anything yet — expect a
    /// value within 60 s.
    samples_count_30m: i64,
    window: &'static str,
    /// Metrics with at least one non-null value in the window. These are
    /// the ones CC's Warp10 actually emits for this app's runtime.
    available_metrics: Vec<&'static str>,
    /// `expected_metrics ∖ available_metrics`. The answer to the user's
    /// "why is disk/net empty?" — these are not emitted by CC for this app.
    missing_metrics: Vec<&'static str>,
    expected_metrics: &'static [&'static str],
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
    let since = Utc::now() - Duration::minutes(DEBUG_WINDOW_MINUTES);
    let availability = metric_samples::availability(&state.pool, monitor.id, since).await?;

    let mut available_metrics = Vec::new();
    let mut missing_metrics = Vec::new();
    let pairs: [(&'static str, bool); 5] = [
        ("cpu", availability.cpu),
        ("mem", availability.mem),
        ("disk", availability.disk),
        ("net_in", availability.net_in),
        ("net_out", availability.net_out),
    ];
    for (name, present) in pairs {
        if present {
            available_metrics.push(name);
        } else {
            missing_metrics.push(name);
        }
    }

    let note = if monitor.cc_metrics_id.is_none() {
        Some("synthetic monitor — not backed by Warp10 data")
    } else if availability.samples_count == 0 {
        Some("no samples written in the last 30 min — wait for the next poll cycle (~60 s)")
    } else {
        None
    };

    Ok(Json(MonitorDebugResponse {
        monitor: monitor.clone(),
        cc_metrics_id: monitor.cc_metrics_id.clone(),
        samples_count_30m: availability.samples_count,
        window: "30m",
        available_metrics,
        missing_metrics,
        expected_metrics: EXPECTED_METRICS,
        latest_sample,
        last_poll_at,
        note,
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
