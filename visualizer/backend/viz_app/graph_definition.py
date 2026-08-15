from __future__ import annotations

from .schemas import GraphEdge, GraphMetadata, GraphNode

NODES: list[GraphNode] = [
    GraphNode(id="start", label="Start", type="ingest",
              description="Initializes run state (id, resets per-run fields)."),
    GraphNode(id="diff_parser", label="Diff Parser", type="ingest",
              description="Parses the incoming PR diff into structured file/hunk entries."),
    GraphNode(id="ast_parser", label="AST Parser", type="ingest",
              description="Parses changed files into ASTs; detects added/deleted/modified functions and structural change type."),
    GraphNode(id="memory_reader", label="Memory Reader", type="retrieval",
              description="Pulls relevant prior review context for this repo from ChromaDB."),
    GraphNode(id="cross-taint", label="Cross-File Tracer", type="retrieval",
              description="Traces tainted sources to sinks across file boundaries using the GitHub repo tree."),
    GraphNode(id="task_classifier", label="Task Classifier", type="router",
              description="Classifies change magnitude/language and decides which specialist agents this diff needs."),
    GraphNode(id="agent_dispatcher", label="Agent Dispatcher", type="router",
              description="Fans out via Send() to the routed specialist agents (or to trivial_output_node for trivial/unparseable diffs)."),
    GraphNode(id="bug_agent", label="Bug Agent", type="agent",
              description="Looks for logic errors, off-by-ones, and incorrect control flow."),
    GraphNode(id="security_agent", label="Security Agent", type="agent",
              description="Scans for injection, taint flow, and unsafe deserialization issues."),
    GraphNode(id="quality_agent", label="Quality Agent", type="agent",
              description="Flags style, readability, and maintainability concerns."),
    GraphNode(id="performance_agent", label="Performance Agent", type="agent",
              description="Checks for N+1 queries, unnecessary allocations, and hot-path issues."),
    GraphNode(id="trivial_output_node", label="Trivial Output", type="format",
              description="Short-circuit path for trivial diffs or files with parse errors — skips agent review entirely."),
    GraphNode(id="aggregator", label="Aggregator", type="merge",
              description="Merges findings from all specialist agents that ran into one candidate review."),
    GraphNode(id="judge_agent", label="Judge", type="evaluation",
              description="Scores aggregated findings; verdict PASS / RETRY / FORCE_OUTPUT."),
    GraphNode(id="output_formatter", label="Output Formatter", type="format",
              description="Renders the final review as markdown/diff/JSON."),
    GraphNode(id="memory_writer", label="Memory Writer", type="persistence",
              description="Writes this review's findings back into ChromaDB."),
]

# (source, target) - forward edges only; the judge -> agent_dispatcher RETRY
# cycle is intentionally excluded
_EDGE_PAIRS: list[tuple[str, str]] = [
    ("start", "diff_parser"),
    ("diff_parser", "ast_parser"),
    ("ast_parser", "memory_reader"),
    ("memory_reader", "cross-taint"),
    ("cross-taint", "task_classifier"),
    ("task_classifier", "agent_dispatcher"),
    ("agent_dispatcher", "bug_agent"),
    ("agent_dispatcher", "security_agent"),
    ("agent_dispatcher", "quality_agent"),
    ("agent_dispatcher", "performance_agent"),
    ("agent_dispatcher", "trivial_output_node"),
    ("bug_agent", "aggregator"),
    ("security_agent", "aggregator"),
    ("quality_agent", "aggregator"),
    ("performance_agent", "aggregator"),
    ("aggregator", "judge_agent"),
    ("judge_agent", "output_formatter"),
    ("trivial_output_node", "memory_writer"),
    ("output_formatter", "memory_writer"),
]

EDGES: list[GraphEdge] = [
    GraphEdge(id=f"{src}->{dst}", source=src, target=dst) for src, dst in _EDGE_PAIRS
]

# Nodes that are only *conditionally* visited on a given run (Send() routed
# agents, plus the trivial-path node). The engine uses this to know which
# un-visited nodes to mark "skipped" rather than leaving them pending
# forever once a run finishes.
CONDITIONAL_NODE_IDS: set[str] = {
    "bug_agent", "security_agent", "quality_agent", "performance_agent",
    "trivial_output_node",
}


def get_dependencies() -> dict[str, list[str]]:
    """node_id -> list of node_ids that must complete before it can run.
    Kept for the frontend's auto-layout (lib/layout.ts uses edges directly,
    but routes/executions.py's /api/graph metadata endpoint still wants
    this shape available)."""
    deps: dict[str, list[str]] = {n.id: [] for n in NODES}
    for edge in EDGES:
        deps[edge.target].append(edge.source)
    return deps


def get_graph_metadata() -> GraphMetadata:
    return GraphMetadata(
        graph_id="code_review_pipeline",
        name="CodeReviewer Pipeline",
        description=(
            "Real multi-agent PR review graph: diff/AST parsing, memory retrieval, "
            "cross-file taint tracing, task classification, a Send()-routed fan-out "
            "into specialist agents, aggregation, judging (with a RETRY loop back "
            "to dispatch, not shown), formatting, and memory write-back."
        ),
        nodes=NODES,
        edges=EDGES,
    )
