"use client";

import { Handle, NodeProps, Position } from "reactflow";
import { useState } from "react";
import { Funnel, Hourglass, Warning } from "@phosphor-icons/react";
import { useEditorData } from "../EditorContext";
import type { CompOp } from "@/services/types";
import { cn } from "@/lib/cn";

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

// Numeric properties (metric readings + group counts) accept ordering ops.
const NUMERIC_PROPS = new Set([
  "cpu",
  "mem",
  "disk",
  "net_in",
  "net_out",
  "critical_count",
  "warning_count",
  "ok_count",
  "unknown_count",
  "total_count",
]);

// Properties where a `for X` duration is meaningful and implemented by the
// backend evaluator (monitor state + metric thresholds). For everything else
// the engine treats a duration as not-held, so we hide the input entirely.
const DURATION_PROPS = new Set(["state", "cpu", "mem", "disk", "net_in", "net_out"]);

// Operators that make sense for a given property type. Keeps users from
// authoring e.g. `state > critical` that the backend would just reject.
function allowedOps(prop: string): CompOp[] {
  if (!prop) return Object.keys(OP_LABEL) as CompOp[];
  if (prop === "state" || prop === "acknowledged") return ["eq", "neq"];
  if (prop === "message") return ["eq", "neq", "contains", "not_contains"];
  if (NUMERIC_PROPS.has(prop)) return ["eq", "neq", "gt", "gte", "lt", "lte"];
  return Object.keys(OP_LABEL) as CompOp[];
}

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

const fieldCls =
  "w-full rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none";

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

  // Compose the `field` string and push it to graph state. Called from the
  // dropdown handlers — never from an effect — so we don't loop on `data`
  // identity changes coming back from the parent.
  const emitField = (k: TargetKind, t: string, p: string) => {
    if (!t || !p) return;
    data.onChange(id, "field", `${k}:${t}:${p}`);
  };

  function changeKind(newKind: TargetKind) {
    setKind(newKind);
    const newProps = newKind === "monitor" ? MONITOR_PROPS : GROUP_PROPS;
    const nextProp =
      prop && (newProps as readonly string[]).includes(prop) ? prop : "";
    if (nextProp !== prop) setProp(nextProp);
    emitField(newKind, targetId, nextProp);
  }

  const onTargetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setTargetId(v);
    emitField(kind, v, prop);
  };

  const onPropChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setProp(v);
    emitField(kind, targetId, v);
    // Reset the operator if it no longer fits the new property type.
    if (data.operator && !allowedOps(v).includes(data.operator)) {
      data.onChange(id, "operator", "");
    }
    // Clear a stale duration when the new property doesn't support one.
    if (!DURATION_PROPS.has(v) && data.for_duration_seconds) {
      setDurationText("");
      data.onChange(id, "for_duration_seconds", undefined);
    }
  };

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

  const valueInput = (() => {
    if (prop === "state") {
      return (
        <select
          className={fieldCls}
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
        <label className="flex items-center gap-1.5 text-xs text-text">
          <input
            type="checkbox"
            checked={!!data.value}
            onChange={onValueChange}
            className="accent-accent"
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
          className={fieldCls}
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
        className={fieldCls}
        value={typeof data.value === "string" ? data.value : ""}
        onChange={onValueChange}
        placeholder="value"
      />
    );
  })();

  const targets = kind === "monitor" ? monitors : groups;
  const isValid = !!targetId && !!prop && !!data.operator;

  return (
    <div
      className={cn(
        "w-72 rounded-2xl border-2 bg-surface p-3 shadow-warm-md",
        isValid ? "border-accent/60" : "border-critical/60",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent-strong">
          <Funnel weight="duotone" size={14} />
          Condition
        </div>
        {!isValid ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium text-critical"
            title="Pick target, property, operator and value"
          >
            <Warning weight="bold" size={12} />
            incomplete
          </span>
        ) : null}
      </div>

      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-bg/60 p-1">
        {(["monitor", "group"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => changeKind(k)}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              kind === k
                ? "bg-accent text-accent-on shadow-warm-sm"
                : "text-text-muted hover:text-text",
            )}
          >
            {k}
          </button>
        ))}
      </div>

      <select
        value={targetId}
        onChange={onTargetChange}
        className={cn(fieldCls, "mb-1.5")}
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

      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        <select
          value={prop}
          onChange={onPropChange}
          className={fieldCls}
        >
          <option value="">— prop —</option>
          {props.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={data.operator}
          onChange={onOperatorChange}
          className={fieldCls}
        >
          <option value="">— op —</option>
          {allowedOps(prop).map((op) => (
            <option key={op} value={op}>
              {OP_LABEL[op]}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-1.5">{valueInput}</div>

      {DURATION_PROPS.has(prop) ? (
        <label className="relative flex items-center">
          <Hourglass
            weight="duotone"
            size={12}
            className="absolute left-2 text-text-subtle pointer-events-none"
          />
          <input
            type="text"
            value={durationText}
            onChange={onDurationChange}
            placeholder="for 5m (optional)"
            className={cn(fieldCls, "pl-6 bg-bg/60")}
          />
        </label>
      ) : null}

      <Handle
        type="source"
        position={Position.Right}
        id="cond-out"
        style={{
          background: "var(--color-accent)",
          width: 12,
          height: 12,
          border: "2px solid var(--color-surface)",
        }}
      />
    </div>
  );
}
