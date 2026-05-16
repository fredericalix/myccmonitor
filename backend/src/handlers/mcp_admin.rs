//! /api/mcp* routes — session-cookie auth. Manages the per-user MCP toggle
//! and Bearer token. The actual MCP protocol surface lives at `/mcp` and is
//! protected by [`crate::mcp::auth::mcp_auth_layer`].

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::db::users::{self, McpStatus};
use crate::error::AppError;
use crate::mcp::token;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/mcp", get(get_status))
        .route("/api/mcp/enable", post(enable))
        .route("/api/mcp/disable", post(disable))
        .route("/api/mcp/token", post(generate_token).delete(revoke_token))
}

#[derive(Serialize)]
struct StatusView {
    enabled: bool,
    has_token: bool,
    token_prefix: Option<String>,
    created_at: Option<DateTime<Utc>>,
    last_used_at: Option<DateTime<Utc>>,
    /// Absolute URL of the MCP endpoint. Convenient for the UI snippet
    /// generators ("paste this into Claude Code: `claude mcp add ...`").
    endpoint_url: String,
}

fn view(status: McpStatus, endpoint_url: String) -> StatusView {
    StatusView {
        enabled: status.enabled,
        has_token: status.has_token,
        token_prefix: status.token_prefix,
        created_at: status.created_at,
        last_used_at: status.last_used_at,
        endpoint_url,
    }
}

fn endpoint_url(state: &AppState) -> String {
    format!(
        "{}/mcp",
        state.cfg.public_base_url.trim_end_matches('/')
    )
}

async fn get_status(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<StatusView>, AppError> {
    let status = users::get_mcp_status(&state.pool, auth.id).await?;
    Ok(Json(view(status, endpoint_url(&state))))
}

async fn enable(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<StatusView>, AppError> {
    users::set_mcp_enabled(&state.pool, auth.id, true).await?;
    let status = users::get_mcp_status(&state.pool, auth.id).await?;
    Ok(Json(view(status, endpoint_url(&state))))
}

async fn disable(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<StatusView>, AppError> {
    users::set_mcp_enabled(&state.pool, auth.id, false).await?;
    let status = users::get_mcp_status(&state.pool, auth.id).await?;
    Ok(Json(view(status, endpoint_url(&state))))
}

#[derive(Serialize)]
struct TokenCreated {
    /// Full token, shown ONCE. Caller must store it now — no endpoint will
    /// return it again.
    token: String,
    token_prefix: String,
    created_at: DateTime<Utc>,
    endpoint_url: String,
}

async fn generate_token(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<TokenCreated>, AppError> {
    let generated = token::generate();
    let created_at = users::set_mcp_token(
        &state.pool,
        auth.id,
        &generated.hash,
        &generated.prefix,
    )
    .await?;
    tracing::info!(user_id = %auth.id, prefix = %generated.prefix, "mcp token generated");
    Ok(Json(TokenCreated {
        token: generated.raw,
        token_prefix: generated.prefix,
        created_at,
        endpoint_url: endpoint_url(&state),
    }))
}

async fn revoke_token(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<StatusCode, AppError> {
    users::clear_mcp_token(&state.pool, auth.id).await?;
    tracing::info!(user_id = %auth.id, "mcp token revoked");
    Ok(StatusCode::NO_CONTENT)
}
