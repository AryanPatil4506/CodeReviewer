import { useMemo } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/format";

type DiffLineType = "add" | "del" | "context" | "meta";

interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function parseUnifiedDiff(raw: string): DiffFile[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode")
    ) {
      continue;
    }

    if (line.startsWith("--- ")) {
      currentFile = { oldPath: line.slice(4).trim(), newPath: "", hunks: [] };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (!currentFile) {
        currentFile = { oldPath: "", newPath: "", hunks: [] };
        files.push(currentFile);
      }
      currentFile.newPath = line.slice(4).trim();
      continue;
    }

    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      if (!currentFile) {
        currentFile = { oldPath: "", newPath: "", hunks: [] };
        files.push(currentFile);
      }
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[3], 10);
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue; // stray preamble line before any real hunk - skip

    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", content: line.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "del", content: line.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (line.startsWith("\\")) {
      currentHunk.lines.push({ type: "meta", content: line, oldLine: null, newLine: null });
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      currentHunk.lines.push({ type: "context", content, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return files.filter((f) => f.hunks.length > 0);
}

function displayPath(file: DiffFile): string {
  const path = file.newPath && file.newPath !== "/dev/null" ? file.newPath : file.oldPath;
  return path.replace(/^[ab]\//, "");
}

export function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);

  if (files.length === 0) {
    // Didn't look like a unified diff we could parse - show it verbatim rather than hide it.
    return (
      <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">
        {diff}
      </pre>
    );
  }

  return (
    <div className="space-y-3">
      {files.map((file, fi) => (
        <div key={fi} className="overflow-hidden rounded-xl border border-white/[0.06]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-slate-400">
            <FileText size={12} className="shrink-0 text-signal-dim" />
            <span className="truncate">{displayPath(file)}</span>
          </div>
          <div className="scrollbar-thin overflow-x-auto bg-black/20">
            {file.hunks.map((hunk, hi) => (
              <div key={hi}>
                <div className="whitespace-pre bg-synth/[0.06] px-3 py-1 font-mono text-[10px] text-synth-soft/80">
                  {hunk.header}
                </div>
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className={cn(
                      "flex font-mono text-[11px] leading-[1.6]",
                      line.type === "add" && "bg-ok/[0.08]",
                      line.type === "del" && "bg-danger/[0.08]",
                      line.type === "meta" && "opacity-50 italic"
                    )}
                  >
                    <span className="w-8 shrink-0 select-none border-r border-white/[0.04] px-1.5 text-right text-slate-600">
                      {line.oldLine ?? ""}
                    </span>
                    <span className="w-8 shrink-0 select-none border-r border-white/[0.04] px-1.5 text-right text-slate-600">
                      {line.newLine ?? ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 shrink-0 select-none text-center",
                        line.type === "add" && "text-ok-soft",
                        line.type === "del" && "text-danger-soft",
                        line.type !== "add" && line.type !== "del" && "text-slate-700"
                      )}
                    >
                      {line.type === "add" ? "+" : line.type === "del" ? "\u2212" : ""}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 whitespace-pre px-2 py-0.5",
                        line.type === "add"
                          ? "text-ok-soft"
                          : line.type === "del"
                          ? "text-danger-soft"
                          : "text-slate-300"
                      )}
                    >
                      {line.content || " "}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
