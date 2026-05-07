"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/services/api";
import type { GroupView, Monitor, Org } from "@/services/types";
import { StateBadge } from "@/components/StateBadge";
import { RolledStateBadge } from "@/components/RolledStateBadge";

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [group, setGroup] = useState<GroupView | null>(null);
  const [allMonitors, setAllMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<string>("");

  const reload = useCallback(async () => {
    try {
      const g = await api.getGroup(id);
      setGroup(g);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/auth/login";
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  // Initial load: group + all of the user's monitors (across orgs).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const orgs: Org[] = await api.listOrgs();
        const monitorLists = await Promise.all(
          orgs.map((o) => api.listMonitors(o.cc_org_id).catch(() => [])),
        );
        if (!active) return;
        setAllMonitors(monitorLists.flat());
        await reload();
      } catch (err: unknown) {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reload]);

  async function addMember() {
    if (!pickerSelected) return;
    setBusy(true);
    try {
      await api.addGroupMember(id, pickerSelected);
      setPickerSelected("");
      await reload();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(monitorId: string) {
    setBusy(true);
    try {
      await api.removeGroupMember(id, monitorId);
      await reload();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    if (!confirm("Delete this group? Members are not affected.")) return;
    setBusy(true);
    try {
      await api.deleteGroup(id);
      router.push("/groups");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (loading) return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="p-8 text-sm text-rose-600">{error}</p>;
  if (!group) return null;

  const memberMonitors = allMonitors.filter((m) =>
    group.member_ids.includes(m.id),
  );
  const memberSet = new Set(group.member_ids);
  const candidates = allMonitors.filter((m) => !memberSet.has(m.id));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              {group.name}
            </h1>
            <RolledStateBadge state={group.rolled_state} />
          </div>
          {group.description && (
            <p className="mt-1 text-sm text-slate-500">{group.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/groups" className="text-sm text-slate-500 hover:text-slate-900">
            ← Groups
          </Link>
          <button
            onClick={deleteGroup}
            disabled={busy}
            className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
          >
            Delete group
          </button>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Auto-grouping
        </h2>
        <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
{JSON.stringify(group.auto_rules ?? {}, null, 2)}
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Members ({memberMonitors.length} of {group.state_breakdown.total} effective)
        </h2>
        <ul className="space-y-2">
          {memberMonitors.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">
                    {m.display_name}
                  </span>
                  <StateBadge state={m.current_state} />
                </div>
                <p className="font-mono text-[11px] text-slate-500">
                  {m.kind} · {m.cc_resource_id ?? "synthetic"}
                </p>
              </div>
              <button
                onClick={() => removeMember(m.id)}
                disabled={busy}
                className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
          {memberMonitors.length === 0 && (
            <li className="text-xs text-slate-500">
              No members yet. Add some manually below or set up auto-grouping
              rules.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Add monitor
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={pickerSelected}
            onChange={(e) => setPickerSelected(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— pick a monitor —</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name} ({m.kind})
              </option>
            ))}
          </select>
          <button
            onClick={addMember}
            disabled={!pickerSelected || busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </section>
    </main>
  );
}
