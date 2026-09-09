"""Covers "class"-kind (stateful, multi-method) problems end to end — construct once,
call a sequence of operations against the instance — alongside the plain-function path
already covered by test_verify.py/test_submissions.py."""

import copy
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "graph.json").read_text())
client = TestClient(app)


def _verified_suite(fixture=FIXTURE):
    resp = client.post("/api/verify", json=fixture)
    assert resp.status_code == 200
    return resp.json()


def _case(body, case_id):
    return next(c for c in body["test_cases"] if c["id"] == case_id)


# ---------- /api/verify ----------


def test_verify_all_stateful_cases_pass():
    body = _verified_suite()
    assert body["verification_status"] == "ok"
    assert body["error_count"] == 0
    assert body["verified_count"] == len(FIXTURE["test_cases"])
    for case in body["test_cases"]:
        assert case["verified"] is True
        assert case["operations"] is not None


def test_verify_computes_expected_output_per_operation():
    body = _verified_suite()
    triangle = _case(body, "triangle")
    outputs = [op["expected_output"] for op in triangle["operations"]]
    assert outputs == [True, True, True, [1, 2, 3]]


def test_verify_empty_graph_case():
    body = _verified_suite()
    empty = _case(body, "empty_graph")
    assert empty["verified"] is True
    assert empty["operations"][0]["expected_output"] == []


def test_verify_self_loop_and_unknown_vertex_cases():
    body = _verified_suite()
    self_loop = _case(body, "self_loop")
    assert [op["expected_output"] for op in self_loop["operations"]] == [True, False]

    unknown = _case(body, "unknown_vertex_query")
    assert unknown["operations"][0]["expected_output"] is False


def test_verify_zero_operations_case_passes_vacuously():
    fixture = copy.deepcopy(FIXTURE)
    fixture["test_cases"] = [
        {
            "id": "no_ops",
            "category": "edge",
            "description": "construct only, no queries",
            "input_mode": "literal",
            "input": {"vertices": [1], "edges": []},
            "operations": [],
        }
    ]
    body = _verified_suite(fixture)
    case = _case(body, "no_ops")
    assert case["verified"] is True
    assert case["operations"] == []


def test_verify_stops_at_first_failing_step_and_reports_which_method():
    fixture = copy.deepcopy(FIXTURE)
    fixture["test_cases"] = [c for c in fixture["test_cases"] if c["id"] == "triangle"]
    fixture["reference_solution"]["code"] = (
        "class Graph:\n"
        "    def __init__(self, vertices, edges):\n"
        "        self._vertices = list(vertices)\n"
        "        self._index = {v: i for i, v in enumerate(self._vertices)}\n"
        "        n = len(self._vertices)\n"
        "        self._matrix = [[False] * n for _ in range(n)]\n"
        "        for u, v in edges:\n"
        "            if u in self._index and v in self._index:\n"
        "                i, j = self._index[u], self._index[v]\n"
        "                self._matrix[i][j] = True\n"
        "                self._matrix[j][i] = True\n"
        "        self._calls = 0\n"
        "\n"
        "    def has_edge(self, u, v):\n"
        "        self._calls += 1\n"
        "        if self._calls == 3:\n"
        "            raise RuntimeError('boom')\n"
        "        i, j = self._index[u], self._index[v]\n"
        "        return self._matrix[i][j]\n"
        "\n"
        "    def get_vertices(self):\n"
        "        return list(self._vertices)\n"
    )
    body = _verified_suite(fixture)
    assert body["verification_status"] == "partial"
    triangle = _case(body, "triangle")
    assert triangle["verified"] is False
    assert triangle["error"] == "has_edge: RuntimeError: boom"
    # the 2 operations before the raising 3rd call survived; get_vertices (4th) never ran
    assert len(triangle["operations"]) == 2


def test_verify_flags_broken_constructor():
    fixture = copy.deepcopy(FIXTURE)
    fixture["reference_solution"]["code"] = "class Graph:\n    def __init__(self, vertices, edges):\n        raise ValueError('ctor boom')\n"
    body = _verified_suite(fixture)
    assert body["verification_status"] == "partial"
    assert body["error_count"] == len(FIXTURE["test_cases"])
    for case in body["test_cases"]:
        assert case["verified"] is False
        assert "ctor boom" in case["error"]
        assert case["operations"] is None


