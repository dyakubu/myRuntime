// Client-side LLM A provider registry — BYOK, direct from the browser, no backend
// involved. Only providers that actually support this are listed here: Anthropic and
// Gemini both let a browser read the response (verified by testing actual POST
// responses, not just the CORS preflight); OpenAI's preflight looks permissive but its
// real response carries no Access-Control-Allow-Origin, so the browser discards it.
// See docs/myruntime-v0-spec.md §5 for the reasoning and docs/myruntime-llm-contract.md
// for the exact JSON shape this prompt asks for.

const SYSTEM_PROMPT = `You turn a pasted coding-interview problem into a strict JSON object. Output ONLY the JSON object — no markdown fences, no commentary, no leading or trailing text.

The JSON must have exactly this shape:
{
  "problem": { "title": string, "difficulty": "easy"|"medium"|"hard", "topics": string[], "normalized_statement": string },
  "function_signature": { "name": string, "parameters": [{ "name": string, "type": string }], "return_type": string },
  "constraints": { "raw": string, "input_bounds": object },
  "reference_solution": { "language": "python", "code": string, "expected_time_complexity": string, "expected_space_complexity": string },
  "test_cases": [
    { "id": string, "category": "example"|"edge", "description": string, "input_mode": "literal", "input": object }
  ],
  "generation_meta": { "provider": string, "model": string, "prompt_version": "v1", "warnings": string[] }
}

Rules:
- Python only. Use Python type strings in function_signature (int, float, str, bool, List[int], List[List[int]], Dict[str,int], etc).
- reference_solution.code must define exactly one top-level function named function_signature.name, with parameters matching function_signature.parameters in order.
- Include exactly 3 "example" cases: straightforward inputs, the kind given in the problem statement itself or an equally typical case — nothing tricky.
- Then include one "edge" case for every edge case you can think of. Cover general edge cases that apply to inputs of these types — empty input, a single element, all elements equal/duplicated, smallest and largest allowed values, negative numbers, already-sorted or reverse-sorted input, etc., whichever actually apply here — AND edge cases specific to this problem's own logic. Do not cap how many you include; more thorough is better than fewer.
- Every test case, "example" and "edge" alike, needs a "description" stating in one short, specific phrase what that case is meant to catch (e.g. "negative value in the middle of the array", "target only reachable by using the same element twice"). Do not write vague descriptions like "edge case" or "tests edge condition".
- All test cases use "input_mode": "literal" with a concrete "input" object keyed by parameter name. Do not use "generated"/randomized inputs — every value must be spelled out literally.
- normalized_statement should be a cleaned-up markdown version of the pasted problem text, not a restatement of these instructions.`;

async function parseJsonOrThrow(resp) {
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const message = (data && (data.error?.message || data.error)) || resp.statusText;
    throw new Error(`${resp.status} ${message}`);
  }
  return data;
}

function extractJson(text) {
  // Models sometimes wrap JSON in ```json fences despite instructions — strip if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}

// max_tokens/maxOutputTokens headroom: the prompt asks for an uncapped number of edge
// cases, so a thorough answer can run long — 8192 lowers truncation risk but doesn't
// rule it out, which is why callModel() below also reports whether a response was cut
// off so generateContract() can tell "truncated" apart from "just malformed."
const MAX_OUTPUT_TOKENS = 8192;

const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 (default)" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (faster, cheaper)" },
    ],
    defaultModel: "claude-sonnet-5",
    // messages: [{ role: "user"|"assistant", content: string }] — a normalized shape
    // shared across providers; each callModel translates it to that provider's wire format.
    async callModel({ apiKey, model, messages }) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          // Opts the RESPONSE into being CORS-readable by a browser. Without it Anthropic
          // still processes the request but the browser discards the response.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          messages,
        }),
      });
      const data = await parseJsonOrThrow(resp);
      const text = data?.content?.[0]?.text;
      if (!text) throw new Error("Anthropic response had no text content");
      return { text, truncated: data?.stop_reason === "max_tokens" };
    },
  },

  gemini: {
    id: "gemini",
    label: "Google (Gemini)",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (default)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (faster, cheaper)" },
    ],
    defaultModel: "gemini-3.8-flash",
    async callModel({ apiKey, model, messages }) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: MAX_OUTPUT_TOKENS },
        }),
      });
      const data = await parseJsonOrThrow(resp);
      const candidate = data?.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini response had no text content");
      return { text, truncated: candidate?.finishReason === "MAX_TOKENS" };
    },
  },
};

// 1 initial attempt + 2 retries. Kept low deliberately: this runs against the user's own
// API key, so a retry loop isn't free — it should give the model a real chance to fix a
// mistake, not quietly burn spend on a case that's never going to parse.
const MAX_ATTEMPTS = 3;

function retryPrompt(error, truncated) {
  if (truncated) {
    return "Your last response was cut off before the JSON object finished (it hit the output length limit). Return the complete JSON object again, in full. If it helps it fit, include fewer edge cases — but every case you do include must still follow all the rules above.";
  }
  return `Your last response was rejected: ${error.message}\n\nFix this and return a corrected JSON object. Output ONLY the JSON object — no markdown fences, no commentary.`;
}

// Drives the whole "ask the model, check the answer, ask again if it's wrong" loop.
// `verify` is supplied by the caller (app.js) — it should validate the contract shape
// and run it through the sandbox self-check, resolving with the verified suite or
// throwing a descriptive Error on any failure (malformed shape, backend 422, etc.).
// Only failures from parsing/verifying a response are retried; a callModel() throw
// (bad key, rate limit, network error) is not retryable and propagates immediately.
async function generateContract({ provider, apiKey, model, problemText, verify, onStatus }) {
  const messages = [{ role: "user", content: problemText }];
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onStatus?.(attempt, MAX_ATTEMPTS);
    const { text, truncated } = await provider.callModel({ apiKey, model, messages });

    let parsed;
    try {
      parsed = extractJson(text);
    } catch (err) {
      lastError = truncated
        ? new Error("model response was cut off before the JSON object finished (hit the output length limit)")
        : new Error(`model did not return valid JSON: ${err.message}`);
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: retryPrompt(lastError, truncated) });
      continue;
    }

    try {
      const suite = await verify(parsed);
      return { contract: parsed, suite };
    } catch (err) {
      lastError = err;
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: retryPrompt(err, false) });
    }
  }

  throw lastError;
}

window.MyRuntimeProviders = PROVIDERS;
window.MyRuntimeGenerate = generateContract;
