//! Sync the monitors for one org against the live CC API: upsert apps + addons,
//! delete the ones that have disappeared. Called on demand by GET /api/orgs/:id/monitors.

use crate::api::cc_client::CcClient;
use crate::db::monitors::{self, Monitor, MonitorInput};
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
        monitors::upsert_cc(
            pool,
            user_id,
            MonitorInput {
                cc_org_id: Some(cc_org_id),
                kind: "cc_application",
                cc_resource_id: Some(&app.id),
                display_name: &app.name,
                metadata: Some(metadata),
            },
        )
        .await?;
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
        monitors::upsert_cc(
            pool,
            user_id,
            MonitorInput {
                cc_org_id: Some(cc_org_id),
                kind: "cc_addon",
                cc_resource_id: Some(&addon.id),
                display_name: &addon.name,
                metadata: Some(metadata),
            },
        )
        .await?;
        kept_ids.push(addon.id.clone());
    }

    let removed = monitors::delete_missing_in(pool, user_id, cc_org_id, &kept_ids).await?;
    if removed > 0 {
        tracing::info!(removed, %cc_org_id, "pruned CC monitors that no longer exist");
    }

    monitors::list_for_org(pool, user_id, cc_org_id).await.map_err(Into::into)
}
