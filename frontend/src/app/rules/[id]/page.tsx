"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/services/api";
import type {
  GroupView,
  Monitor,
  Rule,
  UpsertRuleInput,
} from "@/services/types";
import RuleEditor from "@/components/RuleEditor/RuleEditor";

export default function EditRulePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [rule, setRule] = useState<Rule | null>(null);
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
        const [r, orgs, groups, rules] = await Promise.all([
          api.getRule(id),
          api.listOrgs(),
          api.listGroups().catch(() => []),
          api.listRules().catch(() => []),
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
      alert("Saved.");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    try {
      const result = await api.testRule(id);
      alert(
        `Dry-run: ${result.matched ? "MATCH" : "no match"} · ${result.actions_that_would_run} action(s) would run.`,
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this rule? This is permanent.")) return;
    setBusy(true);
    try {
      await api.deleteRule(id);
      router.push("/rules");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (error) return <p className="p-8 text-sm text-rose-600">{error}</p>;
  if (!rule || !data) return <p className="p-8 text-sm text-slate-500">Loading…</p>;

  return (
    <RuleEditor
      data={data}
      initialRule={rule}
      onSave={handleSave}
      onTest={handleTest}
      onDelete={handleDelete}
      busy={busy}
      saveLabel="Save"
    />
  );
}
