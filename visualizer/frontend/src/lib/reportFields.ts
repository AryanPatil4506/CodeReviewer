/** Extracts and normalizes the Output Formatter node's report fields
 * (output_markdown / output_diff / output_json) out of the raw node
 * output blob, so the UI can render an actual report instead of one
 * escaped JSON dump. */

function tryParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Strips a wrapping ```lang ... ``` fence some LLM-generated diffs
 * arrive wrapped in, leaving the raw unified diff text. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

export interface ReportFields {
  markdown: string | null;
  diff: string | null;
  jsonValue: unknown;
  /** Pretty-printed JSON text, for copy/download - null when there's nothing to show. */
  jsonText: string | null;
}

export function extractReportFields(output: Record<string, unknown> | undefined): ReportFields {
  const mdRaw = output?.["output_markdown"];
  const diffRaw = output?.["output_diff"];
  const jsonRaw = output?.["output_json"];

  const markdown = typeof mdRaw === "string" && mdRaw.trim() ? mdRaw : null;
  const diff = typeof diffRaw === "string" && diffRaw.trim() ? stripCodeFence(diffRaw) : null;

  let jsonValue: unknown = undefined;
  if (typeof jsonRaw === "string" && jsonRaw.trim()) {
    const parsed = tryParseJSON(jsonRaw);
    jsonValue = parsed !== null ? parsed : jsonRaw;
  } else if (jsonRaw !== undefined) {
    jsonValue = jsonRaw;
  }
  const jsonText = jsonValue !== undefined ? JSON.stringify(jsonValue, null, 2) : null;

  return { markdown, diff, jsonValue, jsonText };
}

/** Whether there's enough here to justify the dedicated report UI at all
 * (falls back to the generic raw-output block otherwise). */
export function hasReportContent(fields: ReportFields): boolean {
  return fields.markdown !== null || fields.diff !== null;
}
