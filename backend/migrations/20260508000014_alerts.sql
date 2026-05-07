-- Phase 6: one row per outbound notification (`SendNotification` action).
-- In Phase 6 we just record the row + log; Phase 9 wires the actual
-- adapters (email, Slack, Discord, generic webhook).

CREATE TABLE IF NOT EXISTS alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    monitor_id      UUID REFERENCES monitors ON DELETE SET NULL,
    rule_id         UUID REFERENCES rules ON DELETE SET NULL,
    level           TEXT NOT NULL,            -- warning | critical | recovered | info
    message         TEXT,
    payload         JSONB,
    notified_at     TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerts_user_created_desc
    ON alerts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_monitor_created_desc
    ON alerts (monitor_id, created_at DESC);
