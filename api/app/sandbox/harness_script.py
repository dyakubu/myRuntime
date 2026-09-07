"""Executes one untrusted function call and reports the result as JSON.

Runs standalone (invoked as a subprocess by a SandboxRunner, either directly or via the
Cloud Run `sandbox do` CLI) so it has no imports from the rest of the app.

Reads a JSON payload from stdin: {"code": str, "entry_point": str, "args": object}
Writes exactly one JSON line to stdout: {"ok": true, "result": ...} or {"ok": false, "error": str}
"""

import contextlib
import io
import json
import sys


def main() -> None:
    payload = json.loads(sys.stdin.read())
    code = payload["code"]
    entry_point = payload["entry_point"]
    args = payload.get("args", {})

    namespace: dict = {}
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            exec(code, namespace)  # noqa: S102 - this is the whole point of a code runner
            fn = namespace[entry_point]
            result = fn(**args)
        print(json.dumps({"ok": True, "result": result}))
    except Exception as exc:  # noqa: BLE001 - deliberately broad, reports back any failure
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))


if __name__ == "__main__":
    main()
