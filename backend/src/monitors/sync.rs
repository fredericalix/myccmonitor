//! Sync the monitors for one org against the live CC API: upsert apps + addons,
//! delete the ones that have disappeared. Called on demand by GET /api/orgs/:id/monitors.
//!
//! Reads CC's own `state` field on each app and seeds `current_state` from it
//! on INSERT (fresh monitor) and self-heals it on CONFLICT when the prior row
//! was still `unknown`. Webhook-set states are never clobbered (handled in the
//! SQL `CASE` of `db::monitors::upsert_cc`).

use crate::api::cc_client::CcClient;
use crate::db::{monitor_state_history, monitors};
use crate::db::monitors::{Monitor, MonitorInput};
use crate::monitors::state_map;
use crate::ws::{self, WsFrame};
use chrono::Utc;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn sync_org(
    pool: &PgPool,
    cc: &CcClient<'_>,
    user_id: Uuid,
    cc_org_id: &str,
) -> anyhow::Result<Vec<Monitor>> {
    let apps = cc.list_applications(cc_org_id).await?;
    let addons = cc.list_addons(cc_org_id).await?;

    let mut kept_ids = Vec::with_capacity(apps.len() + addons.len());

    for app in &apps {
        let metadata = json!({
            "type": app.app_type,
            "zone": app.zone,
            "instance_type": app.instance.as_ref().and_then(|i| i.instance_type.clone()),
            "last_deploy": app.last_deploy,
        });
        let initial_state = state_map::map_cc_app_state(app.state.as_deref());
        let monitor = monitors::upsert_cc(
            pool,
            user_id,
            MonitorInput {
                cc_org_id: Some(cc_org_id),
                kind: "cc_application",
                cc_resource_id: Some(&app.id),
                display_name: &app.name,
                metadata: Some(metadata),
                initial_state,
            },
        )
        .await?;
        record_sync_state(pool, &monitor, cc_org_id).await;
        kept_ids.push(app.id.clone());
    }

    for addon in &addons {
        let provider_name = addon
            .provider
            .as_ref()
            .and_then(|p| p.name.clone().or_else(|| p.id.clone()));
        let metadata = json!({
            "provider": provider_name,
            "region": addon.region,
            "real_id": addon.real_id,
        });
        let monitor = monitors::upsert_cc(
            pool,
            user_id,
            MonitorInput {
                cc_org_id: Some(cc_org_id),
                kind: "cc_addon",
                cc_resource_id: Some(&addon.id),
                display_name: &addon.name,
                metadata: Some(metadata),
                initial_state: "ok",
            },
        )
        .await?;
        record_sync_state(pool, &monitor, cc_org_id).await;
        kept_ids.push(addon.id.clone());
    }

    let removed = monitors::delete_missing_in(pool, user_id, cc_org_id, &kept_ids).await?;
    if removed > 0 {
        tracing::info!(removed, %cc_org_id, "pruned CC monitors that no longer exist");
    }

    monitors::list_for_org(pool, user_id, cc_org_id).await.map_err(Into::into)
}

/// If the upsert just transitioned the row out of `unknown`, append a history
/// row + WS frame so dashboards refresh and `for Xm` rule conditions have a
/// real anchor. No-op when state is still unknown or unchanged.
async fn record_sync_state(pool: &PgPool, monitor: &Monitor, cc_org_id: &str) {
    if monitor.current_state == "unknown" {
        return;
    }
    let Some(since) = monitor.current_state_since else {
        return;
    };
    if Utc::now().signed_duration_since(since).num_seconds() > 5 {
        // Pre-existing transition (webhook or earlier sync) — don't re-broadcast.
        return;
    }
    if let Err(e) = monitor_state_history::insert(
        pool,
        monitor.id,
        &monitor.current_state,
        monitor.current_message.as_deref(),
        since,
        "sync",
    )
    .await
    {
        tracing::warn!(error = ?e, monitor_id = %monitor.id, "monitor_state_history insert (sync) failed");
    }
    if let Err(e) = ws::broadcast_via_pg(
        pool,
        cc_org_id,
        WsFrame::MonitorState {
            monitor_id: monitor.id,
            state: monitor.current_state.clone(),
            message: monitor.current_message.clone(),
            since: Some(since),
        },
    )
    .await
    {
        tracing::warn!(error = ?e, monitor_id = %monitor.id, "ws broadcast (sync) failed");
    }
}
