"use client";

import {
  Background,
  Connection,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Condition, Rule, UpsertRuleInput } from "@/services/types";
import ConditionNode from "./Nodes/ConditionNode";
import LogicalOperatorNode from "./Nodes/LogicalOperatorNode";
import ActionNode from "./Nodes/ActionNode";
import RuleOutputNode from "./Nodes/RuleOutputNode";
import { EditorContext, type EditorData } from "./EditorContext";

const NODE_TYPES = {
  conditionNode: ConditionNode,
  logicalOperatorNode: LogicalOperatorNode,
  actionNode: ActionNode,
  ruleOutputNode: RuleOutputNode,
};

const NODE_W = 280;
const NODE_H = 200;

function layout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 80, ranksep: 100, edgesep: 40 });
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return {
    nodes: nodes.map((n) => {
      const p = g.node(n.id);
      return {
        ...n,
        position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      };
    }),
    edges,
  };
}

interface RuleEditorProps {
  data: EditorData;
  initialRule?: Rule;
  onSave: (input: UpsertRuleInput) => Promise<void>;
  onTest?: () => void;
  onDelete?: () => void;
  busy?: boolean;
  saveLabel?: string;
}

function uid(prefix: string, counter: { n: number }) {
  counter.n += 1;
  return `${prefix}-${counter.n}`;
}

