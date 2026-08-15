# Code Reviewer

A production-grade, multi-agent AI code review system built with **LangGraph**. It analyzes GitHub pull requests for bugs, security vulnerabilities, quality issues, and performance problems — including cross-file, security vulnerability tracing — and returns a structured, confidence-scored review.

Fully containerized with Docker, with observability via LangSmith and persistent review memory via ChromaDB.

## Features

- **Multi-agent review pipeline** — four specialist agents (bug, security, quality, performance) analyze code in parallel, dispatched based on task classification and confidence routing
- **GitHub PR integration** — submit a PR URL and pull number; Code Reviewer fetches the diff, changed files, and PR metadata directly via the GitHub API, with automatic retry-with-backoff on rate limits and clear error responses for auth/config issues
- **Cross-file, cross-repo taint tracing** — a custom static analysis engine that traces tainted data (e.g. user input) across file and module boundaries, resolving imports against the PR's full repo tree and fetching non-diff files live from GitHub when needed, rather than relying on local-disk lookups
- **Judge & retry loop** — a judge node evaluates specialist findings and can trigger targeted retries (`PASS` / `RETRY` / `FORCE_OUTPUT`) rather than accepting low-confidence output
- **Persistent memory** — ChromaDB stores review history so the system can reference prior findings across sessions
- **Streaming API** — FastAPI backend with `StreamingResponse` for real-time, per-file review output
- **MCP server** — `review_pr` and `check_cross_file_taint` exposed as MCP tools, so the reviewer can be called directly from any MCP client (Claude Desktop, IDEs, other agents), with bounded concurrency and partial-failure tolerance for multi-file runs
- **Bounded, provider-aware concurrency** — a call-level semaphore wraps every LLM invocation, capping concurrent requests only when running against local Ollama (a real hardware/VRAM limit); Groq/OpenAI/OpenRouter calls bypass the semaphore and rely on their own rate-limit retry/backoff instead, since their actual constraint is requests-per-minute, not concurrency
- **Token-optimized output formatting** — diff-assembly uses a windowed view of findings (padded, merged line ranges) rather than full file content, reducing prompt size for the final review output
- **Fully containerized** — Docker Compose setup with GPU passthrough, healthcheck-gated startup, and non-root privilege dropping; the MCP server runs as its own containerized service sharing the same Ollama instance and Chroma memory store as the main app
- **Multi-provider LLM support** — works with local models via Ollama (Llama, Qwen, Gemma, and others) or hosted providers (OpenAI, Groq, OpenRouter)

## Architecture

```mermaid
flowchart TD
    START([START]) --> start
    start --> diff_parser
    diff_parser --> ast_parser
    ast_parser --> memory_reader
    memory_reader --> cross_taint["cross-taint"]
    cross_taint --> task_classifier
    task_classifier --> agent_dispatcher

    agent_dispatcher -.->|confidence_router| bug_agent
    agent_dispatcher -.->|confidence_router| security_agent
    agent_dispatcher -.->|confidence_router| quality_agent
    agent_dispatcher -.->|confidence_router| performance_agent
    agent_dispatcher -.->|confidence_router| trivial_output_node

    bug_agent --> aggregator
    security_agent --> aggregator
    quality_agent --> aggregator
    performance_agent --> aggregator

    aggregator --> judge_agent

    judge_agent -.->|PASS| output_formatter
    judge_agent -.->|RETRY| agent_dispatcher
    judge_agent -.->|FORCE_OUTPUT| output_formatter

    trivial_output_node --> memory_writer
    output_formatter --> memory_writer
    memory_writer --> END([END])
```

Review findings are deduplicated in the aggregator via a composite key, then passed through the judge before final markdown/diff output is generated. Reviews are streamed back **per file** — each changed file in the PR runs through its own graph execution with a fresh `thread_id`, so output for one file doesn't block on another.

This same graph is what the MCP server's `review_pr` and `check_cross_file_taint` tools invoke — the MCP layer is a thin wrapper exposing the graph over the MCP protocol rather than a separate implementation.

## Tech Stack

