# MyRuntime — Cloud Run & Cloud Run Sandbox Research

Research notes backing the infra decisions in `myruntime-v0-spec.md`: `myruntime-api` runs on Cloud Run (FastAPI), and all untrusted code execution — both LLM reference solutions and user submissions — goes through Cloud Run sandboxes. This doc exists to keep the sourcing and specifics in one place, separate from the spec itself. Researched September 2026; re-verify against current docs before relying on it long-term, since sandboxes are still in preview and things may have changed.

---

## 1. Cloud Run (API hosting)

- **Deploy path:** FastAPI supports Cloud Run's source-based deploy (Cloud Buildpacks build the container automatically if `fastapi` and `uvicorn` are listed in `requirements.txt` — no Dockerfile required). A Dockerfile also works if more control is needed later; not required for v0.
- **Server binding:** uvicorn must bind to `0.0.0.0` and read the port from the `$PORT` env var Cloud Run injects — standard Cloud Run convention, not FastAPI-specific.
- **Non-root:** run the container process as a non-root user (general Cloud Run/GCP container hardening guidance).
- **Billing (as of Sept 2026):** instance-based pricing is roughly $0.000018/vCPU-second + $0.000002/GiB-second. With `min-instances=1`:
  - Default "CPU during requests" mode: the idle minimum instance is billed for memory only, not CPU.
  - "CPU always allocated" mode: idle instances are billed for both CPU and memory, but per-vCPU/GiB rates are lower (~25% less for CPU, ~20% less for memory) and there are no per-request fees.
  - For a single always-on 1 vCPU / 1 GiB instance, Google's own reference figure is roughly $0.072/hour at list price for "always allocated" mode — treat as illustrative, not a quote; run it through the [Cloud Run pricing calculator](https://cloud.google.com/run/pricing) before assuming a specific monthly number.
- `min-instances=0, max-instances=1` (decided in the v0 spec, §6) is unaffected by anything sandbox-specific — v0 moved off in-process Prometheus counters to Cloud Logging-based metrics specifically so scale-to-zero was safe to use; no evidence found that `--sandbox-launcher` behaves differently under scale-to-zero versus an always-on instance beyond the normal Cloud Run cold-start cost (roughly 200ms–2s) on the first request after idle.

**Sources:**
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Quickstart: Deploy a Python (FastAPI) web app to Cloud Run](https://docs.cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-python-fastapi-service)
- [Cloud Run gets always-on CPU allocation](https://cloud.google.com/blog/products/serverless/cloud-run-gets-always-on-cpu-allocation)

---

## 2. Cloud Run sandboxes (code execution)

- **Status:** announced at WeAreDevelopers World Congress, July 2026. Public preview, governed by Google's **Pre-GA Offerings Terms** — no SLA, "as is," may have limited support, API surface may still shift before GA.
- **Requirement:** the Cloud Run resource (service, job, or worker pool) must be on the **2nd-generation execution environment**.
- **Enabling it:**
  - `gcloud beta run deploy SERVICE --image IMAGE_URL --sandbox-launcher` (new service)
  - `gcloud beta run services update SERVICE --sandbox-launcher` (existing service)
  - or `sandboxLauncher: true` in the service YAML.
  - Still under the `gcloud beta` command group as of this research — expect the command to graduate out of beta at some point.
  - Disable with `--no-sandbox-launcher` or by removing the YAML attribute.
- **Invocation is not an HTTP/gRPC API.** It's a CLI binary mounted into the container at `/usr/local/gcp/bin/sandbox`. App code shells out to it:
  - Python: `subprocess.run(["sandbox", "do", "--", "python3", "solution.py"], capture_output=True, timeout=N)`
  - The `sandbox do` subcommand handles the full lifecycle — spin-up, execute, capture output, tear down — in one call.
- **Resource model:** sandboxes run *inside* the same instance as the main container process and share its allocated CPU/memory. No separate billing line — but the main Cloud Run resource's CPU/memory limits must be sized to cover the FastAPI process *and* whatever sandboxes are running concurrently at peak.
- **Security defaults** (this is what v0's threat model for isolating the LLM B key and untrusted code leans on):
  - No inherited environment variables from the host container; no access to the parent process, GCP-held secrets, or the metadata server. This is what keeps LLM B's API key (held only by the FastAPI process, never passed into a sandbox) safe from anything run inside a sandbox.
  - Outbound network egress is **blocked by default**; only opt-in via `--allow-egress` on the `sandbox do` call. v0 should never pass this flag — nothing executed (reference solutions or user code) needs network access.
  - Filesystem: read-only view of the host container root by default. Writes require the `--write` flag (ephemeral, discarded when the sandbox process exits) or an explicit bind mount for anything meant to persist. v0 needs neither — a run just needs to capture stdout/exceptions.
  - Sandboxes are isolated from each other, not just from the host — safe to imagine `reference_solution_A`, `reference_solution_B`, and a user submission each running in their own sandbox without cross-contamination.
- **Performance:** Google's own benchmark is ~500ms average across 1,000 sandbox create/execute/stop cycles. Confirms the v0 spec's assumption that `/api/submissions` can stay responsive under repeated "Run" clicks.
- **Pricing during preview:** no additional charge. Sandboxes bill against the CPU/memory already allocated to the instance, not a separate meter.
- **Gaps in what Google documents today** (checked the code-execution and sandbox-configuration doc pages directly — neither mentions these):
  - No documented hard cap on concurrent sandboxes per instance.
  - No documented built-in execution timeout for a `sandbox do` call.
  - No documented sandbox-specific CPU/memory sub-limits (it's all carved out of the instance's existing allocation).
  - **Implication for v0:** don't assume the platform protects against a runaway or infinite-looping submission. Wrap every `sandbox do` subprocess invocation in an app-level timeout from the FastAPI side.

**Sources:**
- [Google Cloud Run sandboxes are in public preview (Google Cloud blog)](https://cloud.google.com/blog/topics/developers-practitioners/google-cloud-run-sandboxes-are-in-public-preview) — benchmark and pricing-during-preview figures
- [Code execution in Cloud Run (docs)](https://docs.cloud.google.com/run/docs/code-execution) — invocation model, security defaults
- [Configure sandboxes for services (docs)](https://docs.cloud.google.com/run/docs/configuring/services/sandboxes) — enabling flags, resource-sharing requirements

---

## 3. What this settles

- The v0 spec's existing plan (FastAPI on Cloud Run, `--sandbox-launcher` for execution) is workable as described and needs no architectural change — this doc is confirmation plus specifics, not a course correction.
- Clarifies a detail the original spec draft glossed over: `sandbox do` is a **subprocess call**, not an HTTP call — matters for how the FastAPI handlers for `/api/verify` and `/api/submissions` are actually implemented.
- Adds one concrete new requirement not previously called out: **enforce your own execution timeout** around every sandbox invocation, since the platform doesn't document one.

## 4. Open questions (carried into v0 spec §10)

- No documented per-instance sandbox concurrency limit — worth empirically testing once `/api/submissions` is live (e.g., what happens if `/verify`'s two reference-solution runs and a user's `/submissions` call land on the same instance at once).
- Preview status means flag names, CLI syntax, or security defaults could change before GA — re-check this doc against current Google Cloud docs before depending on it past v0.
