import time

from fastapi import APIRouter

from ..config import SANDBOX_TIMEOUT_S
from ..logging_utils import log_metric
from ..models import VerifiedTestCase, VerifyRequest, VerifyResponse
from ..sandbox.factory import get_runner
from ..test_generators import materialize_input

router = APIRouter()
runner = get_runner()


@router.post("/api/verify", response_model=VerifyResponse)
def verify(payload: VerifyRequest) -> VerifyResponse:
    """Self-check only in v0 — runs reference_solution against every test case in the
    sandbox and trusts its output as expected_output. Catches the solution crashing on
    its own test data; can't catch it running cleanly and being wrong. See
    docs/myruntime-v0-spec.md §6."""
    checked: list[VerifiedTestCase] = []
    start = time.perf_counter()

    for case in payload.test_cases:
        args = materialize_input(case)
        result = runner.run(
            code=payload.reference_solution.code,
            entry_point=payload.function_signature.name,
            args=args,
            timeout=SANDBOX_TIMEOUT_S,
        )
        if result.ok:
            checked.append(
                VerifiedTestCase(
                    id=case.id,
                    category=case.category,
                    input=args,
                    expected_output=result.result,
                    verified=True,
                )
            )
        else:
            checked.append(
                VerifiedTestCase(
                    id=case.id,
                    category=case.category,
                    input=args,
                    expected_output=None,
                    verified=False,
                    error=result.error,
                )
            )
            log_metric(
                "solution_self_check_error",
                topic=(payload.problem or {}).get("topics", [None])[0] if payload.problem else None,
                difficulty=(payload.problem or {}).get("difficulty") if payload.problem else None,
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
