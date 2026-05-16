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
    let service = StreamableHttpService::new(
        move || Ok(server::McpServer::new(factory_state.clone())),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    );

    Router::new()
        .route_service("/mcp", service)
        .layer(middleware::from_fn_with_state(state, auth::mcp_auth_layer))
}
