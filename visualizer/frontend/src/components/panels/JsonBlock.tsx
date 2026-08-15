import { Fragment } from "react";

const TOKEN_RE =
  /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g;

/** Renders a pretty-printed JSON string with keys/strings/numbers/booleans
 * in distinct colors, matching the console's monospace/glass aesthetic. */
export function JsonBlock({ data }: { data: unknown }) {
  const text = JSON.stringify(data ?? {}, null, 2);
  if (text === "{}" || text === "[]") {
    return <span className="text-slate-600 italic">empty</span>;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<Fragment key={key++}>{text.slice(lastIndex, match.index)}</Fragment>);
    }
    const token = match[0];
    let className = "text-synth-soft"; // number
    if (/^"/.test(token)) {
      className = token.endsWith(":") ? "text-signal-soft" : "text-ok-soft";
    } else if (/true|false|null/.test(token)) {
      className = "text-warn";
    }
    parts.push(
      <span key={key++} className={className}>
        {token}
      </span>
    );
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }

  return <>{parts}</>;
}
