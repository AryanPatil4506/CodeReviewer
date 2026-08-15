export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type RunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  description: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphMetadata {
  graph_id: string;
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Matches the node_update event contract: node_id / status / timestamp /
 * execution_time / logs / input / output / error. */
export interface NodeUpdateEvent {
  event_type: "node_update";
  run_id: string;
  node_id: string;
  status: NodeStatus;
  timestamp: string;
  execution_time: number | null;
  logs: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
}

export interface LogEvent {
  event_type: "log";
  run_id: string;
  node_id: string;
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
}

export interface RunStatusEvent {
  event_type: "run_status";
  run_id: string;
  status: RunStatus;
  timestamp: string;
  message?: string | null;
}

export interface SnapshotEvent {
  event_type: "snapshot";
  run_id: string;
  status: string;
  nodes: NodeUpdateEvent[];
}

export type ExecutionEvent = NodeUpdateEvent | LogEvent | RunStatusEvent | SnapshotEvent;

/** Per-node state as tracked client-side - a NodeUpdateEvent plus a running
 * log buffer so lines from separate LogEvents accumulate live. */
export interface NodeState {
  node_id: string;
  status: NodeStatus;
  started_at: string | null;
  ended_at: string | null;
  execution_time: number | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  logLines: string[];
}

export interface ConsoleLine {
  id: string;
  timestamp: string;
  node_id: string | null;
  level: "info" | "warn" | "error" | "status";
  message: string;
}

export interface StartExecutionResponse {
  run_id: string;
  graph_id: string;
  status: RunStatus;
  started_at: string;
}

export interface ControlActionResponse {
  run_id: string;
  status: RunStatus;
  message: string;
}

export interface ExecutionRunSummary {
  id: string;
  graph_id: string;
  status: RunStatus;
  label: string | null;
  batch_id: string | null;
  started_at: string;
  ended_at: string | null;
  node_count: number;
  completed_count: number;
  failed_count: number;
}

export interface NodeExecutionDetail {
  node_id: string;
  status: NodeStatus;
  started_at: string | null;
  ended_at: string | null;
  execution_time: number | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  logs: string;
}

export interface ExecutionRunDetail {
  id: string;
  graph_id: string;
  status: RunStatus;
  label: string | null;
  batch_id: string | null;
  started_at: string;
  ended_at: string | null;
  nodes: NodeExecutionDetail[];
}

export interface PrReviewFileRun {
  run_id: string;
  file: string;
}

export interface StartPrReviewResponse {
  batch_id: string;
  runs: PrReviewFileRun[];
}
