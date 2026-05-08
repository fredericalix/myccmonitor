"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/services/api";
import type {
  GroupView,
  Monitor,
  NotificationChannel,
  Rule,
  UpsertRuleInput,
} from "@/services/types";
import RuleEditor from "@/components/RuleEditor/RuleEditor";
import { DebugPanel } from "@/components/RuleEditor/DebugPanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toaster";

export default function EditRulePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [rule, setRule] = useState<Rule | null>(null);
  const [data, setData] = useState<{
    monitors: Monitor[];
    groups: GroupView[];
    rules: Rule[];
    channels: NotificationChannel[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [r, orgs, groups, rules, channels] = await Promise.all([
          api.getRule(id),
          api.listOrgs(),
          api.listGroups().catch(() => []),
          api.listRules().catch(() => []),
          api.listChannels().catch(() => []),
        ]);
        const monitorsByOrg = await Promise.all(
          orgs.map((o) => api.listMonitors(o.cc_org_id).catch(() => [])),
        );
        if (!active) return;
        setRule(r);
        setData({
          monitors: monitorsByOrg.flat(),
          groups: groups as GroupView[],
          rules: rules as Rule[],
          channels: channels as NotificationChannel[],
        });
      } catch (err: unknown) {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  async function handleSave(input: UpsertRuleInput) {
    setBusy(true);
    try {
      await api.updateRule(id, input);
      toast.success("Rule saved");
    } catch (err: unknown) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    try {
      const result = await api.testRule(id);
      if (result.matched) {
        toast.success(
          `Dry-run match · ${result.actions_that_would_run} action${result.actions_that_would_run === 1 ? "" : "s"} would run`,
        );
      } else {
        toast.message("Dry-run: no match", {
          description: "Conditions did not evaluate to true against current state.",
        });
      }
    } catch (err: unknown) {
      toast.error("Dry-run failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await api.deleteRule(id);
      toast.success("Rule deleted");
      router.push("/rules");
    } catch (err: unknown) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : String(err),
      });
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (error)
    return (
      <Card className="p-5 border-critical/30 bg-critical-soft">
        <p className="text-sm text-critical">{error}</p>
      </Card>
    );
  if (!rule || !data)
    return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <>
      <PageHeader
        title={rule.name}
        description={`Cooldown ${rule.cooldown_seconds}s · ${rule.is_enabled ? "enabled" : "disabled"}.`}
        breadcrumbs={[
          { label: "Rules", href: "/rules" },
          { label: rule.name },
        ]}
      />
      <RuleEditor
        data={data}
        initialRule={rule}
        onSave={handleSave}
        onTest={handleTest}
        onDelete={() => setConfirmDelete(true)}
        onDebug={() => setShowDebug(true)}
        busy={busy}
        saveLabel="Save"
      />

      <DebugPanel
        ruleId={id}
        open={showDebug}
        onClose={() => setShowDebug(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this rule?"
        description="This is permanent — all firing history and version snapshots are deleted with it."
        confirmLabel="Delete rule"
        destructive
        loading={busy}
      />
    </>
  );
}
