"use client";

import { Handle, NodeProps, Position } from "reactflow";
import { useState } from "react";
import {
  ArrowsClockwise,
  BracketsCurly,
  Lightning,
  PaperPlaneTilt,
  Warning,
} from "@phosphor-icons/react";
import { useEditorData } from "../EditorContext";
import { cn } from "@/lib/cn";

type ActionKind = "set_monitor_state" | "send_notification" | "escalate";

// Fields that belong to each action type — used to drop now-irrelevant values
// from the node when the user switches type, so stale data isn't carried over.
const FIELDS_BY_KIND: Record<ActionKind, string[]> = {
  set_monitor_state: ["target_monitor_id", "state", "message", "acknowledged"],
  send_notification: ["channel_id", "message", "subject"],
  escalate: ["delay_seconds", "target_rule_id"],
};
const ALL_ACTION_FIELDS = [
  "target_monitor_id",
  "state",
  "message",
  "acknowledged",
  "channel_id",
  "subject",
  "delay_seconds",
  "target_rule_id",
];

// Variables and helpers available to handlebars templates, matching the
// context built in `notifications/dispatch.rs`.
const TEMPLATE_VARS = [
  "{{monitor.display_name}}",
  "{{monitor.current_state}}",
  "{{monitor.current_message}}",
  "{{monitor.kind}}",
  "{{rule.name}}",
  "{{trigger.kind}}",
  "{{format_state monitor.current_state}}",
  "{{relative_time monitor.current_state_since}}",
];

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
  const [showVars, setShowVars] = useState(false);

  // Switch type and drop any field that doesn't belong to the new type, so
  // stale values (e.g. a leftover `state`) aren't serialized or shown later.
  const onTypeChange = (newType: ActionKind) => {
    const keep = new Set(FIELDS_BY_KIND[newType]);
    for (const k of ALL_ACTION_FIELDS) {
      if (!keep.has(k) && data[k as keyof ActionData] !== undefined) {
        onChange(k, undefined);
      }
    }
    onChange("type", newType);
  };

  const meta = KIND_META[data.type];
  const templated =
    data.type === "set_monitor_state" || data.type === "send_notification";

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
        onChange={(e) => onTypeChange(e.target.value as ActionKind)}
        className={cn(fieldCls, "mb-2 font-medium")}
      >
        <option value="set_monitor_state">Set monitor state</option>
        <option value="send_notification">Send notification</option>
        <option value="escalate">Escalate (delayed)</option>
      </select>

      {templated ? (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setShowVars((s) => !s)}
            className="flex items-center gap-1 text-[10px] font-medium text-text-subtle hover:text-accent-strong transition-colors"
          >
            <BracketsCurly weight="bold" size={11} />
            {showVars ? "Hide" : "Template"} variables
          </button>
          {showVars ? (
            <div className="mt-1 flex flex-wrap gap-1 rounded-lg border border-border bg-bg/60 p-1.5">
              {TEMPLATE_VARS.map((v) => (
                <code
                  key={v}
                  className="rounded bg-elevated px-1 py-0.5 text-[9px] text-text-muted"
                >
                  {v}
                </code>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

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
