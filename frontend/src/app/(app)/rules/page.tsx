"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Lightning, Plus, Scroll } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { Rule } from "@/services/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { BlueprintCard } from "@/components/forge/BlueprintCard";
import { LedIndicator } from "@/components/forge/LedIndicator";
import { RiveterButton } from "@/components/forge/RiveterButton";
import { MachineCard } from "@/components/forge/MachineCard";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

export default function BlueprintLibraryPage() {
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
    <>
      <PageHeader
        title={
          <span className="font-serif italic text-[var(--forge-text-accent)]">
            Blueprint library
          </span>
        }
        description="Workflow blueprints that watch the floor, evaluate composite conditions, and fire actions in parallel: set monitor state, broadcast notifications, escalate."
        actions={
          <Link href="/rules/new">
            <RiveterButton variant="primary">
              <Plus weight="bold" size={14} />
              New blueprint
            </RiveterButton>
          </Link>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <MachineCard variant="action" className="p-4">
          <p className="text-[12px] text-[var(--forge-text)]">{error}</p>
        </MachineCard>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Scroll weight="duotone" size={28} />}
          title="No blueprints yet"
          description="Draft your first workflow blueprint with the visual forge — drag sensors, AND/OR them, fan out actuators in parallel."
          action={
            <Link href="/rules/new">
              <RiveterButton variant="primary">
                <Plus weight="bold" size={14} />
                Draft the first blueprint
              </RiveterButton>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => (
            <li key={r.id}>
              <BlueprintCard className="p-4 hover:-translate-y-0.5 hover:brightness-110 transition-[transform,filter] duration-150">
                <div className="relative z-10 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <LedIndicator
                        state={r.is_enabled ? "ok" : "unknown"}
                        size="sm"
                        pulse={false}
                      />
                      <span className="font-serif text-[18px] text-[var(--forge-text)] truncate">
                        {r.name}
                      </span>
                      <Lightning
                        weight="fill"
                        size={11}
                        className="text-[var(--copper-glow)]"
                      />
                      {r.is_enabled ? (
                        <Badge variant="ok">live</Badge>
                      ) : (
                        <Badge variant="unknown">paused</Badge>
                      )}
                      {r.last_outcome_state ? (
                        <Badge variant="accent">
                          last outcome → {r.last_outcome_state}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-[11px] text-[var(--forge-text-muted)] font-mono">
                      cooldown {r.cooldown_seconds}s ·{" "}
                      {r.last_fired_at
                        ? `last fired ${formatRelative(r.last_fired_at)}`
                        : "never fired"}
                    </p>
                  </div>
                  <Link href={`/rules/${r.id}`}>
                    <RiveterButton variant="ghost" size="sm">
                      Open
                      <ArrowRight weight="bold" size={12} />
                    </RiveterButton>
                  </Link>
                </div>
              </BlueprintCard>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
