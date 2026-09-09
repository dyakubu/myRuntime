# Stage 1: build the React frontend. Its output is static — nothing from this stage
# ships in the final image except frontend/dist, so node never reaches production.
FROM node:22-alpine AS frontend-build
WORKDIR /build
# Copy manifests first so `npm ci` is cached unless dependencies actually change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim

# The Cloud Run sandbox (docs/myruntime-cloud-run-research.md) mounts a read-only view
# of this container's root filesystem for the sandboxed process, and does not inherit
# this container's env — including PATH. cloud_run_runner.py therefore invokes the
# interpreter by absolute path (/usr/bin/python3) rather than relying on PATH lookup.
# This image's python3 lives at /usr/local/bin (the official python image's layout), so
# symlink it into /usr/bin as well to match.
RUN ln -s /usr/local/bin/python3 /usr/bin/python3

WORKDIR /app

COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY api/app api/app
# main.py serves this at "/" — the path must stay /app/frontend/dist to match its
# parents[2]/"frontend"/"dist" resolution.
COPY --from=frontend-build /build/dist frontend/dist

WORKDIR /app/api

# Cloud Run injects PORT; default here only matters for `docker run` outside Cloud Run.
ENV PORT=8080
EXPOSE 8080

# RUNNER_BACKEND defaults to "local" (see app/sandbox/factory.py) — set
# RUNNER_BACKEND=cloud_run_sandbox at deploy time (e.g. `gcloud run deploy
# --set-env-vars RUNNER_BACKEND=cloud_run_sandbox --sandbox-launcher
# --execution-environment=gen2`), it's a deploy-time concern, not baked in here.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
