from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..execution_engine import engine
from ..graph_definition import get_graph_metadata
from ..models import ExecutionRun as ExecutionRunModel
from ..schemas import (
    ControlActionResponse,
    ExecutionRunDetail,
    ExecutionRunSummary,
    GraphMetadata,
    PrReviewFileRun,
    PrReviewRequest,
    RunStatus,
    StartExecutionRequest,
    StartPrReviewResponse,
    StartExecutionResponse,
)

router = APIRouter(prefix="/api", tags=["executions"])


@router.get("/graph", response_model=GraphMetadata)
async def get_graph() -> GraphMetadata:
    return get_graph_metadata()


@router.post("/executions", response_model=StartExecutionResponse, status_code=201)
async def start_execution(body: StartExecutionRequest) -> StartExecutionResponse:
    ctx = await engine.start_run(github_url=body.github_url, pull_no=body.pull_no, file=body.file)
    return StartExecutionResponse(
        run_id=ctx.run_id, graph_id=ctx.graph_id, status=ctx.status, started_at=__import__("datetime").datetime.now()
    )


@router.post("/executions/pr", response_model=StartPrReviewResponse, status_code=201)
async def start_pr_review(body: PrReviewRequest) -> StartPrReviewResponse:
    """Review EVERY changed file in the PR, not just the first one. Runs
    are queued sequentially (see start_pr_review in execution_engine.py for
    why) - use GET /api/executions/batch/{batch_id} to fetch and switch
    between them (the frontend's file-switcher tab strip does this)."""
    try:
        batch_id, pairs = await engine.start_pr_review(github_url=body.github_url, pull_no=body.pull_no)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return StartPrReviewResponse(batch_id=batch_id, runs=[PrReviewFileRun(run_id=run_id, file=file) for run_id, file in pairs])


@router.get("/executions/batch/{batch_id}", response_model=list[ExecutionRunSummary])
async def get_batch(batch_id: str, session: AsyncSession = Depends(get_session)) -> list[ExecutionRunSummary]:
    """All file-runs from one start_pr_review() call, in the order they were
    queued - what the frontend's file-switcher tab strip polls."""
    result = await session.execute(
        select(ExecutionRunModel).where(ExecutionRunModel.batch_id == batch_id).order_by(ExecutionRunModel.started_at.asc())
    )
    runs = result.scalars().all()
    if not runs:
        raise HTTPException(status_code=404, detail=f"No batch '{batch_id}' found")
    summaries = []
    for run in runs:
        completed = sum(1 for n in run.nodes if n.status == "completed")
        failed = sum(1 for n in run.nodes if n.status == "failed")
        summaries.append(
            ExecutionRunSummary(
                id=run.id, graph_id=run.graph_id, status=run.status, label=run.label, batch_id=run.batch_id,
                started_at=run.started_at, ended_at=run.ended_at,
                node_count=len(run.nodes), completed_count=completed, failed_count=failed,
            )
        )
    return summaries


def _get_ctx_or_404(run_id: str):
    ctx = engine.get(run_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail=f"No active run '{run_id}' (it may have finished and been dropped from memory; see /api/executions/{{run_id}} for history)")
    return ctx


@router.post("/executions/{run_id}/pause", response_model=ControlActionResponse)
async def pause_execution(run_id: str) -> ControlActionResponse:
    ctx = _get_ctx_or_404(run_id)
    await engine.pause(ctx)
    return ControlActionResponse(run_id=run_id, status=ctx.status, message="paused")


@router.post("/executions/{run_id}/resume", response_model=ControlActionResponse)
async def resume_execution(run_id: str) -> ControlActionResponse:
    ctx = _get_ctx_or_404(run_id)
    await engine.resume(ctx)
    return ControlActionResponse(run_id=run_id, status=ctx.status, message="resumed")


@router.post("/executions/{run_id}/cancel", response_model=ControlActionResponse)
async def cancel_execution(run_id: str) -> ControlActionResponse:
    ctx = _get_ctx_or_404(run_id)
    await engine.cancel(ctx)
    return ControlActionResponse(run_id=run_id, status=RunStatus.CANCELLED, message="cancelling")


@router.get("/executions", response_model=list[ExecutionRunSummary])
async def list_executions(session: AsyncSession = Depends(get_session)) -> list[ExecutionRunSummary]:
    result = await session.execute(select(ExecutionRunModel).order_by(ExecutionRunModel.started_at.desc()).limit(50))
    runs = result.scalars().all()
    summaries = []
    for run in runs:
        completed = sum(1 for n in run.nodes if n.status == "completed")
        failed = sum(1 for n in run.nodes if n.status == "failed")
        summaries.append(
            ExecutionRunSummary(
                id=run.id,
                graph_id=run.graph_id,
                status=run.status,
                label=run.label,
                started_at=run.started_at,
                ended_at=run.ended_at,
                node_count=len(run.nodes),
                completed_count=completed,
                failed_count=failed,
            )
        )
    return summaries


@router.get("/executions/{run_id}", response_model=ExecutionRunDetail)
async def get_execution(run_id: str, session: AsyncSession = Depends(get_session)) -> ExecutionRunDetail:
    result = await session.execute(select(ExecutionRunModel).where(ExecutionRunModel.id == run_id))
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return ExecutionRunDetail.model_validate(run)
