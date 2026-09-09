import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

HARNESS_PATH = Path(__file__).with_name("harness_script.py")


@dataclass
class RunResult:
    ok: bool
    result: Any = None
    error: str | None = None


class SandboxRunner:
    """Runs one untrusted function call via the harness script and returns its result.

    Subclasses only supply the command used to invoke the harness — everything about
    talking to it (passing the payload over stdin, parsing the JSON envelope back,
    timeout/not-found handling) lives here once.
    """

    def _command(self) -> list[str]:
        raise NotImplementedError

    def run(
        self,
        code: str,
        entry_point: str,
        args: dict[str, Any],
        timeout: float,
        operations: list[dict[str, Any]] | None = None,
    ) -> RunResult:
        # `operations` present means `entry_point` is a class: `args` are constructor
        # kwargs, and the harness runs each operation against the built instance in
        # turn, returning `result` as a list of per-step envelopes instead of one value
        # — see harness_script.py. The envelope this method parses is unchanged either
        # way: still exactly one {"ok":.., "result"|"error":..} line.
        payload = json.dumps({"code": code, "entry_point": entry_point, "args": args, "operations": operations})
        try:
            proc = subprocess.run(
                self._command(),
                input=payload,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return RunResult(ok=False, error=f"timeout after {timeout}s")
        except FileNotFoundError as exc:
            return RunResult(ok=False, error=f"runner command not found: {exc}")

        if proc.returncode != 0:
            return RunResult(ok=False, error=proc.stderr.strip() or f"exited with status {proc.returncode}")

        try:
            envelope = json.loads(proc.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return RunResult(ok=False, error=f"malformed output: {proc.stdout!r}")

        if envelope.get("ok"):
            return RunResult(ok=True, result=envelope.get("result"))
        return RunResult(ok=False, error=envelope.get("error", "unknown error"))
