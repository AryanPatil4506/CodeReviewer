from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..execution_engine import engine
from ..ws_manager import manager

logger = logging.getLogger("graph_viz.ws")
router = APIRouter()


@router.websocket("/ws/executions/{run_id}")
async def execution_socket(websocket: WebSocket, run_id: str) -> None:
    await manager.connect(run_id, websocket)
    try:
        ctx = engine.get(run_id)
        if ctx is not None:
            # Replay current state so a client that connects mid-run (or a
            # tab that reloads) can rebuild the board without polling REST
            await websocket.send_json({"event_type": "snapshot", "run_id": run_id, "status": ctx.status.value, "nodes": list(ctx.node_snapshots.values())})
        else:
            await websocket.send_json({"event_type": "snapshot", "run_id": run_id, "status": "unknown", "nodes": []})

        while True:
            # We don't expect client -> server traffic, but keep the socket
            # open and use incoming messages as a liveness signal.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(run_id, websocket)
