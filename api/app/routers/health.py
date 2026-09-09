from fastapi import APIRouter

router = APIRouter()


# Deliberately not /healthz: Google Frontend shadows that exact path on run.app domains
# and answers it with its own 404, so the route never reaches the container and is
# useless for external uptime checks. /api/health is not intercepted.
@router.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
