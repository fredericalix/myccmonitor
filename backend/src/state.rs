use crate::bus::WebhookProducer;
use crate::config::Config;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub pool: PgPool,
    pub http: reqwest::Client,
    pub bus: Arc<WebhookProducer>,
}
