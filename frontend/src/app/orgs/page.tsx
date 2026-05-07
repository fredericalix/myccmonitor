"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/services/api";
import type { Org } from "@/services/types";

export default function OrgsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [setupOk, setSetupOk] = useState<string | null>(null);
  const [setupErr, setSetupErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .listOrgs()
      .then(setOrgs)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  async function setupWebhook(ccOrgId: string) {
    setBusy(ccOrgId);
    setSetupOk(null);
    setSetupErr(null);
    try {
      await api.setupWebhook(ccOrgId);
      setSetupOk(ccOrgId);
    } catch (err: unknown) {
      setSetupErr(
        `${ccOrgId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Your organisations
        </h1>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/groups"
            className="text-slate-600 hover:text-slate-900"
          >
            Groups →
          </Link>
          <Link
            href="/"
            className="text-slate-500 hover:text-slate-900"
          >
            ← Home
          </Link>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {setupOk && (
        <div className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
          Webhook installed on org <span className="font-mono">{setupOk}</span>.
        </div>
      )}
      {setupErr && (
        <div className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-600/20">
          {setupErr}
        </div>
      )}

      {!loading && orgs.length === 0 && !error && (
        <p className="text-sm text-slate-500">
          No organisations returned. Make sure your Clever Cloud account has at
          least one org and that your OAuth consumer has the
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono">
            access-organisations
          </code>
          right.
        </p>
      )}

      <ul className="space-y-3">
        {orgs.map((o) => (
          <li
            key={o.cc_org_id}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-slate-900">
                {o.name ?? o.cc_org_id}
              </div>
              <div className="font-mono text-xs text-slate-500">
                {o.cc_org_id}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setupWebhook(o.cc_org_id)}
                disabled={busy === o.cc_org_id}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {busy === o.cc_org_id ? "Setting up…" : "Setup webhook"}
              </button>
              <Link
                href={`/orgs/${encodeURIComponent(o.cc_org_id)}`}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Monitors →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
