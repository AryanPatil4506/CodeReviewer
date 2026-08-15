import { useEffect, useRef } from "react";
import { useExecutionStore } from "@/store/executionStore";
import { cn, formatClockTime } from "@/lib/format";

const LEVEL_COLOR: Record<string, string> = {
  info: "text-slate-400",
  warn: "text-warn",
  error: "text-danger-soft",
  status: "text-signal-soft",
};

export function EventLogConsole() {
  const consoleLines = useExecutionStore((s) => s.consoleLines);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [consoleLines.length]);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 py-2 font-mono text-[11.5px] leading-relaxed">
      {consoleLines.length === 0 && (
        <p className="py-6 text-center text-slate-600 italic">
          No events yet. Start an execution to see live output here.
        </p>
      )}
      {consoleLines.map((line) => (
        <div key={line.id} className="flex gap-2 py-0.5">
          <span className="shrink-0 text-slate-700">{formatClockTime(line.timestamp)}</span>
          {line.node_id && (
            <span className="shrink-0 text-synth-soft/80">[{line.node_id}]</span>
          )}
          <span className={cn("break-all", LEVEL_COLOR[line.level])}>{line.message}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
