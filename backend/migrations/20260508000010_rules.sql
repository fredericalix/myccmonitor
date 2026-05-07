-- Phase 6: workflow engine — rules. condition + actions are JSONB so the
-- ReactFlow editor (Phase 7) and the runtime evaluator share one schema.

CREATE TABLE IF NOT EXISTS rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    name                TEXT NOT NULL,
    is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    condition           JSONB NOT NULL,
    actions             JSONB NOT NULL,
    cooldown_seconds    INT NOT NULL DEFAULT 300,
    last_fired_at       TIMESTAMPTZ,
    last_outcome_state  TEXT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_modified_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rules_user_enabled ON rules (user_id, is_enabled);
