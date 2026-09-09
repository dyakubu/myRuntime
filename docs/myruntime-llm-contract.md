# MyRuntime — LLM Response Contract (v3: single-model generation)

Python only. One generation call (client-side), one execution/self-check pass (server-side, no LLM involved). LLM B and cross-model verification are deferred to v1 — see `myruntime-v0-spec.md` §2 and §11.

## Pipeline shape

```
Browser: LLM A (user's own key, Anthropic or Gemini)
raw problem text
   + generate()
        │
        ▼
function_signature
reference_solution_A
test_case inputs
        │
        ▼
POST /api/verify  (no LLM call — sandbox only)
        │
        ▼
Sandbox: execute reference_solution_A on every
test case (literal + generated)
        │
        ▼
Per test case:  did it run, or did it raise/time out?
  ran        → expected_output = whatever it returned, verified: true
  errored    → excluded, verified: false, error message kept for the UI
        │
        ▼
verification_status: "ok" | "partial"
surfaced in the UI before the suite is trusted
```

This is a **self-check**, not cross-verification: it confirms the reference solution doesn't crash on its own test data, but if it runs cleanly and is simply *wrong*, nothing here catches that. That gap is what LLM B was designed to close and is explicitly deferred — see the v0 spec.

---

## Stage 1 — LLM A (client-side, user's own key)

Python-only type strings throughout (`int`, `float`, `str`, `bool`, `List[int]`, `List[List[int]]`, `Dict[str,int]`).

Provider and model are chosen by the user from a restricted dropdown (Anthropic or Gemini — see `myruntime-v0-spec.md` §5); the prompt sent to whichever model is selected asks it to return exactly this JSON shape.

Test cases are all `"literal"` for now: exactly 3 `"example"` cases plus as many `"edge"` cases as the model can find (general — empty/single-element/all-duplicate/min-max/negative/etc. — and problem-specific), each with a one-line `"description"` of what it's meant to catch. `"stress"`/`"generated"` cases are paused out of the prompt while a better way to exercise time complexity is decided (a single huge generated array only proves the reference solution finishes inside the sandbox timeout, and its materialized input round-trips back to the browser in full in the `/api/verify` response — not a great signal, and not free). The `generated`/`GeneratorSpec` machinery in Stage 2 below is left in place either way.

```json
{
  "problem": {
    "title": "string",
    "difficulty": "easy | medium | hard",
    "topics": ["array", "two-pointers"],
    "normalized_statement": "cleaned markdown version of the pasted text"
  },
  "function_signature": {
    "name": "two_sum",
    "parameters": [
      { "name": "nums", "type": "List[int]" },
      { "name": "target", "type": "int" }
    ],
    "return_type": "List[int]"
  },
  "constraints": {
    "raw": "2 <= nums.length <= 10^4, -10^9 <= nums[i] <= 10^9",
    "input_bounds": {
      "nums": { "length_min": 2, "length_max": 10000, "value_min": -1000000000, "value_max": 1000000000 },
      "target": { "value_min": -2000000000, "value_max": 2000000000 }
    }
  },
  "reference_solution": {
    "language": "python",
    "code": "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []",
    "expected_time_complexity": "O(n)",
    "expected_space_complexity": "O(n)"
  },
  "test_cases": [
    {
      "id": "example_1",
      "category": "example",
      "description": "given example from the problem statement",
      "input_mode": "literal",
      "input": { "nums": [2, 7, 11, 15], "target": 9 }
    },
    {
      "id": "edge_duplicates",
      "category": "edge",
      "description": "duplicate values, correct pair must use distinct indices",
      "input_mode": "literal",
      "input": { "nums": [3, 3], "target": 6 }
    }
  ],
  "generation_meta": {
    "provider": "anthropic | gemini",
    "model": "string — whichever model the user selected",
    "prompt_version": "v1",
    "warnings": []
  }
}
```

The client validates this shape before doing anything with it (required fields present, `test_cases` non-empty, etc.) — a model that returns malformed JSON should surface a clear "generation failed, try again" error rather than being sent on to `/api/verify`. If it *is* malformed or gets rejected by `/api/verify`, the client retries a bounded number of times, feeding the model its own bad output plus the specific error back as a corrective follow-up turn, before giving up — see `myruntime-v0-spec.md`.

### Stateful (`"class"`-kind) problems

