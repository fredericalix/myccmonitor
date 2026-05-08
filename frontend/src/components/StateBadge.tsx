import type { MonitorState } from "@/services/types";
import { Badge } from "@/components/ui/Badge";

const VARIANTS: Record<MonitorState, "ok" | "warning" | "critical" | "unknown"> = {
  ok: "ok",
  warning: "warning",
  critical: "critical",
  unknown: "unknown",
};

const LABELS: Record<MonitorState, string> = {
  ok: "ok",
  warning: "warn",
  critical: "critical",
  unknown: "unknown",
};

export function StateBadge({
  state,
  withDot = true,
}: {
  state: MonitorState;
  withDot?: boolean;
}) {
  const dotClass: Record<MonitorState, string> = {
    ok: "bg-ok",
    warning: "bg-warning",
    critical: "bg-critical",
    unknown: "bg-unknown",
  };
  return (
    <Badge variant={VARIANTS[state]}>
      {withDot ? (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass[state]}`}
          aria-hidden
        />
      ) : null}
      {LABELS[state]}
    </Badge>
  );
}
