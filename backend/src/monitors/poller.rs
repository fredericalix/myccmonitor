//! Phase 4: 60-second poller. On every backend instance: query monitors that
//! are due for a poll, group them by (user_id, cc_org_id), fetch CPU% + Mem%
//! from Warp10 in batches per kind, write `metric_samples`, broadcast a
//! `MetricsSnapshot` frame, update `last_poll_at`. Per-monitor advisory locks
//! make this multi-instance safe (a monitor is polled by exactly one
//! instance per tick). Phase 6 rules read `metric_samples` to evaluate
//! threshold conditions and drive state transitions.

use crate::api::cc_client::CcClient;
use crate::auth::decrypt_user_oauth;
use crate::db;
use crate::db::monitors::Monitor;
use crate::metrics;
use crate::monitors::state_map;
use crate::rules::exec::{Trigger, trigger_for_monitor};
use crate::state::AppState;
use crate::ws::{self, WsFrame};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use std::time::Duration as StdDuration;
use tokio::time::{MissedTickBehavior, interval};
use uuid::Uuid;

const POLL_TICK: StdDuration = StdDuration::from_secs(60);
const POLL_BATCH_LIMIT: i64 = 200;

pub async fn run(state: AppState) -> anyhow::Result<()> {
    let mut tick = interval(POLL_TICK);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    tracing::info!(period_seconds = POLL_TICK.as_secs(), "poller started");

    loop {
        tick.tick().await;
        // No periodic purge: metric_readings retention is enforced per-row
        // at insert time (KEEP_N_PER_METRIC).
        if let Err(e) = poll_once(&state).await {
            tracing::error!(error = ?e, "poll cycle errored");
        }
    }
}

async fn poll_once(state: &AppState) -> anyhow::Result<()> {
    let pool = &state.pool;
    let due: Vec<Monitor> = sqlx::query_as::<_, Monitor>(
        r#"
        SELECT * FROM monitors
        WHERE enabled = TRUE
          AND kind <> 'synthetic'
          AND cc_org_id IS NOT NULL
          AND cc_resource_id IS NOT NULL
          AND cc_metrics_id IS NOT NULL
          AND (
              last_poll_at IS NULL
              OR last_poll_at < now() - (poll_interval_seconds * INTERVAL '1 second')
          )
        ORDER BY last_poll_at ASC NULLS FIRST
        LIMIT $1
        "#,
    )
    .bind(POLL_BATCH_LIMIT)
    .fetch_all(pool)
    .await?;

    if due.is_empty() {
        return Ok(());
    }
    tracing::debug!(count = due.len(), "poll cycle starting");

    let mut by_org: HashMap<(Uuid, String), Vec<Monitor>> = HashMap::new();
    for m in due {
        if let Some(ref org) = m.cc_org_id {
            by_org.entry((m.user_id, org.clone())).or_default().push(m);
        }
    }

    for ((user_id, cc_org_id), monitors) in by_org {
        if let Err(e) = poll_user_org(state, user_id, &cc_org_id, monitors).await {
            tracing::warn!(error = ?e, %user_id, cc_org_id = %cc_org_id, "poll_user_org failed");
        }
    }

    Ok(())
}

async fn poll_user_org(
    state: &AppState,
    user_id: Uuid,
    cc_org_id: &str,
    monitors: Vec<Monitor>,
) -> anyhow::Result<()> {
    let pool = &state.pool;
    let cfg = state.cfg.as_ref();
    let http = &state.http;
    let token_cache = state.warp10_token_cache.as_ref();

    let user = db::users::find_by_id(pool, user_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("user {user_id} not found"))?;
    let (access_token, access_secret) = decrypt_user_oauth(&user, &cfg.encryption_key)?;
    let cc = CcClient::new(http, cfg, &access_token, &access_secret);

    let apps: Vec<&Monitor> = monitors
        .iter()
        .filter(|m| m.kind == "cc_application")
        .collect();

    // Refresh app state from CC's own view. Cheap (one list_applications call
    // per (user, org) per tick) and bulletproof against missed webhooks.
    if !apps.is_empty() {
        refresh_app_state(state, user_id, &cc, cc_org_id, &apps).await;
    }

    // Single Warp10 batch for apps + addons. CC's Warp10 indexes both kinds
    // under the `app_id` label; for addons the value is `cc_metrics_id`
    // (== addon's realId).
    if !monitors.is_empty() {
        run_metrics_batch(state, &cc, user_id, cc_org_id, &monitors).await;
    }
    Ok(())
}

