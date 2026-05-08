"use client";

import { Handle, NodeProps, Position } from "reactflow";

export default function RuleOutputNode(_props: NodeProps) {
  return (
    <div className="w-32 rounded-md border-2 border-indigo-300 bg-indigo-50 p-3 text-center shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wider text-indigo-700">
        Rule
      </div>
      <div className="mt-1 text-[10px] text-indigo-600">output</div>
      <Handle
        type="target"
        position={Position.Left}
        id="rule-in"
        style={{
          background: "#6366f1",
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="rule-out"
        style={{
          background: "#6366f1",
          width: 12,
          height: 12,
          border: "2px solid white",
        }}
      />
    </div>
  );
}
