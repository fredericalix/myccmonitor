//! Pulsar consumer for `cc-webhooks`. Subscription type `Shared` so every
//! backend instance load-balances messages.
//!
//! Phase 2: parses + dedups + logs.
//! Phase 3 (this version): also maps the event to a monitor state transition,
//! upserts the monitor, writes monitor_state_history, broadcasts a frame on
//! `pg_notify('ws_broadcast', ...)`.

use crate::bus::BusMessage;
use crate::db::{monitor_state_history, monitors, webhook_configs, webhook_dedup};
use crate::rules::exec::{Trigger, trigger_for_monitor};
use crate::state::AppState;
use crate::webhooks::event::WebhookEnvelope;
use crate::ws::{self, WsFrame};
use anyhow::Result;
use chrono::{Duration, Utc};
use futures::TryStreamExt;
use pulsar::{Consumer, Pulsar, SubType, TokioExecutor};

/// Map a CC webhook `event` name to a (new_state, message) pair plus a flag
/// telling whether the resource should be deleted instead of updated.
fn map_event(event: &str) -> Option<EventEffect> {
    match event {
        // CC application lifecycle
        "APPLICATION_CREATION" => Some(EventEffect::Upsert {
            kind: "cc_application",
            state: "unknown",
            message: Some("created"),
        }),
        "APPLICATION_REDEPLOY" | "GIT_PUSH" => Some(EventEffect::SetState {
            state: "unknown",
            message: Some("deploying"),
        }),
        "APPLICATION_STOP" => Some(EventEffect::SetState {
            state: "critical",
            message: Some("stopped"),
        }),
        "DEPLOYMENT_SUCCESS" => Some(EventEffect::SetState {
            state: "ok",
            message: Some("deploy succeeded"),
        }),
        "DEPLOYMENT_FAIL" => Some(EventEffect::SetState {
            state: "critical",
            message: Some("deploy failed"),
        }),
        "APPLICATION_DELETION" => Some(EventEffect::Delete),

        // Addons
        "ADDON_CREATION" => Some(EventEffect::Upsert {
            kind: "cc_addon",
            state: "ok",
            message: Some("created"),
        }),
        "ADDON_DELETION" => Some(EventEffect::Delete),

        _ => None,
    }
}

#[derive(Debug, Clone)]
enum EventEffect {
    /// Upsert the monitor (CC → DB) and set its state.
    Upsert {
        kind: &'static str,
        state: &'static str,
        message: Option<&'static str>,
    },
    /// Update the existing monitor's state if found; otherwise log + skip.
    SetState {
        state: &'static str,
        message: Option<&'static str>,
    },
    /// Drop the monitor.
    Delete,
}

pub async fn run(
    pulsar: Pulsar<TokioExecutor>,
    topic: String,
    subscription: String,
    state: AppState,
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
        if let Err(e) = process_one(&state, &msg.payload.data).await {
            tracing::error!(error = ?e, "processing failed; acking + dropping (CC will not retry)");
        }
        let _ = consumer.ack(&msg).await;
    }

    Ok(())
}

