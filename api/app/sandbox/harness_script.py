"""Executes one untrusted function (or class) call and reports the result as JSON.

Runs standalone (invoked as a subprocess by a SandboxRunner, either directly or via the
Cloud Run `sandbox do` CLI) so it has no imports from the rest of the app.

Reads a JSON payload from stdin:
  {"code": str, "entry_point": str, "args": object, "operations": [op, ...] | null}

Without "operations": `entry_point` is called once as a plain function with `args` as
kwargs, and its return value is `result` — unchanged from the original protocol.

With "operations": `entry_point` is a class. `args` are its constructor kwargs; each
`op` is {"method": str, "args": object} and is called against the built instance in
order. `result` becomes a list of per-step envelopes, e.g.
  [{"ok": true, "result": ...}, {"ok": false, "error": str}, ...]
stopping at the first failing step (state may be invalid afterward, so later steps
aren't attempted) — the outer envelope is still exactly one line either way.

Writes exactly one JSON line to stdout: {"ok": true, "result": ...} or {"ok": false, "error": str}
"""

import contextlib
import io
import json
import sys


def _check_returnable(value: object) -> object:
    """Results are compared and shipped as JSON, so a set/tuple/object return can't be
    graded. Raise here with a message naming the offending type, rather than letting a
    bare 'Object of type X is not JSON serializable' surface from the outer envelope."""
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        raise TypeError(
            f"returned a {type(value).__name__}, which can't cross the sandbox boundary — "
            "return a list, dict, or plain value instead"
        ) from None
    return value


def _run_operations(built: object, operations: list[dict]) -> list[dict]:
    steps = []
    for op in operations:
        try:
            method = getattr(built, op["method"])
            step_result = _check_returnable(method(**op.get("args", {})))
            steps.append({"ok": True, "result": step_result})
        except Exception as exc:  # noqa: BLE001 - reported per-step, not fatal to earlier steps
            steps.append({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
            break
    return steps


def main() -> None:
    payload = json.loads(sys.stdin.read())
    code = payload["code"]
    entry_point = payload["entry_point"]
    args = payload.get("args", {})
    operations = payload.get("operations")

    namespace: dict = {}
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            exec(code, namespace)  # noqa: S102 - this is the whole point of a code runner
            target = namespace[entry_point]
            built = target(**args)
            # Same guard on both paths: a plain function's return value has to be
            # representable too, and used to fail as an opaque error from json.dumps
            # below rather than something the solver could act on.
            result = _run_operations(built, operations) if operations is not None else _check_returnable(built)
        print(json.dumps({"ok": True, "result": result}))
    except Exception as exc:  # noqa: BLE001 - deliberately broad, reports back any failure
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))


if __name__ == "__main__":
    main()
