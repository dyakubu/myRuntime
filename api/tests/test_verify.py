import copy
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "two_sum.json").read_text())

client = TestClient(app)


def test_verify_all_cases_pass():
    resp = client.post("/api/verify", json=FIXTURE)
    assert resp.status_code == 200
    body = resp.json()
    assert body["verification_status"] == "ok"
    assert body["error_count"] == 0
    assert body["verified_count"] == len(FIXTURE["test_cases"])
    for case in body["test_cases"]:
        assert case["verified"] is True
        assert case["expected_output"] is not None


def test_verify_computes_expected_output_for_literal_case():
    resp = client.post("/api/verify", json=FIXTURE)
    body = resp.json()
    example = next(c for c in body["test_cases"] if c["id"] == "example_1")
    assert example["expected_output"] == [0, 1]


def test_verify_flags_broken_reference_solution():
    broken = copy.deepcopy(FIXTURE)
    broken["reference_solution"]["code"] = "def two_sum(nums, target):\n    raise ValueError('boom')\n"
    resp = client.post("/api/verify", json=broken)
    body = resp.json()
    assert body["verification_status"] == "partial"
    assert body["error_count"] == len(FIXTURE["test_cases"])
    assert all(not c["verified"] for c in body["test_cases"])
    assert all("ValueError" in c["error"] for c in body["test_cases"])


def test_verify_generated_case_uses_seeded_length():
    resp = client.post("/api/verify", json=FIXTURE)
    body = resp.json()
    stress = next(c for c in body["test_cases"] if c["id"] == "stress_large_n")
    assert len(stress["input"]["nums"]) == 10000
    assert stress["verified"] is True


def test_verify_unbuildable_case_is_a_case_error_not_a_500():
    """A literal case with no input is schema-valid but can't be materialized — it must
    come back as a per-case error, not an unhandled 500 with an empty body."""
    broken = copy.deepcopy(FIXTURE)
    broken["test_cases"] = [{"id": "no_input", "category": "example", "input_mode": "literal"}]
    resp = client.post("/api/verify", json=broken)
    assert resp.status_code == 200
    body = resp.json()
    assert body["verification_status"] == "partial"
    case = body["test_cases"][0]
    assert case["verified"] is False
    assert "no input" in case["error"]
