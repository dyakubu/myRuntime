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
    { "id": string, "category": "example"|"edge"|"stress", "description": string, "input_mode": "literal", "input": object },
    { "id": string, "category": "stress", "description": string, "input_mode": "generated", "generator": { "type": "random_int_array", "param": string, "length": number, "value_range": [number, number], "seed": number }, "fixed_params": object }
  ],
  "generation_meta": { "provider": string, "model": string, "prompt_version": "v1", "warnings": string[] }
}

Rules:
- Python only. Use Python type strings in function_signature (int, float, str, bool, List[int], List[List[int]], Dict[str,int], etc).
- reference_solution.code must define exactly one top-level function named function_signature.name, with parameters matching function_signature.parameters in order.
- Include at least one "example" case (from the problem statement itself), at least one "edge" case, and, when the problem has a size parameter that benefits from it, one "stress" case using input_mode "generated".
- "literal" cases must include a concrete "input" object keyed by parameter name.
- "generated" cases must include a "generator"; only "random_int_array" is supported as a generator type. Use "fixed_params" for any parameters not covered by the generator.
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

const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 (default)" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (faster, cheaper)" },
    ],
    defaultModel: "claude-sonnet-5",
    async generate({ apiKey, model, problemText }) {
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
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: problemText }],
        }),
      });
      const data = await parseJsonOrThrow(resp);
      const text = data?.content?.[0]?.text;
      if (!text) throw new Error("Anthropic response had no text content");
      return extractJson(text);
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
    async generate({ apiKey, model, problemText }) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: problemText }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });
      const data = await parseJsonOrThrow(resp);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini response had no text content");
      return extractJson(text);
    },
  },
};

window.MyRuntimeProviders = PROVIDERS;
