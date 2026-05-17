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

use axum::Router;
use axum::middleware;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::tower::{
    StreamableHttpServerConfig, StreamableHttpService,
};

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
}
