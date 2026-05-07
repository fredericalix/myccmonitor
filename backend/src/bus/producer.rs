use crate::bus::BusMessage;
use anyhow::{Context, Result};
use pulsar::{Pulsar, TokioExecutor, producer};
use tokio::sync::Mutex;

pub struct WebhookProducer {
    inner: Mutex<producer::Producer<TokioExecutor>>,
}

impl WebhookProducer {
    pub async fn build(
        pulsar: &Pulsar<TokioExecutor>,
        topic: &str,
        instance_id: &str,
    ) -> Result<Self> {
        // Producer name must be unique per instance, otherwise Pulsar returns
        // ProducerBusy when a stale connection is still considered active.
        let unique = uuid::Uuid::new_v4().simple().to_string();
        let name = format!("myccmonitor-producer-{instance_id}-{unique}");
        let inner = pulsar
            .producer()
            .with_topic(topic)
            .with_name(name)
            .build()
            .await
            .with_context(|| format!("build Pulsar producer on {topic}"))?;
        Ok(Self {
            inner: Mutex::new(inner),
        })
    }

    pub async fn send_webhook(&self, msg: &BusMessage) -> Result<()> {
        let payload = serde_json::to_vec(msg)?;
        let partition_key = msg.cc_org_id.clone();
        let mut guard = self.inner.lock().await;
        let receipt = guard
            .send_non_blocking(producer::Message {
                partition_key: Some(partition_key),
                payload,
                ..Default::default()
            })
            .await?;
        // Block on broker ack. For higher throughput we could fire-and-forget
        // here and let the receipts task collect — Phase 2 prefers correctness.
        receipt.await?;
        Ok(())
    }
}
