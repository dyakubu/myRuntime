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