| Layer | Tools |
|---|---|
| Agent orchestration | LangGraph |
| LLM inference | Ollama (local), OpenAI, Groq, OpenRouter |
| Vector memory | ChromaDB |
| API | FastAPI |
| Agent tooling | MCP (Model Context Protocol) — FastMCP |
| Source integration | GitHub REST API |
| Observability | LangSmith |
| Containerization | Docker, Docker Compose |

## GitHub API Setup

Code Reviewer fetches PR file contents, metadata, and any cross-file imports directly
from the GitHub API, so it needs a GitHub **personal access token** to authenticate its
requests. Without one, requests to `/review` will fail immediately with a clear
`500 Configuration Error` rather than attempting the fetch.

### 1. Generate a token

1. Go to **github.com** → click your profile picture (top right) → **Settings**.
2. In the left sidebar, scroll to **Developer settings**.
3. Go to **Personal access tokens → Fine-grained tokens → Generate new token**.
4. Give it a descriptive name (e.g. `code-reviewer-local`) and an expiration — shorter
   is safer for a token used in local development.
5. Under **Repository access**, choose:
   - **Only select repositories** — pick whichever repos you want Code Reviewer to be
     able to review, or
   - **All repositories** — needed if you want to point Code Reviewer at arbitrary
     public repos, not just your own.
