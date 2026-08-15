import { useMemo } from "react";
import { CheckCircle2, CircleDashed, CircleSlash, Loader2, XCircle } from "lucide-react";
import { useExecutionStore } from "@/store/executionStore";
import { cn } from "@/lib/format";

const STATS = [
  { key: "running", label: "Running", icon: Loader2, color: "text-signal-soft", spin: true },
  { key: "completed", label: "Completed", icon: CheckCircle2, color: "text-ok-soft", spin: false },
  { key: "failed", label: "Failed", icon: XCircle, color: "text-danger-soft", spin: false },
  // Send()-routed agents agent_dispatcher didn't dispatch to on this run.
  { key: "skipped", label: "Skipped", icon: CircleSlash, color: "text-slate-600", spin: false },
  { key: "pending", label: "Pending", icon: CircleDashed, color: "text-slate-500", spin: false },
] as const;

export function StatsBar() {
  const nodeStates = useExecutionStore((s) => s.nodeStates);

  const counts = useMemo(() => {
    const c = { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0 };
    for (const state of Object.values(nodeStates)) c[state.status] += 1;
    return c;
  }, [nodeStates]);

  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      {STATS.map(({ key, label, icon: Icon, color, spin }) => (
        <div key={key} className="flex items-center gap-1.5">
          <Icon size={13} className={cn(color, spin && counts.running > 0 && "animate-spin")} />
          <span className={cn("font-mono text-xs", color)}>{counts[key]}</span>
          <span className="text-[11px] text-slate-600">{label}</span>
        </div>
      ))}
    </div>
  );
}
