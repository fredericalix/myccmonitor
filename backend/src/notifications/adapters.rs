//! Notification adapters. Each one knows how to deliver one kind of message.

use crate::config::Config;
use crate::db::notification_channels::NotificationChannel;
use anyhow::{Context, Result, bail};
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde_json::json;

pub struct RenderedMessage<'a> {
    pub subject: &'a str,
    pub body: &'a str,
}

#[async_trait::async_trait]
pub trait NotificationAdapter: Send + Sync {
    async fn send(
        &self,
        cfg: &Config,
        http: &reqwest::Client,
        channel: &NotificationChannel,
        msg: &RenderedMessage<'_>,
    ) -> Result<()>;
}

pub struct EmailAdapter;
pub struct SlackAdapter;
pub struct DiscordAdapter;
pub struct GenericWebhookAdapter;

#[async_trait::async_trait]
impl NotificationAdapter for EmailAdapter {
    async fn send(
        &self,
        cfg: &Config,
        _http: &reqwest::Client,
        channel: &NotificationChannel,
        msg: &RenderedMessage<'_>,
    ) -> Result<()> {
        let host = cfg
            .smtp_host
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("SMTP_HOST not configured"))?;
        let from = cfg
            .smtp_from
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("SMTP_FROM not configured"))?;

        let to_list: Vec<String> = channel
            .config
            .get("to")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        if to_list.is_empty() {
            bail!("email channel '{}' has no `to` recipients", channel.name);
        }

        let prefix = channel
            .config
            .get("subject_prefix")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let subject = if prefix.is_empty() {
            msg.subject.to_string()
        } else {
            format!("{prefix} {}", msg.subject)
        };

        let mut builder = Message::builder()
            .from(from.parse().context("parse SMTP_FROM")?)
            .subject(subject);
        for to in &to_list {
            builder = builder.to(to.parse().with_context(|| format!("parse to '{to}'"))?);
        }
        let email = builder
            .header(ContentType::TEXT_PLAIN)
            .body(msg.body.to_string())
            .context("build email")?;

        let mailer: AsyncSmtpTransport<Tokio1Executor> =
            if let (Some(user), Some(pass)) = (cfg.smtp_user.as_ref(), cfg.smtp_pass.as_ref()) {
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?
                    .credentials(Credentials::new(user.to_string(), pass.to_string()))
                    .build()
            } else {
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?.build()
            };

        mailer.send(email).await.context("send email")?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl NotificationAdapter for SlackAdapter {
    async fn send(
        &self,
        _cfg: &Config,
        http: &reqwest::Client,
        channel: &NotificationChannel,
        msg: &RenderedMessage<'_>,
    ) -> Result<()> {
        let url = channel
            .config
            .get("webhook_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("slack channel missing `webhook_url`"))?;
        let body = if msg.subject.is_empty() {
            json!({ "text": msg.body })
        } else {
            json!({ "text": format!("*{}*\n{}", msg.subject, msg.body) })
        };
        let resp = http.post(url).json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("slack POST {status}: {body}");
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl NotificationAdapter for DiscordAdapter {
    async fn send(
        &self,
        _cfg: &Config,
        http: &reqwest::Client,
        channel: &NotificationChannel,
        msg: &RenderedMessage<'_>,
    ) -> Result<()> {
        let url = channel
            .config
            .get("webhook_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("discord channel missing `webhook_url`"))?;
        let body = if msg.subject.is_empty() {
            json!({ "content": msg.body })
        } else {
            json!({ "content": format!("**{}**\n{}", msg.subject, msg.body) })
        };
        let resp = http.post(url).json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("discord POST {status}: {body}");
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl NotificationAdapter for GenericWebhookAdapter {
    async fn send(
        &self,
        _cfg: &Config,
        http: &reqwest::Client,
        channel: &NotificationChannel,
        msg: &RenderedMessage<'_>,
    ) -> Result<()> {
        let url = channel
            .config
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("webhook channel missing `url`"))?;
        let method = channel
            .config
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("POST")
            .to_uppercase();
        let body = json!({ "subject": msg.subject, "body": msg.body });

        let mut req = match method.as_str() {
            "POST" => http.post(url),
            "PUT" => http.put(url),
            other => bail!("unsupported method {other}"),
        };

        if let Some(headers) = channel.config.get("headers").and_then(|v| v.as_object()) {
            for (k, v) in headers {
                if let Some(s) = v.as_str() {
                    req = req.header(k, s);
                }
            }
        }

        let resp = req.json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("webhook {method} {status}: {body}");
        }
        Ok(())
    }
}

pub fn for_kind(kind: &str) -> Result<Box<dyn NotificationAdapter>> {
    Ok(match kind {
        "email" => Box::new(EmailAdapter),
        "slack" => Box::new(SlackAdapter),
        "discord" => Box::new(DiscordAdapter),
        "webhook" => Box::new(GenericWebhookAdapter),
        other => bail!("unknown channel kind `{other}`"),
    })
}

pub fn validate_config(kind: &str, config: &serde_json::Value) -> Result<(), String> {
    match kind {
        "email" => {
            let to = config.get("to").and_then(|v| v.as_array());
            if to.map(|a| a.is_empty()).unwrap_or(true) {
                return Err("email config: `to` must be a non-empty array".into());
            }
        }
        "slack" | "discord" => {
            if config
                .get("webhook_url")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .is_none()
            {
                return Err(format!("{kind} config: `webhook_url` is required"));
            }
        }
        "webhook" => {
            if config
                .get("url")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .is_none()
            {
                return Err("webhook config: `url` is required".into());
            }
        }
        other => return Err(format!("unknown kind `{other}`")),
    }
    Ok(())
}
