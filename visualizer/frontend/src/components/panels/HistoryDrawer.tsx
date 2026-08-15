import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import { api } from "@/api/client";
import type { ExecutionRunDetail, ExecutionRunSummary } from "@/types/execution";
import { cn, formatClockTime, formatDuration, shortId } from "@/lib/format";
import { RUN_STATUS_COLOR, STATUS_TOKENS } from "@/lib/nodeVisuals";

export function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [runs, setRuns] = useState<ExecutionRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ExecutionRunDetail>>({});

  async function refresh() {
    setLoading(true);
    try {
      const data = await api.listExecutions();
      setRuns(data);
    } catch {
      // history is best-effort; leave the list as-is on failure
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!details[id]) {
      const detail = await api.getExecution(id);
      setDetails((prev) => ({ ...prev, [id]: detail }));
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 420 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="glass-strong fixed right-0 top-0 z-50 h-full w-full max-w-[420px] overflow-hidden flex flex-col border-l border-white/[0.08]"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4">
              <h2 className="font-display text-sm font-semibold text-slate-100">Execution History</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={refresh}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                  aria-label="Refresh"
                >
                  <RefreshCw size={14} className={cn(loading && "animate-spin")} />
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3">
              {runs.length === 0 && !loading && (
                <p className="py-8 text-center text-xs italic text-slate-600">No executions yet.</p>
              )}
              <div className="space-y-2">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
                    <button
                      onClick={() => toggleExpand(run.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-xs text-slate-300">
                            {run.label ?? shortId(run.id)}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              RUN_STATUS_COLOR[run.status]
                            )}
                          >
                            {run.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-600">
                          {formatClockTime(run.started_at)} · {run.completed_count}/{run.node_count} completed
                          {run.failed_count > 0 && <span className="text-danger-soft"> · {run.failed_count} failed</span>}
                        </p>
                      </div>
                      <ChevronDown
                        size={14}
                        className={cn("shrink-0 text-slate-600 transition-transform", expandedId === run.id && "rotate-180")}
                      />
                    </button>

                    <AnimatePresence>
                      {expandedId === run.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t border-white/[0.06]"
                        >
                          <div className="space-y-1 px-3 py-2">
                            {details[run.id] ? (
                              details[run.id].nodes.map((n) => (
                                <div key={n.node_id} className="flex items-center justify-between py-1">
                                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_TOKENS[n.status].dot)} />
                                    {n.node_id}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-600">
                                    {formatDuration(n.execution_time)}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <p className="py-2 text-center text-[11px] text-slate-600">Loading…</p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
