import { useEffect, useState } from "react";
import { useExecutionStore } from "@/store/executionStore";
import { STATUS_TOKENS } from "@/lib/nodeVisuals";
import { cn, formatDuration } from "@/lib/format";

const BAR_COLOR: Record<string, string> = {
  pending: "bg-slate-700",
  running: "bg-signal",
  completed: "bg-ok",
  failed: "bg-danger",
};

export function ExecutionTimeline() {
  const graph = useExecutionStore((s) => s.graph);
  const nodeStates = useExecutionStore((s) => s.nodeStates);
  const runStartedAt = useExecutionStore((s) => s.runStartedAt);
  const runEndedAt = useExecutionStore((s) => s.runEndedAt);
  const runStatus = useExecutionStore((s) => s.runStatus);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (runStatus !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [runStatus]);

  if (!graph || !runStartedAt) {
    return (
      <p className="px-4 py-6 text-center text-xs italic text-slate-600">
        Timeline will appear once an execution starts.
      </p>
    );
  }

  const startMs = new Date(runStartedAt).getTime();
  const endMs = runEndedAt ? new Date(runEndedAt).getTime() : now;
  const totalMs = Math.max(endMs - startMs, 1000);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 py-3">
      <div className="space-y-2">
        {graph.nodes.map((n) => {
          const state = nodeStates[n.id];
          const status = state?.status ?? "pending";
          const started = state?.started_at ? new Date(state.started_at).getTime() : null;
          const ended = state?.ended_at
            ? new Date(state.ended_at).getTime()
            : status === "running"
            ? now
            : null;

          const leftPct = started ? Math.max(((started - startMs) / totalMs) * 100, 0) : 0;
          const widthPct = started && ended ? Math.max(((ended - started) / totalMs) * 100, 0.6) : 0;

          return (
            <div key={n.id} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate font-mono text-[11px] text-slate-500">
                {n.label}
              </span>
              <div className="relative h-4 flex-1 rounded-full bg-white/[0.03]">
                {started && (
                  <div
                    className={cn(
                      "absolute top-0 h-full rounded-full transition-[width] duration-200",
                      BAR_COLOR[status]
                    )}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  />
                )}
              </div>
              <span className={cn("w-14 shrink-0 text-right font-mono text-[10px]", STATUS_TOKENS[status].text)}>
                {formatDuration(state?.execution_time ?? (status === "running" && started ? (now - started) / 1000 : null))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
