import { Fragment, useMemo } from "react";
import { cn } from "@/lib/format";

type Align = "left" | "center" | "right" | null;

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "blockquote"; text: string }
  | { kind: "code"; lang: string | null; content: string }
  | { kind: "table"; headers: string[]; align: Align[]; rows: string[][] }
  | { kind: "hr" };

function splitTableRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

function isTableSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

function parseBlocks(text: string): Block[] {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const fenceMatch = /^```\s*([a-zA-Z0-9_+-]*)\s*$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] || null;
      const contentLines: string[] = [];
      i++;
      while (i < rawLines.length && !/^```\s*$/.test(rawLines[i])) {
        contentLines.push(rawLines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: "code", lang, content: contentLines.join("\n") });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].replace(/\s+#+\s*$/, ""),
      });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < rawLines.length && isTableSeparatorRow(rawLines[i + 1])) {
      const headers = splitTableRow(line);
      const sepCells = splitTableRow(rawLines[i + 1]);
      const align: Align[] = sepCells.map((c) => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return null;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < rawLines.length && rawLines[i].trim() !== "" && rawLines[i].includes("|")) {
        rows.push(splitTableRow(rawLines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, align, rows });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < rawLines.length && /^>\s?/.test(rawLines[i])) {
        quoteLines.push(rawLines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length) {
        const m = /^[-*+]\s+(.*)$/.exec(rawLines[i]);
        if (m) {
          items.push(m[1]);
          i++;
        } else if (/^\s{2,}\S/.test(rawLines[i]) && items.length > 0) {
          items[items.length - 1] += " " + rawLines[i].trim();
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length) {
        const m = /^\d+\.\s+(.*)$/.exec(rawLines[i]);
        if (m) {
          items.push(m[1]);
          i++;
        } else if (/^\s{2,}\S/.test(rawLines[i]) && items.length > 0) {
          items[items.length - 1] += " " + rawLines[i].trim();
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() !== "" &&
      !/^```/.test(rawLines[i]) &&
      !/^(#{1,6})\s+/.test(rawLines[i]) &&
      !/^[-*+]\s+/.test(rawLines[i]) &&
      !/^\d+\.\s+/.test(rawLines[i]) &&
      !/^>\s?/.test(rawLines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(rawLines[i].trim())
    ) {
      paraLines.push(rawLines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: "paragraph", text: paraLines.join(" ") });
    } else {
      i++; // safety net - never spin in place
    }
  }

  return blocks;
}

// Same left-to-right regex-tokenizer approach as JsonBlock.tsx's TOKEN_RE.
const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<Fragment key={`${keyPrefix}-t${key++}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code
          key={`${keyPrefix}-c${key++}`}
          className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] text-signal-soft"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      parts.push(
        <strong key={`${keyPrefix}-b${key++}`} className="font-semibold text-slate-100">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch) {
        parts.push(
          <a
            key={`${keyPrefix}-a${key++}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="text-signal-soft underline decoration-signal-dim underline-offset-2 hover:text-signal"
          >
            {linkMatch[1]}
          </a>
        );
      }
    } else {
      parts.push(
        <em key={`${keyPrefix}-i${key++}`} className="italic text-slate-300">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(<Fragment key={`${keyPrefix}-t${key++}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return parts;
}

const HEADING_SIZE: Record<number, string> = {
  1: "text-lg mt-5 first:mt-0",
  2: "text-base mt-5 first:mt-0",
  3: "text-sm mt-4 first:mt-0",
  4: "text-sm mt-3 first:mt-0",
  5: "text-xs mt-3 first:mt-0",
  6: "text-xs mt-3 first:mt-0",
};

/** Renders a markdown string as styled JSX matching the app's dark/glass
 * theme - headings, paragraphs, lists, tables, code fences, blockquotes,
 * and inline bold/italic/code/links. Hand-rolled (same regex-tokenizer
 * approach as JsonBlock) rather than pulling in a markdown dependency. */
export function MarkdownView({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="space-y-3">
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(block.level, 6)}` as keyof JSX.IntrinsicElements;
            return (
              <Tag
                key={key}
                className={cn(
                  "font-display font-semibold text-slate-100",
                  HEADING_SIZE[block.level],
                  block.level <= 2 && "border-b border-white/[0.06] pb-1.5"
                )}
              >
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={key} className="text-[13px] leading-relaxed text-slate-300">
                {renderInline(block.text, key)}
              </p>
            );
          case "list":
            return block.ordered ? (
              <ol
                key={key}
                className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-slate-300 marker:text-slate-600"
              >
                {block.items.map((item, ii) => (
                  <li key={`${key}-${ii}`}>{renderInline(item, `${key}-${ii}`)}</li>
                ))}
              </ol>
            ) : (
              <ul
                key={key}
                className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-300 marker:text-slate-600"
              >
                {block.items.map((item, ii) => (
                  <li key={`${key}-${ii}`}>{renderInline(item, `${key}-${ii}`)}</li>
                ))}
              </ul>
            );
          case "blockquote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-signal/40 pl-3 text-[13px] italic leading-relaxed text-slate-400"
              >
                {renderInline(block.text, key)}
              </blockquote>
            );
          case "code":
            return (
              <div key={key} className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/30">
                {block.lang && (
                  <div className="border-b border-white/[0.06] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                    {block.lang}
                  </div>
                )}
                <pre className="scrollbar-thin overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                  {block.content}
                </pre>
              </div>
            );
          case "table":
            return (
              <div key={key} className="scrollbar-thin overflow-x-auto rounded-xl border border-white/[0.06]">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-white/[0.08] bg-white/[0.03]">
                      {block.headers.map((h, hi) => (
                        <th
                          key={hi}
                          className={cn(
                            "whitespace-nowrap px-3 py-2 text-left font-display font-semibold text-slate-200",
                            block.align[hi] === "center" && "text-center",
                            block.align[hi] === "right" && "text-right"
                          )}
                        >
                          {renderInline(h, `${key}-h${hi}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-white/[0.04] last:border-0">
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className={cn(
                              "px-3 py-2 text-slate-300",
                              block.align[ci] === "center" && "text-center",
                              block.align[ci] === "right" && "text-right"
                            )}
                          >
                            {renderInline(cell, `${key}-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={key} className="border-white/[0.08]" />;
          default:
            return null;
        }
      })}
    </div>
  );
}
