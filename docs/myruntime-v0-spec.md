# MyRuntime — v0 Spec

Companion to `myruntime-llm-contract.md`, which covers the full JSON schema for LLM A's output and the sandbox self-check pass. This doc covers everything around that contract: endpoints, deployment, observability, and — just as importantly — what's deliberately *not* in v0.

---

## 1. What v0 is

A personal, single-user coding-practice tool: paste a problem (CTCI, a textbook, wherever), get a LeetCode-style environment for it — function signature, sandbox-checked test cases, pass/fail feedback — write and run Python solutions against it.

## 2. Explicit scope boundaries

**In scope for v0:**
- Python only
- Single user, no auth
- Single-model generation: LLM A runs client-side, in the browser, with the user's own API key (see §5) — no server-side LLM call at all in v0
- Sandbox self-check on A's reference solution (runs it against its own test cases server-side, catches cases where it errors out) — see §6. Not cross-model verification; that's deferred (below).
- Structured-log-based metrics from day one (see §7) — no in-process counters, no scrape endpoint
- Client-side caching only, no backend persistence

**Explicitly deferred — don't build these yet:**
- Java / multi-language support
- LLM B / cross-model verification entirely (the original design: a second, server-side-keyed model independently re-solves the problem and disagreements get excluded/logged). Scoped out of v0 to ship something working faster. Revisit once single-model generation quality has been used enough to know whether it's actually needed.
- OpenAI (or any provider that doesn't support direct browser calls) as an LLM A option — would require a backend relay endpoint that forwards the user's key per-request; real scope addition, not a v0 fit. See §5.
- Cross-device history or any real database (revisit only if IndexedDB's single-browser limitation actually becomes a problem in practice)
- Auth / multi-user support
- Solve-history analytics ("show me every graph problem I've failed")

This list exists so scope creep has something concrete to point at. If a feature isn't in "in scope," it's not v0 — full stop, park it.

---

## 3. Tech stack & architecture

- **Backend:** FastAPI, deployed to Cloud Run (`min-instances=0`, `max-instances=1` — scale-to-zero is fine now that metrics don't live in process memory, see §7). Holds no LLM API key at all in v0 (LLM A is client-side/BYOK, LLM B doesn't exist yet) — its only job is running untrusted Python through **Cloud Run sandboxes**. See §8 and the companion `myruntime-cloud-run-research.md` for how that works and what it relies on.
- **Frontend:** React + Vite with a CodeMirror 6 editor, in `frontend/` — see §9 for why this replaced the original vanilla-JS/no-build-step plan. Light/dark theme toggle, **defaulting to dark**. It builds to static assets that the API serves itself (same-origin, no CORS setup); `VITE_API_BASE` is the escape hatch if the frontend ever moves to its own host.
- **Cross-origin:** since frontend hosting isn't decided, don't assume same-origin. Enable CORS on the FastAPI app for the frontend's origin(s). If a same-origin setup happens later (e.g. a reverse proxy in front of both, or the API serving the static files itself), CORS config can be relaxed then — but the backend shouldn't be built assuming that from the start.

```
┌──────────────────────────────┐
│ Browser (hosting TBD)        │
│                              │
│ ┌────────────────────────┐   │
│ │ LLM A call (user's key)│   │
│ │ Anthropic or Gemini,    │  │
│ │ direct from browser     │  │
│ │ → signature,            │  │
│ │   reference_solution_A  │  │
│ │ → test case inputs      │  │
│ └────────────────────────┘   │
│                              │
│ ┌────────────────────────┐   │
│ │ IndexedDB cache          │ │
│ │ keyed by problem hash    │ │
│ └────────────────────────┘   │
└──────────────────────────────┘

        │  HTTPS  (CORS if cross-origin)
        ▼

┌──────────────────────────────┐
│ Cloud Run: myruntime-api     │
│ (min=0, max=1 instances)     │
│ FastAPI — holds no LLM key   │
│                              │
│ POST /api/verify             │
│   → sandbox: self-check A's  │
│     reference solution       │
│   → returns checked suite    │
│                              │
│ POST /api/submissions        │
│   → sandbox: run user code   │
│   → returns pass/fail        │
│                              │
│ GET /healthz                 │
│                              │
│ structured JSON logs → stdout│
│   → Cloud Logging (auto)     │
│   → log-based metrics        │
└──────────────────────────────┘
```

---

## 4. Endpoints

### `POST /api/verify`
Called once per problem, right after LLM A finishes generating in-browser.

- **In:** normalized problem text, LLM A's `function_signature`, `reference_solution_A`, `test_cases` (literal + generated specs)
- **Does:** executes `reference_solution_A` against every test case in the sandbox — no LLM call, no second model. This is a *self-check*, not cross-verification: it catches the reference solution crashing on its own test data (e.g. an off-by-one on an edge case it wrote itself), but it can't catch a case where the solution runs cleanly and is just wrong.
- **Out:** enriched test suite — `expected_output` filled in per case that ran successfully, cases where the reference solution errored are excluded and flagged, suite-level `verification_status` (`ok` / `partial`) with counts

Full schema: see `myruntime-llm-contract.md`.

### `POST /api/submissions`
Called on every "Run" click while the user iterates on their code. No LLM calls — purely sandbox execution, so it should be fast.

- **In:** user's code, the checked test suite from `/verify` (client sends it back each time — backend is stateless, holds nothing)
- **Out:** pass/fail per test case; for failing cases, input / actual output / expected output; runtime per case

### `GET /healthz`
Trivial liveness check for Cloud Run.

---

## 5. LLM A: client-side generation

LLM A is the only model in v0's pipeline (LLM B is deferred — see §2). It runs entirely in the browser with the user's own API key; the backend never sees it and never holds an LLM key of its own.

**Supported providers — Anthropic and Gemini only.** Both were verified (empirically, via direct request testing, not just docs) to support unauthenticated-by-origin, key-authenticated calls straight from browser JavaScript:
- **Anthropic:** requires the `anthropic-dangerous-direct-browser-access: true` request header. Without it, Anthropic still processes the request server-side but omits `Access-Control-Allow-Origin` from the response, so the browser discards it before any JS sees it — the header is what opts the *response* into being CORS-readable, not what makes the request itself succeed.
- **Gemini:** works with a plain `fetch()` — `generativelanguage.googleapis.com` reflects whatever `Origin` sent the request back in `Access-Control-Allow-Origin`, no special header needed.
- **OpenAI is explicitly not supported in v0.** Its preflight `OPTIONS` response looks permissive, but the actual `POST` response carries no `Access-Control-Allow-Origin` header at all — the browser blocks reading it despite the request reaching OpenAI's server. Making OpenAI work would need a backend relay (forward the user's key through our server per-request, never persisted/logged) — a real v1 addition, not a v0 fit.

Access control for both supported providers is by API key, not by origin — neither requires whitelisting a specific domain anywhere, which is what makes "hosting not yet decided" (§3) a non-issue for LLM A specifically: whatever domain the frontend ends up on works with zero provider-side configuration.

**Model selection is a restricted dropdown, not free text.** The whole pipeline depends on the model reliably returning valid JSON matching the Stage 1a contract; a free-text field risks a typo'd model ID or a weak/deprecated model that doesn't follow structured-output instructions well. Each provider gets a short curated list of known-good current models with one preselected default. Adding a model later is a one-line change to the frontend's provider config, not a UI change.

**Key storage:** the user pastes their own API key into a settings panel; it's stored in `localStorage`, scoped to whichever origin the frontend is served from, and is only ever attached to requests going directly to the provider's API — never sent to `myruntime-api`.

---

## 6. Sandbox self-check policy (v0)

- After LLM A generates in-browser, the client sends `reference_solution_A` and `test_cases` to `POST /api/verify`.
- The sandbox executes `reference_solution_A` once per test case (literal cases as given, generated cases materialized from their generator spec).
- **Runs successfully** → `expected_output` set to whatever it returned, case marked `verified: true`.
- **Raises or times out** → case excluded from the suite returned to the user, suite marked `partial: true`, an `error` message attached, and a `solution_self_check_error` event logged.
- This is strictly weaker than the original cross-model design — it can catch "the reference solution is broken" but not "the reference solution runs cleanly and is just wrong." That gap is exactly what LLM B was for, and exactly why it's listed as a deferred v1 feature rather than declared solved.

---

## 7. Observability

No Prometheus, no `/metrics` endpoint, no in-process counters — none of that survives `min-instances=0` cleanly, since a scale-to-zero restart wipes anything held in memory and there's no guarantee something's alive for a scraper to hit. Instead: emit one **structured JSON line to stdout** per event of interest. Cloud Run captures stdout/stderr into **Cloud Logging** automatically, regardless of instance lifecycle — no app code needed for that part, and it works the same whether the instance has been up for a week or was cold-started thirty seconds ago.

Each log line carries a `metric` field naming the event, plus whatever labels/value it needs, e.g.:

```json
{"metric": "http_request", "route": "/api/verify", "status": 200, "duration_s": 0.42}
{"metric": "sandbox_execution", "endpoint": "submissions", "duration_s": 0.51}
{"metric": "solution_self_check_error", "topic": "arrays", "difficulty": "medium"}
{"metric": "test_case_result", "result": "fail"}
```

Metrics to derive from these via **Cloud Logging log-based metrics** (counters count matching log entries; distributions extract a numeric field like `duration_s`):

| Metric | Kind | Source event / value field |
|---|---|---|
| `http_requests_total` | Counter | `metric="http_request"`, labels `route`, `status` |
| `http_request_duration_seconds` | Distribution | `metric="http_request"`, value `duration_s`, label `route` |
| `sandbox_execution_duration_seconds` | Distribution | `metric="sandbox_execution"`, value `duration_s`, label `endpoint` |
| `myruntime_solution_self_check_error_total` | Counter | `metric="solution_self_check_error"`, labels `topic`, `difficulty` (optional) |
| `test_case_results_total` | Counter | `metric="test_case_result"`, label `result` |

Log-based metrics are defined once (console, `gcloud logging metrics create`, or Terraform) and live in Cloud Logging/Monitoring independent of the Cloud Run instance — they keep accumulating correctly across cold starts and scale-to-zero gaps, which is the property in-memory Prometheus counters couldn't give us. Viewable directly in Cloud Monitoring, or through Grafana via the Cloud Monitoring data source if that's preferred later.

`min-instances=0, max-instances=1`: no reason to keep an idle instance running anymore now that metrics don't depend on it. `max=1` still holds — no need for more than one instance at this traffic scale, and it keeps the mental model (and sandbox resource sizing) simple. Trade-off: the first request after an idle period pays a cold start (roughly 200ms–2s depending on image size), which is fine for a personal, low-traffic tool.

---

## 8. Persistence

No database. Backend is fully stateless — every request carries whatever state it needs (the checked suite gets sent back to `/submissions` by the client, not looked up server-side).

Client caches `/verify` responses in **IndexedDB**, keyed by a content hash (SHA-256) of the normalized problem statement, so re-opening a problem doesn't re-trigger generation or the sandbox self-check. Known limitation: tied to one browser profile on one device — acceptable for v0, revisit only if that actually bites in practice.

---

## 9. UI

**React + Vite, with CodeMirror 6 as the editor**, in `frontend/`. This revises the original "vanilla JS, no build tooling" instruction: the product §1 promises is a LeetCode-style *solve environment*, and the two things that actually make it one — a real code editor and a stateful run/results console — are exactly what a plain `<textarea>` and hand-rolled DOM updates can't deliver. A `<textarea>` in particular can't do syntax highlighting or even hold the Tab key, which is disqualifying for the tool's core interaction.

- Built by Vite into `frontend/dist` and served by the API itself (`api/app/main.py` mounts it at `/`), so production is same-origin and needs no CORS setup. `npm run dev` proxies `/api` to a local uvicorn so dev matches prod. The Dockerfile builds the frontend in a `node:22-alpine` stage and copies only `dist` into the Python image.
- No client-side router — the landing/solve switch is React state, so `StaticFiles(html=True)` is sufficient and no SPA catch-all is needed.
- Light/dark theme toggle, **defaulting to dark**, via CSS custom properties + a `data-theme` attribute, persisted in `localStorage`.
- Provider / model / API key settings panel for LLM A (see §5) — restricted dropdowns, password-style key input, persisted in `localStorage`.

### Layout

Landing screen (paste a problem → Generate, or load the built-in example) gives way to the solve view: problem and examples on the left, editor over a tabbed console (**Testcase** / **Result**) on the right, with a draggable split.

**Run** grades only the visible example cases — a fast feedback loop. **Submit** grades the full verified suite. Both post to the same stateless `/api/submissions`; the only difference is which `test_cases` the client sends.

### Display policy (client-side convention, not a security boundary)

The `/verify` response contains the reference solution and every expected output — nothing is technically hidden, since it's a single-user tool with no adversary. The client still chooses not to render most of it, because seeing it destroys the exercise:

- **Reference solution: never rendered.** Not collapsed behind a disclosure — simply not in the UI.
- **Only `category === "example"` cases are shown** (the prompt guarantees exactly 3), rendered as Example 1/2/3 with input and expected output, the way LeetCode does. The count of hidden tests is shown; their inputs, descriptions and ids are not.
- Edge-case `description` fields are especially sensitive: the prompt asks for one edge case per scenario the model can think of, each with a specific label ("negative value in the middle of the array"). Listing them hands over precisely the reasoning the exercise exists to provoke.
- **On a failing case — including a hidden one — show input / your output / expected output** for that case. Finding out what broke you is the point of Submit. Passing cases stay collapsed so a green run doesn't dump the whole suite.

---

## 10. Sandbox execution

Uses **Cloud Run sandboxes** (public preview since July 2026), not a hand-built gVisor/microVM setup. Full research notes: `myruntime-cloud-run-research.md`.

- Requires the Cloud Run resource to run on the **2nd-generation execution environment**.
- Enabled on `myruntime-api` via the `--sandbox-launcher` deployment flag (currently a `gcloud beta` flag). This mounts a `sandbox` CLI binary in the container at `/usr/local/gcp/bin/sandbox`; FastAPI invokes it via `subprocess` (e.g. `subprocess.run(["sandbox", "do", "--", "python3", ...])`) to run untrusted code and read back stdout/output. It is not an HTTP API.
- **Run both untrusted code paths through it** — `reference_solution_A` (self-check in `/verify`) and the user's submission (`/submissions`). Both are untrusted: one is LLM-generated, one is arbitrary user code.
- Security properties that come for free, relevant to this architecture specifically:
  - Sandboxes don't inherit the host container's env vars and have no access to the parent process, secrets, or the GCP metadata server. There's no LLM key held server-side to protect in v0, but this isolation still matters for the standard reason: neither the LLM-generated reference solution nor arbitrary user code should be able to touch anything about the host process.
  - Outbound network egress blocked by default (opt-in only via `--allow-egress`, which v0 should never pass) — none of the executed code needs it.
  - Filesystem defaults to a read-only view of the host container root; nothing is writable unless the `--write` flag or a bind mount is explicitly passed, and none of that is needed here. No cleanup logic required, consistent with the stateless/no-DB design.
  - Sandboxes are isolated from each other, not just from the host.
- Runs on the CPU/memory already allocated to the instance — no separate infra or billing line, and no additional charge during preview.
- Fast enough (Google's own benchmark: ~500ms average across 1,000 sandbox create/execute/stop cycles) to keep `/api/submissions` responsive under repeated "Run" clicks while iterating.
- **Not documented anywhere by Google as of this writing:** a hard cap on concurrent sandboxes per instance, or a built-in execution timeout. Don't assume the platform bounds a runaway script — wrap every `sandbox do` subprocess call in an app-level timeout (e.g. `subprocess.run(..., timeout=N)`).
- **Caveat:** public preview, under Pre-GA Offerings Terms — no SLA, API surface may still shift before GA. Fine for a personal tool; worth re-checking before depending on it for anything less tolerant of change.

---

## 11. Open questions for v1

- Whether single-model self-check (§6) turns out to be good enough in practice, or whether the "runs cleanly but wrong" gap shows up often enough to justify bringing LLM B back
- Whether OpenAI support (via a backend relay that forwards the user's key per-request, never persisted/logged) is worth building, or whether Anthropic + Gemini cover it
- Where the frontend gets hosted, and whether that ends up same-origin with the API (see §3) — decide once the rest of v0 is working, not before
- Whether cross-device use turns out to matter enough to justify the Cloud Storage JSON-blob fallback discussed earlier
- Resource limits per sandbox execution (CPU/memory/timeout caps) for the stress-test cases, once real profiling data exists — see `myruntime-cloud-run-research.md` §2 for what Google does and doesn't document here today
