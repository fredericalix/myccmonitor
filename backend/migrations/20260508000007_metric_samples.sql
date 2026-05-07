-- Phase 4: sliding window of CPU / memory / disk / network samples per monitor,
-- written by the Warp10 poller every poll_interval_seconds. Phase 6 rules
-- read this table to evaluate metric thresholds with optional `for Xm`
-- duration. Retention 24h (purge job called periodically by the poller).

CREATE TABLE IF NOT EXISTS metric_samples (
    monitor_id UUID             NOT NULL REFERENCES monitors ON DELETE CASCADE,
    ts         TIMESTAMPTZ      NOT NULL,
    cpu        DOUBLE PRECISION,
    mem        DOUBLE PRECISION,
    disk       DOUBLE PRECISION,
    net_in     DOUBLE PRECISION,
    net_out    DOUBLE PRECISION,
    PRIMARY KEY (monitor_id, ts)
);

CREATE INDEX IF NOT EXISTS metric_samples_monitor_ts_desc
    ON metric_samples (monitor_id, ts DESC);
