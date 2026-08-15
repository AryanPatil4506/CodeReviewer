from __future__ import annotations

import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger("graph_viz.ws")


class ConnectionManager:
    """Tracks live WebSocket connections, grouped by run_id, and fans events
    out to every connected client for that run. One run can have multiple
    viewers; one client could in principle watch multiple runs (one socket
    per run keeps this simple on both ends)."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, run_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[run_id].add(websocket)
        logger.info("client connected to run %s (%d total)", run_id, len(self._connections[run_id]))

    def disconnect(self, run_id: str, websocket: WebSocket) -> None:
        self._connections[run_id].discard(websocket)
        if not self._connections[run_id]:
            del self._connections[run_id]

    async def broadcast(self, run_id: str, payload: dict) -> None:
        dead: list[WebSocket] = []
        for ws in self._connections.get(run_id, set()):
            try:
                await ws.send_json(payload)
            except Exception:  # connection dropped mid-send
                dead.append(ws)
        for ws in dead:
            self.disconnect(run_id, ws)


manager = ConnectionManager()
