-- Phase 2: cache of Clever Cloud organisations a user has access to.
-- Refreshed on demand from /v2/organisations.

CREATE TABLE IF NOT EXISTS orgs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    cc_org_id    TEXT NOT NULL,
    name         TEXT,
    avatar_url   TEXT,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, cc_org_id)
);
