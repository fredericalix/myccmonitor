"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Buildings,
  Factory,
  Plug,
  PlugsConnected,
  Question,
  Warning,
} from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { Org } from "@/services/types";
import { RiveterButton } from "@/components/forge/RiveterButton";
import { MachineCard, MachineLabel } from "@/components/forge/MachineCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { toast } from "@/components/ui/Toaster";

export default function WorkshopsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
      // Optimistic: flip the local row so the chip + label update immediately,
      // then refetch to pick up the authoritative CC view.
      setOrgs((prev) =>
        prev.map((o) =>
          o.cc_org_id === ccOrgId
            ? { ...o, has_webhook: true, webhook_check_failed: false }
            : o,
        ),
      );
      toast.success("Webhook hook-up installed", {
        description: `Workshop ${ccOrgId} now relays events.`,
      });
      api
        .listOrgs()
        .then(setOrgs)
        .catch(() => {
          /* keep the optimistic view; next page load will reconcile */
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
        title={
          <span>
            <span className="font-serif italic text-[var(--forge-text-accent)]">
              Workshops
            </span>
          </span>
        }
        description="Every Clever Cloud organisation your account can reach. Install the webhook hook-up to stream deployment events into the bus."
      />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <MachineCard variant="action" className="p-4">
          <p className="text-[12px] text-[var(--forge-text)]">{error}</p>
        </MachineCard>
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={<Buildings weight="duotone" size={28} />}
          title="No workshops on file"
          description="Make sure your Clever Cloud account has at least one org and that the OAuth consumer carries access-organisations + manage-organisations-applications."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {orgs.map((o) => {
            const hasWebhook = o.has_webhook === true;
            const checkFailed = o.webhook_check_failed === true;
            return (
              <li key={o.cc_org_id}>
                <MachineCard className="p-4 h-full flex flex-col gap-3 hover:-translate-y-0.5 hover:brightness-110 transition-[transform,filter] duration-150">
                  <MachineLabel>
                    <span className="flex items-center gap-2 normal-case tracking-normal">
                      <Factory weight="fill" size={14} className="text-[var(--copper-glow)]" />
                      <span className="font-serif text-[18px] leading-tight text-[var(--forge-text)] truncate">
                        {o.name ?? o.cc_org_id}
                      </span>
                    </span>
                    <span className="rounded-[3px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/70 px-1.5 py-0.5 text-[9px] tracking-[0.5px] text-[var(--forge-text-muted)] font-mono">
                      WORKSHOP
                    </span>
                  </MachineLabel>
                  <p className="-mt-1 truncate font-mono text-[11px] text-[var(--forge-text-dim)]">
                    {o.cc_org_id}
                  </p>
                  <div className="mt-auto flex items-center gap-2 flex-wrap">
                    <RiveterButton
                      variant="default"
                      size="sm"
                      onClick={() => setupWebhook(o.cc_org_id)}
                      disabled={busy === o.cc_org_id}
                    >
                      {hasWebhook ? (
                        <>
                          <PlugsConnected weight="bold" size={12} />
                          Re-install
                        </>
                      ) : (
                        <>
                          <Plug weight="bold" size={12} />
                          {busy === o.cc_org_id ? "Hooking up…" : "Hook up"}
                        </>
                      )}
                    </RiveterButton>
                    {!hasWebhook && !checkFailed ? (
                      <span
                        title="No webhook installed yet — events won't reach the bus until you hook this workshop up."
                        className="inline-flex items-center gap-1 rounded-[3px] border border-[var(--led-warn)]/60 bg-[var(--led-warn)]/12 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.5px] text-[var(--led-warn)] font-mono"
                      >
                        <Warning weight="fill" size={11} />
                        Required
                      </span>
                    ) : null}
                    {checkFailed ? (
                      <span
                        title="Couldn't reach Clever Cloud to verify the webhook state — try again in a moment."
                        className="inline-flex items-center gap-1 rounded-[3px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/60 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.5px] text-[var(--forge-text-muted)] font-mono"
                      >
                        <Question weight="bold" size={11} />
                        ?
                      </span>
                    ) : null}
                    <Link
                      href={`/orgs/${encodeURIComponent(o.cc_org_id)}`}
                      className="ml-auto"
                    >
                      <RiveterButton variant="primary" size="sm">
                        Enter
                        <ArrowRight weight="bold" size={12} />
                      </RiveterButton>
                    </Link>
                  </div>
                </MachineCard>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
