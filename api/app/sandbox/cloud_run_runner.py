from .base import HARNESS_PATH, SandboxRunner


class CloudRunSandboxRunner(SandboxRunner):
    """Runs the harness inside a Cloud Run sandbox via the `sandbox` CLI.

    Requires the service to be deployed with --sandbox-launcher on the 2nd-generation
    execution environment. See docs/myruntime-cloud-run-research.md for what that flag
    does and what isolation it provides.
    """

    def _command(self) -> list[str]:
        return ["sandbox", "do", "--", "python3", str(HARNESS_PATH)]
