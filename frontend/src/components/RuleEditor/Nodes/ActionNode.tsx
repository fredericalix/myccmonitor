"use client";

import { Handle, NodeProps, Position } from "reactflow";
import { useEditorData } from "../EditorContext";

type ActionKind = "set_monitor_state" | "send_notification" | "escalate";

interface ActionData {
  type: ActionKind;
  // SetMonitorState
  target_monitor_id?: string;
  state?: string;
  message?: string;
  acknowledged?: boolean;
  // SendNotification
  channel_id?: string;
  subject?: string;
  // Escalate
  delay_seconds?: number;
  target_rule_id?: string;
  onChange: (nodeId: string, key: string, value: unknown) => void;
}

const STATE_VALUES = ["ok", "warning", "critical", "unknown"];

export default function ActionNode({ id, data }: NodeProps<ActionData>) {
  const { monitors, rules } = useEditorData();
  const onChange = (key: string, value: unknown) => data.onChange(id, key, value);

  const tone =
    data.type === "set_monitor_state"
      ? "border-emerald-300"
      : data.type === "send_notification"
      ? "border-violet-300"
      : "border-rose-300";

  return (
    <div className={`w-72 rounded-md border-2 bg-white p-3 shadow-sm ${tone}`}>
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
        Action
      </div>

      <select
        value={data.type}
        onChange={(e) => onChange("type", e.target.value as ActionKind)}
        className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-xs font-medium"
      >
        <option value="set_monitor_state">Set monitor state</option>
        <option value="send_notification">Send notification</option>
        <option value="escalate">Escalate (delayed)</option>
      </select>

      {data.type === "set_monitor_state" && (
        <>
          <select
            value={data.target_monitor_id ?? ""}
            onChange={(e) => onChange("target_monitor_id", e.target.value)}
            className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
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
            className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
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
            placeholder="message (optional)"
            className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <label className="flex items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              checked={!!data.acknowledged}
              onChange={(e) => onChange("acknowledged", e.target.checked)}
            />
            set acknowledged
          </label>
        </>
      )}

      {data.type === "send_notification" && (
        <>
          <input
            type="text"
            value={data.channel_id ?? ""}
            onChange={(e) => onChange("channel_id", e.target.value)}
            placeholder="channel UUID"
            className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
          />
          <input
            type="text"
            value={data.subject ?? ""}
            onChange={(e) => onChange("subject", e.target.value)}
            placeholder="subject (email-only)"
            className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <textarea
            value={data.message ?? ""}
            onChange={(e) => onChange("message", e.target.value)}
            placeholder="message (handlebars; e.g. {{monitor.display_name}})"
            rows={3}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <p className="mt-1 text-[10px] italic text-slate-400">
            Phase 6: records an alert row. Phase 9 wires real delivery.
          </p>
        </>
      )}

      {data.type === "escalate" && (
        <>
          <input
            type="number"
            min="0"
            value={data.delay_seconds ?? 0}
            onChange={(e) =>
              onChange("delay_seconds", parseInt(e.target.value, 10) || 0)
            }
            placeholder="delay seconds"
            className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <select
            value={data.target_rule_id ?? ""}
            onChange={(e) => onChange("target_rule_id", e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">— rule to escalate to —</option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] italic text-slate-400">
            Phase 6: stub. Phase 8 wires Pulsar delayed delivery.
          </p>
        </>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="action-in"
        style={{
          background: "#10b981",
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />
    </div>
  );
}