Most problems are `"function"` kind (the shape above): call one function once, compare its return value. Some interview problems — "design a Graph/LRU Cache/Trie/Union-Find" — inherently need state that persists across multiple calls, with no single meaningful return value at all. `function_signature.kind: "class"` covers these: `name` is the class name, `parameters` are the constructor's kwargs, and `methods` lists every query method (`{name, parameters, return_type}`). Each test case's `input` still builds the instance (same as a `"function"` case's call args), but adds `operations`: a `{method, args}` sequence run against that one instance, in order — no `expected_output` anywhere in what the model emits; the backend computes each step's expected result by running `reference_solution` itself, exactly as it does for the top-level `expected_output` in a plain-function case.

```json
{
  "function_signature": {
    "name": "Graph",
    "kind": "class",
    "parameters": [
      { "name": "vertices", "type": "List" },
      { "name": "edges", "type": "List[tuple]" }
    ],
    "return_type": "Graph",
    "methods": [
      { "name": "has_edge", "parameters": [{ "name": "u", "type": "Any" }, { "name": "v", "type": "Any" }], "return_type": "bool" },
      { "name": "get_vertices", "parameters": [], "return_type": "List" }
    ]
  },
  "reference_solution": {
    "language": "python",
    "code": "class Graph:\n    def __init__(self, vertices, edges):\n        ...\n\n    def has_edge(self, u, v):\n        ...\n\n    def get_vertices(self):\n        ..."
  },
  "test_cases": [
    {
      "id": "triangle",
      "category": "example",
      "description": "triangle graph, every pair connected",
      "input_mode": "literal",
      "input": { "vertices": [1, 2, 3], "edges": [[1, 2], [2, 3], [1, 3]] },
      "operations": [
        { "method": "has_edge", "args": { "u": 1, "v": 2 } },
        { "method": "get_vertices", "args": {} }
      ]
    }
  ]
}
```

One rule applies to both kinds: only JSON-native types (`int`/`float`/`str`/`bool`/`list`/`dict`/`None`) may cross a parameter or return boundary — a tree or linked list is represented as a plain nested list, with any node objects built privately inside `reference_solution.code`, never passed in or returned directly.

---

## Stage 2 — sandbox self-check (server-side, `POST /api/verify`)

**Request body:** `function_signature`, `reference_solution`, `test_cases` from Stage 1 (the rest of the Stage 1 payload — `problem`, `constraints`, `generation_meta` — is echoed back unchanged; the backend doesn't need it to do the self-check, but round-trips it so the client doesn't have to stitch state back together).

For each test case: materialize the input (literal cases as given; generated cases built from their `generator` spec using the fixed `seed`), then run `reference_solution.code` against it inside a Cloud Run sandbox — a plain function call for a `"function"`-kind case, or construct-then-run-each-operation for a `"class"`-kind one.

**Ran successfully (`"function"`-kind):**
```json
{
  "id": "example_1",
  "category": "example",
  "input": { "nums": [2, 7, 11, 15], "target": 9 },
  "expected_output": [0, 1],
  "verified": true
}
```

**Raised or timed out (`"function"`-kind):**
```json
{
  "id": "edge_case_x",
  "category": "edge",
  "input": { "...": "..." },
  "expected_output": null,
  "verified": false,
  "error": "IndexError: list index out of range"
}
```

**`"class"`-kind case:** each operation's expected output is filled in the same way, per step, in `operations`. A step that raises stops the sequence there — `operations` ends up shorter than what the model asked for, and `error` names which method failed:
```json
{
  "id": "triangle",
  "category": "example",
  "input": { "vertices": [1, 2, 3], "edges": [[1, 2], [2, 3], [1, 3]] },
  "verified": true,
  "operations": [
    { "method": "has_edge", "args": { "u": 1, "v": 2 }, "expected_output": true },
    { "method": "get_vertices", "args": {}, "expected_output": [1, 2, 3] }
  ]
}
```
```json
{
  "id": "triangle",
  "verified": false,
  "error": "has_edge: RuntimeError: boom",
  "operations": [
    { "method": "has_edge", "args": { "u": 1, "v": 2 }, "expected_output": true }
  ]
}
```

`/api/submissions` grades a `"class"`-kind case the same way: it re-runs the same `operations` sequence against the submitted class and compares each step's actual output to the `expected_output` already captured above, reporting a `steps` list (`{method, args, expected_output, actual_output, passed, error}`) alongside the case's overall pass/fail.

## Suite-level status

```json
{
  "verification_status": "ok | partial",
  "verified_count": 8,
  "error_count": 1,
  "total_count": 9
}
```

`partial` means at least one test case made the reference solution error out — surface this clearly in the UI (e.g. a "8/9 checked — 1 case errored" badge with the errored case's message shown, not silently dropped) before the user trusts the suite. An errored case is excluded from what `/api/submissions` grades against, since there's no known-good `expected_output` for it.

---

## What changed from the original cross-model design

The earlier version of this contract (v2) had LLM A generate client-side and a server-held LLM B independently re-solve the same problem, with the sandbox running both solutions and diffing outputs — disagreement meant a case got excluded and logged, agreement meant the shared output became `expected_output`. That's deferred, not deleted: the schema shape here (`verified` per case, suite-level status with counts, excluded-and-flagged rather than silently dropped) is deliberately kept close to that design so reintroducing LLM B later is a matter of adding a second sandbox run and an agree/disagree check, not restructuring the contract. See `myruntime-v0-spec.md` §11.
