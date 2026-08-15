import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { api } from "@/api/client";
import { useExecutionStore } from "@/store/executionStore";
import { useExecutionSocket } from "@/hooks/useExecutionSocket";
import { TopBar } from "@/components/layout/TopBar";
import { FileTabsBar } from "@/components/layout/FileTabsBar";
import { BottomDock } from "@/components/layout/BottomDock";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { HistoryDrawer } from "@/components/panels/HistoryDrawer";

export default function App() {
  const setGraph = useExecutionStore((s) => s.setGraph);
  const runId = useExecutionStore((s) => s.runId);
  const graph = useExecutionStore((s) => s.graph);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGraph()
      .then(setGraph)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load graph"));
  }, [setGraph]);

  useExecutionSocket(runId);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-void-950">
      <div className="pointer-events-none fixed inset-0 bg-grid-fine bg-grid-fine opacity-40" />

      <TopBar onOpenHistory={() => setHistoryOpen(true)} />
      <FileTabsBar />

      <div className="relative flex min-h-0 flex-1">
        {graph ? (
          <ReactFlowProvider>
            <div className="relative flex-1">
              <GraphCanvas />
              <NodeDetailPanel />
            </div>
          </ReactFlowProvider>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-600">
            {loadError ? (
              <span className="text-danger-soft">
                Could not reach the backend ({loadError}). Is it running on :8000?
              </span>
            ) : (
              "Loading graph…"
            )}
          </div>
        )}
      </div>

      <BottomDock />

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
