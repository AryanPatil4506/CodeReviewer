import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Braces, Check, Copy, Download, FileText, GitCompare, type LucideIcon, X } from "lucide-react";
import { cn } from "@/lib/format";
import { MarkdownView } from "./MarkdownView";
import { DiffViewer } from "./DiffViewer";
import { JsonBlock } from "./JsonBlock";

type TabId = "report" | "diff" | "json";

interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  copyText: string;
}

interface FinalReportModalProps {
  open: boolean;
  onClose: () => void;
  nodeLabel: string;
  markdown: string | null;
  diff: string | null;
  jsonValue: unknown;
  jsonText: string | null;
}

export function FinalReportModal({
  open,
  onClose,
  nodeLabel,
  markdown,
  diff,
  jsonValue,
  jsonText,
}: FinalReportModalProps) {
  const candidateTabs: { id: TabId; label: string; icon: LucideIcon; copyText: string | null }[] = [
    { id: "report", label: "Report", icon: FileText, copyText: markdown },
    { id: "diff", label: "Diff", icon: GitCompare, copyText: diff },
    { id: "json", label: "Raw JSON", icon: Braces, copyText: jsonText },
  ];
  const tabs: TabDef[] = candidateTabs.filter((t): t is TabDef => t.copyText !== null);

  const [activeTab, setActiveTab] = useState<TabId>(tabs[0]?.id ?? "report");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTab(tabs[0]?.id ?? "report");
      setCopied(false);
    }
    // re-picks the first available tab whenever the modal opens or the underlying content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, markdown, diff, jsonText]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!tabs.length) return null;

  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(active.copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied - nothing actionable to do here
    }
  }

  function handleDownload() {
    const ext = active.id === "report" ? "md" : active.id === "diff" ? "diff" : "json";
    const blob = new Blob([active.copyText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nodeLabel.toLowerCase().replace(/\s+/g, "-") || "report"}-${active.id}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
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
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="glass-strong flex h-full max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-semibold text-slate-100">Final Report</h2>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{nodeLabel}</p>
                </div>
                <button
                  onClick={onClose}
                  className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 transition-colors"
                  aria-label="Close report"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-2.5">
                <div className="flex items-center gap-1.5">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors",
                        activeTab === t.id
                          ? "border-signal/30 bg-signal/[0.12] text-signal-soft"
                          : "border-transparent text-slate-500 hover:bg-white/[0.05] hover:text-slate-300"
                      )}
                    >
                      <t.icon size={13} />
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-300"
                  >
                    {copied ? <Check size={13} className="text-ok-soft" /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-300"
                  >
                    <Download size={13} />
                    Download
                  </button>
                </div>
              </div>

              <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
                {active.id === "report" && markdown && <MarkdownView content={markdown} />}
                {active.id === "diff" && diff && <DiffViewer diff={diff} />}
                {active.id === "json" && jsonValue !== undefined && (
                  <pre className="font-mono text-[12px] leading-relaxed text-slate-300">
                    <JsonBlock data={jsonValue} />
                  </pre>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
