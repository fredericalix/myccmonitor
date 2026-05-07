-- Phase 3: append-only audit of monitor state transitions. Used by the
-- workflow engine for `for Xm` time-based conditions in Phase 6, and by the
-- alerts UI to show state history. Retained 30 days (purge job in Phase 4+).

CREATE TABLE IF NOT EXISTS monitor_state_history (
    monitor_id UUID NOT NULL REFERENCES monitors ON DELETE CASCADE,
    state      TEXT NOT NULL,
    message    TEXT,
    changed_at TIMESTAMPTZ NOT NULL,
    source     TEXT NOT NULL,  -- 'webhook' | 'poller' | 'rule_action' | 'manual'
    PRIMARY KEY (monitor_id, changed_at)
);

CREATE INDEX IF NOT EXISTS monitor_state_history_monitor_changed_desc
    ON monitor_state_history (monitor_id, changed_at DESC);
