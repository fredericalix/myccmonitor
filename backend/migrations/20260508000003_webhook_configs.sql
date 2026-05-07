-- Phase 2: one webhook configuration per (user, org). Holds the opaque
-- token CC will use to authenticate POST /webhooks/cc/:token deliveries.

CREATE TABLE IF NOT EXISTS webhook_configs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    cc_org_id          TEXT NOT NULL,
    token              TEXT UNIQUE NOT NULL,
    cc_webhook_id      TEXT,
    subscribed_events  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    last_received_at   TIMESTAMPTZ,
    failure_count      INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, cc_org_id)
);
