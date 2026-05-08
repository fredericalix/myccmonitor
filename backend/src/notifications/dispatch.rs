//! Top-level send: build template context, render subject + body, hand off to
//! the matching adapter. Retries 3× with exponential backoff (1s → 4s → 16s).
//! Records success / failure on the channel row and returns the alert id that
//! was inserted for the audit log.

use crate::db::alerts;
use crate::db::monitors::Monitor;
use crate::db::notification_channels::{self, NotificationChannel};
use crate::db::rules::Rule;
use crate::notifications::adapters::{RenderedMessage, for_kind};
use crate::notifications::template;
use crate::state::AppState;
use anyhow::{Result, bail};
use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct NotifContext<'a> {
    pub rule: &'a Rule,
    pub monitor: Option<&'a Monitor>,
    pub trigger_kind: &'a str,
    pub trigger_ref: Option<Uuid>,
    pub level: &'a str,
}

pub async fn dispatch(
    state: &AppState,
    channel_id: Uuid,
    rule: &Rule,
    user_id: Uuid,
    trigger_kind: &str,
    trigger_ref: Option<Uuid>,
    raw_message: &str,
    raw_subject: Option<&str>,
) -> Result<Uuid> {
    // Best-effort look up the monitor that triggered, if any.
    let monitor = match trigger_ref {
        Some(id) => crate::db::monitors::find_by_id_for_user(&state.pool, user_id, id)
            .await
            .ok()
            .flatten(),
        None => None,
    };
    let ctx_value = json!({
        "rule": {
            "id": rule.id,
            "name": rule.name,
        },
        "trigger": {
            "kind": trigger_kind,
            "ref": trigger_ref,
        },
        "monitor": monitor.as_ref().map(|m| json!({
            "id": m.id,
            "display_name": m.display_name,
            "kind": m.kind,
            "current_state": m.current_state,
            "current_message": m.current_message,
            "current_state_since": m.current_state_since,
            "cc_resource_id": m.cc_resource_id,
            "cc_org_id": m.cc_org_id,
        })),
    });

    let default_subject = format!(
        "[{}] {}",
        rule.name,
        monitor
            .as_ref()
            .map(|m| m.display_name.as_str())
            .unwrap_or("alert"),
    );
    let default_body = format!(
        "Rule '{}' fired (trigger={}). Monitor: {}.",
        rule.name,
        trigger_kind,
        monitor
            .as_ref()
            .map(|m| format!(
                "{} ({}) — {}",
                m.display_name, m.kind, m.current_state
            ))
            .unwrap_or_else(|| "n/a".to_string()),
    );

    let subject = template::render(raw_subject.unwrap_or(""), &ctx_value, &default_subject);
    let body = template::render(raw_message, &ctx_value, &default_body);

    let channel = notification_channels::find(&state.pool, user_id, channel_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("channel {channel_id} not found"))?;
    if !channel.enabled {
        tracing::warn!(
            %channel_id,
            channel_name = %channel.name,
            channel_kind = %channel.kind,
            rule_id = %rule.id,
            "channel disabled; aborting dispatch"
        );
        bail!("channel '{}' is disabled", channel.name);
    }
    tracing::info!(
        %channel_id,
        channel_name = %channel.name,
        channel_kind = %channel.kind,
        rule_id = %rule.id,
        rule_name = %rule.name,
        "dispatching notification"
    );

    let adapter = for_kind(&channel.kind)?;
    let rendered = RenderedMessage {
        subject: &subject,
        body: &body,
    };

    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..3u32 {
        if attempt > 0 {
            // 1s, 4s, 16s
            let delay = 1u64 << (2 * (attempt - 1));
            sleep(Duration::from_secs(delay)).await;
        }
        match adapter.send(&state.cfg, &state.http, &channel, &rendered).await {
            Ok(()) => {
                tracing::info!(
                    %channel_id,
                    channel_kind = %channel.kind,
                    attempt,
                    rule_id = %rule.id,
                    "notification delivered"
                );
                let _ = notification_channels::record_success(&state.pool, channel.id).await;
                let alert_id = alerts::insert(
                    &state.pool,
                    user_id,
                    monitor.as_ref().map(|m| m.id),
                    Some(rule.id),
                    rendered_level(rule, monitor.as_ref()),
                    Some(&body),
                    Some(json!({
                        "channel_id": channel.id,
                        "channel_kind": channel.kind,
                        "subject": subject,
                        "trigger_kind": trigger_kind,
                        "delivered": true,
                    })),
                )
                .await?;
                // Mark the alert as notified.
                let _ = sqlx::query(
                    "UPDATE alerts SET notified_at = now() WHERE id = $1",
                )
                .bind(alert_id)
                .execute(&state.pool)
                .await;
                return Ok(alert_id);
            }
            Err(e) => {
                tracing::warn!(error = ?e, attempt, "notification send failed");
                last_err = Some(e);
            }
        }
    }

    let err_msg = last_err
        .as_ref()
        .map(|e| format!("{e}"))
        .unwrap_or_else(|| "unknown error".to_string());
    let _ = notification_channels::record_failure(&state.pool, channel.id, &err_msg).await;
    let alert_id = alerts::insert(
        &state.pool,
        user_id,
        monitor.as_ref().map(|m| m.id),
        Some(rule.id),
        "error",
        Some(&format!("delivery failed after 3 attempts: {err_msg}")),
        Some(json!({
            "channel_id": channel.id,
            "channel_kind": channel.kind,
            "subject": subject,
            "trigger_kind": trigger_kind,
            "delivered": false,
        })),
    )
    .await?;
    bail!("notification dispatch failed: {err_msg} (alert {alert_id})");
}

fn rendered_level(_rule: &Rule, monitor: Option<&Monitor>) -> &'static str {
    match monitor.map(|m| m.current_state.as_str()) {
        Some("critical") => "critical",
        Some("warning") => "warning",
        Some("ok") => "recovered",
        _ => "info",
    }
}
