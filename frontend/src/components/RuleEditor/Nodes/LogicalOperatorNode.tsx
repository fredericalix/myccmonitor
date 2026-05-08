"use client";

import { Handle, NodeProps, Position } from "reactflow";
import { useCallback, useMemo } from "react";
import type { LogicalOp } from "@/services/types";

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
            background: data.op === "and" ? "#f97316" : "#f59e0b",
            width: 12,
            height: 12,
            top: `${((i + 1) / (inputCount + 1)) * 100}%`,
            border: "2px solid white",
          }}
        />,
      );
    }
    return list;
  }, [inputCount, data.op]);

  const tone = data.op === "and" ? "border-orange-300" : "border-amber-300";

  return (
    <div className={`w-44 rounded-md border-2 bg-white p-3 shadow-sm ${tone}`}>
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-orange-700">
        Logical
      </div>
      <select
        value={data.op}
        onChange={onOpChange}
        className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-sm font-bold"
      >
        <option value="and">AND</option>
        <option value="or">OR</option>
      </select>
      <label className="mb-0.5 block text-[10px] uppercase text-slate-500">
        Inputs
      </label>
      <select
        value={inputCount}
        onChange={onCountChange}
        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
      >
        {[2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <p className="mt-2 text-[10px] italic text-slate-500">
        {data.op === "and" ? "all true" : "any true"}
      </p>
      {handles}
      <Handle
        type="source"
        position={Position.Right}
        id="logical-out"
        style={{
          background: data.op === "and" ? "#f97316" : "#f59e0b",
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />
    </div>
  );
}