async fn process_one(state: &AppState, payload: &[u8]) -> Result<()> {
    let pool = &state.pool;
    let bus_msg: BusMessage = match serde_json::from_slice(payload) {
        Ok(m) => m,
        Err(e) => {
            tracing::error!(error = ?e, "failed to parse BusMessage");
            return Ok(());
        }
    };
    let envelope: WebhookEnvelope = match serde_json::from_slice(&bus_msg.raw_body) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(error = ?e, "failed to parse webhook envelope");
            return Ok(());
        }
    };

    // Cross-instance dedup
    let key = envelope.dedup_key();
    match webhook_dedup::try_record(pool, &key, Duration::seconds(60)).await {
        Ok(true) => {}
        Ok(false) => {
            tracing::debug!(event = %envelope.event, "duplicate dropped");
            return Ok(());
        }
        Err(e) => {
            tracing::warn!(error = ?e, "dedup record failed; proceeding");
        }
    }

    let _ = webhook_configs::find_by_token(pool, &bus_msg.token).await;

    let Some(routing) = envelope.routing() else {
        tracing::debug!(event = %envelope.event, "no routable owner; skipping");
        return Ok(());
    };
    if routing.owner_id != bus_msg.cc_org_id {
        tracing::warn!(
            from = %routing.owner_id,
            expected = %bus_msg.cc_org_id,
            event = %envelope.event,
            "owner_id mismatch; dropping"
        );
        return Ok(());
    }

    let Some(effect) = map_event(&envelope.event) else {
        tracing::debug!(event = %envelope.event, "no monitor effect for this event");
        return Ok(());
    };

    let now = Utc::now();
    match effect {
        EventEffect::Upsert {
            kind,
            state: new_state,
            message,
        } => {
            let monitor = monitors::upsert_cc(
                pool,
                bus_msg.user_id,
                crate::db::monitors::MonitorInput {
                    cc_org_id: Some(&bus_msg.cc_org_id),
                    kind,
                    cc_resource_id: Some(&routing.resource_id),
                    // Webhooks for ADDON_CREATION carry only `addon_xxx` in the
                    // payload; the real_id needed for Warp10 is fetched on the
                    // next sync_org call and self-heals via the always-overwrite
                    // ON CONFLICT clause in upsert_cc.
                    cc_metrics_id: Some(&routing.resource_id),
                    display_name: &routing.resource_id,
                    metadata: None,
                    // Webhook owns the steady-state via apply_state_change below;
                    // seed unknown so the history+broadcast it does next is the
                    // canonical creation event.
                    initial_state: "unknown",
                },
            )
            .await?;
            apply_state_change(
                state,
                bus_msg.user_id,
                monitor.id,
                new_state,
                message,
                &bus_msg.cc_org_id,
                now,
                &envelope.event,
            )
            .await?;
        }
        EventEffect::SetState {
            state: new_state,
            message,
        } => {
            match monitors::find_by_cc_resource(
                pool,
                bus_msg.user_id,
                &bus_msg.cc_org_id,
                &routing.resource_id,
            )
            .await?
            {
                Some(monitor) => {
                    apply_state_change(
                        state,
                        bus_msg.user_id,
                        monitor.id,
                        new_state,
                        message,
                        &bus_msg.cc_org_id,
                        now,
                        &envelope.event,
                    )
                    .await?;
                }
                None => {
                    tracing::info!(
                        event = %envelope.event,
                        resource = %routing.resource_id,
                        cc_org_id = %bus_msg.cc_org_id,
                        "no monitor row yet; user must list monitors for this org first"
                    );
                }
            }
        }
        EventEffect::Delete => {
            let n = monitors::delete_by_cc_resource(
                pool,
                bus_msg.user_id,
                &bus_msg.cc_org_id,
                &routing.resource_id,
            )
            .await?;
            if n > 0 {
                tracing::info!(resource = %routing.resource_id, "monitor deleted on CC event");
            }
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn apply_state_change(
    state: &AppState,
    user_id: uuid::Uuid,
    monitor_id: uuid::Uuid,
    new_state: &str,
    message: Option<&str>,
    cc_org_id: &str,
    now: chrono::DateTime<Utc>,
    event: &str,
) -> Result<()> {
    let pool = &state.pool;
    let Some((after, since)) =
        monitors::set_state_if_changed(pool, monitor_id, new_state, message).await?
    else {
        // No transition — nothing to do. (Same state, idempotent webhook.)
        tracing::debug!(
            %event,
            %monitor_id,
            current = %new_state,
            "webhook event did not change monitor state; skipping rule trigger"
        );
        return Ok(());
    };
    monitor_state_history::insert(pool, monitor_id, &after, message, now, "webhook").await?;
    ws::broadcast_via_pg(
        pool,
        cc_org_id,
        WsFrame::MonitorState {
            monitor_id,
            state: after.clone(),
            message: message.map(|s| s.to_string()),
            since: Some(since),
        },
    )
    .await?;

    tracing::info!(
        %event,
        %monitor_id,
        %user_id,
        new_state = %after,
        "webhook applied state transition; triggering dependent rules"
    );

    // Fire rules that watch this monitor. Best-effort: webhook ack must succeed
    // even if rule eval errors out.
    match trigger_for_monitor(state, user_id, monitor_id, Trigger::Webhook).await {
        Ok(fired) => {
            tracing::info!(
                %monitor_id,
                fired,
                "trigger_for_monitor done (webhook)"
            );
        }
        Err(e) => {
            tracing::error!(
                error = ?e,
                %monitor_id,
                "trigger_for_monitor failed (webhook); continuing"
            );
        }
    }
    Ok(())
}
