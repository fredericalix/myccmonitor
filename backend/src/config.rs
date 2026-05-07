use anyhow::{Context, Result, bail};
use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub public_base_url: String,
    pub database_url: String,

    pub cc_consumer_key: String,
    pub cc_consumer_secret: String,
    pub cc_api_base_url: String,

    /// AES-256-GCM key, 32 bytes, decoded once at startup.
    pub encryption_key: [u8; 32],

    pub pulsar_binary_url: String,
    pub pulsar_token: String,
    pub pulsar_tenant: String,
    pub pulsar_namespace: String,

    pub smtp_host: Option<String>,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
    pub smtp_from: Option<String>,

    pub instance_id: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let key_hex = req("APP_ENCRYPTION_KEY")?;
        let key_bytes = hex::decode(&key_hex)
            .context("APP_ENCRYPTION_KEY must be hex-encoded (use `openssl rand -hex 32`)")?;
        if key_bytes.len() != 32 {
            bail!("APP_ENCRYPTION_KEY must decode to exactly 32 bytes (got {})", key_bytes.len());
        }
        let mut encryption_key = [0u8; 32];
        encryption_key.copy_from_slice(&key_bytes);

        Ok(Self {
            port: env::var("PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8080),
            public_base_url: req("PUBLIC_BASE_URL")?,
            database_url: env::var("POSTGRESQL_ADDON_URI")
                .or_else(|_| env::var("DATABASE_URL"))
                .context("POSTGRESQL_ADDON_URI or DATABASE_URL is required")?,
            cc_consumer_key: req("CC_CONSUMER_KEY")?,
            cc_consumer_secret: req("CC_CONSUMER_SECRET")?,
            cc_api_base_url: env::var("CC_API_BASE_URL")
                .unwrap_or_else(|_| "https://api.clever-cloud.com".to_string()),
            encryption_key,
            pulsar_binary_url: req("PULSAR_BINARY_URL")?,
            pulsar_token: env::var("PULSAR_TOKEN").unwrap_or_default(),
            pulsar_tenant: req("PULSAR_TENANT")?,
            pulsar_namespace: req("PULSAR_NAMESPACE")?,
            smtp_host: env::var("SMTP_HOST").ok(),
            smtp_user: env::var("SMTP_USER").ok(),
            smtp_pass: env::var("SMTP_PASS").ok(),
            smtp_from: env::var("SMTP_FROM").ok(),
            instance_id: env::var("INSTANCE_ID").unwrap_or_else(|_| "local".to_string()),
        })
    }

    pub fn callback_url(&self) -> String {
        format!("{}/auth/callback", self.public_base_url.trim_end_matches('/'))
    }

    pub fn cookie_secure(&self) -> bool {
        self.public_base_url.starts_with("https://")
    }
}

fn req(name: &str) -> Result<String> {
    env::var(name).with_context(|| format!("env var {name} is required"))
}
