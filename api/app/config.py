import os

# "*" is fine for a single-user, no-auth personal tool with no server-held secrets to
# protect (see docs/myruntime-v0-spec.md §3) — restrict via CORS_ORIGINS once a real
# frontend origin exists, e.g. "https://myruntime.example.com,http://localhost:5500".
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

# Cloud Run sandboxes don't document a built-in execution timeout (see
# docs/myruntime-cloud-run-research.md §2) — this is what actually bounds a runaway
# reference solution or user submission.
SANDBOX_TIMEOUT_S = float(os.environ.get("SANDBOX_TIMEOUT_S", "10"))
