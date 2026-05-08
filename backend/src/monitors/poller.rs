//! Phase 4: 60-second poller. On every backend instance: query monitors that
//! are due for a poll, group them by (user_id, cc_org_id), fetch CPU% + Mem%
//! from Warp10 in batches per kind, write `metric_samples`, broadcast a
//! `MetricsSnapshot` frame, update `last_poll_at`. Per-monitor advisory locks
//! make this multi-instance safe (a monitor is polled by exactly one
//! instance per tick). Phase 6 rules read `metric_samples` to evaluate
//! threshold conditions and drive state transitions.

use crate::api::cc_client::CcClient;
use crate::auth::decrypt_user_oauth;
use crate::config::Config;
use crate::db;
use crate::db::monitors::Monitor;
use crate::metrics::{self, tokens::TokenCache};
use crate::monitors::state_map;
use crate::ws::{self, WsFrame};
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration as StdDuration;
use tokio::time::{MissedTickBehavior, interval};
use uuid::Uuid;

const POLL_TICK: StdDuration = StdDuration::from_secs(60);
const PURGE_EVERY_N_TICKS: u32 = 60;
const PURGE_AGE_HOURS: i64 = 24;
const POLL_BATCH_LIMIT: i64 = 200;

pub async fn run(
    pool: PgPool,
    cfg: Arc<Config>,
    http: reqwest::Client,
    token_cache: Arc<TokenCache>,
) -> anyhow::Result<()> {
    let mut tick = interval(POLL_TICK);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut counter: u32 = 0;
    tracing::info!(period_seconds = POLL_TICK.as_secs(), "poller started");

    loop {
        tick.tick().await;
        counter = counter.wrapping_add(1);

        if counter % PURGE_EVERY_N_TICKS == 0 {
            let cutoff = Utc::now() - Duration::hours(PURGE_AGE_HOURS);
            match db::metric_samples::purge_older_than(&pool, cutoff).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(rows = n, "purged old metric_samples"),
                Err(e) => tracing::warn!(error = ?e, "purge_older_than failed"),
            }
        }

        if let Err(e) = poll_once(&pool, &cfg, &http, &token_cache).await {
            tracing::error!(error = ?e, "poll cycle errored");
        }
    }
}

async fn poll_once(
    pool: &PgPool,
    cfg: &Config,
    http: &reqwest::Client,
    token_cache: &TokenCache,
) -> anyhow::Result<()> {
    let due: Vec<Monitor> = sqlx::query_as::<_, Monitor>(
        r#"
        SELECT * FROM monitors
        WHERE enabled = TRUE
          AND kind <> 'synthetic'
          AND cc_org_id IS NOT NULL
          AND cc_resource_id IS NOT NULL
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
        if let Err(e) =
            poll_user_org(pool, cfg, http, token_cache, user_id, &cc_org_id, monitors).await
        {
            tracing::warn!(error = ?e, %user_id, cc_org_id = %cc_org_id, "poll_user_org failed");
        }
    }

    Ok(())
}

async fn poll_user_org(
    pool: &PgPool,
    cfg: &Config,
    http: &reqwest::Client,
    token_cache: &TokenCache,
    user_id: Uuid,
    cc_org_id: &str,
    monitors: Vec<Monitor>,
) -> anyhow::Result<()> {
    let user = db::users::find_by_id(pool, user_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("user {user_id} not found"))?;
    let (access_token, access_secret) = decrypt_user_oauth(&user, &cfg.encryption_key)?;
    let cc = CcClient::new(http, cfg, &access_token, &access_secret);

    let (apps, addons): (Vec<_>, Vec<_>) = monitors
        .into_iter()
        .partition(|m| m.kind == "cc_application");

    // Refresh app state from CC's own view. Cheap (one list_applications call
    // per (user, org) per tick) and bulletproof against missed webhooks.
    if !apps.is_empty() {
        refresh_app_state(pool, &cc, cc_org_id, &apps).await;
    }

    if !apps.is_empty() {
        run_kind(pool, cfg, http, &cc, token_cache, user_id, cc_org_id, "app_id", &apps).await;
    }
    if !addons.is_empty() {
        run_kind(
            pool, cfg, http, &cc, token_cache, user_id, cc_org_id, "addon_id", &addons,
        )
        .await;
    }
    Ok(())
}

/// One `list_applications` call per (user, org), then per-monitor advisory-
/// locked `set_state_if_changed` so two backends don't both write. Silent
/// no-op on stable fleets — only emits when CC's reported state actually
/// differs from what we hold.
async fn refresh_app_state(
    pool: &PgPool,
    cc: &CcClient<'_>,
    cc_org_id: &str,
    apps: &[Monitor],
) {
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
    for monitor in apps {
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

        match db::monitors::set_state_if_changed(pool, monitor.id, mapped, None).await {
            Ok(Some((new_state, since))) => {
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
                        state: new_state,
                        message: None,
                        since: Some(since),
                    },
                )
                .await
                {
                    tracing::warn!(error = ?e, monitor_id = %monitor.id, "ws broadcast (poll) failed");
                }
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!(error = ?e, monitor_id = %monitor.id, "set_state_if_changed (poll) failed");
            }
        }

        if let Err(e) = tx.commit().await {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "commit (poll state lock release) failed");
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_kind(
    pool: &PgPool,
    cfg: &Config,
    http: &reqwest::Client,
    cc: &CcClient<'_>,
    token_cache: &TokenCache,
    user_id: Uuid,
    cc_org_id: &str,
    label_name: &str,
    monitors: &[Monitor],
) {
    let ids: Vec<String> = monitors
        .iter()
        .filter_map(|m| m.cc_resource_id.clone())
        .collect();
    let map = match metrics::fetch_cpu_mem(
        cfg, http, cc, token_cache, user_id, cc_org_id, label_name, &ids,
    )
    .await
    {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = ?e, %label_name, %cc_org_id, "fetch_cpu_mem failed");
            // Still bump last_poll_at so we don't hammer a broken upstream.
            for m in monitors {
                let _ = bump_last_poll(pool, m.id).await;
            }
            return;
        }
    };

    let now = Utc::now();
    for monitor in monitors {
        let Some(rid) = monitor.cc_resource_id.as_deref() else {
            continue;
        };
        let (cpu, mem) = map.get(rid).copied().unwrap_or((None, None));
        write_sample(pool, monitor, cpu, mem, cc_org_id, now).await;
    }
}

async fn write_sample(
    pool: &PgPool,
    monitor: &Monitor,
    cpu: Option<f32>,
    mem: Option<f32>,
    cc_org_id: &str,
    ts: DateTime<Utc>,
) {
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

    if let Err(e) = db::metric_samples::insert(pool, monitor.id, ts, cpu_d, mem_d).await {
        tracing::warn!(error = ?e, monitor_id = %monitor.id, "insert metric_sample failed");
    }
    if let Err(e) = bump_last_poll(pool, monitor.id).await {
        tracing::warn!(error = ?e, monitor_id = %monitor.id, "bump last_poll_at failed");
    }
    if cpu_d.is_some() || mem_d.is_some() {
        if let Err(e) = ws::broadcast_via_pg(
            pool,
            cc_org_id,
            WsFrame::MetricsSnapshot {
                monitor_id: monitor.id,
                ts,
                cpu: cpu_d,
                mem: mem_d,
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
