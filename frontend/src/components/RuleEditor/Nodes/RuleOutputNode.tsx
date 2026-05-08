"use client";

import { Handle, Position } from "reactflow";
import { CheckCircle } from "@phosphor-icons/react";

export default function RuleOutputNode() {
  return (
    <div className="w-36 rounded-2xl border-2 border-accent/60 bg-accent-soft p-3 text-center shadow-warm-md">
      <div className="flex flex-col items-center gap-0.5">
        <CheckCircle weight="duotone" size={22} className="text-accent-strong" />
        <div className="text-xs font-semibold uppercase tracking-wider text-accent-strong">
          Rule output
        </div>
        <div className="text-[10px] text-text-muted italic">fire actions →</div>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="rule-in"
        style={{
          background: "var(--color-accent)",
          width: 12,
          height: 12,
          border: "2px solid var(--color-surface)",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="rule-out"
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