/// One `list_applications` call per (user, org), then per-monitor advisory-
/// locked `set_state_if_changed` so two backends don't both write. Silent
/// no-op on stable fleets — only emits when CC's reported state actually
/// differs from what we hold.
async fn refresh_app_state(
    state: &AppState,
    user_id: Uuid,
    cc: &CcClient<'_>,
    cc_org_id: &str,
    apps: &[&Monitor],
) {
    let pool = &state.pool;
    let cc_apps = match cc.list_applications(cc_org_id).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = ?e, %cc_org_id, "list_applications (poll refresh) failed");
            return;
        }
    };
    let by_id: HashMap<&str, Option<&str>> = cc_apps
        .iter()
        .map(|a| (a.id.as_str(), a.state.as_deref()))
        .collect();

    let now = Utc::now();
    for monitor in apps.iter().copied() {
        let Some(rid) = monitor.cc_resource_id.as_deref() else {
            continue;
        };
        let Some(&cc_state) = by_id.get(rid) else {
            continue;
        };
        let mapped = state_map::map_cc_app_state(cc_state);
        if monitor.current_state == mapped {
            continue;
        }

        let key = advisory_lock_key(monitor.id);
        // xact-scoped lock auto-released at commit/rollback. Holding the lock
        // on the same connection that started the transaction avoids the
        // cross-connection unlock that triggered Postgres NOTICEs.
        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                tracing::warn!(error = ?e, monitor_id = %monitor.id, "begin tx (poll state) failed");
                continue;
            }
        };
        let acquired: bool = match sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
            .bind(key)
            .fetch_one(&mut *tx)
            .await
        {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = ?e, monitor_id = %monitor.id, "advisory_xact_lock (poll state) failed");
                let _ = tx.rollback().await;
                continue;
            }
        };
        if !acquired {
            let _ = tx.rollback().await;
            continue;
        }

        let mut transitioned = false;
        match db::monitors::set_state_if_changed(pool, monitor.id, mapped, None).await {
            Ok(Some((new_state, since))) => {
                transitioned = true;
                if let Err(e) = db::monitor_state_history::insert(
                    pool, monitor.id, &new_state, None, now, "poll",
                )
                .await
                {
                    tracing::warn!(error = ?e, monitor_id = %monitor.id, "history insert (poll) failed");
                }
                if let Err(e) = ws::broadcast_via_pg(
                    pool,
                    cc_org_id,
                    WsFrame::MonitorState {
                        monitor_id: monitor.id,
                        state: new_state.clone(),
                        message: None,
                        since: Some(since),
                    },
                )
                .await
                {
                    tracing::warn!(error = ?e, monitor_id = %monitor.id, "ws broadcast (poll) failed");
                }
                tracing::info!(
                    monitor_id = %monitor.id,
                    %user_id,
                    new_state = %new_state,
                    "poll detected state transition; will trigger dependent rules"
                );
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!(error = ?e, monitor_id = %monitor.id, "set_state_if_changed (poll) failed");
            }
        }

        if let Err(e) = tx.commit().await {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "commit (poll state lock release) failed");
        }

        // Fire dependent rules AFTER the lock is released, so rule actions that
        // re-enter set_state_if_changed don't deadlock on the same advisory key.
        if transitioned {
            match trigger_for_monitor(state, user_id, monitor.id, Trigger::Poll { monitor_id: monitor.id }).await {
                Ok(fired) => {
                    tracing::info!(monitor_id = %monitor.id, fired, "trigger_for_monitor done (poll state)");
                }
                Err(e) => {
                    tracing::error!(error = ?e, monitor_id = %monitor.id, "trigger_for_monitor failed (poll state)");
                }
            }
        }
    }
}