function ruleToGraph(
  rule: Rule | undefined,
  onChange: (nodeId: string, key: string, value: unknown) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const counter = { n: 0 };

  const outputId = uid("output", counter);
  nodes.push({
    id: outputId,
    type: "ruleOutputNode",
    position: { x: 800, y: 200 },
    data: {},
  });

  if (!rule) {
    return { nodes, edges };
  }

  function processCondition(c: Condition): string {
    if (c.type === "comparison") {
      const cid = uid("condition", counter);
      const initial = c.field || "";
      const dur =
        c.for_duration?.seconds !== undefined
          ? { for_duration_seconds: c.for_duration.seconds }
          : {};
      nodes.push({
        id: cid,
        type: "conditionNode",
        position: { x: 0, y: 0 },
        data: {
          field: initial,
          operator: c.operator,
          value: c.value,
          ...dur,
          onChange,
        },
      });
      return cid;
    } else {
      const lid = uid("logical", counter);
      nodes.push({
        id: lid,
        type: "logicalOperatorNode",
        position: { x: 0, y: 0 },
        data: {
          op: c.op,
          inputCount: Math.max(c.children.length, 2),
          onChange,
        },
      });
      c.children.forEach((child, i) => {
        const child_id = processCondition(child);
        edges.push({
          id: `e-${child_id}-${lid}-${i}`,
          source: child_id,
          target: lid,
          targetHandle: `input-${i}`,
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      });
      return lid;
    }
  }

  const rootId = processCondition(rule.condition);
  edges.push({
    id: `e-${rootId}-${outputId}`,
    source: rootId,
    target: outputId,
    markerEnd: { type: MarkerType.ArrowClosed },
  });

  rule.actions.forEach((action, i) => {
    const aid = uid("action", counter);
    nodes.push({
      id: aid,
      type: "actionNode",
      position: { x: 1100, y: 100 + i * 250 },
      data: { ...action, onChange },
    });
    edges.push({
      id: `e-${outputId}-${aid}`,
      source: outputId,
      target: aid,
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  });

  return layout(nodes, edges);
}

function graphToRule(
  nodes: Node[],
  edges: Edge[],
  name: string,
  isEnabled: boolean,
  cooldownSeconds: number,
): UpsertRuleInput {
  const output = nodes.find((n) => n.type === "ruleOutputNode");
  if (!output) throw new Error("RuleOutput node missing");

  const incomingToOutput = edges.filter((e) => e.target === output.id);
  if (incomingToOutput.length === 0) {
    throw new Error("nothing connected to RuleOutput");
  }

  const seen = new Set<string>();
  function build(nodeId: string): Condition | null {
    if (seen.has(nodeId)) return null;
    seen.add(nodeId);
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return null;
    if (n.type === "conditionNode") {
      const d = n.data as {
        field: string;
        operator: string;
        value: unknown;
        for_duration_seconds?: number;
      };
      if (!d.field || !d.operator) return null;
      const cmp: Condition = {
        type: "comparison",
        field: d.field,
        operator: d.operator as Condition extends { type: "comparison"; operator: infer O }
          ? O
          : never,
        value: d.value,
      };
      if (d.for_duration_seconds && d.for_duration_seconds > 0) {
        cmp.for_duration = { seconds: d.for_duration_seconds };
      }
      return cmp;
    }
    if (n.type === "logicalOperatorNode") {
      const d = n.data as { op: "and" | "or" };
      const incoming = edges
        .filter((e) => e.target === n.id)
        .sort((a, b) => {
          const ai = parseInt((a.targetHandle || "input-0").split("-")[1] ?? "0", 10);
          const bi = parseInt((b.targetHandle || "input-0").split("-")[1] ?? "0", 10);
          return ai - bi;
        });
      const children: Condition[] = [];
      for (const e of incoming) {
        const c = build(e.source);
        if (c) children.push(c);
      }
      if (children.length === 0) return null;
      return { type: "logical", op: d.op, children };
    }
    return null;
  }

  const condition = build(incomingToOutput[0].source);
  if (!condition) throw new Error("could not build condition tree");

  const actionEdges = edges.filter((e) => e.source === output.id);
  const actions: Action[] = [];
  for (const e of actionEdges) {
    const an = nodes.find((x) => x.id === e.target && x.type === "actionNode");
    if (!an) continue;
    const { onChange: _omit, ...rest } = an.data as Record<string, unknown>;
    actions.push(rest as unknown as Action);
  }
  if (actions.length === 0) {
    throw new Error("at least one Action node must connect to RuleOutput");
  }

  return {
    name,
    is_enabled: isEnabled,
    condition,
    actions,
    cooldown_seconds: cooldownSeconds,
  };
}

function RuleEditorInner({
  data,
  initialRule,
  onSave,
  onTest,
  onDelete,
  busy,
  saveLabel,
}: RuleEditorProps) {
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);

  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
  const [name, setName] = useState(initialRule?.name ?? "");
  const [isEnabled, setIsEnabled] = useState(initialRule?.is_enabled ?? true);
  const [cooldown, setCooldown] = useState(initialRule?.cooldown_seconds ?? 300);

  const handleNodeChange = useCallback(
    (nodeId: string, key: string, value: unknown) => {
      setNodes((curr) =>
        curr.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, [key]: value } } : n,
        ),
      );
    },
    [setNodes],
  );

  // Load initial graph. The setStates here are synchronising React state
  // with an external prop (initialRule) — this is the canonical pattern.
  useEffect(() => {
    const { nodes: ns, edges: es } = ruleToGraph(initialRule, handleNodeChange);
    setNodes(ns);
    setEdges(es);
  }, [initialRule, handleNodeChange, setNodes, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => {
      const newEdge: Edge = {
        ...(c as Edge),
        id: `e-${c.source}-${c.target}-${Date.now()}`,
        markerEnd: { type: MarkerType.ArrowClosed },
      };
      setEdges((es) => addEdge(newEdge, es));
    },
    [setEdges],
  );

  const onNodesChangeWrap = useCallback(
    (changes: NodeChange[]) => {
      changes.forEach((ch) => {
        if (ch.type === "remove" && "id" in ch) {
          setEdges((es) =>
            es.filter((e) => e.source !== ch.id && e.target !== ch.id),
          );
        }
      });
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes, setEdges],
  );

  const addNode = useCallback(
    (type: keyof typeof NODE_TYPES) => {
      const id = `${type}-${crypto.randomUUID()}`;
      const pos = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2 - 100,
      });
      const baseData: Record<string, unknown> = { onChange: handleNodeChange };
      switch (type) {
        case "conditionNode":
          Object.assign(baseData, { field: "", operator: "", value: "" });
          break;
        case "logicalOperatorNode":
          Object.assign(baseData, { op: "and", inputCount: 2 });
          break;
        case "actionNode":
          Object.assign(baseData, { type: "set_monitor_state" });
          break;
      }
      const newNode: Node = { id, type, position: pos, data: baseData };
      setNodes((curr) => [...curr, newNode]);
    },
    [rf, handleNodeChange, setNodes],
  );

  const onLayout = useCallback(() => {
    const { nodes: ns, edges: es } = layout(nodes, edges);
    setNodes([...ns]);
    setEdges([...es]);
    requestAnimationFrame(() => rf.fitView({ padding: 0.2 }));
  }, [nodes, edges, setNodes, setEdges, rf]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      alert("Rule name is required.");
      return;
    }
    try {
      const input = graphToRule(nodes, edges, name.trim(), isEnabled, cooldown);
      await onSave(input);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }, [nodes, edges, name, isEnabled, cooldown, onSave]);

  const ctx = useMemo(() => data, [data]);

  return (
    <EditorContext.Provider value={ctx}>
      <div className="flex h-[calc(100vh-3rem)] flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rule name"
            className="flex-1 min-w-[200px] rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <label className="flex items-center gap-1 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
            />
            enabled
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-700">
            cooldown
            <input
              type="number"
              min="0"
              value={cooldown}
              onChange={(e) => setCooldown(parseInt(e.target.value, 10) || 0)}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
            />
            s
          </label>
          <button
            onClick={handleSave}
            disabled={busy}
            className="rounded bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Saving…" : (saveLabel ?? "Save")}
          </button>
          {onTest && (
            <button
              onClick={onTest}
              disabled={busy}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Dry-run
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              disabled={busy}
              className="rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>

        <div className="flex-1" ref={wrap}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWrap}
            onEdgesChange={(c) => setEdges((es) => applyEdgeChanges(c, es))}
            onConnect={onConnect}
            nodeTypes={NODE_TYPES}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
          >
            <Controls />
            <MiniMap />
            <Background gap={16} />

            <Panel
              position="top-left"
              className="rounded-md border border-slate-200 bg-white p-2 shadow-sm"
            >
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Add node
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => addNode("conditionNode")}
                  className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  + Condition
                </button>
                <button
                  type="button"
                  onClick={() => addNode("logicalOperatorNode")}
                  className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                >
                  + Logical (AND/OR)
                </button>
                <button
                  type="button"
                  onClick={() => addNode("actionNode")}
                  className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  + Action
                </button>
                <button
                  type="button"
                  onClick={onLayout}
                  className="mt-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Re-layout
                </button>
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </div>
    </EditorContext.Provider>
  );
}

export default function RuleEditor(props: RuleEditorProps) {
  return (
    <ReactFlowProvider>
      <RuleEditorInner {...props} />
    </ReactFlowProvider>
  );
}
