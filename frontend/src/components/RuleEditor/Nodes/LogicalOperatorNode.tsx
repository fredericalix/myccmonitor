"use client";

import { Handle, NodeProps, Position } from "reactflow";
import { useCallback, useMemo } from "react";
import { Intersect, Union } from "@phosphor-icons/react";
import type { LogicalOp } from "@/services/types";
import { cn } from "@/lib/cn";

interface LogicalData {
  op: LogicalOp;
  inputCount: number;
  onChange: (nodeId: string, key: string, value: unknown) => void;
}

export default function LogicalOperatorNode({ id, data }: NodeProps<LogicalData>) {
  const inputCount = Math.max(data.inputCount || 2, 2);

  const onOpChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) =>
      data.onChange(id, "op", e.target.value),
    [id, data],
  );
  const onCountChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) =>
      data.onChange(id, "inputCount", parseInt(e.target.value, 10)),
    [id, data],
  );

  const handleColor = data.op === "and" ? "var(--color-warning)" : "var(--color-critical)";

  const handles = useMemo(() => {
    const list = [];
    for (let i = 0; i < inputCount; i++) {
      list.push(
        <Handle
          key={`in-${i}`}
          type="target"
          position={Position.Left}
          id={`input-${i}`}
          style={{
            background: handleColor,
            width: 12,
            height: 12,
            top: `${((i + 1) / (inputCount + 1)) * 100}%`,
            border: "2px solid var(--color-surface)",
          }}
        />,
      );
    }
    return list;
  }, [inputCount, handleColor]);

  const ringTone = data.op === "and"
    ? "border-warning/60 bg-warning-soft"
    : "border-critical/60 bg-critical-soft";

  const fieldCls =
    "w-full rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none";

  return (
    <div
      className={cn(
        "w-44 rounded-2xl border-2 p-3 shadow-warm-md",
        ringTone,
      )}
    >
      <div className="mb-2 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text">
        {data.op === "and" ? (
          <Intersect weight="duotone" size={16} />
        ) : (
          <Union weight="duotone" size={16} />
        )}
        {data.op === "and" ? "AND" : "OR"}
      </div>
      <select
        value={data.op}
        onChange={onOpChange}
        className={cn(fieldCls, "mb-1.5 font-bold")}
      >
        <option value="and">AND — all true</option>
        <option value="or">OR — any true</option>
      </select>
      <label className="block text-[10px] uppercase text-text-muted mb-0.5">
        Inputs
      </label>
      <select
        value={inputCount}
        onChange={onCountChange}
        className={fieldCls}
      >
        {[2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {handles}
      <Handle
        type="source"
        position={Position.Right}
        id="logical-out"
        style={{
          background: handleColor,
          width: 12,
          height: 12,
          border: "2px solid var(--color-surface)",
        }}
      />
    </div>
  );
}
