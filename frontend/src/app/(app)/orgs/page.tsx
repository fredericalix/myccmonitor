"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Buildings,
  Plug,
  PlugsConnected,
} from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { Org } from "@/services/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { toast } from "@/components/ui/Toaster";

export default function OrgsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [setupDone, setSetupDone] = useState<Record<string, boolean>>({});

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
    try {
      await api.setupWebhook(ccOrgId);
      setSetupDone((s) => ({ ...s, [ccOrgId]: true }));
      toast.success("Webhook installed", {
        description: `Org ${ccOrgId} now sends events to myccmonitor.`,
      });
    } catch (err: unknown) {
      toast.error("Webhook setup failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Toutes les orgs Clever Cloud auxquelles ton compte a accès. Active le webhook pour recevoir les événements de déploiement en live."
      />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <Card className="p-5 border-critical/30 bg-critical-soft">
          <p className="text-sm text-critical">{error}</p>
        </Card>
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={<Buildings weight="duotone" size={28} />}
          title="No organisations yet"
          description="Make sure your Clever Cloud account has at least one org and that the OAuth consumer carries access-organisations + manage-organisations-applications."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {orgs.map((o) => {
            const ok = setupDone[o.cc_org_id];
            return (
              <li key={o.cc_org_id}>
                <Card variant="interactive" className="p-5 h-full flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                      <Buildings weight="duotone" size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-xl text-text">
                        {o.name ?? o.cc_org_id}
                      </p>
                      <p className="truncate font-mono text-[11px] text-text-subtle">
                        {o.cc_org_id}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center gap-2 flex-wrap">
                    <Button
                      variant={ok ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => setupWebhook(o.cc_org_id)}
                      disabled={busy === o.cc_org_id}
                    >
                      {ok ? (
                        <>
                          <PlugsConnected weight="bold" size={14} />
                          Re-install webhook
                        </>
                      ) : (
                        <>
                          <Plug weight="bold" size={14} />
                          {busy === o.cc_org_id ? "Setting up…" : "Setup webhook"}
                        </>
                      )}
                    </Button>
                    <Link
                      href={`/orgs/${encodeURIComponent(o.cc_org_id)}`}
                      className="ml-auto"
                    >
                      <Button variant="ghost" size="sm">
                        Monitors
                        <ArrowRight weight="bold" size={14} />
                      </Button>
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
