"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/services/api";
import type {
  GroupView,
  Monitor,
  NotificationChannel,
  Rule,
  UpsertRuleInput,
} from "@/services/types";
import RuleEditor from "@/components/RuleEditor/RuleEditor";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { toast } from "@/components/ui/Toaster";

export default function NewRulePage() {
  const router = useRouter();
  const [data, setData] = useState<{
    monitors: Monitor[];
    groups: GroupView[];
    rules: Rule[];
    channels: NotificationChannel[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const orgs = await api.listOrgs();
        const monitorsByOrg = await Promise.all(
          orgs.map((o) => api.listMonitors(o.cc_org_id).catch(() => [])),
        );
        const [groups, rules, channels] = await Promise.all([
          api.listGroups().catch(() => []),
          api.listRules().catch(() => []),
          api.listChannels().catch(() => []),
        ]);
        if (active)
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
  }, []);

  async function handleSave(input: UpsertRuleInput) {
    setBusy(true);
    try {
      const created = await api.createRule(input);
      toast.success("Rule created");
      router.push(`/rules/${created.id}`);
    } catch (err: unknown) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <Card className="p-5 border-critical/30 bg-critical-soft">
        <p className="text-sm text-critical">{error}</p>
      </Card>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <>
      <PageHeader
        title="New rule"
        description="Drag conditions and actions onto the canvas. Save to validate (no cycles, fields exist) and start watching."
        breadcrumbs={[
          { label: "Rules", href: "/rules" },
          { label: "New" },
        ]}
      />
      <RuleEditor
        data={data}
        onSave={handleSave}
        busy={busy}
        saveLabel="Create rule"
      />
    </>
  );
}
