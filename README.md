# MyRuntime

Paste any coding problem, get a LeetCode-style environment for it.

**Live:** https://myruntime-api-352837256578.europe-west1.run.app/

Practice problems from a textbook, a blog post, or an interview you just failed are not on LeetCode. MyRuntime takes that raw problem text and turns it into a runnable exercise: a function signature, a reference solution, and a test suite that has been executed in a sandbox before you ever see it. Then it gives you an editor and grades your attempt against it.

## How it works

```
  paste problem text
         |
         v
  LLM (in your browser, your own API key)
  produces a strict JSON contract:
  signature + reference solution + test cases
         |
         v
  POST /api/verify
  runs the reference solution against every case
  in a Cloud Run sandbox
         |
         v
  cases that ran -> expected_output recorded, case trusted
  cases that crashed -> excluded and flagged
         |
         v
  you solve it in the editor
         |
         v
  POST /api/submissions
  Run  -> grades the 3 visible examples
  Submit -> grades the full suite, reveals failures
```

The backend never calls an LLM. Generation happens entirely client-side with the user's own key, so no provider credential is ever held server-side.

## Architecture

| Layer | Choice |
| --- | --- |
| API | FastAPI on Python 3.11, deployed to Cloud Run |
| Frontend | React 18 + Vite, CodeMirror 6 editor |
| Code execution | Cloud Run sandboxes (2nd-gen execution environment, `--sandbox-launcher`) |
| Generation | Anthropic or Gemini, called directly from the browser |
| Persistence | None. The backend is stateless; the client caches verified suites in IndexedDB |
| Observability | Structured JSON logs to stdout, picked up by Cloud Logging |
| CI/CD | Cloud Build trigger on push, building a multi-stage image |

The API serves the built frontend itself, so production is single-origin and needs no CORS configuration.

## Design decisions worth explaining

**Untrusted code runs in a sandbox, and both sides are untrusted.** The user's submission is obviously untrusted, but so is the LLM's reference solution. Both go through the same Cloud Run sandbox, which blocks network egress by default, does not inherit the host container's environment, and cannot reach the parent process or the GCP metadata server. Google does not document a built-in execution timeout, so every invocation is wrapped in an app-level `subprocess` timeout.

**Declared types are enforced, not decorative.** Every value crosses a JSON boundary on its way to the sandbox and back, so a signature declaring a type JSON cannot represent is a promise the pipeline cannot keep. `Dict[int, List[int]]` is the instructive case: JSON object keys are always strings, so it arrives with string keys and any solution indexing it by integer fails, while the problem statement swears the keys are integers. Signatures are validated against a fixed grammar (`api/app/wire_types.py`) and rejected at the boundary:

```
T := int | float | str | bool | None | Any | List[T] | Dict[str, T] | Optional[T]
```

Tuples, sets and class names are rejected for the same reason. The harness applies the matching check on the way out.

**Bad generations correct themselves.** A malformed or rejected contract is not a dead end. The client feeds the model its own broken output plus the specific error and asks again, up to three attempts. Because validation errors are precise ("JSON object keys are always strings, so a dict must be keyed by str"), the model can usually fix its own signature. A suite where nothing verified is treated as a failed generation rather than cached.

**The self-check is honest about what it cannot do.** Running the reference solution against its own test cases catches a solution that crashes. It cannot catch one that runs cleanly and is simply wrong. That gap is documented rather than papered over, which is exactly why anything checkable deterministically (types, serializability, representability) is checked deterministically instead of being left to a prompt.

**Hidden tests stay hidden.** The verify response contains the reference solution and every expected output, but the UI renders only the 3 example cases. The generation prompt asks for an edge case covering every scenario the model can think of, each with a descriptive label, so listing them would hand over precisely the reasoning the exercise is meant to provoke. A hidden case reveals its input and expected output only when your solution fails it.

**Time limits are a property of the submission.** An infinite loop hangs every test case identically, so grading stops at the first timeout instead of spending `timeout x N` seconds proving the same point. Anything the solution printed comes back with the result, including output printed before a crash.

## Running locally

Backend:

```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8080
```

Frontend (proxies `/api` to the backend above):

```bash
cd frontend
npm install
npm run dev
```

Add an Anthropic or Gemini API key in the Settings panel, or press "Load example" to try it without a key.

`RUNNER_BACKEND` defaults to `local`, which executes code in a plain subprocess with **no isolation**. That is fine for development and required for the tests, but production must set `RUNNER_BACKEND=cloud_run_sandbox`.

## Tests

```bash
cd api && source .venv/bin/activate && python -m pytest -q
```

27 tests covering the verify and submissions round-trips, stateful class-based problems, the wire-type gate, sandbox failure modes (crashes, timeouts, malformed harness output, unserializable return values), and the retry and error paths.

## Deployment

Pushing to `main` triggers a Cloud Build job that builds the multi-stage image (a Node stage compiles the frontend, and only the built assets are copied into the Python image) and deploys it to Cloud Run.

The service needs `--sandbox-launcher` on the 2nd-generation execution environment and `RUNNER_BACKEND=cloud_run_sandbox`.

One deployment quirk worth knowing: Google Frontend intercepts the exact path `/healthz` on `run.app` domains, returning Google's own 404 before the request reaches the container. The endpoint itself works locally and inside the container; only that exact public path is shadowed. `/healthz/` with a trailing slash reaches it normally.

## Project layout

```
api/
  app/
    main.py            app setup, static mount, validation error handler
    models.py          the request/response contract, with type enforcement
    wire_types.py      which declared types survive the JSON boundary
    routers/           verify, submissions, health
    sandbox/           runner abstraction, Cloud Run and local backends, harness
  tests/
frontend/
  src/
    lib/               provider calls, retry loop, storage, API client
    components/        landing screen, problem panel, editor, console
docs/                  spec, LLM contract, Cloud Run research notes
```

## Not built, on purpose

Scope boundaries are recorded in `docs/myruntime-v0-spec.md`. The notable exclusions: no auth, no database, Python only, and no cross-model verification. That last one, a second model independently re-solving each problem so disagreements can be excluded, is the real fix for "the reference solution runs but is wrong" and is deferred rather than pretended away.
