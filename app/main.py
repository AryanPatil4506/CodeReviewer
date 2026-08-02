from .graph.graph_builder import graph
from .schemas import GitReviewInfo, construct_review_req, GitHubPermanentError, GitHubRateLimitError, ConfigurationError, InvalidRequestError, FileEntry
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
import uuid
from collections import defaultdict
import asyncio
import os

async def stream_review(
        file: str,
        repo_id: str,
        entries: list[FileEntry],
        repo_url_fetch: str,
        repo_tree: set[str],
        head_sha: str,
        semaphore: asyncio.Semaphore,
):
    async with semaphore:
            config = {"configurable": {"thread_id": str(uuid.uuid4())}}
    
            yield f"\n\n--- {file} ---\n\n"
            async for token_chunk, metadata in graph.astream(
                {
                    'repo_id': repo_id, 
                    'input': [f.model_dump() for f in entries], 
                    'repo_url_fetch': repo_url_fetch, 
                    'repo_tree': repo_tree, 
                    'head_sha': head_sha
                },
                config=config,
                stream_mode="messages"
            ):
                if metadata.get("langgraph_node") == "output_formatter":
                    yield token_chunk.content



async def stream_review_loop(
        repo_id: str, 
        input_dict: dict, 
        failed_files: dict, 
        repo_url_fetch: str, 
        repo_tree: set[str], 
        head_sha: str
):
    semaphore = asyncio.Semaphore(int(os.getenv("FILE_SEMAPHORE", 5)))

    # Shared queue between producers and the consumer.
    # Producers push streamed review chunks here, while the outer loop
    # consumes them and yields them to the client as soon as they arrive.
    queue: asyncio.Queue = asyncio.Queue()

    DONE = object()    # sentinel object to track if every task (per file langgraph execution) is complete or not

    async def produce(file, entries):
        async for chunk in stream_review(
            file=file,
            repo_id=repo_id,
            entries=entries,
            repo_tree=repo_tree,
            repo_url_fetch=repo_url_fetch,
            head_sha=head_sha,
            semaphore=semaphore
        ):
            await queue.put(chunk)

    async def run_all():
        tasks = [
            asyncio.create_task(produce(file, entries))
            for file, entries in input_dict.items()
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
        await queue.put(DONE)

    runner = asyncio.create_task(run_all())

    if failed_files:
        for f in failed_files:
            yield f"""Failed:\n{f}\n{failed_files[f]}"""
            yield "\n\n------\n\n"

    # Waits for items from the queue and immediately streams them
    # to the caller. This continues until the DONE sentinel arrives.
    while True:
        item = await queue.get()
        if item is DONE:
            break
        yield item

    await runner    # Ensures the background producer task has completelt finished, propagate any exception, ensures a clean shutdown


app = FastAPI()

@app.post("/review")
def review(info: GitReviewInfo):
    try:
        request = construct_review_req(url=info.github_url, pull_number=info.pull_number)
    except GitHubPermanentError as e:
        raise HTTPException(status_code=e.status_code, detail=f"{e.args[0]} (url: {e.url})")
    except GitHubRateLimitError as e:
        raise HTTPException(status_code=503, detail=f"{e.args[0]} (url: {e.url})")
    except ConfigurationError as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
    except InvalidRequestError as e:
        raise HTTPException(status_code=400, detail=f"Error: {str(e)}")
    
    grouped_by_filename = defaultdict(list)
    for entry in request.input:
        grouped_by_filename[entry.file].append(entry)
    
    return StreamingResponse(
        stream_review_loop(
            repo_id=request.repo_id, 
            input_dict=grouped_by_filename, 
            failed_files=request.failed_files, 
            repo_url_fetch=request.repo_url_fetch, 
            repo_tree=request.repo_tree, 
            head_sha=request.head_sha
        ),
        media_type="text/plain"
    )