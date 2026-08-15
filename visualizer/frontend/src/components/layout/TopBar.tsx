import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { History, Pause, Play, Search, SquareX, Wifi, WifiOff, Workflow } from "lucide-react";
import { api } from "@/api/client";
import { useExecutionStore } from "@/store/executionStore";
import { cn } from "@/lib/format";

export function TopBar({ onOpenHistory }: { onOpenHistory: () => void }) {
  const runId = useExecutionStore((s) => s.runId);
  const runStatus = useExecutionStore((s) => s.runStatus);
  const runLabel = useExecutionStore((s) => s.runLabel);
  const wsConnected = useExecutionStore((s) => s.wsConnected);
  const nodeStates = useExecutionStore((s) => s.nodeStates);
  const searchQuery = useExecutionStore((s) => s.searchQuery);
  const setSearchQuery = useExecutionStore((s) => s.setSearchQuery);
  const startNewRun = useExecutionStore((s) => s.startNewRun);
  const setRunStatus = useExecutionStore((s) => s.setRunStatus);
  const setActiveBatch = useExecutionStore((s) => s.setActiveBatch);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [pullNo, setPullNo] = useState("");

  const total = Object.keys(nodeStates).length || 1;
  const settled = Object.values(nodeStates).filter(
    (n) => n.status === "completed" || n.status === "failed"
  ).length;
  const progressPct = Math.round((settled / total) * 100);

  const isIdle = runStatus === "idle" || runStatus === "completed" || runStatus === "failed" || runStatus === "cancelled";
  const isRunning = runStatus === "running" || runStatus === "pending";
  const isPaused = runStatus === "paused";

  async function guarded(fn: () => Promise<void>) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await fn();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const canStart = githubUrl.trim().length > 0 && pullNo.trim().length > 0;

  const handleStart = () =>
    guarded(async () => {
      if (!canStart) {
        setErrorMsg("Enter a GitHub repo URL and PR number first.");
        return;
      }
      const res = await api.startExecution(githubUrl.trim(), pullNo.trim());
      setActiveBatch(null); // a single-file run replaces any previous batch's tab strip
      startNewRun(res.run_id);
    });

  const handleStartAllFiles = () =>
    guarded(async () => {
      if (!canStart) {
        setErrorMsg("Enter a GitHub repo URL and PR number first.");
        return;
      }
      const res = await api.startPrReview(githubUrl.trim(), pullNo.trim());
      if (res.runs.length === 0) return;
      setActiveBatch({ batchId: res.batch_id, files: res.runs });
      // Live-view the first file; the FileTabsBar (rendered whenever
      // activeBatch is set) lets the person switch to any other file's
      // run - including ones still queued, which just shows "pending"
      // until its turn comes up in the sequential backend queue.
      startNewRun(res.runs[0].run_id);
    });

  const handlePause = () =>
    guarded(async () => {
      if (!runId) return;
      setRunStatus("paused");
      await api.pauseExecution(runId);
    });

  const handleResume = () =>
    guarded(async () => {
      if (!runId) return;
      setRunStatus("running");
      await api.resumeExecution(runId);
    });

  const handleCancel = () =>
    guarded(async () => {
      if (!runId) return;
      await api.cancelExecution(runId);
    });

  const statusLabel = useMemo(() => {
    if (runStatus === "idle") return "Ready";
    return runStatus.charAt(0).toUpperCase() + runStatus.slice(1);
  }, [runStatus]);

  return (
    <div className="glass-strong relative z-30 border-b border-white/[0.06]">
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-signal/30 bg-signal/10 text-signal">
            <Workflow size={18} />
          </span>
          <div>
            <h1 className="font-display text-[15px] font-semibold leading-tight text-slate-100">
              Graph Execution Visualizer
            </h1>
            <p className="text-[11px] leading-tight text-slate-500">
              {runId ? (
                <>
                  {runLabel ? (
                    <span className="text-slate-400">{runLabel}</span>
                  ) : (
                    <>
                      run <span className="font-mono text-slate-400">{runId.slice(0, 8)}</span>
                    </>
                  )}{" "}
                  · <span className={cn(runStatus === "failed" && "text-danger-soft")}>{statusLabel}</span>
                </>
              ) : (
                "Code review pipeline · idle"
              )}
            </p>
          </div>
        </div>

        <div className="relative hidden md:block">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-56 rounded-lg border border-white/[0.08] bg-white/[0.03] py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/30"
          />
        </div>

        <div className="flex items-center gap-2">
          {errorMsg && <span className="max-w-[220px] truncate text-[11px] text-danger-soft">{errorMsg}</span>}

          <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-slate-500 sm:flex">
            {wsConnected ? <Wifi size={12} className="text-ok" /> : <WifiOff size={12} className="text-slate-600" />}
            {wsConnected ? "Live" : "Offline"}
          </span>

          <button
            onClick={onOpenHistory}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/[0.06]"
          >
            <History size={13} />
            History
          </button>

          {isIdle && (
            <>
              <input
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="github.com/owner/repo"
                className="hidden w-48 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/30 lg:block"
              />
              <input
                value={pullNo}
                onChange={(e) => setPullNo(e.target.value)}
                placeholder="PR #"
                className="hidden w-16 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/30 lg:block"
              />
              <button
                onClick={handleStart}
                disabled={busy || !canStart}
                className="flex items-center gap-1.5 rounded-lg bg-signal/90 px-3.5 py-1.5 text-xs font-medium text-void-950 transition-colors hover:bg-signal disabled:opacity-50"
              >
                <Play size={13} />
                Start Execution
              </button>
              <button
                onClick={handleStartAllFiles}
                disabled={busy || !canStart}
                title="Review every changed file in this PR, one after another"
                className="hidden items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50 md:flex"
              >
                <Play size={13} />
                All Files
              </button>
            </>
          )}
          {isRunning && (
            <>
              <button
                onClick={handlePause}
                disabled={busy || runStatus === "pending"}
                className="flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-3 py-1.5 text-xs font-medium text-warn transition-colors hover:bg-warn/20 disabled:opacity-50"
              >
                <Pause size={13} />
                Pause
              </button>
              <button
                onClick={handleCancel}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-soft transition-colors hover:bg-danger/20 disabled:opacity-50"
              >
                <SquareX size={13} />
                Cancel
              </button>
            </>
          )}
          {isPaused && (
            <>
              <button
                onClick={handleResume}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-signal/90 px-3.5 py-1.5 text-xs font-medium text-void-950 transition-colors hover:bg-signal disabled:opacity-50"
              >
                <Play size={13} />
                Resume
              </button>
              <button
                onClick={handleCancel}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-soft transition-colors hover:bg-danger/20 disabled:opacity-50"
              >
                <SquareX size={13} />
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="h-[2px] w-full bg-white/[0.04]">
        <motion.div
          className="h-full bg-gradient-to-r from-signal to-ok"
          animate={{ width: `${runId ? progressPct : 0}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
