import time

from fastapi import APIRouter

from ..config import SANDBOX_TIMEOUT_S
from ..logging_utils import log_metric
from ..models import VerifiedOperation, VerifiedTestCase, VerifyRequest, VerifyResponse
from ..sandbox.factory import get_runner
from ..test_generators import materialize_input

router = APIRouter()
runner = get_runner()


def _log_self_check_error(payload: VerifyRequest, case_id: str, category: str, error: str | None, args: dict) -> None:
    log_metric(
        "solution_self_check_error",
        level="error",
        case_id=case_id,
        category=category,
        error=error,
        input=args,
        topic=(payload.problem or {}).get("topics", [None])[0] if payload.problem else None,
        difficulty=(payload.problem or {}).get("difficulty") if payload.problem else None,
    )


@router.post("/api/verify", response_model=VerifyResponse)
def verify(payload: VerifyRequest) -> VerifyResponse:
    """Self-check only in v0 — runs reference_solution against every test case in the
    sandbox and trusts its output as expected_output. Catches the solution crashing on
    its own test data; can't catch it running cleanly and being wrong. See
    docs/myruntime-v0-spec.md §6."""
    checked: list[VerifiedTestCase] = []
    start = time.perf_counter()

    for case in payload.test_cases:
        # A case can be schema-valid yet unbuildable (input_mode "literal" with no
        # input, an unknown generator type). That's bad model output, not a server
        # fault — report it as a per-case error instead of raising a 500 whose empty
        # body gives the client's retry loop nothing to feed back.
        try:
            args = materialize_input(case)
        except ValueError as exc:
            checked.append(
                VerifiedTestCase(id=case.id, category=case.category, input={}, verified=False, error=str(exc))
            )
            _log_self_check_error(payload, case.id, case.category, str(exc), {})
            continue

        # is-not-None, not truthiness: an empty operations list ([]) is still a stateful
        # case (construct-only, no queries) and must not fall through to the plain-
        # function path below just because it's falsy.
        operations = [op.model_dump() for op in case.operations] if case.operations is not None else None
        result = runner.run(
            code=payload.reference_solution.code,
            entry_point=payload.function_signature.name,
            args=args,
            timeout=SANDBOX_TIMEOUT_S,
            operations=operations,
        )

        if not result.ok:
            checked.append(
                VerifiedTestCase(id=case.id, category=case.category, input=args, verified=False, error=result.error)
            )
            _log_self_check_error(payload, case.id, case.category, result.error, args)
            continue

        if case.operations is not None:
            # result.result is the harness's list of per-step envelopes — see
            # harness_script.py. It's shorter than case.operations exactly when a step
            # failed partway through (later steps were never attempted).
            steps: list[VerifiedOperation] = []
            case_error: str | None = None
            for op, step in zip(case.operations, result.result):
                if step.get("ok"):
                    steps.append(VerifiedOperation(method=op.method, args=op.args, expected_output=step.get("result")))
                else:
                    case_error = f"{op.method}: {step.get('error')}"
                    break
            all_ok = case_error is None and len(steps) == len(case.operations)
            checked.append(
                VerifiedTestCase(
                    id=case.id,
                    category=case.category,
                    input=args,
                    verified=all_ok,
                    error=case_error,
                    operations=steps,
                )
            )
            if not all_ok:
                _log_self_check_error(payload, case.id, case.category, case_error, args)
        else:
            checked.append(
                VerifiedTestCase(id=case.id, category=case.category, input=args, expected_output=result.result, verified=True)
            )

    duration = time.perf_counter() - start
    log_metric("sandbox_execution", endpoint="verify", duration_s=round(duration, 4))

    verified_count = sum(1 for c in checked if c.verified)
    error_count = len(checked) - verified_count

    return VerifyResponse(
        problem=payload.problem,
        function_signature=payload.function_signature,
        constraints=payload.constraints,
        generation_meta=payload.generation_meta,
        test_cases=checked,
        verification_status="ok" if error_count == 0 else "partial",
        verified_count=verified_count,
        error_count=error_count,
        total_count=len(checked),
    )
