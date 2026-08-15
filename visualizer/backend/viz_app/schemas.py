from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


# Enums

class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# Graph metadata

class GraphNode(BaseModel):
    id: str
    label: str
    type: str  # ingest | retrieval | router | agent | merge | evaluation | format | persistence
    description: str = ""


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str


class GraphMetadata(BaseModel):
    graph_id: str
    name: str
    description: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# Realtime event contract

class NodeUpdateEvent(BaseModel):
    event_type: Literal["node_update"] = "node_update"
    run_id: str
    node_id: str
    status: NodeStatus
    timestamp: datetime
    execution_time: float | None = None
    logs: str = ""
    input: dict = Field(default_factory=dict)
    output: dict = Field(default_factory=dict)
    error: str | None = None


class LogEvent(BaseModel):
    event_type: Literal["log"] = "log"
    run_id: str
    node_id: str
    timestamp: datetime
    message: str
    level: Literal["info", "warn", "error"] = "info"


class RunStatusEvent(BaseModel):
    event_type: Literal["run_status"] = "run_status"
    run_id: str
    status: RunStatus
    timestamp: datetime
    message: str | None = None


ExecutionEvent = Annotated[
    Union[NodeUpdateEvent, LogEvent, RunStatusEvent],
    Field(discriminator="event_type"),
]


# REST request/response bodies

class StartExecutionRequest(BaseModel):
    github_url: str
    pull_no: str
    # A PR can touch multiple files; the graph runs once per file (see
    # CodeReviewer's review_loop). Omit to visualize the first file in the
    # PR diff, pass one explicitly to pick which file's run to watch
    file: str | None = None


class PrReviewRequest(BaseModel):
    github_url: str
    pull_no: str


class StartExecutionResponse(BaseModel):
    run_id: str
    graph_id: str
    status: RunStatus
    started_at: datetime


class ControlActionResponse(BaseModel):
    run_id: str
    status: RunStatus
    message: str


class NodeExecutionDetail(BaseModel):
    node_id: str
    status: NodeStatus
    started_at: datetime | None
    ended_at: datetime | None
    execution_time: float | None
    input: dict
    output: dict
    error: str | None
    logs: str

    model_config = {"from_attributes": True}


class ExecutionRunDetail(BaseModel):
    id: str
    graph_id: str
    status: RunStatus
    label: str | None = None
    batch_id: str | None = None
    started_at: datetime
    ended_at: datetime | None
    nodes: list[NodeExecutionDetail]

    model_config = {"from_attributes": True}


class ExecutionRunSummary(BaseModel):
    id: str
    graph_id: str
    status: RunStatus
    label: str | None = None
    batch_id: str | None = None
    started_at: datetime
    ended_at: datetime | None
    node_count: int
    completed_count: int
    failed_count: int

    model_config = {"from_attributes": True}


class PrReviewFileRun(BaseModel):
    run_id: str
    file: str


class StartPrReviewResponse(BaseModel):
    batch_id: str
    runs: list[PrReviewFileRun]
