//! Real-time WebSocket layer. Each backend instance keeps a local in-memory
//! `OrgBus` (DashMap of broadcast channels per org). Producers (Pulsar consumer,
//! Phase 4 poller) emit `pg_notify('ws_broadcast', payload_json)`; a dedicated
//! `PgListener` task on every instance picks them up and pushes onto its local
//! org channels. WebSocket clients connect to `GET /ws?org=cc_org_id` and
//! receive frames for that org regardless of which instance produced them.

pub mod handler;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::postgres::PgListener;
use tokio::sync::broadcast;
use uuid::Uuid;

pub use handler::router;

/// All frame variants the backend pushes to WS clients. Tagged with `type`
/// in JSON so the frontend can switch on it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsFrame {
    MonitorState {
        monitor_id: Uuid,
        state: String,
        message: Option<String>,
        since: Option<DateTime<Utc>>,
    },
    WebhookHealth {
        cc_org_id: String,
        last_received_at: DateTime<Utc>,
    },
    MetricsSnapshot {
        monitor_id: Uuid,
        ts: DateTime<Utc>,
        cpu: Option<f64>,
        mem: Option<f64>,
    },
    RuleFiring {
        rule_id: Uuid,
        rule_name: String,
        outcome: String,
        fired_at: DateTime<Utc>,
        trigger_kind: String,
        trigger_ref: Option<Uuid>,
    },
}

/// Payload of `pg_notify('ws_broadcast', ...)`. Producers serialize this and
/// send it via SELECT pg_notify; the listener loop deserializes it on every
/// instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BroadcastPayload {
    pub cc_org_id: String,
    pub frame: WsFrame,
}

const BROADCAST_CAPACITY: usize = 256;

#[derive(Default)]
pub struct OrgBus {
    inner: DashMap<String, broadcast::Sender<WsFrame>>,
}

impl OrgBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self, cc_org_id: &str) -> broadcast::Receiver<WsFrame> {
        self.inner
            .entry(cc_org_id.to_string())
            .or_insert_with(|| broadcast::channel(BROADCAST_CAPACITY).0)
            .subscribe()
    }

    pub fn send(&self, cc_org_id: &str, frame: WsFrame) {
        if let Some(tx) = self.inner.get(cc_org_id) {
            // Errors here only mean "no current subscribers" — drop silently.
            let _ = tx.send(frame);
        }
    }
}

/// Helper for producers: emit a `BroadcastPayload` over Postgres LISTEN/NOTIFY.
/// Every backend instance with a live LISTEN connection will see it within ~50ms.
pub async fn broadcast_via_pg(
    pool: &PgPool,
    cc_org_id: &str,
    frame: WsFrame,
) -> anyhow::Result<()> {
    let payload = serde_json::to_string(&BroadcastPayload {
        cc_org_id: cc_org_id.to_string(),
        frame,
    })?;
    sqlx::query("SELECT pg_notify('ws_broadcast', $1)")
        .bind(&payload)
        .execute(pool)
        .await?;
    Ok(())
}

/// Variant for org-agnostic frames (rule firings). Broadcasts on the
/// `__system__` org channel — clients can subscribe via `GET /ws?org=__system__`.
pub async fn broadcast_via_pg_ignore_error(
    pool: &PgPool,
    frame: WsFrame,
) -> anyhow::Result<()> {
    broadcast_via_pg(pool, "__system__", frame).await
}

/// Long-running task: LISTEN ws_broadcast and route incoming notifications to
/// the local OrgBus. One per backend instance. Returns only on unrecoverable
/// error; the spawn site logs it but does not bring the whole backend down.
pub async fn run_listen_notify(
    pool: PgPool,
    bus: std::sync::Arc<OrgBus>,
) -> anyhow::Result<()> {
    let mut listener = PgListener::connect_with(&pool).await?;
    listener.listen("ws_broadcast").await?;
    tracing::info!("LISTEN ws_broadcast active");

    loop {
        let notification = listener.recv().await?;
        let payload = notification.payload();
        match serde_json::from_str::<BroadcastPayload>(payload) {
            Ok(p) => bus.send(&p.cc_org_id, p.frame),
            Err(e) => tracing::warn!(error = ?e, payload, "bad ws_broadcast payload"),
        }
    }
}
