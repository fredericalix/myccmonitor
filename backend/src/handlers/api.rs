//! Authenticated API routes under /api/*.
//! Phase 2: list orgs, set up webhook.

use crate::api::{CcClient, SUBSCRIBED_EVENTS};
use crate::auth::AuthenticatedUser;
use crate::db::monitors::Monitor;
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
use rand::RngCore;
use serde::Serialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/orgs", get(list_orgs))
        .route("/api/orgs/{cc_org_id}/webhook", post(setup_webhook))
        .route("/api/orgs/{cc_org_id}/monitors", get(list_monitors))
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

    // 32 random bytes → b64url, 43 chars.
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);

    let target_url = format!(
        "{}/webhooks/cc/{}",
        state.cfg.public_base_url.trim_end_matches('/'),
        token
    );

    let cc = CcClient::new(
        &state.http,
        &state.cfg,
        &auth.access_token,
        &auth.access_secret,
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
        cc_hook.id.as_deref(),
        &events,
    )
    .await?;

    Ok(Json(cfg))
}
