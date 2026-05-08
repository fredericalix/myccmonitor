//! Apache Pulsar event bus: producer + consumer for `cc-webhooks`
//! (30d retention, audit log) and `rule-escalations` (Phase 8 delayed
//! delivery via `deliver_at_time`).

pub mod consumer;
pub mod escalations;
pub mod message;
pub mod producer;

pub use escalations::{EscalationMessage, EscalationProducer};
pub use message::BusMessage;
pub use producer::WebhookProducer;

use crate::config::Config;
use anyhow::{Context, Result};
use pulsar::{Authentication, Pulsar, TokioExecutor};

pub async fn connect(cfg: &Config) -> Result<Pulsar<TokioExecutor>> {
    let mut builder = Pulsar::builder(cfg.pulsar_binary_url.clone(), TokioExecutor);
    if !cfg.pulsar_token.is_empty() {
        builder = builder.with_auth(Authentication {
            name: "token".to_string(),
            data: cfg.pulsar_token.clone().into_bytes(),
        });
    }
    builder.build().await.context("connect to Pulsar broker")
}
