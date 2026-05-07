-- Phase 6: every rule edit appends a version row. We keep the last 5 per
-- rule (auto-pruned on insert in `db::rules`) so an operator can roll back.

CREATE TABLE IF NOT EXISTS rule_versions (
    rule_id    UUID NOT NULL REFERENCES rules ON DELETE CASCADE,
    version_id TEXT NOT NULL,                 -- v{unix_ts}
    rule       JSONB NOT NULL,                -- snapshot of the full rule
    comment    TEXT,
    saved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rule_id, version_id)
);

CREATE INDEX IF NOT EXISTS rule_versions_saved_at_desc
    ON rule_versions (rule_id, saved_at DESC);
