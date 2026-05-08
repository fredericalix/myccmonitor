-- Phase 9: notification channels — where SendNotification actions deliver.
-- `kind` selects the adapter; `config` is JSONB whose shape depends on kind:
--   * email   { "to": ["a@b"], "subject_prefix"?: "..." }
--   * slack   { "webhook_url": "https://hooks.slack.com/..." }
--   * discord { "webhook_url": "https://discord.com/api/webhooks/..." }
--   * webhook { "url": "...", "method"?: "POST", "headers"?: {...} }

CREATE TABLE IF NOT EXISTS notification_channels (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('email', 'slack', 'discord', 'webhook')),
    name          TEXT NOT NULL,
    config        JSONB NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    failure_count INT NOT NULL DEFAULT 0,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_failure_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS notification_channels_user
    ON notification_channels (user_id);
