-- Phase 5: monitor groups. Effective members = manual list ∪ auto-matched
-- (computed at read time from auto_rules). Rolled-up state at read time too.

CREATE TABLE IF NOT EXISTS monitor_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    auto_rules  JSONB,                                  -- {name_pattern?, kinds?, …}
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS monitor_groups_user_id ON monitor_groups (user_id);
