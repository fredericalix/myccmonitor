-- Phase 3: monitors are the things we watch. Three kinds:
--   * cc_application — backed by a Clever Cloud application (cc_resource_id = app_xxx)
--   * cc_addon       — backed by a Clever Cloud addon (cc_resource_id = addon_xxx)
--   * synthetic      — derived state, mutated only by rules (cc_org_id, cc_resource_id null)

CREATE TABLE IF NOT EXISTS monitors (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    cc_org_id             TEXT,
    kind                  TEXT NOT NULL CHECK (kind IN ('cc_application', 'cc_addon', 'synthetic')),
    cc_resource_id        TEXT,
    display_name          TEXT NOT NULL,
    enabled               BOOLEAN NOT NULL DEFAULT TRUE,
    poll_interval_seconds INT NOT NULL DEFAULT 60,
    current_state         TEXT NOT NULL DEFAULT 'unknown',
    current_message       TEXT,
    current_state_since   TIMESTAMPTZ,
    last_poll_at          TIMESTAMPTZ,
    acknowledged          BOOLEAN NOT NULL DEFAULT FALSE,
    metadata              JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One monitor per CC resource; synthetics have cc_resource_id null and use the unique constraint on display_name.
CREATE UNIQUE INDEX IF NOT EXISTS monitors_uniq_cc_resource
    ON monitors (user_id, cc_org_id, kind, cc_resource_id)
    WHERE cc_resource_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS monitors_uniq_synthetic_name
    ON monitors (user_id, display_name)
    WHERE kind = 'synthetic';

-- Inverse lookup for webhook dispatch (find a monitor by its CC resource id).
CREATE INDEX IF NOT EXISTS monitors_cc_resource
    ON monitors (cc_resource_id)
    WHERE cc_resource_id IS NOT NULL;
