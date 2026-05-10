-- Phase 11f: per-metric storage (drop wide-row metric_samples write path).
-- Each Warp10 reading becomes its own row keyed by (monitor_id, metric_name, ts).
-- The poller inserts only metrics it actually received and prunes to the last
-- 10 per (monitor, metric) on every write. Display reads "latest non-null"
-- per metric independently — disk's slow cadence (~5 min) no longer makes
-- the bar flicker between real values and n/a.

CREATE TABLE IF NOT EXISTS metric_readings (
  monitor_id  UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL CHECK (metric_name IN ('cpu','mem','disk','net_in','net_out')),
  ts          TIMESTAMPTZ NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (monitor_id, metric_name, ts)
);

CREATE INDEX IF NOT EXISTS metric_readings_monitor_metric_ts_desc
  ON metric_readings (monitor_id, metric_name, ts DESC);

-- Backfill once from metric_samples so the dashboard doesn't go cold during
-- the transition. ON CONFLICT DO NOTHING makes it safe to re-run.
INSERT INTO metric_readings (monitor_id, metric_name, ts, value)
SELECT monitor_id, 'cpu', ts, cpu FROM metric_samples WHERE cpu IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO metric_readings (monitor_id, metric_name, ts, value)
SELECT monitor_id, 'mem', ts, mem FROM metric_samples WHERE mem IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO metric_readings (monitor_id, metric_name, ts, value)
SELECT monitor_id, 'disk', ts, disk FROM metric_samples WHERE disk IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO metric_readings (monitor_id, metric_name, ts, value)
SELECT monitor_id, 'net_in', ts, net_in FROM metric_samples WHERE net_in IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO metric_readings (monitor_id, metric_name, ts, value)
SELECT monitor_id, 'net_out', ts, net_out FROM metric_samples WHERE net_out IS NOT NULL
ON CONFLICT DO NOTHING;
