import type {
  ControlActionResponse,
  ExecutionRunDetail,
  ExecutionRunSummary,
  GraphMetadata,
  StartExecutionResponse,
  StartPrReviewResponse,
} from "@/types/execution";

// Empty base = same-origin, relying on the Vite dev proxy (see
// vite.config.ts) or on the production build being served behind the same
// reverse proxy as the API. Override with VITE_API_BASE_URL if the backend
// lives elsewhere.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getGraph: () => request<GraphMetadata>("/api/graph"),

  startExecution: (githubUrl: string, pullNo: string, file?: string) =>
    request<StartExecutionResponse>("/api/executions", {
      method: "POST",
      body: JSON.stringify({ github_url: githubUrl, pull_no: pullNo, file: file || null }),
    }),

  // Reviews every changed file in the PR, not just the first one - each
  // file gets its own run (visible in History), run sequentially on the
  // backend. See execution_engine.py::start_pr_review for why sequential.
  startPrReview: (githubUrl: string, pullNo: string) =>
    request<StartPrReviewResponse>("/api/executions/pr", {
      method: "POST",
      body: JSON.stringify({ github_url: githubUrl, pull_no: pullNo }),
    }),

  pauseExecution: (runId: string) =>
    request<ControlActionResponse>(`/api/executions/${runId}/pause`, { method: "POST" }),

  resumeExecution: (runId: string) =>
    request<ControlActionResponse>(`/api/executions/${runId}/resume`, { method: "POST" }),

  cancelExecution: (runId: string) =>
    request<ControlActionResponse>(`/api/executions/${runId}/cancel`, { method: "POST" }),

  listExecutions: () => request<ExecutionRunSummary[]>("/api/executions"),

  getExecution: (runId: string) =>
    request<ExecutionRunDetail>(`/api/executions/${runId}`),

  // All file-runs from one "All Files" click, in queued order - what the
  // file-switcher tab strip polls to update statuses as each file's turn
  // comes up in the sequential queue.
  getBatch: (batchId: string) =>
    request<ExecutionRunSummary[]>(`/api/executions/batch/${batchId}`),
};

export function wsUrl(runId: string): string {
  const explicit = import.meta.env.VITE_WS_BASE_URL as string | undefined;
  if (explicit) return `${explicit}/ws/executions/${runId}`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/executions/${runId}`;
}
