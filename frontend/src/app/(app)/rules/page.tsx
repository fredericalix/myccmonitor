"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Lightning, Plus } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type { Rule } from "@/services/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

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
    <>
      <PageHeader
        title="Workflow rules"
        description="Visual rules that watch your monitors, evaluate composite conditions, and fan out actions: setMonitorState, sendNotification, escalate."
        actions={
          <Link href="/rules/new">
            <Button variant="primary">
              <Plus weight="bold" size={16} />
              New rule
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <Card className="p-5 border-critical/30 bg-critical-soft">
          <p className="text-sm text-critical">{error}</p>
        </Card>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Lightning weight="duotone" size={28} />}
          title="No rules yet"
          description="Create your first workflow rule with the visual editor — drag conditions, AND/OR them, fan out actions in parallel."
          action={
            <Link href="/rules/new">
              <Button variant="primary">
                <Plus weight="bold" size={16} />
                Create your first rule
              </Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => (
            <li key={r.id}>
              <Card variant="interactive" className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-serif text-xl text-text truncate">
                        {r.name}
                      </span>
                      {r.is_enabled ? (
                        <Badge variant="ok">enabled</Badge>
                      ) : (
                        <Badge variant="unknown">disabled</Badge>
                      )}
                      {r.last_outcome_state ? (
                        <Badge variant="accent">
                          last → {r.last_outcome_state}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs text-text-muted">
                      cooldown {r.cooldown_seconds}s ·{" "}
                      {r.last_fired_at
                        ? `last fired ${new Date(r.last_fired_at).toLocaleString()}`
                        : "never fired"}
                    </p>
                  </div>
                  <Link href={`/rules/${r.id}`}>
                    <Button variant="ghost" size="sm">
                      Edit
                      <ArrowRight weight="bold" size={14} />
                    </Button>
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
