# Build context must be the CodeReviewer repo ROOT (not this backend/ dir),
# since this image needs both the real `app/` package (graph, taint, memory,
# model_factory, ...) AND this service's own `viz_app/` package. From the
# repo root, use the following below command:
#   docker build -f visualizer/backend/Dockerfile -t codereviewer-visualizer .
FROM python:3.12-slim
WORKDIR /repo

# CodeReviewer's own deps (langgraph, chromadb, etc.)
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# This service's extra deps (sqlalchemy, aiosqlite, websockets, etc.)
COPY visualizer/backend/requirements.txt ./visualizer-requirements.txt
RUN pip install --no-cache-dir -r visualizer-requirements.txt

# The real graph package (graph/, taint/, memory.py, model_factory.py,
# schemas.py, routers.py, embeddings.py, ...) — same set mcp_server's
# DockerFile copies.
COPY app ./app

# This visualizer's own FastAPI service.
COPY visualizer/backend/viz_app ./visualizer/backend/viz_app

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/repo

WORKDIR /repo/visualizer/backend
RUN mkdir -p data
EXPOSE 8001

CMD ["uvicorn", "viz_app.main:app", "--host", "0.0.0.0", "--port", "8001"]
