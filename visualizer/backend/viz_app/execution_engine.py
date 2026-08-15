from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .database import async_session_factory
from .graph_definition import CONDITIONAL_NODE_IDS, NODES
from .models import ExecutionEvent as ExecutionEventModel
from .models import ExecutionRun as ExecutionRunModel
from .models import NodeExecution as NodeExecutionModel
from .schemas import LogEvent, NodeStatus, NodeUpdateEvent, RunStatus, RunStatusEvent
from .ws_manager import manager as ws_manager

logger = logging.getLogger("graph_viz.engine")

# --- wire up to the actual CodeReviewer package -----------------------------
# This file is expected to live three levels under the CodeReviewer repo
# root (e.g. CodeReviewer/visualizer/backend/app/execution_engine.py), the
# same layout trick app/mcp_server/main.py already uses. Adjust the number
# of `.parents[...]` hops if you place it somewhere else.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.graph.graph_builder import graph as review_graph  # noqa: E402
from app.schemas import construct_review_req  # noqa: E402
from app.schemas import (  # noqa: E402
    ConfigurationError,
    GitHubPermanentError,
    GitHubRateLimitError,
    InvalidRequestError,
)

NODE_IDS = [n.id for n in NODES]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sanitize(value):
    """Make a CodeReviewState delta JSON-safe (sets -> sorted lists, etc.)
    without mutating the original object LangGraph is still using.

    The fallback branch matters: agent node code evolves independently of
    this file, and it's easy for a new state field to end up holding
    something JSON can't handle directly (a Pydantic model, an exception
    object, bytes, a datetime). Passing those through unchanged means the
    failure happens later at `model_dump(mode="json")`/DB-write time,
    inside the per-node try/except in _execute_file - survivable there, but
    better to convert defensively here and never hit that path at all."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, set):
        sanitized_items = [_sanitize(v) for v in value]
        try:
            return sorted(sanitized_items)
        except TypeError:  # e.g. a set of dicts - not orderable, and that's fine
            return sanitized_items
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in value]
    if hasattr(value, "model_dump"):  # Pydantic model
        try:
            return _sanitize(value.model_dump(mode="json"))
        except Exception:  # noqa: BLE001
            return str(value)
    try:
        import json as _json
        _json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)



# Per-run mutable state

class RunContext:
    def __init__(self, run_id: str, graph_id: str) -> None:
        self.run_id = run_id
        self.graph_id = graph_id
        self.status = RunStatus.PENDING
        self.resume_event = asyncio.Event()
        self.resume_event.set()  # set == not paused
        self.cancelled = False
        self.task: asyncio.Task | None = None
        self.node_snapshots: dict[str, dict] = {}


class ExecutionEngine:
    def __init__(self) -> None:
        self.runs: dict[str, RunContext] = {}

    # lifecycle

    async def _create_run_row(self, run_id: str, graph_id: str, label: str | None, batch_id: str | None = None) -> None:
        async with async_session_factory() as session:
            session.add(ExecutionRunModel(id=run_id, graph_id=graph_id, status=RunStatus.PENDING.value, label=label, batch_id=batch_id))
            for node in NODES:
                session.add(NodeExecutionModel(run_id=run_id, node_id=node.id, status=NodeStatus.PENDING.value))
            await session.commit()

    async def start_run(
        self,
        github_url: str,
        pull_no: str,
        file: str | None = None,
        graph_id: str = "code_review_pipeline",
    ) -> RunContext:
        """Start a single run. Fetches the PR itself and picks one file - the
        first one in the diff, unless `file` names one that's actually in it.
        See start_pr_review() to review every file in the PR instead."""
        run_id = str(uuid.uuid4())
        ctx = RunContext(run_id, graph_id)
        self.runs[run_id] = ctx
        await self._create_run_row(run_id, graph_id, label=None)  # label filled in once the target file is known

        ctx.task = asyncio.create_task(self._run_from_scratch(ctx, github_url, pull_no, file))
        return ctx

    async def start_pr_review(
        self, github_url: str, pull_no: str, graph_id: str = "code_review_pipeline"
    ) -> tuple[str, list[tuple[str, str]]]:
        """Fetch the PR once, then run every changed file through the graph
        sequentially (not concurrently - two reasons: (1) the frontend
        canvas has exactly one set of 16 node boxes, so interleaving two
        files' WebSocket events on it would corrupt the display, and
        (2) it avoids piling concurrent LLM calls onto whatever's already
        constrained, e.g. a single local Ollama instance).
        Returns (batch_id, [(run_id, file), ...]) - batch_id links every
        run so the frontend's file-switcher can fetch them as a group via
        GET /api/executions/batch/{batch_id}. All rows exist (as PENDING)
        immediately so History/the tab strip shows the whole batch right
        away, even though only the first file starts running now."""
        try:
            request = construct_review_req(url=github_url, pull_number=pull_no)
        except (GitHubPermanentError, GitHubRateLimitError, ConfigurationError, InvalidRequestError) as e:
            raise ValueError(f"Could not fetch PR: {e}") from e

        grouped: dict[str, list] = defaultdict(list)
        for entry in request.input:
            grouped[entry.file].append(entry)
        if not grouped:
            raise ValueError("PR has no reviewable file entries.")

        batch_id = str(uuid.uuid4())
        batch: list[tuple[str, str, list]] = []
        for target_file, entries in grouped.items():
            run_id = str(uuid.uuid4())
            ctx = RunContext(run_id, graph_id)
            self.runs[run_id] = ctx
            label = f"{request.repo_id} - {target_file}"
            await self._create_run_row(run_id, graph_id, label=label, batch_id=batch_id)
            batch.append((run_id, target_file, entries))

        asyncio.create_task(self._run_batch_sequentially(request, batch))
        return batch_id, [(run_id, target_file) for run_id, target_file, _ in batch]

    async def _run_batch_sequentially(self, request, batch: list[tuple[str, str, list]]) -> None:
        for run_id, target_file, entries in batch:
            ctx = self.runs[run_id]
            if ctx.cancelled:  # cancelled before its turn came up
                continue
            await self._execute_file(ctx, request, target_file, entries)

    def get(self, run_id: str) -> RunContext | None:
        return self.runs.get(run_id)

    async def pause(self, ctx: RunContext) -> None:
        if ctx.status != RunStatus.RUNNING:
            return
        ctx.resume_event.clear()
        ctx.status = RunStatus.PAUSED
        await self._emit(RunStatusEvent(run_id=ctx.run_id, status=RunStatus.PAUSED, timestamp=_now(), message="Execution paused"))
        await self._persist_run_status(ctx.run_id, RunStatus.PAUSED)

    async def resume(self, ctx: RunContext) -> None:
        if ctx.status != RunStatus.PAUSED:
            return
        ctx.status = RunStatus.RUNNING
        ctx.resume_event.set()
        await self._emit(RunStatusEvent(run_id=ctx.run_id, status=RunStatus.RUNNING, timestamp=_now(), message="Execution resumed"))
        await self._persist_run_status(ctx.run_id, RunStatus.RUNNING)

    async def cancel(self, ctx: RunContext) -> None:
        if ctx.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
            return
        ctx.cancelled = True
        ctx.resume_event.set()  # release anything paused so it can observe cancellation

    # driver: real graph.astream(), not a scheduler

    async def _run_from_scratch(self, ctx: RunContext, github_url: str, pull_no: str, file: str | None) -> None:
        """Fetch the PR and run exactly one file (used by start_run)."""
        try:
            request = construct_review_req(url=github_url, pull_number=pull_no)
        except (GitHubPermanentError, GitHubRateLimitError, ConfigurationError, InvalidRequestError) as e:
            await self._fail_run(ctx, f"Could not fetch PR: {e}")
            return

        grouped: dict[str, list] = defaultdict(list)
        for entry in request.input:
            grouped[entry.file].append(entry)
        if not grouped:
            await self._fail_run(ctx, "PR has no reviewable file entries.")
            return

        target_file = file if file in grouped else next(iter(grouped))
        await self._set_label(ctx.run_id, f"{request.repo_id} - {target_file}")
        await self._execute_file(ctx, request, target_file, grouped[target_file])

    async def _execute_file(self, ctx: RunContext, request, target_file: str, entries: list) -> None:
        ctx.status = RunStatus.RUNNING
        await self._emit(RunStatusEvent(run_id=ctx.run_id, status=RunStatus.RUNNING, timestamp=_now(), message=f"Reviewing {target_file}..."))
        await self._persist_run_status(ctx.run_id, RunStatus.RUNNING)

        visited: set[str] = set()
        run_failed = False
        # stream_mode="updates" only tells us a node just FINISHED - LangGraph
        # doesn't hand us a separate "node started" event with a real
        # timestamp. The best honest signal available is the wall-clock gap
        # since the previous chunk arrived; that's this chunk's actual
        # elapsed time on the graph, so we attribute it to whichever node(s)
        # completed in it (a Send()-parallel chunk with 2 nodes genuinely
        # did share that same window, so giving both the same duration is
        # correct, not just a fallback).
        last_chunk_at = _now()

        try:
            inputs = {
                "repo_id": request.repo_id,
                "input": [e.model_dump() for e in entries],
                "repo_url_fetch": request.repo_url_fetch,
                "repo_tree": request.repo_tree,
                "head_sha": request.head_sha,
            }
            config = {"configurable": {"thread_id": str(uuid.uuid4())}}

            stream = review_graph.astream(inputs, config=config, stream_mode="updates")
            try:
                async for step in stream:
                    await ctx.resume_event.wait()
                    if ctx.cancelled:
                        break

                    chunk_arrived_at = _now()
                    chunk_duration = (chunk_arrived_at - last_chunk_at).total_seconds()

                    for node_id, delta in step.items():
                        # LangGraph internal bookkeeping keys aren't real nodes.
                        if node_id not in NODE_IDS:
                            continue

                        # Isolated per-node: if turning this ONE node's state
                        # delta into events raises (bad data shape, a
                        # serialization edge case, whatever), that must not
                        # propagate out of the `async for` body - doing so
                        # forces Python to close the still-suspended
                        # `stream` generator, which is what actually produces
                        # a "GeneratorExit ... yield o" traceback out of
                        # LangGraph's own astream(). The graph itself may be
                        # completely healthy; it's OUR processing of one
                        # node's output that broke. Log it, mark that node
                        # failed, and keep consuming the rest of the stream.
                        try:
                            visited.add(node_id)
                            delta = delta or {}
                            errors = delta.get("agent_errors") or []
                            node_failed = bool(errors)
                            run_failed = run_failed or node_failed

                            running_event = NodeUpdateEvent(
                                run_id=ctx.run_id, node_id=node_id, status=NodeStatus.RUNNING,
                                timestamp=last_chunk_at, execution_time=None, logs="",
                                input=_sanitize({k: v for k, v in delta.items() if k in ("agents_required", "router_decision")}),
                                output={}, error=None,
                            )
                            ctx.node_snapshots[node_id] = running_event.model_dump(mode="json")
                            await self._emit(running_event)
                            await self._persist_node(ctx.run_id, running_event, mark_started=True)

                            output_event = NodeUpdateEvent(
                                run_id=ctx.run_id, node_id=node_id,
                                status=NodeStatus.FAILED if node_failed else NodeStatus.COMPLETED,
                                timestamp=chunk_arrived_at, execution_time=chunk_duration,
                                logs="\n".join(f"[{e.get('agent', node_id)}] {e.get('error')}" for e in errors),
                                input={}, output=_sanitize(delta),
                                error="; ".join(e.get("error", "") for e in errors) if errors else None,
                            )
                            ctx.node_snapshots[node_id] = output_event.model_dump(mode="json")
                            await self._emit(output_event)
                            await self._persist_node(ctx.run_id, output_event)
                        except Exception:  # noqa: BLE001 - isolate this node's failure; the stream must keep flowing
                            run_failed = True
                            logger.error(
                                "Failed to process update for node '%s' on run %s (file %s) - "
                                "skipping this node's event, continuing the stream. Raw delta keys: %s",
                                node_id, ctx.run_id, target_file, list(delta.keys()) if isinstance(delta, dict) else type(delta),
                                exc_info=True,
                            )
                            # Best-effort: make sure this node still shows up
                            # as failed rather than sitting at "pending"
                            # forever if the exception happened before its
                            # first event was ever persisted.
                            try:
                                fallback_event = NodeUpdateEvent(
                                    run_id=ctx.run_id, node_id=node_id, status=NodeStatus.FAILED,
                                    timestamp=_now(), execution_time=None,
                                    logs="Internal error processing this node's update - see server logs",
                                    input={}, output={}, error="Internal error processing this node's update",
                                )
                                await self._emit(fallback_event)
                                await self._persist_node(ctx.run_id, fallback_event, mark_started=True)
                            except Exception:  # noqa: BLE001
                                pass  # already logged above; don't let the fallback itself become a new crash source

                    last_chunk_at = chunk_arrived_at
            finally:
                # Deterministic cleanup, in this task, instead of leaving it
                # to garbage collection
                try:
                    await stream.aclose()
                except Exception:  # noqa: BLE001 - cleanup-path errors shouldn't mask the real result
                    logger.warning("astream() cleanup raised on run %s - non-fatal, continuing", ctx.run_id, exc_info=True)

            if ctx.cancelled:
                await self._mark_unvisited(ctx, visited, NodeStatus.FAILED, "Cancelled by user")
                final_status = RunStatus.CANCELLED
            else:
                await self._mark_unvisited(ctx, visited, NodeStatus.SKIPPED, "Not routed to by agent_dispatcher on this run")
                final_status = RunStatus.FAILED if run_failed else RunStatus.COMPLETED

            ctx.status = final_status
            await self._emit(RunStatusEvent(run_id=ctx.run_id, status=final_status, timestamp=_now(), message=f"Execution {final_status.value}"))
            await self._persist_run_status(ctx.run_id, final_status, ended=True)

        except Exception as e:  # noqa: BLE001 - surface any graph-level failure to the UI
            await self._fail_run(ctx, f"Graph execution error: {e}")

    async def _mark_unvisited(self, ctx: RunContext, visited: set[str], status: NodeStatus, reason: str) -> None:
        for node_id in NODE_IDS:
            if node_id in visited:
                continue
            is_conditional = node_id in CONDITIONAL_NODE_IDS
            event = NodeUpdateEvent(
                run_id=ctx.run_id, node_id=node_id, status=status,
                timestamp=_now(), execution_time=None,
                logs=reason if is_conditional else f"{reason} (upstream path bypassed this node)",
                input={}, output={}, error=None,
            )
            ctx.node_snapshots[node_id] = event.model_dump(mode="json")
            await self._emit(event)
            await self._persist_node(ctx.run_id, event)

    async def _fail_run(self, ctx: RunContext, message: str) -> None:
        ctx.status = RunStatus.FAILED
        await self._emit(LogEvent(run_id=ctx.run_id, node_id="start", timestamp=_now(), message=message))
        # Without this, a failure that happens before the graph starts
        # (bad PR URL, GitHub API error, ...) leaves every node sitting at
        # "pending" forever on the canvas - confirmed by testing this path
        # directly. Mark them all failed so the UI reflects reality
        await self._mark_unvisited(ctx, visited=set(), status=NodeStatus.FAILED, reason=message)
        await self._emit(RunStatusEvent(run_id=ctx.run_id, status=RunStatus.FAILED, timestamp=_now(), message=message))
        await self._persist_run_status(ctx.run_id, RunStatus.FAILED, ended=True)

    # persistence + broadcast

    async def _emit(self, event: NodeUpdateEvent | LogEvent | RunStatusEvent) -> None:
        payload = event.model_dump(mode="json")
        async with async_session_factory() as session:
            session.add(
                ExecutionEventModel(
                    run_id=event.run_id,
                    node_id=getattr(event, "node_id", None),
                    event_type=event.event_type,
                    payload=payload,
                )
            )
            await session.commit()
        await ws_manager.broadcast(event.run_id, payload)

    async def _persist_node(self, run_id: str, event: NodeUpdateEvent, mark_started: bool = False) -> None:
        from sqlalchemy import select

        async with async_session_factory() as session:
            result = await session.execute(
                select(NodeExecutionModel).where(
                    NodeExecutionModel.run_id == run_id, NodeExecutionModel.node_id == event.node_id
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                return
            row.status = event.status.value
            row.input = event.input
            row.output = event.output
            row.error = event.error
            row.execution_time = event.execution_time
            row.logs = event.logs
            if mark_started:
                row.started_at = event.timestamp
            else:
                row.ended_at = event.timestamp
            await session.commit()

    async def _set_label(self, run_id: str, label: str) -> None:
        from sqlalchemy import select

        async with async_session_factory() as session:
            result = await session.execute(select(ExecutionRunModel).where(ExecutionRunModel.id == run_id))
            row = result.scalar_one_or_none()
            if row is None:
                return
            row.label = label
            await session.commit()

    async def _persist_run_status(self, run_id: str, status: RunStatus, ended: bool = False) -> None:
        from sqlalchemy import select

        async with async_session_factory() as session:
            result = await session.execute(select(ExecutionRunModel).where(ExecutionRunModel.id == run_id))
            row = result.scalar_one_or_none()
            if row is None:
                return
            row.status = status.value
            if ended:
                row.ended_at = _now()
            await session.commit()


engine = ExecutionEngine()
