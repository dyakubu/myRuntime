import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Default pydantic errors are a deeply nested detail array — fine for a developer,
    # unreadable dropped straight into a status line. Flatten to "field.path: message"
    # strings so the frontend (and generateContract()'s retry-feedback loop) has
    # something a human, or a model correcting its own output, can act on directly.
    errors = [f"{'.'.join(str(p) for p in err['loc'] if p != 'body')}: {err['msg']}" for err in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


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
# docs/myruntime-v0-spec.md §3/§11): serve the built React app from this same service,
# so a single-Cloud-Run-service deploy works with zero CORS setup. In local dev the Vite
# server proxies /api here instead (frontend/vite.config.js), so this mount being absent
# before a build is fine. Nothing stops the frontend moving to its own static host later
# — CORS_ORIGINS exists for exactly that.
# No SPA catch-all is needed: view switching is React state, not client-side routing.
_WEB_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_WEB_DIR), html=True), name="web")
