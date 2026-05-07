//! POST /webhooks/cc/:token — CC's webhook endpoint. Lives outside the
//! session middleware. Auth is the opaque token in the URL (set up via
//! POST /api/orgs/:cc_org_id/webhook).
//!
//! Always replies 204 (No Content) on success and 401 only when the token is
//! unknown. Parse failures are logged and 204'd because CC retries on non-2xx
//! and we'd rather drop a malformed event than receive it forever.

use crate::bus::BusMessage;
use crate::db::webhook_configs;
use crate::state::AppState;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::post;

pub fn router() -> Router<AppState> {
    Router::new().route("/webhooks/cc/{token}", post(receive))
}

async fn receive(
    State(state): State<AppState>,
    Path(token): Path<String>,
    body: Bytes,
) -> StatusCode {
    let cfg = match webhook_configs::find_by_token(&state.pool, &token).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            tracing::warn!("webhook POST with unknown token");
            return StatusCode::UNAUTHORIZED;
        }
        Err(e) => {
            tracing::error!(error = ?e, "webhook token lookup failed");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
    };

    let bus_msg = BusMessage {
        token: cfg.token.clone(),
        user_id: cfg.user_id,
        cc_org_id: cfg.cc_org_id.clone(),
        raw_body: body.to_vec(),
        received_at_ms: chrono::Utc::now().timestamp_millis(),
    };

    if let Err(e) = state.bus.send_webhook(&bus_msg).await {
        tracing::error!(error = ?e, "Pulsar produce failed");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }

    if let Err(e) = webhook_configs::touch_last_received(&state.pool, cfg.id).await {
        tracing::warn!(error = ?e, "touch_last_received failed");
    }

    StatusCode::NO_CONTENT
}
