// Mirror of api/app/wire_types.py. The backend is the authority — this exists only to
// fail before spending a network round-trip and a sandbox run. Keep the two in step.
//
// Grammar: T := int | float | str | bool | None | Any | List[T] | Dict[str, T] | Optional[T] | T | None

const SCALARS = new Set(["int", "float", "str", "bool", "none", "any"]);
const BARE_CONTAINERS = new Set(["list", "dict"]);

function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim());
}

function isWireType(declared) {
  const t = (declared || "").trim();
  if (!t) return false;
  const low = t.toLowerCase();

  if (SCALARS.has(low) || BARE_CONTAINERS.has(low)) return true;

  if (t.includes("|") && !t.split("|")[0].includes("[")) {
    return splitTopLevel(t, "|").every(isWireType);
  }

  if (!t.endsWith("]")) return false;
  const open = t.indexOf("[");
  if (open < 0) return false;
  const head = t.slice(0, open).trim().toLowerCase();
  const inner = t.slice(open + 1, -1);

  if (head === "list" || head === "optional") return isWireType(inner);
  if (head === "dict") {
    const parts = splitTopLevel(inner, ",");
    // JSON object keys are always strings — this is the whole reason the check exists.
    return parts.length === 2 && parts[0].toLowerCase() === "str" && isWireType(parts[1]);
  }
  return false;
}

function explainType(declared) {
  const t = (declared || "").trim();
  const low = t.toLowerCase();
  if (low.startsWith("dict[")) {
    return `${t} is not usable across the boundary: JSON object keys are always strings, so a dict must be keyed by str (use Dict[str, ...], or an index-based List[...] instead)`;
  }
  if (low.startsWith("tuple") || low.startsWith("set") || low.startsWith("frozenset")) {
    return `${t} has no JSON equivalent — use List[...] at the boundary and convert inside your code`;
  }
  return `${t} is not a supported wire type. Use int, float, str, bool, None, Any, List[T], Dict[str, T] or Optional[T]`;
}

// Returns a list of human-readable problems; empty means the signature is fine.
// A "class" problem's return_type is the class name and never gets serialized — only
// its constructor args and its methods' signatures actually cross the boundary.
function checkSignature(sig) {
  const problems = [];
  const check = (label, declared) => {
    if (!isWireType(declared)) problems.push(`${label}: ${explainType(declared)}`);
  };

  for (const p of sig.parameters || []) check(`parameter "${p.name}"`, p.type);
  if (sig.kind !== "class") check("return_type", sig.return_type);
  for (const m of sig.methods || []) {
    for (const p of m.parameters || []) check(`method "${m.name}" parameter "${p.name}"`, p.type);
    check(`method "${m.name}" return_type`, m.return_type);
  }
  return problems;
}

export { isWireType, explainType, checkSignature };