async fn run_metrics_batch(
    state: &AppState,
    cc: &CcClient<'_>,
    user_id: Uuid,
    cc_org_id: &str,
    monitors: &[Monitor],
) {
    let pool = &state.pool;
    let cfg = state.cfg.as_ref();
    let http = &state.http;
    let token_cache = state.warp10_token_cache.as_ref();

    let ids: Vec<String> = monitors
        .iter()
        .filter_map(|m| m.cc_metrics_id.clone())
        .collect();
    // Hard-coded `app_id` label — CC's Warp10 keys both apps and addons under
    // it; addons just use their realId instead of their addon_id.
    let map = match metrics::fetch_metrics(
        cfg, http, cc, token_cache, user_id, cc_org_id, "app_id", &ids,
    )
    .await
    {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = ?e, %cc_org_id, "fetch_metrics failed");
            // Still bump last_poll_at so we don't hammer a broken upstream.
            for m in monitors {
                let _ = bump_last_poll(pool, m.id).await;
            }
            return;
        }
    };

    let now = Utc::now();
    for monitor in monitors {
        let Some(mid) = monitor.cc_metrics_id.as_deref() else {
            continue;
        };
        let (cpu, mem, disk, net_in, net_out) =
            map.get(mid).copied().unwrap_or((None, None, None, None, None));
        write_sample(
            state, user_id, monitor, cpu, mem, disk, net_in, net_out, cc_org_id, now,
        )
        .await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn write_sample(
    state: &AppState,
    user_id: Uuid,
    monitor: &Monitor,
    cpu: Option<f32>,
    mem: Option<f32>,
    disk: Option<f32>,
    net_in: Option<f32>,
    net_out: Option<f32>,
    cc_org_id: &str,
    ts: DateTime<Utc>,
) {
    let pool = &state.pool;
    let key = advisory_lock_key(monitor.id);
    // xact-scoped advisory lock — auto-released at commit/rollback. Avoids the
    // session-vs-pool-connection mismatch that caused "you don't own a lock"
    // NOTICEs from Postgres.
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "begin tx (write_sample) failed");
            return;
        }
    };
    let acquired: bool = match sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(key)
        .fetch_one(&mut *tx)
        .await
    {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "advisory_xact_lock (write_sample) failed");
            let _ = tx.rollback().await;
            return;
        }
    };
    if !acquired {
        // Another instance is on it; nothing to do.
        let _ = tx.rollback().await;
        return;
    }

    let cpu_d = cpu.map(|v| v as f64);
    let mem_d = mem.map(|v| v as f64);
    let disk_d = disk.map(|v| v as f64);
    let net_in_d = net_in.map(|v| v as f64);
    let net_out_d = net_out.map(|v| v as f64);
    let fresh_metric =
        cpu_d.is_some() || mem_d.is_some() || disk_d.is_some() || net_in_d.is_some() || net_out_d.is_some();

    // Write each non-null reading as its own row in metric_readings. Each
    // call also prunes to keep only the 10 most recent for that
    // (monitor, metric_name) — bounded growth, no NULLs.
    let to_write: [(&str, Option<f64>); 5] = [
        ("cpu", cpu_d),
        ("mem", mem_d),
        ("disk", disk_d),
        ("net_in", net_in_d),
        ("net_out", net_out_d),
    ];
    for (name, opt) in to_write {
        if let Some(v) = opt {
            if let Err(e) =
                db::metric_readings::insert_and_prune(pool, monitor.id, name, ts, v).await
            {
                tracing::warn!(
                    error = ?e, monitor_id = %monitor.id, metric = %name,
                    "insert metric_reading failed"
                );
            }
        }
    }
    if let Err(e) = bump_last_poll(pool, monitor.id).await {
        tracing::warn!(error = ?e, monitor_id = %monitor.id, "bump last_poll_at failed");
    }

    // For the WS frame, read back the latest per metric (= what we just wrote
    // for the fresh ones + the previous values for those CC didn't emit this
    // tick). The dashboard always shows the last known reading; disk stays
    // visible between its slow-cadence samples.
    let latest = match db::metric_readings::latest_per_metric(pool, monitor.id).await {
        Ok(map) => map,
        Err(e) => {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "latest_per_metric failed");
            std::collections::HashMap::new()
        }
    };
    let b_cpu = latest.get("cpu").map(|r| r.value);
    let b_mem = latest.get("mem").map(|r| r.value);
    let b_disk = latest.get("disk").map(|r| r.value);
    let b_net_in = latest.get("net_in").map(|r| r.value);
    let b_net_out = latest.get("net_out").map(|r| r.value);
    let any_to_broadcast = b_cpu.is_some()
        || b_mem.is_some()
        || b_disk.is_some()
        || b_net_in.is_some()
        || b_net_out.is_some();
    if any_to_broadcast {
        if let Err(e) = ws::broadcast_via_pg(
            pool,
            cc_org_id,
            WsFrame::MetricsSnapshot {
                monitor_id: monitor.id,
                ts,
                cpu: b_cpu,
                mem: b_mem,
                disk: b_disk,
                net_in: b_net_in,
                net_out: b_net_out,
            },
        )
        .await
        {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "broadcast metrics frame failed");
        }
    }

    if let Err(e) = tx.commit().await {
        tracing::warn!(error = ?e, monitor_id = %monitor.id, "commit (write_sample lock release) failed");
    }

    // Fire dependent rules so threshold conditions on cpu/mem are evaluated
    // every poll cycle. Best-effort outside the lock. Trigger only when the
    // current poll actually produced new data (not on carry-forward only) —
    // rules read live monitor state, not historical values.
    if fresh_metric {
        if let Err(e) = trigger_for_monitor(
            state,
            user_id,
            monitor.id,
            Trigger::Poll { monitor_id: monitor.id },
        )
        .await
        {
            tracing::error!(error = ?e, monitor_id = %monitor.id, "trigger_for_monitor failed (write_sample)");
        }
    }
}

async fn bump_last_poll(pool: &PgPool, monitor_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE monitors SET last_poll_at = now() WHERE id = $1")
        .bind(monitor_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Hash a UUID v4 to an i64 advisory-lock key. We XOR the two 64-bit halves
/// of the UUID, which preserves enough entropy to make collisions astronomically
/// unlikely at our scale.
fn advisory_lock_key(id: Uuid) -> i64 {
    let (hi, lo) = id.as_u64_pair();
    (hi ^ lo) as i64
}