def test_verify_flags_non_serializable_step_result():
    fixture = copy.deepcopy(FIXTURE)
    fixture["test_cases"] = [c for c in fixture["test_cases"] if c["id"] == "triangle"]
    fixture["reference_solution"]["code"] = (
        "class Graph:\n"
        "    def __init__(self, vertices, edges):\n"
        "        self._vertices = list(vertices)\n"
        "\n"
        "    def has_edge(self, u, v):\n"
        "        return self\n"  # bug: returns the instance instead of a bool
        "\n"
        "    def get_vertices(self):\n"
        "        return list(self._vertices)\n"
    )
    body = _verified_suite(fixture)
    triangle = _case(body, "triangle")
    assert triangle["verified"] is False
    assert "has_edge" in triangle["error"]
    assert "not JSON serializable" in triangle["error"] or "TypeError" in triangle["error"]
    assert triangle["operations"] == []


def test_verify_plain_function_cases_have_no_operations_field():
    two_sum = json.loads((Path(__file__).parent / "fixtures" / "two_sum.json").read_text())
    resp = client.post("/api/verify", json=two_sum)
    body = resp.json()
    for case in body["test_cases"]:
        assert case["operations"] is None


# ---------- /api/submissions ----------


def test_submission_correct_class_passes_all_steps():
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
    for r in body["results"]:
        assert r["passed"] is True
        assert all(s["passed"] for s in r["steps"])


def test_submission_wrong_class_fails_specific_steps_without_crashing():
    suite = _verified_suite()
    wrong_code = (
        "class Graph:\n"
        "    def __init__(self, vertices, edges):\n"
        "        self._vertices = list(vertices)\n"
        "\n"
        "    def has_edge(self, u, v):\n"
        "        return False\n"  # bug: never reports an edge
        "\n"
        "    def get_vertices(self):\n"
        "        return list(self._vertices)\n"
    )
    payload = {
        "function_signature": FIXTURE["function_signature"],
        "code": wrong_code,
        "test_cases": suite["test_cases"],
    }
    resp = client.post("/api/submissions", json=payload)
    body = resp.json()
    triangle = next(r for r in body["results"] if r["id"] == "triangle")
    assert triangle["passed"] is False
    has_edge_steps = [s for s in triangle["steps"] if s["method"] == "has_edge"]
    assert all(s["passed"] is False and s["actual_output"] is False and s["expected_output"] is True for s in has_edge_steps)
    get_vertices_step = next(s for s in triangle["steps"] if s["method"] == "get_vertices")
    assert get_vertices_step["passed"] is True

    empty = next(r for r in body["results"] if r["id"] == "empty_graph")
    assert empty["passed"] is True  # get_vertices is correct even with the has_edge bug


def test_submission_crashing_class_reports_error_with_partial_steps():
    suite = _verified_suite()
    missing_method_code = (
        "class Graph:\n"
        "    def __init__(self, vertices, edges):\n"
        "        self._vertices = list(vertices)\n"
        "\n"
        "    def has_edge(self, u, v):\n"
        "        return True\n"
        # no get_vertices defined at all
    )
    payload = {
        "function_signature": FIXTURE["function_signature"],
        "code": missing_method_code,
        "test_cases": suite["test_cases"],
    }
    resp = client.post("/api/submissions", json=payload)
    body = resp.json()
    empty = next(r for r in body["results"] if r["id"] == "empty_graph")
    assert empty["passed"] is False
    assert "get_vertices" in empty["error"]
    assert "AttributeError" in empty["error"]

    triangle = next(r for r in body["results"] if r["id"] == "triangle")
    assert triangle["passed"] is False
    # the 3 has_edge calls succeed (wrongly, but without raising); get_vertices (4th) crashes
    assert len(triangle["steps"]) == 4
    assert triangle["steps"][-1]["error"] is not None


def test_submission_broken_constructor_reports_case_level_error():
    suite = _verified_suite()
    payload = {
        "function_signature": FIXTURE["function_signature"],
        "code": "class Graph:\n    def __init__(self, vertices, edges):\n        raise ValueError('ctor boom')\n",
        "test_cases": suite["test_cases"],
    }
    resp = client.post("/api/submissions", json=payload)
    body = resp.json()
    assert body["passed_count"] == 0
    for r in body["results"]:
        assert r["passed"] is False
        assert "ctor boom" in r["error"]
        assert r["steps"] == []
