import { useState } from "react";
import { ChevronDown, ListTree, Terminal } from "lucide-react";
import { StatsBar } from "@/components/panels/StatsBar";
import { EventLogConsole } from "@/components/panels/EventLogConsole";
import { ExecutionTimeline } from "@/components/panels/ExecutionTimeline";
import { cn } from "@/lib/format";

type Tab = "console" | "timeline";

export function BottomDock() {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Tab>("console");

  return (
    <div className="glass-strong border-t border-white/[0.06]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-2">
        <div className="flex items-center">
          <TabButton active={tab === "console"} onClick={() => setTab("console")} icon={Terminal} label="Event Log" />
          <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")} icon={ListTree} label="Timeline" />
        </div>
        <div className="flex items-center gap-3">
          {!collapsed && <StatsBar />}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="mr-1 rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label={collapsed ? "Expand console" : "Collapse console"}
          >
            <ChevronDown size={14} className={cn("transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="h-48">{tab === "console" ? <EventLogConsole /> : <ExecutionTimeline />}</div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Terminal;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
        active ? "border-signal text-signal-soft" : "border-transparent text-slate-500 hover:text-slate-300"
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
