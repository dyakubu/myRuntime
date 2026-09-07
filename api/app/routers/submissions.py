import time

from fastapi import APIRouter

from ..config import SANDBOX_TIMEOUT_S
from ..logging_utils import log_metric
from ..models import SubmissionRequest, SubmissionResponse, TestCaseResult
from ..sandbox.factory import get_runner

router = APIRouter()
runner = get_runner()


@router.post("/api/submissions", response_model=SubmissionResponse)
def submit(payload: SubmissionRequest) -> SubmissionResponse:
    results: list[TestCaseResult] = []
    total_start = time.perf_counter()

    for case in payload.test_cases:
        if not case.verified:
            # No known-good expected_output for a case the reference solution errored on.
            continue

        case_start = time.perf_counter()
        result = runner.run(
            code=payload.code,
            entry_point=payload.function_signature.name,
            args=case.input,
            timeout=SANDBOX_TIMEOUT_S,
        )
        runtime_s = round(time.perf_counter() - case_start, 4)
        passed = result.ok and result.result == case.expected_output

        results.append(
            TestCaseResult(
                id=case.id,
                passed=passed,
                input=case.input,
                expected_output=case.expected_output,
                actual_output=result.result if result.ok else None,
                error=None if result.ok else result.error,
                runtime_s=runtime_s,
            )
        )
        log_metric("test_case_result", result="pass" if passed else "fail")

    duration = time.perf_counter() - total_start
    log_metric("sandbox_execution", endpoint="submissions", duration_s=round(duration, 4))

    passed_count = sum(1 for r in results if r.passed)
    return SubmissionResponse(results=results, passed_count=passed_count, total_count=len(results))
