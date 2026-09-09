// Same-origin by default — the API serves this build itself (api/app/main.py mounts
// frontend/dist at "/"), and `npm run dev` proxies /api through to it (vite.config.js).
const API_BASE = import.meta.env.VITE_API_BASE || "";

// The backend flattens pydantic validation errors into "field.path: message" strings
// (api/app/main.py's RequestValidationError handler), so detail is usually an array.
function flattenDetail(detail) {
  if (Array.isArray(detail)) return detail.join("; ");
  return detail;
}

async function postJson(path, body, label) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => null);
    const detail = flattenDetail(errBody?.detail);
    throw new Error(`${label} failed: ${resp.status}${detail ? ` — ${detail}` : ` ${resp.statusText}`}`);
  }
  return resp.json();
}

// /api/verify answers 200 with verification_status "partial" even when the reference
// solution crashed on every single case — which used to sail through as success, get
// cached, and leave the problem permanently stuck. A suite with nothing verified has no
// known-good expected output for anything, so it's a failed generation: throwing here is
// what lets generateContract()'s retry loop feed the error back and ask for a fix.
async function runVerify(contract) {
  const suite = await postJson("/api/verify", contract, "verify");
  if (!suite.verified_count) {
    const firstError = suite.test_cases?.find((c) => c.error)?.error;
    throw new Error(
      `the reference solution failed on all ${suite.total_count} test cases` +
        (firstError ? ` (e.g. ${firstError})` : "")
    );
  }
  return suite;
}

function runSubmission({ functionSignature, code, testCases }) {
  return postJson(
    "/api/submissions",
    { function_signature: functionSignature, code, test_cases: testCases },
    "run"
  );
}

export { runVerify, runSubmission, flattenDetail };
