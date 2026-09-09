import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "two_sum.json").read_text())
client = TestClient(app)


def _verified_suite():
    resp = client.post("/api/verify", json=FIXTURE)
    assert resp.status_code == 200
    return resp.json()


def test_submission_correct_solution_passes_all():
    suite = _verified_suite()
    payload = {
        "function_signature": FIXTURE["function_signature"],
        "code": FIXTURE["reference_solution"]["code"],
        "test_cases": suite["test_cases"],
    }
    resp = client.post("/api/submissions", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_count"] == len(suite["test_cases"])
    assert body["passed_count"] == body["total_count"]
    assert all(r["passed"] for r in body["results"])


def test_submission_wrong_solution_fails_with_details():
    suite = _verified_suite()
    wrong_code = "def two_sum(nums, target):\n    return [-1, -1]\n"
    payload = {
        "function_signature": FIXTURE["function_signature"],
        "code": wrong_code,
        "test_cases": suite["test_cases"],
    }
    resp = client.post("/api/submissions", json=payload)
    body = resp.json()
    assert body["passed_count"] == 0
    assert body["total_count"] == len(suite["test_cases"])
    example = next(r for r in body["results"] if r["id"] == "example_1")
    assert example["passed"] is False
    assert example["actual_output"] == [-1, -1]
    assert example["expected_output"] == [0, 1]


def test_submission_crashing_solution_reports_error_not_exception():
    suite = _verified_suite()
    crashing_code = "def two_sum(nums, target):\n    return 1 / 0\n"
    payload = {
        "function_signature": FIXTURE["function_signature"],
        "code": crashing_code,
        "test_cases": suite["test_cases"],
    }
    resp = client.post("/api/submissions", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["passed_count"] == 0
    assert all("ZeroDivisionError" in r["error"] for r in body["results"])


def test_submission_stdout_is_returned_for_print_debugging():
    suite = _verified_suite()
    code = "def two_sum(nums, target):\n    print('saw', len(nums))\n    return [0, 1]\n"
    resp = client.post(
        "/api/submissions",
        json={"function_signature": FIXTURE["function_signature"], "code": code, "test_cases": suite["test_cases"]},
    )
    body = resp.json()
    assert body["results"][0]["stdout"].startswith("saw ")


def test_submission_stdout_survives_a_crash():
    """What the solution printed before blowing up is usually the most useful thing it
    produced, so it has to ship alongside the error."""
    suite = _verified_suite()
    code = "def two_sum(nums, target):\n    print('got here')\n    return 1 / 0\n"
    resp = client.post(
        "/api/submissions",
        json={"function_signature": FIXTURE["function_signature"], "code": code, "test_cases": suite["test_cases"]},
    )
    first = resp.json()["results"][0]
    assert "got here" in first["stdout"]
    assert "ZeroDivisionError" in first["error"]


def test_submission_stops_at_first_timeout_instead_of_grinding_through_every_case():
    """A timeout is a property of the submission, not of one case — running the rest
    would just cost timeout x N seconds to learn the same thing."""
    import app.routers.submissions as subs

    original = subs.SANDBOX_TIMEOUT_S
    subs.SANDBOX_TIMEOUT_S = 1
    try:
        suite = _verified_suite()
        gradable = [c for c in suite["test_cases"] if c["verified"]]
        assert len(gradable) > 1, "fixture needs multiple cases for this to mean anything"
        resp = client.post(
            "/api/submissions",
            json={
                "function_signature": FIXTURE["function_signature"],
                "code": "def two_sum(nums, target):\n    while True:\n        pass\n",
                "test_cases": suite["test_cases"],
            },
        )
        body = resp.json()
        assert body["status"] == "timeout"
        assert body["total_count"] == 1
        assert body["not_run_count"] == len(gradable) - 1
    finally:
        subs.SANDBOX_TIMEOUT_S = original
