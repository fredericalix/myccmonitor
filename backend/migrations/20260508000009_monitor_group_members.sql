-- Phase 5: explicit (manual) members of a monitor group. The auto-matched
-- members are computed in Rust at read time, never persisted here.

CREATE TABLE IF NOT EXISTS monitor_group_members (
    group_id   UUID NOT NULL REFERENCES monitor_groups ON DELETE CASCADE,
    monitor_id UUID NOT NULL REFERENCES monitors ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, monitor_id)
);

CREATE INDEX IF NOT EXISTS monitor_group_members_monitor
    ON monitor_group_members (monitor_id);
