import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useExecutionStore } from "@/store/executionStore";
import { computeLayout } from "@/lib/layout";
import { WorkflowNode, type WorkflowNodeData } from "./WorkflowNode";
import { FlowEdge } from "./FlowEdge";

const nodeTypes = { workflowNode: WorkflowNode };
const edgeTypes = { signalEdge: FlowEdge };

export function GraphCanvas() {
  const graph = useExecutionStore((s) => s.graph);
  const nodeStates = useExecutionStore((s) => s.nodeStates);
  const selectNode = useExecutionStore((s) => s.selectNode);

  const initialNodes: Node<WorkflowNodeData>[] = useMemo(() => {
    if (!graph) return [];
    const positions = computeLayout(graph.nodes, graph.edges);
    return graph.nodes.map((n) => ({
      id: n.id,
      type: "workflowNode",
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: { label: n.label, nodeType: n.type, description: n.description },
    }));
  }, [graph]);

  const initialEdges: Edge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "signalEdge",
      animated: false,
    }));
  }, [graph]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const STATUS_DOT_COLOR: Record<string, string> = {
    pending: "#334155",
    running: "#22D3EE",
    completed: "#34D399",
    failed: "#FB7185",
  };
  const minimapNodeColor = (node: Node) => {
    const status = nodeStates[node.id]?.status ?? "pending";
    return STATUS_DOT_COLOR[status] ?? "#334155";
  };

  if (!graph) return null;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onPaneClick={() => selectNode(null)}
      fitView
      fitViewOptions={{ padding: 0.2, minZoom: 0.6, maxZoom: 1 }}
      minZoom={0.35}
      maxZoom={1.75}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={28}
        size={1}
        color="rgba(148,163,184,0.15)"
      />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={minimapNodeColor}
        nodeStrokeWidth={0}
        maskColor="rgba(5,7,12,0.75)"
        pannable
        zoomable
      />
    </ReactFlow>
  );
}
