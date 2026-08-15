import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Braces, Clock, FileText, GitCompare, Maximize2, Terminal, X, type LucideIcon } from "lucide-react";
import { useExecutionStore } from "@/store/executionStore";
import { NODE_TYPE_ICON, STATUS_TOKENS } from "@/lib/nodeVisuals";
import { cn, formatClockTime, formatDuration } from "@/lib/format";
import { extractReportFields, hasReportContent, type ReportFields } from "@/lib/reportFields";
import { JsonBlock } from "./JsonBlock";
import { MarkdownView } from "./MarkdownView";
import { DiffViewer } from "./DiffViewer";
import { FinalReportModal } from "./FinalReportModal";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h4>
      {children}
    </div>
  );
}

type ReportTab = "report" | "diff" | "json";

/** Inline quick-glance preview for the Output Formatter node - the same
 * rendered report/diff/json tabs as the full modal, just sized for the
 * side panel, with an Expand button into the comfortable full-screen view. */
function ReportPreview({ report, onExpand }: { report: ReportFields; onExpand: () => void }) {
  const tabs: { id: ReportTab; label: string; icon: LucideIcon }[] = [
    ...(report.markdown ? [{ id: "report" as const, label: "Report", icon: FileText }] : []),
    ...(report.diff ? [{ id: "diff" as const, label: "Diff", icon: GitCompare }] : []),
    ...(report.jsonText ? [{ id: "json" as const, label: "JSON", icon: Braces }] : []),
  ];
  const [tab, setTab] = useState<ReportTab>(tabs[0]?.id ?? "report");

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-display text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Final Report
        </h4>
        <button
          onClick={onExpand}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-signal-soft transition-colors hover:bg-signal/[0.08]"
        >
          <Maximize2 size={11} />
          Expand
        </button>
      </div>

      <div className="mb-2 flex items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
              tab === t.id
                ? "border-signal/30 bg-signal/[0.12] text-signal-soft"
                : "border-transparent text-slate-500 hover:bg-white/[0.05]"
            )}
          >
            <t.icon size={11} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20 p-3">
        {tab === "report" && report.markdown && <MarkdownView content={report.markdown} />}
        {tab === "diff" && report.diff && <DiffViewer diff={report.diff} />}
        {tab === "json" && report.jsonValue !== undefined && (
          <pre className="font-mono text-[11px] leading-relaxed text-slate-300">
            <JsonBlock data={report.jsonValue} />
          </pre>
        )}
      </div>
    </div>
  );
}

export function NodeDetailPanel() {
  const graph = useExecutionStore((s) => s.graph);
  const selectedNodeId = useExecutionStore((s) => s.selectedNodeId);
  const nodeState = useExecutionStore((s) =>
    s.selectedNodeId ? s.nodeStates[s.selectedNodeId] : undefined
  );
  const selectNode = useExecutionStore((s) => s.selectNode);

  const meta = graph?.nodes.find((n) => n.id === selectedNodeId);
  const Icon = meta ? NODE_TYPE_ICON[meta.type] : Terminal;
  const tokens = nodeState ? STATUS_TOKENS[nodeState.status] : STATUS_TOKENS.pending;

  const report = extractReportFields(nodeState?.output);
  const isFormatNode = meta?.type === "format";
  const showReport = isFormatNode && hasReportContent(report);

  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => {
    setReportOpen(false);
  }, [selectedNodeId]);

  return (
    <>
      <AnimatePresence>
        {selectedNodeId && meta && (
        <motion.aside
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="glass-strong absolute right-3 top-3 bottom-3 z-20 w-[360px] overflow-hidden rounded-2xl flex flex-col"
        >
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-4">
            <div className="flex items-start gap-3 min-w-0">
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06]", tokens.text)}>
                {Icon ? <Icon size={17} /> : null}
              </span>
              <div className="min-w-0">
                <h3 className="truncate font-display text-sm font-semibold text-slate-100">{meta.label}</h3>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{meta.description}</p>
              </div>
            </div>
            <button
              onClick={() => selectNode(null)}
              className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 transition-colors"
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex items-center gap-4 border-b border-white/[0.06] px-4 py-3">
            <span className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", tokens.border, tokens.text)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", tokens.dot)} />
              {tokens.label}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Clock size={12} />
              {formatDuration(nodeState?.execution_time)}
            </span>
            {nodeState?.started_at && (
              <span className="font-mono text-[11px] text-slate-600">
                {formatClockTime(nodeState.started_at)}
              </span>
            )}
          </div>

          <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-4 py-4">
            {nodeState?.error && (
              <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.06] px-3 py-2.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
                <p className="text-xs leading-relaxed text-danger-soft">{nodeState.error}</p>
              </div>
            )}

            <Section title="Input">
              <pre className="scrollbar-thin overflow-x-auto rounded-xl border border-white/[0.06] bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                <JsonBlock data={nodeState?.input} />
              </pre>
            </Section>

            {showReport ? (
              <ReportPreview report={report} onExpand={() => setReportOpen(true)} />
            ) : (
              <Section title="Output">
                <pre className="scrollbar-thin overflow-x-auto rounded-xl border border-white/[0.06] bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                  <JsonBlock data={nodeState?.output} />
                </pre>
              </Section>
            )}

            <Section title="Execution Logs">
              <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
                {nodeState?.logLines.length ? (
                  nodeState.logLines.map((line, i) => (
                    <div key={i} className="py-0.5">
                      <span className="text-signal-dim mr-1.5">›</span>
                      {line}
                    </div>
                  ))
                ) : (
                  <span className="italic text-slate-600">No logs yet</span>
                )}
              </div>
            </Section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>

    <FinalReportModal
      open={reportOpen && showReport}
      onClose={() => setReportOpen(false)}
      nodeLabel={meta?.label ?? "Output Formatter"}
      markdown={report.markdown}
      diff={report.diff}
      jsonValue={report.jsonValue}
      jsonText={report.jsonText}
    />
    </>
  );
}