6. Under **Permissions → Repository permissions**, grant:
   - **Pull requests: Read-only** — required to list PR files and fetch PR metadata.
   - **Contents: Read-only** — required to fetch file contents (old/new versions, the
     full repo tree, and any imported files used during cross-file taint tracing that
     aren't part of the PR diff itself).
7. Click **Generate token** and **copy it immediately** — GitHub only shows the full
   token once.

### 2. Configure it

Add the token to your `.env` file at the project root:

```
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

If you're running via Docker Compose, make sure this `.env` file is either loaded via
`env_file:` in `docker-compose.yml` or the variable is passed through under
`environment:` — otherwise the container won't see it even if it's set on your host.
This applies to both the `app` and `mcp-server` services.

### Error handling

Requests fail fast and clearly rather than hanging or returning ambiguous errors:

| Situation | Status | Response |
|---|---|---|
| No token configured | `500` | Configuration error |
| Malformed GitHub URL / bad pull number | `400` | Invalid request error |
| Token invalid/expired, or PR/repo not found | passthrough (`401`/`404`) | GitHub's own error message |
| Rate limit hit, retries exhausted | `503` | Rate limit error |

### Notes on rate limits

Authenticated requests get a much higher GitHub API rate limit than unauthenticated
ones (5,000 requests/hour vs. 60/hour), which matters here since a single PR review
can trigger several calls — one for the file list, one for PR metadata, one or two per
changed file for content, plus additional calls per cross-file import resolved against
the repo tree during taint tracing. If you hit a rate limit anyway, Code Reviewer
retries automatically with backoff (reading the `retry-after` header) and returns a
`503` only if retries are exhausted — no action needed on your end beyond waiting.

## Concurrency Configuration

Code Reviewer bounds how many LLM calls and file-level graph runs can execute
concurrently, configurable via two environment variables:

| Variable | Default | What it bounds |
|---|---|---|
| `LLM_SEMAPHORE` | `3` | Concurrent LLM calls — **only enforced when `LLM_PROVIDER=ollama`** |
| `FILE_SEMAPHORE` | `5` | Concurrent files being reviewed at once, per `/review` request |

### Why two separate limits

`LLM_SEMAPHORE` protects your GPU: Ollama runs on a single local GPU with
fixed VRAM, so uncontrolled concurrent requests can queue up unpredictably or
exhaust available memory. This limit wraps the actual LLM call site, so it
correctly bounds concurrency across every node in the graph — including the
specialist agents (bug/security/quality/performance) that fan out
concurrently within a single file's review.

For hosted providers (OpenAI, Groq, OpenRouter), `LLM_SEMAPHORE` is not
applied — their real constraint is a rate-over-time limit (requests/tokens
per minute), which a concurrency cap doesn't solve. Rate-limit handling for
these providers is instead done via automatic retry with backoff, reading the
`retry-after` header when present.

`FILE_SEMAPHORE` bounds how many files' worth of graph execution (diff
parsing, AST parsing, memory reads, taint tracing) run in parallel per
review request. This is a lighter-weight, general safeguard — not tied to a
specific hardware constraint — useful mainly for very large PRs.

### Tuning `LLM_SEMAPHORE`

If you're running Ollama locally, set this based on your GPU's VRAM and the
model size in use — start conservative (2–3) and increase only if you've
confirmed via `nvidia-smi` (or Task Manager on Windows) that VRAM usage stays
well within budget at higher values. Too high a value risks OOM or degraded
performance under concurrent requests; too low unnecessarily serializes work
that your hardware could otherwise handle in parallel.

```dotenv
# In .env
LLM_SEMAPHORE=3
FILE_SEMAPHORE=5
```

## Getting Started

### Prerequisites
- Docker & Docker Compose
- NVIDIA GPU + drivers (for local Ollama inference; optional if using a hosted provider)

### Setup

1. Clone the repo and copy the environment template:
```bash
git clone https://github.com/AryanPatil4506/CodeReviewer.git
cd CodeReviewer
cp .env.example .env
```

2. Fill in `.env` with your LangSmith API key, `GITHUB_TOKEN`, and choose your `LLM_PROVIDER` (`ollama`, `openai`, `groq`, or `openrouter`).
3. Build and run:
```bash
docker compose up --build
```
   On first run, the Ollama container will pull the required models before the app becomes healthy — this can take a few minutes depending on model size.

4. The API is available at `http://localhost:8000` (Swagger UI at `http://localhost:8000/docs`).

### Using OpenRouter

Set `LLM_PROVIDER=openrouter` and configure:

```dotenv
OPENROUTER_API_KEY=your_key_here
OPENROUTER_CLASSIFIER=your_model_id
OPENROUTER_JUDGE_MODEL=your_model_id
OPENROUTER_SPECIALIST_MODEL=your_model_id
OPENROUTER_DEFAULT_MODEL=your_model_id
```

> **Free-tier models (`:free` suffix) may be used for training by the
> underlying provider.** Do not send proprietary code, secrets, or sensitive
> data through `:free` model IDs. Paid OpenRouter model IDs on the same key
> are not subject to this. See `.env.example` for full provider terms and
> links (NVIDIA NIM / OpenRouter free-tier data usage notices).

### Example request

Submit a real GitHub PR by URL and pull number — Code Reviewer fetches everything else
(diff, file contents, repo tree) itself:

```bash
curl -X POST http://localhost:8000/review \
  -H "Content-Type: application/json" \
  -d '{
    "github_url": "https://github.com/your-org/your-repo",
    "pull_number": "12"
  }'
```

Or via Swagger UI at `http://localhost:8000/docs`: open the `POST /review` endpoint,
click **Try it out**, and fill in the same two fields (`github_url`, `pull_number`).

The response streams back per changed file — each file's section is separated by a
`--- {filename} ---` header, with any files that failed to fetch or process (e.g. a
syntax error, or a GitHub fetch failure) surfaced first under a `Failed:` block before
the successful reviews stream in.

## MCP Server

Code Reviewer's review pipeline is also exposed as an **MCP (Model Context Protocol)
server**, so it can be called directly from an MCP client — Claude Desktop, an IDE
integration, or another agent — as a tool, without going through the HTTP API.

### Tools

| Tool | Description |
|---|---|
| `review_pr` | Runs the full multi-agent review pipeline against a GitHub PR. Reviews changed files with bounded concurrency and partial-failure tolerance, so one file's error doesn't block the rest. |
| `check_cross_file_taint` | Runs cross-file taint tracing in isolation against a GitHub PR, without the full specialist-agent review pipeline. |

Both tools share the same underlying LangGraph pipeline, GitHub integration, and
Chroma memory store as the main `app` service — findings and memory are consistent
regardless of whether a review was triggered via the HTTP API or an MCP tool call.

### Running via Docker Compose

The MCP server runs as its own service (`mcp-server`) in `docker-compose.yml`,
alongside `app` and `ollama`. It shares the `ollama` service (for local inference) and
the `chroma_data` named volume (for persistent memory) with the main app — no separate
setup needed beyond the `.env` configuration already described above.

```bash
docker compose build mcp-server
```

Since MCP servers communicate over stdio rather than HTTP, `mcp-server` isn't meant to
be started standalone via `docker compose up` — it's spawned on demand by the MCP
client itself, per the client config below.

### Connecting from Claude Desktop

Add the following to your Claude Desktop config (typically at
`%APPDATA%\Claude\claude_desktop_config.json` on Windows, or the equivalent
`claude_desktop_config.json` path on macOS/Linux):

```json
{
  "mcpServers": {
    "codereviewer": {
      "command": "docker",
      "args": [
        "compose",
        "-f", "/absolute/path/to/CodeReviewer/docker-compose.yml",
        "run", "--rm", "-i",
        "mcp-server"
      ]
    }
  }
}
```

Restart Claude Desktop after saving. The `review_pr` and `check_cross_file_taint`
tools will then be available directly in conversation.

## Graph Visualizer

Watch a PR review run through your real LangGraph pipeline, node by node,
live: `start → diff_parser → ast_parser → memory_reader → cross-taint →
task_classifier → agent_dispatcher → [bug/security/quality/performance
agents, Send()-routed] → aggregator → judge_agent → output_formatter →
memory_writer`.

This is not a demo. The backend calls your actual compiled graph via
`graph.astream(..., stream_mode="updates")` — no simulated timings, no
fake output. What you see is what the graph actually did.

---


### 1. Run it locally (no Docker) — do this first

```bash
cd CodeReviewer
pip install -r requirements.txt                    # your existing deps
pip install -r visualizer/backend/requirements.txt  # the small delta: sqlalchemy, aiosqlite, websockets

cd visualizer/backend
uvicorn viz_app.main:app --reload --port 8001
```

In a second terminal:

```bash
cd CodeReviewer/visualizer/frontend
npm install
npm run dev       # opens on http://localhost:5173, proxies API calls to :8001
```

Open `http://localhost:5173`, type in a GitHub PR URL and a PR number, hit
**Start Execution**, and watch it run.

**Env vars it needs** (same ones your MCP server / FastAPI app already
use — nothing new): `GITHUB_TOKEN` and whichever LLM provider vars your
`model_factory.py` reads (Ollama running locally, or `GROQ_API_KEY` /
`OPENAI_API_KEY` / etc.), plus ChromaDB pointed at the same path your main
app uses if you want memory-reader context to show up as non-empty.

A PR can touch multiple files. **Start Execution** reviews just the first
file — good for a quick look at one graph run. **All Files**, next to it,
queues every changed file and runs them one after another (this is what
was missing before: previously only one file ever ran, and LangSmith only
ever showed one trace, because the engine picked exactly one file and
stopped there). Each file's run is live-viewable via the History drawer,
now labeled by filename instead of a bare UUID.

---

### 2. Run it with Docker

Merge the two services in `visualizer/docker-compose.snippet.yml` into
your **existing** `CodeReviewer/docker-compose.yml` (don't replace your
file — the snippet reuses your `ollama` service and `chroma_data` volume).
Also add `visualizer_data:` to your top-level `volumes:` block.

Then, from the repo root:

```bash
docker compose up --build visualizer-backend visualizer-frontend
```

- Backend: `http://localhost:8001`
- Frontend: `http://localhost:3000`

Your existing `app` service keeps port `8000` — no conflict.

---

### 3. API, if you want to drive it without the UI

```bash
# Start a run for one file (the first file in the diff, by default)
curl -X POST http://localhost:8001/api/executions \
  -H "Content-Type: application/json" \
  -d '{"github_url": "https://github.com/AryanPatil4506/CodeReviewer", "pull_no": "1", "file": "handler_sink.py"}'
# -> {"run_id": "...", "status": "pending", ...}

# Review EVERY changed file in the PR (queues one run per file, run
# sequentially on the backend - not concurrently, see the docstring on
# execution_engine.py::start_pr_review for why)
curl -X POST http://localhost:8001/api/executions/pr \
  -H "Content-Type: application/json" \
  -d '{"github_url": "https://github.com/AryanPatil4506/CodeReviewer", "pull_no": "1"}'
# -> {"runs": [{"run_id": "...", "file": "handler_sink.py"}, {"run_id": "...", "file": "helper_source.py"}, ...]}

# Poll it
curl http://localhost:8001/api/executions/<run_id>

# Or list everything (History drawer uses this - each entry now has a
# `label` like "owner/repo - path/to/file.py" instead of a bare UUID)
curl http://localhost:8001/api/executions

# Or stream it live
wscat -c ws://localhost:8001/ws/executions/<run_id>

# Pause / resume / cancel
curl -X POST http://localhost:8001/api/executions/<run_id>/pause
curl -X POST http://localhost:8001/api/executions/<run_id>/resume
curl -X POST http://localhost:8001/api/executions/<run_id>/cancel

# Static graph metadata (nodes/edges, for the canvas layout)
curl http://localhost:8001/api/graph
```

---

### 4. What each node status means on the canvas

| Status | Meaning |
|---|---|
| `pending` | Hasn't run yet |
| `running` | LangGraph is currently executing it |
| `completed` | Ran, no `agent_errors` in its state delta |
| `failed` | Ran, but returned `agent_errors` (matches `bug_agent.py`'s real error shape: `{agent, file, error}`) |
| `skipped` | **New status added for this integration.** `agent_dispatcher` didn't `Send()` to this node on this particular run — expected for 3 of the 4 specialist agents on most PRs, since `task_classifier` usually only routes to 1–2 |

If the whole run fails before the graph even starts (bad PR URL, GitHub
rate limit, etc.), every node is marked `failed` rather than sitting at
`pending` forever — this was a real bug in an earlier pass, since fixed
and covered by a test.

---


### 5. If you change your graph later

Two files are the only ones coupled to your graph's specific shape:

- `visualizer/backend/viz_app/graph_definition.py` — the static node/edge
  list used purely for canvas layout. Add/remove/rename a node here if you
  add/remove/rename one in `graph_builder.py`.
- `visualizer/backend/viz_app/execution_engine.py` — the `_run` method's
  `inputs = {...}` dict must match whatever keys your graph's entry state
  actually expects (currently: `repo_id`, `input`, `repo_url_fetch`,
  `repo_tree`, `head_sha`, matching `construct_review_req`'s output).

Everything else (scheduler, WebSocket broadcast, DB persistence, the React
canvas) is graph-shape-agnostic and shouldn't need touching.

## Project Structure

```
app/
├── main.py               # FastAPI entrypoint, PR-fetch orchestration, per-file streaming
├── graph/                 # LangGraph nodes and graph wiring
│   ├── agents/             # bug, security, quality, performance agents
│   └── ...
├── taint/                  # cross-file, cross-repo taint tracing engine
├── mcp_server/              # MCP server exposing review_pr and check_cross_file_taint as tools
│   ├── main.py                # FastMCP server entrypoint
│   ├── Dockerfile              # standalone image, imports shared app/ modules
│   └── pyproject.toml           # isolated uv project, pinned dependencies
├── memory.py               # ChromaDB read/write
├── model_factory.py        # provider-agnostic model loading (Ollama, OpenAI, Groq, OpenRouter)
├── schemas.py              # request models, GitHub error hierarchy, PR-fetch construction
└── visualizer/             # live LangGraph execution visualizer (FastAPI + React)
docker-compose.yml
Dockerfile
```

## Roadmap

- [x] Core multi-agent review pipeline
- [x] Cross-file taint tracing
- [x] Docker containerization
- [x] GitHub PR API integration — automatic fetching of PR diffs, file contents, and cross-repo imports, replacing manual file copying
- [x] **MCP server** — `review_pr` and `check_cross_file_taint` exposed as MCP tools, containerized and verified end-to-end via Claude Desktop
- [x] **Token-optimized output formatting** — windowed, merged diff context for the diff-assembly LLM call instead of full-file content
- [x] **OpenRouter provider support** — added as a fourth LLM provider alongside Ollama, OpenAI, and Groq
- [x] **Bounded, provider-aware LLM concurrency** — call-level semaphore for Ollama, rate-limit backoff for hosted providers
- [x] **Frontend** — lightweight UI for submitting a PR link and viewing streamed review output
- [ ] Model-aware prompt optimization to further reduce token usage by dynamically adjusting prompt complexity based on the selected model
- [ ] QLoRA fine-tuning exploration

## License

MIT
