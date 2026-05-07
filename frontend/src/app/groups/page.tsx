"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/services/api";
import type { GroupView } from "@/services/types";
import { RolledStateBadge } from "@/components/RolledStateBadge";

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline create form
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newKinds, setNewKinds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      const rows = await api.listGroups();
      setGroups(rows);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/auth/login";
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    api
      .listGroups()
      .then((rows) => {
        if (active) setGroups(rows);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const auto_rules =
        newPattern.trim() || newKinds.length > 0
          ? {
              name_pattern: newPattern.trim() || undefined,
              kinds: newKinds.length > 0 ? newKinds : undefined,
            }
          : undefined;
      await api.createGroup({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        auto_rules,
      });
      setNewName("");
      setNewDescription("");
      setNewPattern("");
      setNewKinds([]);
      refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  function toggleKind(k: string) {
    setNewKinds((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Monitor groups
        </h1>
        <Link href="/orgs" className="text-sm text-slate-500 hover:text-slate-900">
          ← Organisations
        </Link>
      </div>

      <form
        onSubmit={createGroup}
        className="mb-10 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          New group
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (required)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="Auto-match name regex (optional, e.g. ^prod-)"
            className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm sm:col-span-2"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500">Auto-match kinds:</span>
          {(["cc_application", "cc_addon", "synthetic"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={newKinds.includes(k)}
                onChange={() => toggleKind(k)}
              />
              <span className="font-mono">{k}</span>
            </label>
          ))}
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="ml-auto rounded-md bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {!loading && groups.length === 0 && !error && (
        <p className="text-sm text-slate-500">
          No groups yet. Create one above to start grouping your monitors.
        </p>
      )}

      <ul className="space-y-3">
        {groups.map((g) => (
          <li
            key={g.id}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-900">{g.name}</span>
                <RolledStateBadge state={g.rolled_state} />
              </div>
              {g.description && (
                <p className="mt-1 text-xs text-slate-500">{g.description}</p>
              )}
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {g.state_breakdown.total} member
                {g.state_breakdown.total === 1 ? "" : "s"}
                {g.state_breakdown.critical > 0 &&
                  ` · ${g.state_breakdown.critical} critical`}
                {g.state_breakdown.warning > 0 &&
                  ` · ${g.state_breakdown.warning} warning`}
              </p>
            </div>
            <Link
              href={`/groups/${g.id}`}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Manage →
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
