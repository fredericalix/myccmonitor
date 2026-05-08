"use client";

import { Handle, NodeProps, Position } from "reactflow";
import {
  ArrowsClockwise,
  Lightning,
  PaperPlaneTilt,
  Warning,
} from "@phosphor-icons/react";
import { useEditorData } from "../EditorContext";
import { cn } from "@/lib/cn";

type ActionKind = "set_monitor_state" | "send_notification" | "escalate";

interface ActionData {
  type: ActionKind;
  target_monitor_id?: string;
  state?: string;
  message?: string;
  acknowledged?: boolean;
  channel_id?: string;
  subject?: string;
  delay_seconds?: number;
  target_rule_id?: string;
  onChange: (nodeId: string, key: string, value: unknown) => void;
}

const STATE_VALUES = ["ok", "warning", "critical", "unknown"];

const fieldCls =
  "w-full rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none";

const KIND_META: Record<
  ActionKind,
  { label: string; ring: string; handle: string; icon: React.ReactNode }
> = {
  set_monitor_state: {
    label: "Set monitor state",
    ring: "border-ok/60",
    handle: "var(--color-ok)",
    icon: <ArrowsClockwise weight="duotone" size={14} />,
  },
  send_notification: {
    label: "Send notification",
    ring: "border-accent/60",
    handle: "var(--color-accent)",
    icon: <PaperPlaneTilt weight="duotone" size={14} />,
  },
  escalate: {
    label: "Escalate (delayed)",
    ring: "border-critical/60",
    handle: "var(--color-critical)",
    icon: <Lightning weight="duotone" size={14} />,
  },
};

export default function ActionNode({ id, data }: NodeProps<ActionData>) {
  const { monitors, rules, channels } = useEditorData();
  const onChange = (key: string, value: unknown) => data.onChange(id, key, value);

  const meta = KIND_META[data.type];

  let invalid = false;
  if (data.type === "set_monitor_state") {
    invalid = !data.target_monitor_id || !data.state;
  } else if (data.type === "send_notification") {
    invalid = !data.channel_id || !data.message;
  } else if (data.type === "escalate") {
    invalid = !data.target_rule_id;
  }

  return (
    <div
      className={cn(
        "w-72 rounded-2xl border-2 bg-surface p-3 shadow-warm-md",
        invalid ? "border-critical/60" : meta.ring,
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text">
          <span className="text-accent-strong">{meta.icon}</span>
          Action
        </div>
        {invalid ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-critical">
            <Warning weight="bold" size={12} />
            incomplete
          </span>
        ) : null}
      </div>

      <select
        value={data.type}
        onChange={(e) => onChange("type", e.target.value as ActionKind)}
        className={cn(fieldCls, "mb-2 font-medium")}
      >
        <option value="set_monitor_state">Set monitor state</option>
        <option value="send_notification">Send notification</option>
        <option value="escalate">Escalate (delayed)</option>
      </select>

      {data.type === "set_monitor_state" ? (
        <>
          <select
            value={data.target_monitor_id ?? ""}
            onChange={(e) => onChange("target_monitor_id", e.target.value)}
            className={cn(fieldCls, "mb-1.5")}
          >
            <option value="">— target monitor —</option>
            {monitors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name} ({m.kind})
              </option>
            ))}
          </select>
          <select
            value={data.state ?? ""}
            onChange={(e) => onChange("state", e.target.value)}
            className={cn(fieldCls, "mb-1.5")}
          >
            <option value="">— new state —</option>
            {STATE_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={data.message ?? ""}
            onChange={(e) => onChange("message", e.target.value)}
            placeholder="message (handlebars supported)"
            className={cn(fieldCls, "mb-1.5")}
          />
          <label className="flex items-center gap-1.5 text-[11px] text-text">
            <input
              type="checkbox"
              checked={!!data.acknowledged}
              onChange={(e) => onChange("acknowledged", e.target.checked)}
              className="accent-accent"
            />
            set acknowledged
          </label>
        </>
      ) : null}

      {data.type === "send_notification" ? (
        <>
          <select
            value={data.channel_id ?? ""}
            onChange={(e) => onChange("channel_id", e.target.value)}
            className={cn(fieldCls, "mb-1.5")}
          >
            <option value="">— channel —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.kind})
              </option>
            ))}
          </select>
          <input
            type="text"
            value={data.subject ?? ""}
            onChange={(e) => onChange("subject", e.target.value)}
            placeholder="subject (email-only)"
            className={cn(fieldCls, "mb-1.5")}
          />
          <textarea
            value={data.message ?? ""}
            onChange={(e) => onChange("message", e.target.value)}
            placeholder="{{monitor.display_name}} just turned {{format_state monitor.current_state}}"
            rows={3}
            className={cn(fieldCls, "resize-y min-h-[60px]")}
          />
        </>
      ) : null}

      {data.type === "escalate" ? (
        <>
          <input
            type="number"
            min="0"
            value={data.delay_seconds ?? 0}
            onChange={(e) =>
              onChange("delay_seconds", parseInt(e.target.value, 10) || 0)
            }
            placeholder="delay seconds"
            className={cn(fieldCls, "mb-1.5")}
          />
          <select
            value={data.target_rule_id ?? ""}
            onChange={(e) => onChange("target_rule_id", e.target.value)}
            className={fieldCls}
          >
            <option value="">— rule to escalate to —</option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <Handle
        type="target"
        position={Position.Left}
        id="action-in"
        style={{
          background: meta.handle,
          width: 12,
          height: 12,
          border: "2px solid var(--color-surface)",
        }}
      />
    </div>
  );
}
