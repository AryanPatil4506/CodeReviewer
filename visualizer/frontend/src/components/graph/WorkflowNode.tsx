import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useExecutionStore } from "@/store/executionStore";
import { NODE_TYPE_ICON, STATUS_TOKENS } from "@/lib/nodeVisuals";
import { cn, formatDuration } from "@/lib/format";

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  description: string;
}

function WorkflowNodeImpl({ id, data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const nodeState = useExecutionStore((s) => s.nodeStates[id]);
  const searchQuery = useExecutionStore((s) => s.searchQuery);
  const selectNode = useExecutionStore((s) => s.selectNode);

  const status = nodeState?.status ?? "pending";
  const tokens = STATUS_TOKENS[status];
  const Icon = NODE_TYPE_ICON[d.nodeType] ?? Loader2;

  const matchesSearch =
    searchQuery.trim() === "" ||
    d.label.toLowerCase().includes(searchQuery.trim().toLowerCase());

  // Brief celebratory/alert flash the moment a node finishes, layered on
  // top of the steady-state styling above.
  const prevStatus = useRef(status);
  const [justFinished, setJustFinished] = useState(false);
  useEffect(() => {
    if (prevStatus.current !== status && (status === "completed" || status === "failed")) {
      setJustFinished(true);
      const t = setTimeout(() => setJustFinished(false), 900);
      return () => clearTimeout(t);
    }
    prevStatus.current = status;
  }, [status]);

  return (
    <div
      className={cn("relative transition-opacity duration-300", !matchesSearch && "opacity-20")}
      onClick={() => selectNode(id)}
    >
      {status === "running" && (
        <motion.div
          className="absolute inset-0 rounded-2xl border border-signal/60"
          animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      {justFinished && (
        <motion.div
          className={cn(
            "absolute inset-0 rounded-2xl border-2",
            status === "completed" ? "border-ok" : "border-danger"
          )}
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      )}

      <motion.div
        layout
        animate={{ scale: status === "running" ? 1.02 : 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className={cn(
          "relative w-[260px] rounded-2xl border px-5 py-4 cursor-pointer select-none",
          "bg-void-800/95 backdrop-blur-xl shadow-lg shadow-black/40",
          tokens.border,
          tokens.glow,
          status === "pending" && "opacity-90",
          status === "skipped" && "opacity-70",
          selected && "ring-2 ring-synth/70"
        )}
      >
        <Handle
          type="target"
          position={Position.Left}
          className={cn("!w-2 !h-2 !border-none", tokens.dot)}
        />
        <Handle
          type="source"
          position={Position.Right}
          className={cn("!w-2 !h-2 !border-none", tokens.dot)}
        />

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.1]",
                tokens.text
              )}
            >
              {status === "running" ? (
                <Loader2 size={17} className="animate-spin" />
              ) : status === "failed" ? (
                <AlertTriangle size={17} />
              ) : (
                <Icon size={17} />
              )}
            </span>
            <span className="truncate font-display text-[15px] font-semibold text-white">
              {d.label}
            </span>
          </div>
          <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", tokens.dot)} />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-300">
            {d.nodeType}
          </span>
          <span className={cn("font-mono text-[11px] font-medium", tokens.text)}>
            {status === "pending" ? tokens.label : formatDuration(nodeState?.execution_time)}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeImpl);
