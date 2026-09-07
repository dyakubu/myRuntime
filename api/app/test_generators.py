import random
from typing import Any

from .models import TestCase


def _random_int_array(case: TestCase) -> dict[str, Any]:
    spec = case.generator
    assert spec is not None
    rng = random.Random(spec.seed)
    lo, hi = spec.value_range
    array = [rng.randint(lo, hi) for _ in range(spec.length)]
    args = dict(case.fixed_params or {})
    args[spec.param] = array
    return args


_GENERATORS = {
    "random_int_array": _random_int_array,
}


def materialize_input(case: TestCase) -> dict[str, Any]:
    """Builds the concrete function-call arguments for one test case."""
    if case.input_mode == "literal":
        if case.input is None:
            raise ValueError(f"test case {case.id!r} is input_mode=literal but has no input")
        return case.input

    if case.generator is None:
        raise ValueError(f"test case {case.id!r} is input_mode=generated but has no generator")
    try:
        generator_fn = _GENERATORS[case.generator.type]
    except KeyError as exc:
        raise ValueError(f"unknown generator type {case.generator.type!r}") from exc
    return generator_fn(case)
