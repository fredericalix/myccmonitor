//! Bearer token middleware for the `/mcp` endpoint.
//!
//! Verifies `Authorization: Bearer mccm_…` against `users.mcp_token_hash`
//! (and that the matched user has `mcp_enabled = TRUE`). On success it
//! inserts an `McpAuth { user_id }` into the request's extensions so the
//! rmcp `StreamableHttpService` propagates it into each tool's
//! `RequestContext`.

use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, StatusCode, header::AUTHORIZATION};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use uuid::Uuid;

use crate::db::users;
use crate::mcp::token;
use crate::state::AppState;

#[derive(Debug, Clone, Copy)]
pub struct McpAuth {
    pub user_id: Uuid,
}

pub async fn mcp_auth_layer(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    // Diagnostic fields so we can attribute periodic unauthenticated probes
    // (CC health checks, scanners, stale clients) when they show up.
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let user_agent = req
        .headers()
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-")
        .to_string();

    let raw = match req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
    {
        Some(t) if t.starts_with(token::TOKEN_PREFIX) => t.to_string(),
        _ => return rejected("missing_or_malformed_bearer", &method, &path, &user_agent),
    };

    let hash = token::hash(&raw);
    let user_id = match users::find_by_mcp_token_hash(&state.pool, &hash).await {
        Ok(Some(id)) => id,
        Ok(None) => return rejected("invalid_token_or_mcp_disabled", &method, &path, &user_agent),
        Err(err) => {
            tracing::error!(error = ?err, "mcp auth db lookup failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
        }
    };

    // Fire-and-forget last_used_at update — never block the hot path.
    {
        let pool = state.pool.clone();
        tokio::spawn(async move {
            if let Err(e) = users::touch_mcp_last_used(&pool, user_id).await {
                tracing::warn!(error = ?e, %user_id, "touch_mcp_last_used failed");
            }
        });
    }

    req.extensions_mut().insert(McpAuth { user_id });
    next.run(req).await
}

fn rejected(
    reason: &str,
    method: &axum::http::Method,
    path: &str,
    user_agent: &str,
) -> Response {
    // Unauthenticated probes are expected (CC health checks, scanners,
    // disconnected clients reconnecting). Log at info so they stay visible
    // for a few days while we attribute the 60s-cadence requests; bumped
    // to warn when the *token* is actually wrong (real auth failure).
    if reason == "missing_or_malformed_bearer" {
        tracing::info!(%method, path, user_agent, reason, "mcp request rejected");
    } else {
        tracing::warn!(%method, path, user_agent, reason, "mcp request rejected");
    }
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"error": reason})),
    )
        .into_response()
}
