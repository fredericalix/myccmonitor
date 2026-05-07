mod api;
mod auth;
mod bus;
mod config;
mod db;
mod error;
mod groups;
mod handlers;
mod monitors;
mod notifications;
mod rules;
mod state;
mod webhooks;
mod ws;

use anyhow::Result;
use axum::{Router, routing::get};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use std::time::Duration;
use tower_sessions::{Expiry, SessionManagerLayer, cookie::SameSite};
use tower_sessions_sqlx_store::PostgresStore;
use tracing_subscriber::{EnvFilter, fmt};

use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=info")),
        )
        .init();

    let cfg = Arc::new(config::Config::from_env()?);
    tracing::info!(
        instance_id = %cfg.instance_id,
        port = cfg.port,
        public_base_url = %cfg.public_base_url,
        "myccmonitor-backend starting"
    );

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&cfg.database_url)
        .await?;
    tracing::info!("connected to postgres");

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("sqlx migrations applied");

    // tower-sessions-sqlx-store creates its own schema/table.
    let session_store = PostgresStore::new(pool.clone());
    session_store.migrate().await?;
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(cfg.cookie_secure())
        .with_same_site(SameSite::Lax)
        .with_expiry(Expiry::OnInactivity(time::Duration::days(7)));
    tracing::info!("session store ready");

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    let state = AppState {
        cfg: cfg.clone(),
        pool,
        http,
    };

    let app = Router::new()
        .route("/health", get(health))
        .merge(auth::router())
        .layer(session_layer)
        .with_state(state);

    let addr = ("0.0.0.0", cfg.port);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(addr = %listener.local_addr()?, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}
