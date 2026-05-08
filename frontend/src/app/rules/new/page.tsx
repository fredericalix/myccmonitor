"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/services/api";
import type { GroupView, Monitor, Rule, UpsertRuleInput } from "@/services/types";
import RuleEditor from "@/components/RuleEditor/RuleEditor";

export default function NewRulePage() {
  const router = useRouter();
  const [data, setData] = useState<{
    monitors: Monitor[];
    groups: GroupView[];
    rules: Rule[];
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
        const [groups, rules] = await Promise.all([
          api.listGroups().catch(() => []),
          api.listRules().catch(() => []),
        ]);
        if (active)
          setData({
            monitors: monitorsByOrg.flat(),
            groups: groups as GroupView[],
            rules: rules as Rule[],
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
      router.push(`/rules/${created.id}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="p-8 text-sm text-rose-600">{error}</p>;
  if (!data) return <p className="p-8 text-sm text-slate-500">Loading…</p>;

  return (
    <RuleEditor
      data={data}
      onSave={handleSave}
      busy={busy}
      saveLabel="Create rule"
    />
  );
}
