import sys

from .base import HARNESS_PATH, SandboxRunner


class LocalSubprocessRunner(SandboxRunner):
    """Dev/test convenience only — a plain local subprocess, no isolation whatsoever.

    Exists so /api/verify and /api/submissions are testable without a live Cloud Run
    instance. NEVER use this backend (RUNNER_BACKEND=local) for real user traffic —
    use CloudRunSandboxRunner (RUNNER_BACKEND=cloud_run_sandbox) for that.
    """

    def _command(self) -> list[str]:
        return [sys.executable, str(HARNESS_PATH)]
