// Builds the starter code seeded into the editor. "class"-kind problems (Graph, LRU
// Cache, ...) need a full skeleton — constructor plus one stub per declared method —
// since the grader calls those methods by name; see docs/myruntime-llm-contract.md.

const TYPING_NAMES = ["Any", "Dict", "List", "Optional"];

// Annotations are evaluated at def time (no `from __future__ import annotations` here),
// so a stub annotated `List[int]` without the import raises NameError the moment the
// sandbox execs it. Emit exactly the typing imports the signature actually uses.
function typingImport(types) {
  const joined = types.join(" ");
  const used = TYPING_NAMES.filter((n) => new RegExp(`\\b${n}\\b`).test(joined));
  return used.length ? `from typing import ${used.join(", ")}\n\n` : "";
}

function annotate(params) {
  return params.map((p) => `${p.name}: ${p.type}`).join(", ");
}

function signatureTypes(sig) {
  const types = sig.parameters.map((p) => p.type);
  if (sig.kind === "class") {
    for (const m of sig.methods || []) {
      types.push(...m.parameters.map((p) => p.type), m.return_type);
    }
  } else {
    types.push(sig.return_type);
  }
  return types;
}

function stubCode(sig) {
  const header = typingImport(signatureTypes(sig));

  if (sig.kind === "class") {
    const ctor = annotate(sig.parameters);
    const lines = [
      `class ${sig.name}:`,
      `    def __init__(self${ctor ? ", " + ctor : ""}):`,
      `        # your solution here`,
      `        pass`,
    ];
    for (const m of sig.methods || []) {
      const params = annotate(m.parameters);
      lines.push(
        "",
        `    def ${m.name}(self${params ? ", " + params : ""}) -> ${m.return_type}:`,
        `        # your solution here`,
        `        pass`
      );
    }
    return header + lines.join("\n") + "\n";
  }

  return `${header}def ${sig.name}(${annotate(sig.parameters)}) -> ${sig.return_type}:\n    # your solution here\n    pass\n`;
}

function formatSignature(sig) {
  if (sig.kind === "class") {
    const ctor = annotate(sig.parameters);
    const lines = [`class ${sig.name}:`, `    def __init__(self${ctor ? ", " + ctor : ""}):`];
    for (const m of sig.methods || []) {
      const params = annotate(m.parameters);
      lines.push(`    def ${m.name}(self${params ? ", " + params : ""}) -> ${m.return_type}:`);
    }
    return lines.join("\n");
  }
  return `def ${sig.name}(${annotate(sig.parameters)}) -> ${sig.return_type}:`;
}

export { stubCode, formatSignature };
