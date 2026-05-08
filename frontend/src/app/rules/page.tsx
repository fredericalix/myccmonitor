"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/services/api";
import type { Rule } from "@/services/types";

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listRules()
      .then((rs) => {
        if (active) setRules(rs);
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

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Workflow rules
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/rules/new"
            className="rounded-md bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
          >
            + New rule
          </Link>
          <Link href="/orgs" className="text-slate-500 hover:text-slate-900">
            ← Organisations
          </Link>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {!loading && rules.length === 0 && !error && (
        <p className="text-sm text-slate-500">
          No rules yet. Click <span className="font-medium">+ New rule</span> to
          open the visual editor.
        </p>
      )}

      <ul className="space-y-3">
        {rules.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-900">{r.name}</span>
                {!r.is_enabled && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    disabled
                  </span>
                )}
                {r.last_outcome_state && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700">
                    {r.last_outcome_state}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                cooldown {r.cooldown_seconds}s ·{" "}
                {r.last_fired_at
                  ? `last fired ${new Date(r.last_fired_at).toLocaleString()}`
                  : "never fired"}
              </p>
            </div>
            <Link
              href={`/rules/${r.id}`}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit →
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
