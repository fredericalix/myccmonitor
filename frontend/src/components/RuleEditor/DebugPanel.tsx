"use client";

import { useEffect, useState } from "react";
import {
  ArrowsCounterClockwise,
  CheckCircle,
  Clock,
  Hourglass,
  PaperPlaneTilt,
  Pulse,
  StackSimple,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { api } from "@/services/api";
import type {
  ChannelDebugInfo,
  GroupDebugInfo,
  MonitorDebugInfo,
  RuleDebugResponse,
  RuleFiring,
} from "@/services/types";
import { Dialog } from "@/components/ui/Dialog";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StateBadge } from "@/components/StateBadge";
import { RolledStateBadge } from "@/components/RolledStateBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86_400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
}

const outcomeBadge: Record<RuleFiring["outcome"], "ok" | "warning" | "critical" | "unknown" | "accent"> = {
  matched: "ok",
  not_matched: "unknown",
  cooldown_skipped: "warning",
  error: "critical",
};

interface DebugPanelProps {
  ruleId: string;
  open: boolean;
  onClose: () => void;
}

export function DebugPanel({ ruleId, open, onClose }: DebugPanelProps) {
  const [data, setData] = useState<RuleDebugResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reqTick, setReqTick] = useState(0);

  // Trigger a re-fetch by bumping reqTick. Used by the Refresh button.
  const refresh = () => setReqTick((n) => n + 1);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .debugRule(ruleId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ruleId, reqTick]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Rule diagnostic"
      description={
        data
          ? `Live snapshot — ${data.rule.is_enabled ? "enabled" : "disabled"}, cooldown ${data.rule.cooldown_seconds}s`
          : undefined
      }
    >
      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : error ? (
        <Card className="p-4 border-critical/30 bg-critical-soft">
          <p className="text-sm text-critical">{error}</p>
        </Card>
      ) : data ? (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <VerdictBox data={data} />

          {data.monitors_referenced.length > 0 ? (
            <Section icon={<Pulse weight="duotone" size={16} />} title="Monitors referenced">
              <ul className="space-y-2">
                {data.monitors_referenced.map((m) => (
                  <MonitorRow key={m.id} monitor={m} />
                ))}
              </ul>
            </Section>
          ) : null}

          {data.groups_referenced.length > 0 ? (
            <Section icon={<StackSimple weight="duotone" size={16} />} title="Groups referenced">
              <ul className="space-y-2">
                {data.groups_referenced.map((g) => (
                  <GroupRow key={g.id} group={g} />
                ))}
              </ul>
            </Section>
          ) : null}

          <Section icon={<PaperPlaneTilt weight="duotone" size={16} />} title="Channels used">
            {data.channels_used.length === 0 ? (
              <p className="text-xs text-text-subtle">
                No <code className="font-mono">send_notification</code> action — no channel
                will be hit. (If you expect one, add a SendNotification action node.)
              </p>
            ) : (
              <ul className="space-y-2">
                {data.channels_used.map((c) => (
                  <ChannelRow key={c.id} channel={c} />
                ))}
              </ul>
            )}
          </Section>

          <Section
            icon={<ArrowsCounterClockwise weight="duotone" size={16} />}
            title="Recent firings"
          >
            {data.recent_firings.length === 0 ? (
              <p className="text-xs text-text-subtle">
                No recent firings. The rule has never been evaluated; if you expect
                triggers, check that the monitor is referenced in the condition tree
                and that webhooks are arriving.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.recent_firings.map((f) => (
                  <FiringRow key={f.id} firing={f} />
                ))}
              </ul>
            )}
          </Section>

          <Section title="Condition tree (annotated)">
            <pre className="overflow-x-auto rounded-lg bg-bg/60 border border-border p-3 font-mono text-[11px] text-text leading-relaxed">
              {JSON.stringify(data.condition_summary, null, 2)}
            </pre>
          </Section>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
              <ArrowsCounterClockwise weight="bold" size={14} />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        {icon ? <span className="text-accent-strong">{icon}</span> : null}
        {title}
      </h3>
      {children}
    </div>
  );
}

