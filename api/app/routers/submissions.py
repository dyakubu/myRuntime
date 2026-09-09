import time

from fastapi import APIRouter

from ..config import SANDBOX_TIMEOUT_S
from ..logging_utils import log_metric
from ..models import StepResult, SubmissionRequest, SubmissionResponse, TestCaseResult, VerifiedOperation
from ..sandbox.factory import get_runner

router = APIRouter()
runner = get_runner()


def _grade_operations(
    operations: list[VerifiedOperation], step_envelopes: list[dict]
) -> tuple[bool, list[StepResult], str | None]:
    """step_envelopes is the harness's per-step result list — shorter than
    operations exactly when a step raised (later steps never ran)."""
    steps: list[StepResult] = []
    case_error: str | None = None
    for vo, envelope in zip(operations, step_envelopes):
        if envelope.get("ok"):
            actual = envelope.get("result")
            steps.append(
                StepResult(
                    method=vo.method, args=vo.args, expected_output=vo.expected_output, actual_output=actual, passed=actual == vo.expected_output
                )
            )
        else:
            case_error = f"{vo.method}: {envelope.get('error')}"
            steps.append(
                StepResult(method=vo.method, args=vo.args, expected_output=vo.expected_output, passed=False, error=envelope.get("error"))
            )
            break
    passed = case_error is None and len(steps) == len(operations) and all(s.passed for s in steps)
    return passed, steps, case_error


@router.post("/api/submissions", response_model=SubmissionResponse)
def submit(payload: SubmissionRequest) -> SubmissionResponse:
    results: list[TestCaseResult] = []
    total_start = time.perf_counter()

    for case in payload.test_cases:
        if not case.verified:
            # No known-good expected_output for a case the reference solution errored on.
            continue

        case_start = time.perf_counter()
        # is-not-None, not truthiness — see the matching note in verify.py.
        operations = [{"method": vo.method, "args": vo.args} for vo in case.operations] if case.operations is not None else None
        result = runner.run(
            code=payload.code,
            entry_point=payload.function_signature.name,
            args=case.input,
            timeout=SANDBOX_TIMEOUT_S,
            operations=operations,
        )
        runtime_s = round(time.perf_counter() - case_start, 4)

        if case.operations is not None:
            if result.ok:
                passed, steps, case_error = _grade_operations(case.operations, result.result)
            else:
                passed, steps, case_error = False, [], result.error
            results.append(
                TestCaseResult(
                    id=case.id,
                    passed=passed,
                    input=case.input,
                    error=case_error,
                    runtime_s=runtime_s,
                    steps=steps,
                )
            )
        else:
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

        if passed:
            log_metric("test_case_result", result="pass", case_id=case.id)
        else:
            log_metric(
                "test_case_result",
                level="error",
                result="fail",
                case_id=case.id,
                input=case.input,
                error=results[-1].error,
                actual_output=results[-1].actual_output,
                expected_output=case.expected_output,
            )

    duration = time.perf_counter() - total_start
    log_metric("sandbox_execution", endpoint="submissions", duration_s=round(duration, 4))

    passed_count = sum(1 for r in results if r.passed)
    return SubmissionResponse(results=results, passed_count=passed_count, total_count=len(results))
