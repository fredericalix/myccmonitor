-- Phase 6: index of (monitor | group) refs found in each rule's condition tree.
-- Recomputed on every save. Inverse query: given a monitor that just changed,
-- which rules need re-evaluation? — `WHERE ref_kind='monitor' AND ref_id=$1`.

CREATE TABLE IF NOT EXISTS rule_dependencies (
    rule_id  UUID NOT NULL REFERENCES rules ON DELETE CASCADE,
    ref_kind TEXT NOT NULL CHECK (ref_kind IN ('monitor', 'group')),
    ref_id   UUID NOT NULL,
    PRIMARY KEY (rule_id, ref_kind, ref_id)
);

CREATE INDEX IF NOT EXISTS rule_dependencies_ref
    ON rule_dependencies (ref_kind, ref_id);
