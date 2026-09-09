// Renders values the way a Python-facing UI should: JSON is close enough for lists,
// numbers and strings, but Python's None/True/False read wrong as null/true/false.
function formatValue(value) {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${formatValue(v)}`)
      .join(", ")}}`;
  }
  return String(value);
}

// Keyword-argument style, matching how the sandbox actually calls the function.
function formatArgs(args) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args)
    .map(([k, v]) => `${k} = ${formatValue(v)}`)
    .join(", ");
}

export { formatValue, formatArgs };
