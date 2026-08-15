import {
  Bot,
  Database,
  Download,
  FileText,
  GitBranch,
  type LucideIcon,
  Merge,
  Save,
  Scale,
} from "lucide-react";
import type { NodeStatus, RunStatus } from "@/types/execution";

export const NODE_TYPE_ICON: Record<string, LucideIcon> = {
  ingest: Download,
  retrieval: Database,
  router: GitBranch,
  agent: Bot,
  merge: Merge,
  evaluation: Scale,
  format: FileText,
  persistence: Save,
};

export interface StatusTokens {
  label: string;
  border: string;
  glow: string;
  text: string;
  dot: string;
}

export const STATUS_TOKENS: Record<NodeStatus, StatusTokens> = {
  pending: {
    label: "Pending",
    border: "border-white/[0.1]",
    glow: "",
    text: "text-slate-300",
    dot: "bg-slate-400",
  },
  running: {
    label: "Running",
    border: "border-signal/60",
    glow: "shadow-glow-signal",
    text: "text-signal-soft",
    dot: "bg-signal",
  },
  completed: {
    label: "Completed",
    border: "border-ok/50",
    glow: "shadow-glow-ok",
    text: "text-ok-soft",
    dot: "bg-ok",
  },
  failed: {
    label: "Failed",
    border: "border-danger/60",
    glow: "shadow-glow-danger",
    text: "text-danger-soft",
    dot: "bg-danger",
  },
  skipped: {
    // agent_dispatcher's Send() didn't route to this node on this run —
    // distinct from "pending" (never got a chance) or "failed" (ran and errored).
    label: "Skipped",
    border: "border-white/[0.1]",
    glow: "",
    text: "text-slate-400",
    dot: "bg-slate-500",
  },
};

// Shared with HistoryDrawer and FileTabsBar - one source of truth for what
// each RUN-level (not node-level) status looks like.
export const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  completed: "text-ok-soft border-ok/40",
  failed: "text-danger-soft border-danger/40",
  cancelled: "text-slate-400 border-white/20",
  running: "text-signal-soft border-signal/40",
  paused: "text-warn border-warn/40",
  pending: "text-slate-500 border-white/10",
};
