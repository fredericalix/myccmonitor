//! MCP (Model Context Protocol) server.
//!
//! Mounts a Streamable HTTP endpoint at `/mcp` (POST for JSON-RPC + GET for
//! SSE resumability). Auth is Bearer token `mccm_…` validated against
//! `users.mcp_token_hash` by [`auth::mcp_auth_layer`]. Tools live in
//! [`server::McpServer`] and reuse the same `db::*` / `handlers::*` helpers
//! as the REST API.

pub mod auth;
pub mod server;
pub mod token;

use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::http::StatusCode;
use axum::middleware;
use axum::routing::get;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::tower::{
    StreamableHttpServerConfig, StreamableHttpService,
};
use serde_json::json;

use crate::state::AppState;

/// Build the `/mcp` router with Bearer auth applied. Called from `main.rs`
/// after `AppState` is constructed.
pub fn build_router(state: AppState) -> Router<AppState> {
    let factory_state = state.clone();
    // rmcp's default `allowed_hosts` is `["localhost", "127.0.0.1", "::1"]`
    // as a DNS-rebinding guard for locally-bound servers. We're a public
    // TLS-fronted endpoint with our own Bearer auth, so DNS rebinding isn't
    // the relevant threat model; disable the host check rather than chase
    // every CC subdomain.
    let config = StreamableHttpServerConfig::default().disable_allowed_hosts();
    let service = StreamableHttpService::new(
        move || Ok(server::McpServer::new(factory_state.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );

    // `route_layer` (NOT `layer`) is critical: the latter would apply the
    // Bearer middleware to every request reaching the merged top-level
    // router — including CC's `GET /` Ruby health probe, which would log
    // a noisy 401 every 60 s. `route_layer` scopes the middleware to
    // requests that actually match a route on this Router, i.e. /mcp only.
    Router::new()
        .route_service("/mcp", service)
        .route_layer(middleware::from_fn_with_state(state, auth::mcp_auth_layer))
        // OAuth discovery endpoints. The MCP SDK auto-probes these even when
        // the user has configured a static Bearer header; if they 404 with
        // HTML (default Next.js response) the SDK throws a noisy JSON-parse
        // error in the client. Returning `404 application/json` lets the SDK
        // see "no OAuth advertised" cleanly and fall back to the Bearer.
        .route("/.well-known/oauth-protected-resource", get(oauth_metadata_404))
        .route("/.well-known/oauth-authorization-server", get(oauth_metadata_404))
}

async fn oauth_metadata_404() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": "not_found",
            "error_description": "OAuth is not used by this MCP server. Authenticate with a Bearer token via the Authorization header."
        })),
    )
}
