from .base import HARNESS_PATH, SandboxRunner


class CloudRunSandboxRunner(SandboxRunner):
    """Runs the harness inside a Cloud Run sandbox via the `sandbox` CLI.

    Requires the service to be deployed with --sandbox-launcher on the 2nd-generation
    execution environment. See docs/myruntime-cloud-run-research.md for what that flag
    does and what isolation it provides.
    """

    def _command(self) -> list[str]:
        # Sandboxes don't inherit the host container's env (including PATH), so the
        # interpreter must be an absolute path rather than a bare "python3" lookup.
        return ["sandbox", "do", "--", "/usr/bin/python3", str(HARNESS_PATH)]
