-- Phase 11e: addons need a separate id for Warp10 lookups. CC's Warp10 stores
-- metrics for both apps and addons under the `app_id` label, but for addons the
-- value is the addon's `realId` (e.g. `postgresql_xxx`), not its `id`
-- (`addon_xxx`). We keep `cc_resource_id` as the CC API id (used for webhook
-- routing, deletion, etc.) and add `cc_metrics_id` for the Warp10 lookup key.
--
-- Backfill is best-effort: apps copy from cc_resource_id, addons read
-- metadata->>'real_id' (set by sync.rs since Phase 3a). Synthetics keep NULL.
-- The next sync_org call always overwrites cc_metrics_id (auto-healing).

ALTER TABLE monitors ADD COLUMN IF NOT EXISTS cc_metrics_id TEXT;

UPDATE monitors
SET cc_metrics_id = cc_resource_id
WHERE kind = 'cc_application'
  AND cc_metrics_id IS NULL
  AND cc_resource_id IS NOT NULL;

UPDATE monitors
SET cc_metrics_id = COALESCE(metadata->>'real_id', cc_resource_id)
WHERE kind = 'cc_addon'
  AND cc_metrics_id IS NULL;

CREATE INDEX IF NOT EXISTS monitors_cc_metrics_id
  ON monitors (cc_metrics_id)
  WHERE cc_metrics_id IS NOT NULL;
