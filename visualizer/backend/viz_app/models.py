from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ExecutionRun(Base):
    """One execution of the whole graph."""

    __tablename__ = "execution_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    graph_id: Mapped[str] = mapped_column(String(64), default="code_review_pipeline")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # e.g. "AryanPatil4506/CodeReviewer#1 - handler_sink.py" - lets History
    # tell 5 runs from the same PR apart instead of showing 5 bare UUIDs.
    label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Shared by every file-run kicked off from the same start_pr_review()
    # call, so the frontend can group them into a file-switcher tab strip.
    # NULL for single-file runs started via start_run().
    batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    triggered_by: Mapped[str] = mapped_column(String(64), default="manual")

    nodes: Mapped[list["NodeExecution"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin"
    )
    events: Mapped[list["ExecutionEvent"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin"
    )


class NodeExecution(Base):
    """State of a single node within a single run."""

    __tablename__ = "node_executions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("execution_runs.id"))
    node_id: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    execution_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    input: Mapped[dict] = mapped_column(JSON, default=dict)
    output: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    logs: Mapped[str] = mapped_column(Text, default="")

    run: Mapped[ExecutionRun] = relationship(back_populates="nodes")


class ExecutionEvent(Base):
    """Append-only log of every event emitted during a run (for replay/history)."""

    __tablename__ = "execution_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("execution_runs.id"))
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_type: Mapped[str] = mapped_column(String(24))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    run: Mapped[ExecutionRun] = relationship(back_populates="events")
