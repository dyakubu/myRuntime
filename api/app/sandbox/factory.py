import os

from .base import SandboxRunner
from .cloud_run_runner import CloudRunSandboxRunner
from .local_runner import LocalSubprocessRunner

_RUNNERS = {
    "local": LocalSubprocessRunner,
    "cloud_run_sandbox": CloudRunSandboxRunner,
}


def get_runner() -> SandboxRunner:
    """RUNNER_BACKEND selects local (dev/test) vs cloud_run_sandbox (real isolation).
    Defaults to local so the app runs out of the box without a Cloud Run environment;
    production deploys must set RUNNER_BACKEND=cloud_run_sandbox explicitly."""
    backend = os.environ.get("RUNNER_BACKEND", "local")
    try:
        runner_cls = _RUNNERS[backend]
    except KeyError as exc:
        raise ValueError(f"unknown RUNNER_BACKEND {backend!r}, expected one of {sorted(_RUNNERS)}") from exc
    return runner_cls()
