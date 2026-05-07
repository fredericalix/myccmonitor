use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Pulsar payload for the `cc-webhooks` topic. We don't parse the CC body
/// here — the consumer does — so the raw bytes are passed through verbatim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusMessage {
    pub token: String,
    pub user_id: Uuid,
    pub cc_org_id: String,
    /// The raw JSON body POSTed by CC.
    #[serde(with = "serde_bytes")]
    pub raw_body: Vec<u8>,
    pub received_at_ms: i64,
}
