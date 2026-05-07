//! Pulsar consumer for `cc-webhooks`. Subscription type `Shared` so every
//! backend instance load-balances messages. Phase 2: parses + dedups + logs.
//! Phase 3 will dispatch to monitors / alerts / WS broadcast.

use crate::bus::BusMessage;
use crate::db::{webhook_configs, webhook_dedup};
use crate::webhooks::event::WebhookEnvelope;
use anyhow::Result;
use chrono::Duration;
use futures::TryStreamExt;
use pulsar::{Consumer, Pulsar, SubType, TokioExecutor};
use sqlx::PgPool;

pub async fn run(
    pulsar: Pulsar<TokioExecutor>,
    topic: String,
    subscription: String,
    pool: PgPool,
) -> Result<()> {
    let mut consumer: Consumer<Vec<u8>, _> = pulsar
        .consumer()
        .with_topic(topic.clone())
        .with_subscription_type(SubType::Shared)
        .with_subscription(subscription)
        .build()
        .await?;
    tracing::info!(%topic, "Pulsar consumer started");

    while let Some(msg) = consumer.try_next().await? {
        let payload = &msg.payload.data;
        let bus_msg: BusMessage = match serde_json::from_slice(payload) {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(error = ?e, "failed to parse BusMessage; acking + dropping");
                let _ = consumer.ack(&msg).await;
                continue;
            }
        };

        let envelope: Option<WebhookEnvelope> = serde_json::from_slice(&bus_msg.raw_body).ok();
        let event_label = envelope
            .as_ref()
            .map(|e| e.event.as_str())
            .unwrap_or("<unparsed>");

        // Cross-instance dedup
        if let Some(env) = envelope.as_ref() {
            let key = env.dedup_key();
            match webhook_dedup::try_record(&pool, &key, Duration::seconds(60)).await {
                Ok(true) => {}
                Ok(false) => {
                    tracing::debug!(event = event_label, "duplicate dropped");
                    let _ = consumer.ack(&msg).await;
                    continue;
                }
                Err(e) => {
                    tracing::warn!(error = ?e, "dedup record failed; proceeding");
                }
            }
        }

        // Phase 2: log only. Phase 3 wires monitor state updates + WS broadcast.
        tracing::info!(
            event = event_label,
            cc_org_id = %bus_msg.cc_org_id,
            user_id = %bus_msg.user_id,
            "webhook received"
        );

        if let Err(e) = webhook_configs::find_by_token(&pool, &bus_msg.token).await {
            tracing::warn!(error = ?e, "webhook_configs lookup failed");
        }

        let _ = consumer.ack(&msg).await;
    }

    Ok(())
}
