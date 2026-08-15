import type { GraphEdge, GraphNode } from "@/types/execution";

export interface LayoutPosition {
  x: number;
  y: number;
}

const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 150;

// After this many columns, wrap to a second row instead of continuing
// further right. A straight 12-column pipeline is ~4000px wide - fitView
// has to zoom out to ~30% to show all of that at once, which is what made
// nodes unreadable by default. Wrapping into two rows of ~6 columns each
// roughly halves the required width, so a readable zoom level actually
// fits a normal viewport.
//
// Both rows flow left-to-right (NOT mirrored/serpentine) - every node's
// handles are fixed as target=Left, source=Right (see WorkflowNode.tsx),
// so a mirrored second row would force edges to exit a node's right side
// and loop backward to reach a target sitting to its left, which is
// exactly what produced the scrambled, looping edge lines. Keeping both
// rows in the same direction means every edge's geometry is consistent;
// the single row-wrap connection (last node of row 1 -> first node of row
// 2) is just one longer diagonal edge, which reads fine.
const WRAP_AFTER_COLUMNS = 6;
const BAND_HEIGHT = 620; // vertical gap between row 1 and row 2 baselines - tall enough to clear the widest column's node stack (the 5-way agent fan-out)

/**
 * Assigns each node to a column equal to its longest-path depth from a root
 * (a node with no incoming edges), then stacks nodes within a column
 * vertically, centered around each row-band's own y=0. Columns beyond
 * WRAP_AFTER_COLUMNS drop to a second row band, so the whole graph reads
 * as two shorter rows instead of one very long line. This degrades
 * gracefully to a reasonable layered layout for any DAG shape the backend
 * might serve, not just the bundled 12-column example graph.
 */
export function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Record<string, LayoutPosition> {
  const incoming: Record<string, string[]> = {};
  const outgoing: Record<string, string[]> = {};
  for (const n of nodes) {
    incoming[n.id] = [];
    outgoing[n.id] = [];
  }
  for (const e of edges) {
    outgoing[e.source]?.push(e.target);
    incoming[e.target]?.push(e.source);
  }

  const depth: Record<string, number> = {};
  const roots = nodes.filter((n) => incoming[n.id].length === 0).map((n) => n.id);
  const queue = [...roots];
  for (const r of roots) depth[r] = 0;

  // Kahn-style BFS over a DAG, tracking the *longest* path length seen so
  // far so fan-in nodes (e.g. an aggregator) land after all of their
  // branches, not just the first one processed.
  const indegreeRemaining: Record<string, number> = {};
  for (const n of nodes) indegreeRemaining[n.id] = incoming[n.id].length;

  while (queue.length) {
    const id = queue.shift()!;
    for (const next of outgoing[id] ?? []) {
      depth[next] = Math.max(depth[next] ?? 0, (depth[id] ?? 0) + 1);
      indegreeRemaining[next] -= 1;
      if (indegreeRemaining[next] === 0) queue.push(next);
    }
  }

  const columns: Record<number, string[]> = {};
  for (const n of nodes) {
    const d = depth[n.id] ?? 0;
    (columns[d] ??= []).push(n.id);
  }

  const positions: Record<string, LayoutPosition> = {};
  for (const [colStr, ids] of Object.entries(columns)) {
    const col = Number(colStr);
    const band = Math.floor(col / WRAP_AFTER_COLUMNS);
    const colWithinBand = col % WRAP_AFTER_COLUMNS;

    const count = ids.length;
    ids.forEach((id, i) => {
      const yOffset = (i - (count - 1) / 2) * ROW_HEIGHT;
      positions[id] = {
        x: colWithinBand * COLUMN_WIDTH,
        y: band * BAND_HEIGHT + yOffset,
      };
    });
  }

  return positions;
}
