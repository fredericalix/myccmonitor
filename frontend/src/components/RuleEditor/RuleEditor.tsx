"use client";

import {
  Background,
  BackgroundVariant,
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
import {
  ArrowsClockwise,
  Funnel,
  Info,
  Intersect,
  Lightning,
  PaperPlaneTilt,
  PlayCircle,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import type { Action, Condition, Rule, UpsertRuleInput } from "@/services/types";
import ConditionNode from "./Nodes/ConditionNode";
import LogicalOperatorNode from "./Nodes/LogicalOperatorNode";
import ActionNode from "./Nodes/ActionNode";
import RuleOutputNode from "./Nodes/RuleOutputNode";
import { EditorContext, type EditorData } from "./EditorContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";

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

  if (!rule) return { nodes, edges };

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
    const copy = { ...(an.data as Record<string, unknown>) };
    delete copy.onChange;
    actions.push(copy as unknown as Action);
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
  const [showLegend, setShowLegend] = useState(false);

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
        style: { stroke: "var(--color-accent)" },
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
      toast.error("Rule name is required");
      return;
    }
    try {
      const input = graphToRule(nodes, edges, name.trim(), isEnabled, cooldown);
      await onSave(input);
    } catch (e: unknown) {
      toast.error("Validation failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [nodes, edges, name, isEnabled, cooldown, onSave]);

  const ctx = useMemo(() => data, [data]);

  return (
    <EditorContext.Provider value={ctx}>
      <Card variant="elevated" className="overflow-hidden p-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg/50 px-4 py-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rule name"
            className="flex-1 min-w-[200px]"
          />
          <label className="flex items-center gap-1.5 text-xs text-text-muted whitespace-nowrap">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="accent-accent h-4 w-4"
            />
            enabled
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted whitespace-nowrap">
            cooldown
            <input
              type="number"
              min="0"
              value={cooldown}
              onChange={(e) => setCooldown(parseInt(e.target.value, 10) || 0)}
              className="w-20 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text"
            />
            s
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {onTest ? (
              <Button variant="secondary" size="sm" onClick={onTest} disabled={busy}>
                <PlayCircle weight="bold" size={14} />
                Dry-run
              </Button>
            ) : null}
            {onDelete ? (
              <Button variant="danger" size="sm" onClick={onDelete} disabled={busy}>
                <Trash weight="bold" size={14} />
                Delete
              </Button>
            ) : null}
            <Button variant="primary" size="sm" onClick={handleSave} disabled={busy}>
              {busy ? "Saving…" : (saveLabel ?? "Save")}
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div
          className="h-[calc(100vh-22rem)] min-h-[500px] bg-bg/40 react-flow-warm"
          ref={wrap}
        >
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
              style: { stroke: "var(--color-accent-strong)", strokeWidth: 1.5 },
            }}
            fitView
          >
            <Controls
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                color: "var(--color-text)",
                overflow: "hidden",
              }}
            />
            <MiniMap
              pannable
              zoomable
              maskColor="var(--color-bg)"
              maskStrokeColor="var(--color-border-strong)"
              nodeColor={(n) => {
                switch (n.type) {
                  case "conditionNode":
                    return "var(--color-accent)";
                  case "logicalOperatorNode":
                    return "var(--color-warning)";
                  case "actionNode":
                    return "var(--color-ok)";
                  case "ruleOutputNode":
                    return "var(--color-accent-strong)";
                  default:
                    return "var(--color-border-strong)";
                }
              }}
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
              }}
            />
            <Background
              gap={20}
              size={1.4}
              color="var(--color-border-strong)"
              variant={BackgroundVariant.Dots}
            />

            <Panel position="top-left">
              <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface/95 backdrop-blur p-2 shadow-warm-md">
                <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Add node
                </p>
                <button
                  type="button"
                  onClick={() => addNode("conditionNode")}
                  className="flex items-center gap-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent-strong hover:bg-accent hover:text-accent-on transition-colors"
                >
                  <Funnel weight="duotone" size={14} />
                  Condition
                </button>
                <button
                  type="button"
                  onClick={() => addNode("logicalOperatorNode")}
                  className="flex items-center gap-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs font-medium text-warning hover:opacity-90 transition-opacity"
                >
                  <Intersect weight="duotone" size={14} />
                  Logical
                </button>
                <button
                  type="button"
                  onClick={() => addNode("actionNode")}
                  className="flex items-center gap-2 rounded-lg bg-ok-soft px-2.5 py-1.5 text-xs font-medium text-ok hover:opacity-90 transition-opacity"
                >
                  <Lightning weight="duotone" size={14} />
                  Action
                </button>
                <hr className="my-1 border-border" />
                <button
                  type="button"
                  onClick={onLayout}
                  className="flex items-center gap-2 rounded-lg bg-bg/60 border border-border px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-elevated"
                >
                  <ArrowsClockwise weight="bold" size={12} />
                  Re-layout
                </button>
                <button
                  type="button"
                  onClick={() => setShowLegend((s) => !s)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1 text-[11px] text-text-muted hover:text-text"
                >
                  <Info weight="duotone" size={12} />
                  {showLegend ? "Hide" : "Show"} legend
                </button>
              </div>
            </Panel>

            {showLegend ? (
              <Panel position="top-right">
                <div className="rounded-2xl border border-border bg-surface/95 backdrop-blur p-3 shadow-warm-md text-xs space-y-1.5 max-w-[260px]">
                  <p className="font-serif text-base text-text mb-2">Legend</p>
                  <div className="flex items-center gap-2">
                    <Funnel weight="duotone" size={14} className="text-accent-strong" />
                    <span className="text-text-muted">
                      <strong className="text-text">Condition</strong> — compare a
                      monitor or group property to a value.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Intersect weight="duotone" size={14} className="text-warning" />
                    <span className="text-text-muted">
                      <strong className="text-text">Logical</strong> — AND / OR
                      with 2–6 inputs.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Lightning weight="duotone" size={14} className="text-ok" />
                    <span className="text-text-muted">
                      <strong className="text-text">Action</strong> —
                      setMonitorState, sendNotification, escalate.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <PaperPlaneTilt
                      weight="duotone"
                      size={14}
                      className="text-accent-strong"
                    />
                    <span className="text-text-muted">
                      Connect a condition tree to <strong>Rule output</strong>;
                      attach actions on the right.
                    </span>
                  </div>
                </div>
              </Panel>
            ) : null}

            <Panel position="bottom-right">
              <div className="rounded-full border border-border bg-surface/95 backdrop-blur px-2.5 py-1 text-[10px] text-text-subtle font-mono shadow-warm-sm flex items-center gap-1">
                <Plus weight="bold" size={10} />
                Drag handles to connect nodes
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </Card>
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
