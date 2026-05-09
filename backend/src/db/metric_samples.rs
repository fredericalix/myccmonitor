use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MetricSample {
    pub monitor_id: Uuid,
    pub ts: DateTime<Utc>,
    pub cpu: Option<f64>,
    pub mem: Option<f64>,
    pub disk: Option<f64>,
    pub net_in: Option<f64>,
    pub net_out: Option<f64>,
}

#[allow(clippy::too_many_arguments)]
pub async fn insert(
    pool: &PgPool,
    monitor_id: Uuid,
    ts: DateTime<Utc>,
    cpu: Option<f64>,
    mem: Option<f64>,
    disk: Option<f64>,
    net_in: Option<f64>,
    net_out: Option<f64>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO metric_samples (monitor_id, ts, cpu, mem, disk, net_in, net_out)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (monitor_id, ts) DO UPDATE
        SET cpu = COALESCE(EXCLUDED.cpu, metric_samples.cpu),
            mem = COALESCE(EXCLUDED.mem, metric_samples.mem),
            disk = COALESCE(EXCLUDED.disk, metric_samples.disk),
            net_in = COALESCE(EXCLUDED.net_in, metric_samples.net_in),
            net_out = COALESCE(EXCLUDED.net_out, metric_samples.net_out)
        "#,
    )
    .bind(monitor_id)
    .bind(ts)
    .bind(cpu)
    .bind(mem)
    .bind(disk)
    .bind(net_in)
    .bind(net_out)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn latest(
    pool: &PgPool,
    monitor_id: Uuid,
) -> Result<Option<MetricSample>, sqlx::Error> {
    sqlx::query_as::<_, MetricSample>(
        r#"
        SELECT * FROM metric_samples
        WHERE monitor_id = $1
        ORDER BY ts DESC
        LIMIT 1
        "#,
    )
    .bind(monitor_id)
    .fetch_optional(pool)
    .await
}

/// Latest sample per monitor for a given (user, org). Used by the frontend
/// hydration endpoint so the dashboard paints metrics immediately on mount
/// instead of waiting up to 60 s for the next WS frame.
pub async fn latest_for_org(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<Vec<MetricSample>, sqlx::Error> {
    sqlx::query_as::<_, MetricSample>(
        r#"
        SELECT DISTINCT ON (ms.monitor_id)
            ms.monitor_id, ms.ts, ms.cpu, ms.mem, ms.disk, ms.net_in, ms.net_out
        FROM metric_samples ms
        JOIN monitors m ON m.id = ms.monitor_id
        WHERE m.user_id = $1 AND m.cc_org_id = $2
        ORDER BY ms.monitor_id, ms.ts DESC
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_all(pool)
    .await
}

pub async fn purge_older_than(
    pool: &PgPool,
    cutoff: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    let res = sqlx::query("DELETE FROM metric_samples WHERE ts < $1")
        .bind(cutoff)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}
