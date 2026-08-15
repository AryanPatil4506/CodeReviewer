import { create } from "zustand";
import type {
  ExecutionEvent,
  ExecutionRunDetail,
  GraphMetadata,
  NodeState,
  ConsoleLine,
  PrReviewFileRun,
  RunStatus,
} from "@/types/execution";

interface ActiveBatch {
  batchId: string;
  files: PrReviewFileRun[]; // in queued order - just enough to render tabs immediately; FileTabsBar polls for live status
}

interface ExecutionStore {
  graph: GraphMetadata | null;
  runId: string | null;
  runStatus: RunStatus | "idle";
  runLabel: string | null;
  runStartedAt: string | null;
  runEndedAt: string | null;
  nodeStates: Record<string, NodeState>;
  consoleLines: ConsoleLine[];
  selectedNodeId: string | null;
  searchQuery: string;
  wsConnected: boolean;
  activeBatch: ActiveBatch | null;

  setGraph: (graph: GraphMetadata) => void;
  startNewRun: (runId: string) => void;
  loadRun: (detail: ExecutionRunDetail) => void;
  setActiveBatch: (batch: ActiveBatch | null) => void;
  applyEvent: (event: ExecutionEvent) => void;
  selectNode: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setWsConnected: (v: boolean) => void;
  setRunStatus: (status: RunStatus) => void;
}

function blankNodeState(nodeId: string): NodeState {
  return {
    node_id: nodeId,
    status: "pending",
    started_at: null,
    ended_at: null,
    execution_time: null,
    input: {},
    output: {},
    error: null,
    logLines: [],
  };
}

let lineCounter = 0;
function nextLineId(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

const MAX_CONSOLE_LINES = 2000;

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  graph: null,
  runId: null,
  runStatus: "idle",
  runLabel: null,
  runStartedAt: null,
  runEndedAt: null,
  nodeStates: {},
  consoleLines: [],
  selectedNodeId: null,
  searchQuery: "",
  wsConnected: false,
  activeBatch: null,

  setGraph: (graph) => {
    const nodeStates: Record<string, NodeState> = {};
    for (const n of graph.nodes) nodeStates[n.id] = blankNodeState(n.id);
    set({ graph, nodeStates });
  },

  startNewRun: (runId) => {
    const graph = get().graph;
    const nodeStates: Record<string, NodeState> = {};
    if (graph) {
      for (const n of graph.nodes) nodeStates[n.id] = blankNodeState(n.id);
    }
    set({
      runId,
      runStatus: "pending",
      runLabel: null,
      runStartedAt: new Date().toISOString(),
      runEndedAt: null,
      nodeStates,
      consoleLines: [],
      selectedNodeId: null,
    });
  },

  // Switches the canvas to a DIFFERENT run's already-known state, fetched
  // via REST (GET /api/executions/{run_id}) rather than live over
  // WebSocket. This is what the file-switcher tabs use: clicking a
  // finished (or not-yet-started) file's tab shouldn't require it to be
  // "live" - the full per-node input/output/logs/duration are already
  // sitting in the database from when that file's graph ran, exactly like
  // the History drawer's expanded view already reads them. Works even if
  // the backend process has restarted since that run happened, unlike
  // relying on the in-memory WebSocket snapshot cache.
  loadRun: (detail) => {
    const graph = get().graph;
    const nodeStates: Record<string, NodeState> = {};
    if (graph) {
      for (const n of graph.nodes) nodeStates[n.id] = blankNodeState(n.id);
    }
    for (const n of detail.nodes) {
      nodeStates[n.node_id] = {
        node_id: n.node_id,
        status: n.status,
        started_at: n.started_at,
        ended_at: n.ended_at,
        execution_time: n.execution_time,
        input: n.input,
        output: n.output,
        error: n.error,
        logLines: n.logs ? n.logs.split("\n").filter(Boolean) : [],
      };
    }
    set({
      runId: detail.id,
      runStatus: detail.status,
      runLabel: detail.label,
      runStartedAt: detail.started_at,
      runEndedAt: detail.ended_at,
      nodeStates,
      consoleLines: [], // this run's live console history wasn't kept around - the per-node logs above cover the same ground
      selectedNodeId: null,
    });
  },

  setActiveBatch: (batch) => set({ activeBatch: batch }),

  setRunStatus: (status) => set({ runStatus: status }),

  selectNode: (id) => set({ selectedNodeId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setWsConnected: (v) => set({ wsConnected: v }),

  applyEvent: (event) => {
    const state = get();

    if (event.event_type === "snapshot") {
      const nodeStates = { ...state.nodeStates };
      for (const n of event.nodes) {
        nodeStates[n.node_id] = {
          node_id: n.node_id,
          status: n.status,
          started_at: n.status === "running" ? n.timestamp : nodeStates[n.node_id]?.started_at ?? null,
          ended_at: n.status !== "running" ? n.timestamp : null,
          execution_time: n.execution_time,
          input: n.input,
          output: n.output,
          error: n.error,
          logLines: n.logs ? n.logs.split("\n").filter(Boolean) : nodeStates[n.node_id]?.logLines ?? [],
        };
      }
      set({ nodeStates });
      return;
    }

    if (event.event_type === "node_update") {
      const prev = state.nodeStates[event.node_id] ?? blankNodeState(event.node_id);
      const nextState: NodeState = {
        node_id: event.node_id,
        status: event.status,
        started_at: event.status === "running" ? event.timestamp : prev.started_at,
        ended_at: event.status === "completed" || event.status === "failed" ? event.timestamp : null,
        execution_time: event.execution_time,
        input: event.input,
        output: event.output,
        error: event.error,
        logLines: event.logs ? event.logs.split("\n").filter(Boolean) : prev.logLines,
      };

      const line: ConsoleLine = {
        id: nextLineId(),
        timestamp: event.timestamp,
        node_id: event.node_id,
        level: event.status === "failed" ? "error" : "status",
        message:
          event.status === "running"
            ? `${event.node_id} started`
            : event.status === "completed"
            ? `${event.node_id} completed in ${event.execution_time != null ? event.execution_time.toFixed(2) + "s" : "an unknown duration"}`
            : `${event.node_id} failed${event.error ? `: ${event.error}` : ""}`,
      };

      set({
        nodeStates: { ...state.nodeStates, [event.node_id]: nextState },
        consoleLines: [...state.consoleLines, line].slice(-MAX_CONSOLE_LINES),
      });
      return;
    }

    if (event.event_type === "log") {
      const prev = state.nodeStates[event.node_id];
      const line: ConsoleLine = {
        id: nextLineId(),
        timestamp: event.timestamp,
        node_id: event.node_id,
        level: event.level,
        message: event.message,
      };
      set({
        nodeStates: prev
          ? {
              ...state.nodeStates,
              [event.node_id]: { ...prev, logLines: [...prev.logLines, event.message] },
            }
          : state.nodeStates,
        consoleLines: [...state.consoleLines, line].slice(-MAX_CONSOLE_LINES),
      });
      return;
    }

    if (event.event_type === "run_status") {
      const line: ConsoleLine = {
        id: nextLineId(),
        timestamp: event.timestamp,
        node_id: null,
        level: event.status === "failed" ? "error" : "status",
        message: event.message ?? `run ${event.status}`,
      };
      const terminal = ["completed", "failed", "cancelled"].includes(event.status);
      set({
        runStatus: event.status,
        runEndedAt: terminal ? event.timestamp : state.runEndedAt,
        consoleLines: [...state.consoleLines, line].slice(-MAX_CONSOLE_LINES),
      });
    }
  },
}));