function VerdictBox({ data }: { data: RuleDebugResponse }) {
  const cd = data.cooldown;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Card
        className={cn(
          "p-4",
          data.would_match_now
            ? "border-ok/40 bg-ok-soft"
            : "border-border bg-surface",
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          {data.would_match_now ? (
            <CheckCircle weight="duotone" size={20} className="text-ok" />
          ) : (
            <XCircle weight="duotone" size={20} className="text-text-muted" />
          )}
          <p className="font-serif text-lg text-text leading-none">
            {data.would_match_now ? "Would match now" : "Would not match"}
          </p>
        </div>
        <p className="text-xs text-text-muted">
          Live verdict, computed by re-running <code className="font-mono">evaluate</code> against current
          monitor / group state.
        </p>
        {!data.rule.is_enabled ? (
          <p className="mt-2 text-xs text-warning inline-flex items-center gap-1">
            <WarningCircle weight="bold" size={14} />
            Rule is disabled — actions would not run even on match.
          </p>
        ) : null}
      </Card>

      <Card
        className={cn(
          "p-4",
          cd.would_skip_due_to_cooldown
            ? "border-warning/40 bg-warning-soft"
            : "border-border bg-surface",
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          {cd.would_skip_due_to_cooldown ? (
            <Hourglass weight="duotone" size={20} className="text-warning" />
          ) : (
            <Clock weight="duotone" size={20} className="text-text-muted" />
          )}
          <p className="font-serif text-lg text-text leading-none">Cooldown</p>
        </div>
        <p className="text-xs text-text-muted">
          {cd.would_skip_due_to_cooldown
            ? `Skipped — ${humanDuration(cd.remaining_seconds)} remaining (verdict unchanged from previous match).`
            : cd.last_fired_at
              ? `Last fired ${new Date(cd.last_fired_at).toLocaleString()}; cooldown ${cd.cooldown_seconds}s.`
              : "Never fired yet — no cooldown active."}
        </p>
        {cd.last_outcome_state ? (
          <p className="mt-1.5 text-[11px] text-text-subtle">
            Last outcome: <code className="font-mono">{cd.last_outcome_state}</code>
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function MonitorRow({ monitor }: { monitor: MonitorDebugInfo }) {
  return (
    <li className="rounded-xl bg-bg/60 border border-border px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <StateBadge state={monitor.current_state} />
        <span className="font-medium text-text truncate">{monitor.display_name}</span>
        <span className="font-mono text-[11px] text-text-subtle">{monitor.kind}</span>
      </div>
      <p className="mt-1 text-[11px] text-text-muted">
        held current state for {humanDuration(monitor.held_for_seconds)}
        {monitor.current_state_since
          ? ` · since ${new Date(monitor.current_state_since).toLocaleString()}`
          : ""}
      </p>
      {monitor.current_message ? (
        <p className="mt-1 text-xs text-text-muted truncate">
          msg: {monitor.current_message}
        </p>
      ) : null}
    </li>
  );
}

function GroupRow({ group }: { group: GroupDebugInfo }) {
  return (
    <li className="rounded-xl bg-bg/60 border border-border px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <RolledStateBadge state={group.rolled_state} />
        <span className="font-medium text-text truncate">{group.name}</span>
      </div>
      <p className="mt-1 text-[11px] text-text-muted">
        {group.total} member{group.total === 1 ? "" : "s"} · {group.critical_count} critical
        · {group.warning_count} warning · {group.ok_count} ok
      </p>
    </li>
  );
}

function ChannelRow({ channel }: { channel: ChannelDebugInfo }) {
  const broken = !channel.enabled || channel.failure_count > 0;
  return (
    <li
      className={cn(
        "rounded-xl border px-4 py-3",
        broken ? "border-critical/30 bg-critical-soft" : "border-border bg-bg/60",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            channel.enabled ? "bg-ok" : "bg-critical",
          )}
          aria-hidden
        />
        <span className="font-medium text-text">{channel.name}</span>
        <Badge variant="neutral">{channel.kind}</Badge>
        {!channel.enabled ? <Badge variant="warning">disabled</Badge> : null}
        {channel.failure_count > 0 ? (
          <Badge variant="critical">{channel.failure_count} failures</Badge>
        ) : null}
      </div>
      {channel.last_success_at ? (
        <p className="mt-1 text-[11px] text-text-subtle">
          last success {new Date(channel.last_success_at).toLocaleString()}
        </p>
      ) : null}
      {channel.last_failure_message ? (
        <p className="mt-1 text-[11px] text-critical">
          last error: {channel.last_failure_message}
        </p>
      ) : null}
    </li>
  );
}

function FiringRow({ firing }: { firing: RuleFiring }) {
  const variant = outcomeBadge[firing.outcome];
  return (
    <li className="rounded-xl bg-bg/60 border border-border px-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={variant}>{firing.outcome}</Badge>
        <span className="text-[11px] text-text-muted">
          {new Date(firing.fired_at).toLocaleString()}
        </span>
        <span className="font-mono text-[11px] text-text-subtle">
          trigger: {firing.trigger_kind}
        </span>
      </div>
      {firing.error_message ? (
        <p className="mt-1 text-[11px] text-critical">{firing.error_message}</p>
      ) : null}
    </li>
  );
}
