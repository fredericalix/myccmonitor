mod api;
mod auth;
mod bus;
mod config;
mod db;
mod groups;
mod handlers;
mod monitors;
mod notifications;
mod rules;
mod webhooks;
mod ws;

use anyhow::Result;
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=info")),
        )
        .init();

    tracing::info!("myccmonitor-backend starting (phase 0 skeleton)");

    let cfg = config::Config::from_env()?;
    tracing::info!(port = cfg.port, public_base_url = %cfg.public_base_url, "config loaded");

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    let app = axum::Router::new().route("/health", axum::routing::get(health));

    tracing::info!(addr = %listener.local_addr()?, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}
