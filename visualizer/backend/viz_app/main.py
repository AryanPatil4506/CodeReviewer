from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routes import executions, ws

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("graph_viz")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("database ready")
    yield


app = FastAPI(
    title="Graph Execution Visualizer API",
    description=(
        "Drives a real-time, node-by-node visualization of a graph-based "
        "workflow. Start a run, watch node_update/log/run_status events "
        "stream over WebSocket, and control execution (pause/resume/cancel) "
        "via REST."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(executions.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}
