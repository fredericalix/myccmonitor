use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MetricSample {
    pub monitor_id: Uuid,
    pub ts: DateTime<Utc>,
    pub cpu: Option<f64>,
    pub mem: Option<f64>,
    pub disk: Option<f64>,
    pub net_in: Option<f64>,
    pub net_out: Option<f64>,
}

pub async fn insert(
    pool: &PgPool,
    monitor_id: Uuid,
    ts: DateTime<Utc>,
    cpu: Option<f64>,
    mem: Option<f64>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO metric_samples (monitor_id, ts, cpu, mem)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (monitor_id, ts) DO UPDATE
        SET cpu = COALESCE(EXCLUDED.cpu, metric_samples.cpu),
            mem = COALESCE(EXCLUDED.mem, metric_samples.mem)
        "#,
    )
    .bind(monitor_id)
    .bind(ts)
    .bind(cpu)
    .bind(mem)
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
