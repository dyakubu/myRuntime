from typing import Any, Literal

from pydantic import BaseModel


class Parameter(BaseModel):
    name: str
    type: str


class FunctionSignature(BaseModel):
    name: str
    parameters: list[Parameter]
    return_type: str


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


class TestCase(BaseModel):
    id: str
    category: str
    description: str | None = None
    input_mode: Literal["literal", "generated"]
    input: dict[str, Any] | None = None
    generator: GeneratorSpec | None = None
    fixed_params: dict[str, Any] | None = None


class VerifyRequest(BaseModel):
    problem: dict[str, Any] | None = None
    function_signature: FunctionSignature
    constraints: dict[str, Any] | None = None
    reference_solution: ReferenceSolution
    test_cases: list[TestCase]
    generation_meta: dict[str, Any] | None = None


class VerifiedTestCase(BaseModel):
    id: str
    category: str
    input: dict[str, Any]
    expected_output: Any = None
    verified: bool
    error: str | None = None


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


class TestCaseResult(BaseModel):
    id: str
    passed: bool
    input: dict[str, Any]
    expected_output: Any = None
    actual_output: Any = None
    error: str | None = None
    runtime_s: float


class SubmissionResponse(BaseModel):
    results: list[TestCaseResult]
    passed_count: int
    total_count: int
