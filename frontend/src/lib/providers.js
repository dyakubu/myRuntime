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
  "function_signature": {
    "name": string,
    "kind": "function"|"class",
    "parameters": [{ "name": string, "type": string }],
    "return_type": string,
    "methods": [{ "name": string, "parameters": [{ "name": string, "type": string }], "return_type": string }]
  },
  "constraints": { "raw": string, "input_bounds": object },
  "reference_solution": { "language": "python", "code": string, "expected_time_complexity": string, "expected_space_complexity": string },
  "test_cases": [
    {
      "id": string,
      "category": "example"|"edge",
      "description": string,
      "input_mode": "literal",
      "input": object,
      "operations": [{ "method": string, "args": object }]
    }
  ],
  "generation_meta": { "provider": string, "model": string, "prompt_version": "v1", "warnings": string[] }
}

Rules:
- Python only. Use Python type strings in function_signature/methods (int, float, str, bool, List[int], List[List[int]], Dict[str,int], etc).
- Only JSON-native types (int, float, str, bool, list, dict, None, and combinations of these) may appear as a parameter or return type anywhere in function_signature or methods. If the problem is naturally about a node/pointer structure (a tree, a linked list, a graph as an object), represent it as a plain nested list/dict at the boundary (e.g. a level-order array with nulls for a tree) and build/tear down any node objects privately inside reference_solution.code — never require the caller to pass in or receive one of your own classes.
- Most problems are "function" kind: one pure function, no persistent state. Use "kind": "function", omit "methods", and give every test case an "input" (the call's arguments) with no "operations".
- Use "kind": "class" ONLY when the problem inherently needs state that persists across multiple calls with no single meaningful return value — e.g. "design a Graph/LRU Cache/Trie/Union-Find". For a "class" problem:
  - function_signature.name is the class name; function_signature.parameters are the constructor's parameters; function_signature.methods lists every query method the class must support (name, parameters, return_type). Do not include mutation methods unless the problem explicitly asks for them.
  - Every test case's "input" is the constructor's arguments, and "operations" is the sequence of method calls to run against that one constructed instance, in order — each is { "method": one of function_signature.methods' names, "args": object }. Never include an "expected_output" anywhere — the backend computes each operation's expected result by running reference_solution itself.
  - reference_solution.code defines the class with __init__ plus every listed method, nothing else.
- Include exactly 3 "example" cases: straightforward inputs (or, for "class" problems, operation sequences), the kind given in the problem statement itself or an equally typical case — nothing tricky.
- Then include one "edge" case for every edge case you can think of. Cover general edge cases that apply to inputs of these types — empty input, a single element, all elements equal/duplicated, smallest and largest allowed values, negative numbers, already-sorted or reverse-sorted input, etc., whichever actually apply here — AND edge cases specific to this problem's own logic. Do not cap how many you include; more thorough is better than fewer.
- Every test case, "example" and "edge" alike, needs a "description" stating in one short, specific phrase what that case (and, for a "class" problem, its operation sequence) is meant to catch (e.g. "negative value in the middle of the array", "query a pair of vertices with no edge between them"). Do not write vague descriptions like "edge case" or "tests edge condition".
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
// cases, and "class"-kind problems add a methods list plus a per-case operations
// sequence on top of that, so a thorough answer can run long. Raising this lowers
// truncation risk but doesn't rule it out, which is why callModel() below also reports
// whether a response was cut off so generateContract() can tell "truncated" apart from
// "just malformed."
const MAX_OUTPUT_TOKENS = 16384;

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
      // content[0] isn't reliably the answer — extended thinking (on by default for
      // some models) puts a "thinking" block first, with the real answer in a later
      // "text" block. Filter by type instead of assuming position 0.
      const text = (data?.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
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
      // Same reasoning as the Anthropic side: a thinking-enabled model marks reasoning
      // parts with "thought": true ahead of the real answer part — skip those instead
      // of assuming parts[0] is the text.
      const text = (candidate?.content?.parts ?? [])
        .filter((part) => !part.thought && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
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

export { PROVIDERS, generateContract, MAX_ATTEMPTS };
