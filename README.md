# MyRuntime

Paste any coding problem, get a LeetCode-style environment for it.

**Live:** https://myruntime-api-352837256578.europe-west1.run.app/

**Bring your own key.** Problem generation runs in your browser against your own Anthropic or Gemini API key. Nothing to sign up for, and no key is stored on the server. See [Bring your own key](#bring-your-own-key) for the details, or press "Load example" on the live site to try it without one.

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

## Bring your own key

**MyRuntime does not ship with an API key and does not have one.** You supply your own, and generation runs entirely in your browser.

Concretely:

* You paste your own Anthropic or Gemini key into the Settings panel.
* It is stored in `localStorage`, scoped to the origin serving the frontend, and stays on your machine.
* It is attached only to requests going directly from your browser to the provider's API.
* It is never sent to `myruntime-api`, never logged, and never persisted server-side.
* The backend holds no LLM credential of its own and makes no LLM calls at all. It only runs code in a sandbox.

That means running costs are yours and are billed by your provider, and there is nothing to sign up for here. If you want to try the app without a key, "Load example" runs a built-in Two Sum problem through the real verification and grading path, no key required.

### Why only Anthropic and Gemini

Both allow key-authenticated calls straight from browser JavaScript, verified by testing real requests rather than trusting documentation:

* **Anthropic** works once the request carries `anthropic-dangerous-direct-browser-access: true`. Without that header Anthropic still processes the request, but the response omits `Access-Control-Allow-Origin`, so the browser discards it before any JavaScript can read it.
* **Gemini** works with a plain `fetch()`. `generativelanguage.googleapis.com` reflects the requesting origin back in `Access-Control-Allow-Origin`.

**OpenAI is not supported, and cannot be without changing the architecture.** Its preflight `OPTIONS` response looks permissive, but the actual `POST` response carries no `Access-Control-Allow-Origin` header at all, so the browser blocks reading the response even though the request reached OpenAI's servers. Supporting it would require a backend relay that forwards your key through this server on every request, which would break the property the whole design rests on: that your key never leaves your browser. That tradeoff is deliberately not made.

Neither supported provider gates access by origin, only by key, so no domain allowlisting is needed anywhere.

## Architecture

| Layer | Choice |
| --- | --- |
| API | FastAPI on Python 3.11, deployed to Cloud Run |
| Frontend | React 18 + Vite, CodeMirror 6 editor |
| Code execution | Cloud Run sandboxes (2nd-gen execution environment, `--sandbox-launcher`) |
| Generation | Anthropic or Gemini, called directly from the browser with your own key |
| Persistence | None. The backend is stateless; the client caches verified suites in IndexedDB |
| Observability | Structured JSON logs to stdout, picked up by Cloud Logging |
| CI/CD | Cloud Build trigger on push, building a multi-stage image |

The API serves the built frontend itself, so production is single-origin and needs no CORS configuration.

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

The liveness endpoint is `GET /api/health`, deliberately not the conventional `/healthz`. Google Frontend shadows that exact path on `run.app` domains and answers it with its own 404 before the request reaches the container, which makes it useless for external uptime monitoring. `/healthz/`, `/healthz2` and `/api/health` all reach the app, so the interception applies to that one literal path.

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
