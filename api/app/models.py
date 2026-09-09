from typing import Any, Literal

from pydantic import BaseModel


class Parameter(BaseModel):
    name: str
    type: str


class MethodSignature(BaseModel):
    name: str
    parameters: list[Parameter]
    return_type: str


class FunctionSignature(BaseModel):
    name: str
    parameters: list[Parameter]
    return_type: str
    # "class" problems (Graph, LRU Cache, Trie, ...) construct one instance via `name`
    # (parameters as constructor kwargs) and exercise it through `methods` — see
    # `Operation` below. Everything defaults to plain-function behavior unchanged.
    kind: Literal["function", "class"] = "function"
    methods: list[MethodSignature] | None = None


class ReferenceSolution(BaseModel):
    language: str = "python"
    code: str
    expected_time_complexity: str | None = None
    expected_space_complexity: str | None = None


class GeneratorSpec(BaseModel):
    type: str
    param: str
    length: int
    value_range: tuple[int, int]
    seed: int


class Operation(BaseModel):
    """One method call in a stateful test case's sequence, run against the instance
    constructed from the TestCase's own `input`."""

    method: str
    args: dict[str, Any] = {}


class TestCase(BaseModel):
    id: str
    category: Literal["example", "edge", "stress"]
    description: str | None = None
    input_mode: Literal["literal", "generated"]
    input: dict[str, Any] | None = None
    generator: GeneratorSpec | None = None
    fixed_params: dict[str, Any] | None = None
    # Present only for "class"-kind problems: `input` builds the instance, then each
    # operation runs against it in order. None/absent means an ordinary function call.
    operations: list[Operation] | None = None


class VerifyRequest(BaseModel):
    problem: dict[str, Any] | None = None
    function_signature: FunctionSignature
    constraints: dict[str, Any] | None = None
    reference_solution: ReferenceSolution
    test_cases: list[TestCase]
    generation_meta: dict[str, Any] | None = None


class VerifiedOperation(BaseModel):
    method: str
    args: dict[str, Any] = {}
    expected_output: Any = None


class VerifiedTestCase(BaseModel):
    id: str
    category: str
    input: dict[str, Any]
    expected_output: Any = None
    verified: bool
    error: str | None = None
    operations: list[VerifiedOperation] | None = None


class VerifyResponse(BaseModel):
    problem: dict[str, Any] | None = None
    function_signature: FunctionSignature
    constraints: dict[str, Any] | None = None
    generation_meta: dict[str, Any] | None = None
    test_cases: list[VerifiedTestCase]
    verification_status: Literal["ok", "partial"]
    verified_count: int
    error_count: int
    total_count: int


class SubmissionRequest(BaseModel):
    function_signature: FunctionSignature
    code: str
    test_cases: list[VerifiedTestCase]


class StepResult(BaseModel):
    method: str
    args: dict[str, Any] = {}
    expected_output: Any = None
    actual_output: Any = None
    passed: bool
    error: str | None = None


class TestCaseResult(BaseModel):
    id: str
    passed: bool
    input: dict[str, Any]
    expected_output: Any = None
    actual_output: Any = None
    error: str | None = None
    runtime_s: float
    # Present only for "class"-kind problems — one entry per operation, in order.
    # `passed`/`actual_output`/`expected_output`/`error` above remain a case-level
    # summary (passed = all steps passed) so a client ignoring `steps` still works.
    steps: list[StepResult] | None = None


class SubmissionResponse(BaseModel):
    results: list[TestCaseResult]
    passed_count: int
    total_count: int
