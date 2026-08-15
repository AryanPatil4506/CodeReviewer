import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { api } from "@/api/client";
import { useExecutionStore } from "@/store/executionStore";
import { RUN_STATUS_COLOR } from "@/lib/nodeVisuals";
import { cn } from "@/lib/format";
import type { ExecutionRunSummary, RunStatus } from "@/types/execution";

const STATUS_ICON: Record<RunStatus, typeof CheckCircle2> = {
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
  running: Loader2,
  paused: CircleDashed,
  pending: CircleDashed,
};

const SETTLED: RunStatus[] = ["completed", "failed", "cancelled"];

/** Shown whenever a batch review ("All Files") is active. Polls the batch's
 * live status while any file is still queued/running, and lets the person
 * jump the main canvas to any file's run - including ones still sitting in
 * the sequential queue, which just show "pending" until their turn comes. */
export function FileTabsBar() {
  const activeBatch = useExecutionStore((s) => s.activeBatch);
  const currentRunId = useExecutionStore((s) => s.runId);
  const loadRun = useExecutionStore((s) => s.loadRun);
  const [summaries, setSummaries] = useState<ExecutionRunSummary[]>([]);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!activeBatch) {
      setSummaries([]);
      return;
    }

    let cancelled = false;
    async function poll() {
      try {
        const rows = await api.getBatch(activeBatch!.batchId);
        if (!cancelled) setSummaries(rows);
        const allSettled = rows.length > 0 && rows.every((r) => SETTLED.includes(r.status));
        if (allSettled && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // transient fetch failure - next tick retries, nothing to show the user for one missed poll
      }
    }

    poll();
    pollRef.current = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBatch?.batchId]);

  if (!activeBatch) return null;

  // Prefer live-polled summaries (real status/label); fall back to the
  // placeholder file list from the start response for tabs not in the
  // first poll response yet (there's no gap in practice, but this avoids
  // a one-frame flash of missing tabs).
  const rows: { run_id: string; file: string; status: RunStatus }[] =
    summaries.length > 0
      ? summaries.map((s) => ({ run_id: s.id, file: s.label?.split(" - ").slice(1).join(" - ") || s.id, status: s.status }))
      : activeBatch.files.map((f) => ({ run_id: f.run_id, file: f.file, status: "pending" as RunStatus }));

  async function handleSelect(runId: string) {
    if (runId === currentRunId) return;
    setSwitchingTo(runId);
    try {
      const detail = await api.getExecution(runId);
      loadRun(detail);
    } finally {
      setSwitchingTo(null);
    }
  }

  return (
    <div className="glass-strong scrollbar-thin flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.06] px-5 py-2">
      <span className="mr-1 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-500">Files</span>
      {rows.map((row) => {
        const Icon = STATUS_ICON[row.status];
        const active = row.run_id === currentRunId;
        return (
          <button
            key={row.run_id}
            onClick={() => handleSelect(row.run_id)}
            disabled={switchingTo === row.run_id}
            title={row.file}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-colors",
              active
                ? "border-signal/60 bg-signal/10 text-signal-soft"
                : cn("bg-white/[0.02] hover:bg-white/[0.06]", RUN_STATUS_COLOR[row.status]),
              switchingTo === row.run_id && "opacity-60"
            )}
          >
            <Icon size={12} className={row.status === "running" ? "animate-spin" : ""} />
            <span className="max-w-[220px] truncate">{row.file}</span>
          </button>
        );
      })}
    </div>
  );
}
