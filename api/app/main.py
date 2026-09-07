import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import CORS_ORIGINS
from .logging_utils import log_metric
from .routers import health, submissions, verify

app = FastAPI(title="myruntime-api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    log_metric(
        "http_request",
        route=request.url.path,
        status=response.status_code,
        duration_s=round(time.perf_counter() - start, 4),
    )
    return response


app.include_router(health.router)
app.include_router(verify.router)
app.include_router(submissions.router)

# Simplest answer to "where does the frontend live" (still open per
# docs/myruntime-v0-spec.md §3/§11): serve it from this same service when the web/
# directory is sitting next to api/, so local dev and a single-Cloud-Run-service deploy
# both work with zero CORS setup. Nothing stops the frontend moving to its own static
# host later — CORS_ORIGINS exists for exactly that.
_WEB_DIR = Path(__file__).resolve().parents[2] / "web"
if _WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_WEB_DIR), html=True), name="web")
