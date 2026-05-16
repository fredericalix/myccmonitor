mod api;
mod auth;
mod bus;
mod config;
mod db;
mod error;
mod groups;
mod handlers;
mod mcp;
mod metrics;
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
        pulsar = %cfg.pulsar_binary_url,
        "myccmonitor-backend starting"
    );

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&cfg.database_url)
        .await?;
    tracing::info!("connected to postgres");

    // Custom migration runner. We tried both `sqlx::migrate!` (caching issues
    // when adding files post-build) and `sqlx::migrate::Migrator::new` (silently
    // no-ops in our setup); this 20-line direct loop is explicit and reliable.
    {
        let migrations_dir =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations");
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS _myccmonitor_migrations (\
                version BIGINT PRIMARY KEY, \
                name TEXT NOT NULL, \
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        )
        .execute(&pool)
        .await?;

        let mut entries: Vec<_> = std::fs::read_dir(&migrations_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path().extension().and_then(|x| x.to_str()) == Some("sql")
                    && !e.file_name().to_string_lossy().starts_with('.')
            })
            .collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let fname = entry.file_name().to_string_lossy().to_string();
            let version: i64 = fname
                .split('_')
                .next()
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| anyhow::anyhow!("bad migration filename: {fname}"))?;

            let already: Option<(i64,)> = sqlx::query_as(
                "SELECT version FROM _myccmonitor_migrations WHERE version = $1",
            )
            .bind(version)
            .fetch_optional(&pool)
            .await?;
            if already.is_some() {
                tracing::debug!(version, name = %fname, "migration already applied");
                continue;
            }

            let sql = std::fs::read_to_string(entry.path())?;
            sqlx::raw_sql(&sql).execute(&pool).await?;
            sqlx::query(
                "INSERT INTO _myccmonitor_migrations (version, name) VALUES ($1, $2)",
            )
            .bind(version)
            .bind(&fname)
            .execute(&pool)
            .await?;
            tracing::info!(version, name = %fname, "migration applied");
        }
    }
    tracing::info!("migrations done");

    // tower-sessions-sqlx-store creates its own schema/table.
    let session_store = PostgresStore::new(pool.clone());
    session_store.migrate().await?;
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(cfg.cookie_secure())
        .with_same_site(SameSite::Lax)
        .with_expiry(Expiry::OnInactivity(time::Duration::days(7)));
    tracing::info!("session store ready");

    let pulsar = bus::connect(&cfg).await?;
    let cc_webhooks_topic = cfg.pulsar_topic("cc-webhooks");
    let producer =
        bus::WebhookProducer::build(&pulsar, &cc_webhooks_topic, &cfg.instance_id).await?;
    tracing::info!(topic = %cc_webhooks_topic, "Pulsar producer ready");

    let escalations_topic = cfg.pulsar_topic("rule-escalations");
    let escalation_producer =
        bus::EscalationProducer::build(&pulsar, &escalations_topic, &cfg.instance_id).await?;
    tracing::info!(topic = %escalations_topic, "Pulsar escalation producer ready");

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    // Per-instance WebSocket bus + LISTEN/NOTIFY bridge.
    let ws_bus = Arc::new(ws::OrgBus::new());
    {
        let pool = pool.clone();
        let bus = ws_bus.clone();
        tokio::spawn(async move {
            if let Err(e) = ws::run_listen_notify(pool, bus).await {
                tracing::error!(error = ?e, "LISTEN/NOTIFY task exited");
            }
        });
    }

    // Phase 4 Warp10 poller: shared in-memory cache for the metrics tokens.
    let warp10_token_cache = Arc::new(metrics::tokens::TokenCache::new());

    // Build AppState early so spawned background tasks (webhook consumer,
    // poller, escalation consumer) all share the same state and can fire
    // dependent rules through `rules::exec::trigger_for_monitor`.
    let state = AppState {
        cfg: cfg.clone(),
        pool: pool.clone(),
        http: http.clone(),
        bus: Arc::new(producer),
        ws_bus,
        warp10_token_cache,
        escalation_producer: Arc::new(escalation_producer),
    };

    // Spawn the webhook consumer in its own task. If it dies, log and don't bring the whole backend down —
    // the producer still works, webhooks keep accruing in the topic until restart.
    {
        let pulsar = pulsar.clone();
        let state = state.clone();
        let topic = cc_webhooks_topic.clone();
        tokio::spawn(async move {
            if let Err(e) =
                bus::consumer::run(pulsar, topic, "myccmonitor-processor".to_string(), state).await
            {
                tracing::error!(error = ?e, "Pulsar consumer task exited with error");
            }
        });
    }

    {
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = monitors::poller::run(state).await {
                tracing::error!(error = ?e, "Warp10 poller task exited");
            }
        });
    }

    // Phase 8 escalation consumer: re-evaluates rules when a delayed Pulsar
    // message becomes due. Same Shared subscription model as the webhook
    // consumer so multi-instance load-balances naturally.
    {
        let pulsar_clone = pulsar.clone();
        let state_clone = state.clone();
        let topic = escalations_topic.clone();
        tokio::spawn(async move {
            if let Err(e) = bus::escalations::run_consumer(
                pulsar_clone,
                topic,
                "myccmonitor-escalator".to_string(),
                state_clone,
            )
            .await
            {
                tracing::error!(error = ?e, "Escalation consumer task exited");
            }
        });
    }

    let mcp_router = mcp::build_router(state.clone());
    tracing::info!(
        endpoint = %format!("{}/mcp", cfg.public_base_url.trim_end_matches('/')),
        "MCP endpoint mounted"
    );

    let app = Router::new()
        .route("/health", get(health))
        .merge(auth::router())
        .merge(handlers::api_router())
        .merge(handlers::groups_router())
        .merge(handlers::rules_router())
        .merge(handlers::channels_router())
        .merge(handlers::mcp_admin_router())
        .merge(webhooks::router())
        .merge(ws::router())
        .merge(mcp_router)
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
