// Builds the starter code seeded into the editor. "class"-kind problems (Graph, LRU
// Cache, ...) need a full skeleton — constructor plus one stub per declared method —
// since the grader calls those methods by name; see docs/myruntime-llm-contract.md.

function stubCode(sig) {
  if (sig.kind === "class") {
    const ctorParams = sig.parameters.map((p) => p.name).join(", ");
    const lines = [
      `class ${sig.name}:`,
      `    def __init__(self${ctorParams ? ", " + ctorParams : ""}):`,
      `        # your solution here`,
      `        pass`,
    ];
    for (const m of sig.methods || []) {
      const params = m.parameters.map((p) => p.name).join(", ");
      lines.push("", `    def ${m.name}(self${params ? ", " + params : ""}):`, `        # your solution here`, `        pass`);
    }
    return lines.join("\n") + "\n";
  }
  const params = sig.parameters.map((p) => p.name).join(", ");
  return `def ${sig.name}(${params}):\n    # your solution here\n    pass\n`;
}

function formatSignature(sig) {
  if (sig.kind === "class") {
    const ctorParams = sig.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
    const lines = [`class ${sig.name}:`, `    def __init__(self${ctorParams ? ", " + ctorParams : ""}):`];
    for (const m of sig.methods || []) {
      const params = m.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
      lines.push(`    def ${m.name}(self${params ? ", " + params : ""}) -> ${m.return_type}:`);
    }
    return lines.join("\n");
  }
  const params = sig.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
  return `def ${sig.name}(${params}) -> ${sig.return_type}:`;
}

export { stubCode, formatSignature };
