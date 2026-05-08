"use client";

import { Handle, NodeProps, Position } from "reactflow";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorData } from "../EditorContext";
import type { CompOp } from "@/services/types";

type TargetKind = "monitor" | "group";

const MONITOR_PROPS = [
  "state",
  "message",
  "acknowledged",
  "cpu",
  "mem",
  "disk",
  "net_in",
  "net_out",
] as const;

const GROUP_PROPS = [
  "state",
  "critical_count",
  "warning_count",
  "ok_count",
  "unknown_count",
  "total_count",
] as const;

const STATE_VALUES = ["ok", "warning", "critical", "unknown"] as const;

interface ConditionData {
  field: string;
  operator: CompOp | "";
  value: unknown;
  for_duration_seconds?: number;
  onChange: (nodeId: string, key: string, value: unknown) => void;
}

const OP_LABEL: Record<CompOp, string> = {
  eq: "==",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  not_contains: "not contains",
};

function parseField(field: string): {
  kind: TargetKind | "";
  id: string;
  prop: string;
} {
  const parts = field.split(":");
  if (parts.length !== 3) return { kind: "", id: "", prop: "" };
  if (parts[0] !== "monitor" && parts[0] !== "group") {
    return { kind: "", id: "", prop: "" };
  }
  return { kind: parts[0] as TargetKind, id: parts[1], prop: parts[2] };
}

function parseDuration(input: string): number | null {
  const m = input.trim().match(/^(\d+)\s*(s|m|h)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  switch (m[2] ?? "s") {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    default:
      return null;
  }
}

function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export default function ConditionNode({ id, data }: NodeProps<ConditionData>) {
  const { monitors, groups } = useEditorData();
  const initial = parseField(data.field || "");
  const [kind, setKind] = useState<TargetKind>(initial.kind || "monitor");
  const [targetId, setTargetId] = useState(initial.id);
  const [prop, setProp] = useState(initial.prop);
  const [durationText, setDurationText] = useState(
    data.for_duration_seconds ? formatDuration(data.for_duration_seconds) : "",
  );

  const props = kind === "monitor" ? MONITOR_PROPS : GROUP_PROPS;

  function changeKind(newKind: TargetKind) {
    setKind(newKind);
    const newProps = newKind === "monitor" ? MONITOR_PROPS : GROUP_PROPS;
    if (prop && !(newProps as readonly string[]).includes(prop)) {
      setProp("");
    }
  }

  const updateField = useCallback(() => {
    if (!targetId || !prop) return;
    data.onChange(id, "field", `${kind}:${targetId}:${prop}`);
  }, [id, data, kind, targetId, prop]);

  useEffect(() => {
    updateField();
  }, [updateField]);

  const onOperatorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    data.onChange(id, "operator", e.target.value);
  };

  const onValueChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    let v: unknown = e.target.value;
    if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") {
      v = e.target.checked;
    } else if (e.target instanceof HTMLInputElement && e.target.type === "number") {
      v = parseFloat(e.target.value);
    }
    data.onChange(id, "value", v);
  };

  const onDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setDurationText(text);
    if (!text.trim()) {
      data.onChange(id, "for_duration_seconds", undefined);
    } else {
      const seconds = parseDuration(text);
      if (seconds !== null) {
        data.onChange(id, "for_duration_seconds", seconds);
      }
    }
  };

  const valueInput = useMemo(() => {
    if (prop === "state") {
      return (
        <select
          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          value={String(data.value ?? "")}
          onChange={onValueChange}
        >
          <option value="">— state —</option>
          {STATE_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );
    }
    if (prop === "acknowledged") {
      return (
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={!!data.value}
            onChange={onValueChange}
          />
          {data.value ? "true" : "false"}
        </label>
      );
    }
    if (
      prop === "cpu" ||
      prop === "mem" ||
      prop === "disk" ||
      prop === "net_in" ||
      prop === "net_out" ||
      prop === "critical_count" ||
      prop === "warning_count" ||
      prop === "ok_count" ||
      prop === "unknown_count" ||
      prop === "total_count"
    ) {
      return (
        <input
          type="number"
          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          value={typeof data.value === "number" ? data.value : ""}
          onChange={onValueChange}
          placeholder="number"
          step="any"
        />
      );
    }
    return (
      <input
        type="text"
        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
        value={typeof data.value === "string" ? data.value : ""}
        onChange={onValueChange}
        placeholder="value"
      />
    );
  }, [prop, data.value]);

  const targets = kind === "monitor" ? monitors : groups;
  const isValid = !!targetId && !!prop && !!data.operator;

  return (
    <div
      className={`w-72 rounded-md border-2 bg-white p-3 shadow-sm ${
        isValid ? "border-blue-300" : "border-rose-300"
      }`}
    >
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-blue-700">
        Condition
      </div>

      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={() => changeKind("monitor")}
          className={`flex-1 rounded px-2 py-0.5 text-[11px] font-medium ${
            kind === "monitor"
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          monitor
        </button>
        <button
          type="button"
          onClick={() => changeKind("group")}
          className={`flex-1 rounded px-2 py-0.5 text-[11px] font-medium ${
            kind === "group"
              ? "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          group
        </button>
      </div>

      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
      >
        <option value="">— pick {kind} —</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {kind === "monitor"
              ? `${(t as unknown as { display_name: string }).display_name}`
              : (t as unknown as { name: string }).name}
          </option>
        ))}
      </select>

      <select
        value={prop}
        onChange={(e) => setProp(e.target.value)}
        className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
      >
        <option value="">— property —</option>
        {props.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <select
        value={data.operator}
        onChange={onOperatorChange}
        className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
      >
        <option value="">— op —</option>
        {(Object.keys(OP_LABEL) as CompOp[]).map((op) => (
          <option key={op} value={op}>
            {OP_LABEL[op]}
          </option>
        ))}
      </select>

      <div className="mb-1.5">{valueInput}</div>

      <input
        type="text"
        value={durationText}
        onChange={onDurationChange}
        placeholder="for 5m (optional)"
        className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]"
      />

      <Handle
        type="source"
        position={Position.Right}
        id="cond-out"
        style={{
          background: "#3b82f6",
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />
    </div>
  );
}
