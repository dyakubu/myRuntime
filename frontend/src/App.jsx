import { useCallback, useEffect, useState } from "react";
import { PROVIDERS, generateContract } from "./lib/providers.js";
import { Settings, Cache } from "./lib/storage.js";
import { runVerify, runSubmission } from "./lib/api.js";
import { stubCode } from "./lib/stubs.js";
import { exampleContract } from "./lib/exampleContract.js";
import LandingScreen from "./components/LandingScreen.jsx";
import SolveView from "./components/SolveView.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";

export default function App() {
  const [theme, setTheme] = useState(() => Settings.getTheme());
  const [problemText, setProblemText] = useState("");
  const [contract, setContract] = useState(null);
  const [suite, setSuite] = useState(null);
  const [code, setCode] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState(null); // { text, kind }
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(null); // null | "run" | "submit"
  const [runError, setRunError] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    Settings.setTheme(theme);
  }, [theme]);

  const openContract = useCallback((nextContract, nextSuite) => {
    setContract(nextContract);
    setSuite(nextSuite);
    setCode(stubCode(nextContract.function_signature));
    setResults(null);
    setRunError(null);
    setGenStatus(null);
  }, []);

  const loadFromCacheOrBuild = useCallback(
    async (cacheKey, build) => {
      const hash = await Cache.hashOf(cacheKey);
      const cached = await Cache.get(hash);
      if (cached) {
        openContract(cached.contract, cached.suite);
        return;
      }
      const { contract: built, suite: builtSuite } = await build();
      // Never cache a suite with nothing verified — api.js already treats that as a
      // failed generation, but this keeps a partially-verified one from being cached
      // as if it were complete only when it has something usable to grade against.
      if (builtSuite.verified_count > 0) await Cache.set(hash, { contract: built, suite: builtSuite });
      openContract(built, builtSuite);
    },
    [openContract]
  );

  async function handleGenerate() {
    const text = problemText.trim();
    if (!text) return setGenStatus({ text: "Paste a problem first.", kind: "error" });

    const { provider: providerId, model, apiKey } = Settings.getLlmA();
    if (!apiKey) return setGenStatus({ text: "Add an API key in Settings first.", kind: "error" });
    const provider = PROVIDERS[providerId];

    setGenerating(true);
    try {
      await loadFromCacheOrBuild(text, () =>
        generateContract({
          provider,
          apiKey,
          model,
          problemText: text,
          verify: async (parsed) => {
            validateContract(parsed);
            return runVerify(parsed);
          },
          onStatus: (attempt, max) =>
            setGenStatus({
              text:
                attempt === 1
                  ? `Generating with ${provider.label}…`
                  : `That attempt didn't check out — retrying (${attempt}/${max})…`,
              kind: null,
            }),
        })
      );
    } catch (err) {
      setGenStatus({ text: err.message || String(err), kind: "error" });
    } finally {
      setGenerating(false);
    }
  }

  async function handleLoadExample() {
    const demo = exampleContract();
    setGenerating(true);
    setGenStatus({ text: "Checking the reference solution in the sandbox…", kind: null });
    try {
      await loadFromCacheOrBuild(demo.problem.normalized_statement, async () => ({
        contract: demo,
        suite: await runVerify(demo),
      }));
    } catch (err) {
      setGenStatus({ text: err.message || String(err), kind: "error" });
    } finally {
      setGenerating(false);
    }
  }

  async function handleRun(mode) {
    const gradable = suite.test_cases.filter((c) => c.verified);
    const cases = mode === "run" ? gradable.filter((c) => c.category === "example") : gradable;
    if (!cases.length) {
      setRunError("No verified test cases to run against.");
      return;
    }
    setRunning(mode);
    setRunError(null);
    try {
      const resp = await runSubmission({
        functionSignature: contract.function_signature,
        code,
        testCases: cases,
      });
      setResults({ ...resp, mode });
    } catch (err) {
      setRunError(err.message || String(err));
    } finally {
      setRunning(null);
    }
  }

  function handleNewProblem() {
    setContract(null);
    setSuite(null);
    setResults(null);
    setRunError(null);
    setGenStatus(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          MyRuntime
          {contract && <span className="brand-sub">{contract.problem.title}</span>}
        </div>
        <div className="topbar-actions">
          {contract && (
            <button className="btn btn-ghost btn-small" type="button" onClick={handleNewProblem}>
              ← New problem
            </button>
          )}
          <SettingsPanel />
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
        </div>
      </header>

      {contract ? (
        <SolveView
          contract={contract}
          suite={suite}
          code={code}
          onCodeChange={setCode}
          theme={theme}
          onRun={handleRun}
          running={running}
          results={results}
          runError={runError}
        />
      ) : (
        <LandingScreen
          problemText={problemText}
          onProblemTextChange={setProblemText}
          onGenerate={handleGenerate}
          onLoadExample={handleLoadExample}
          generating={generating}
          status={genStatus}
        />
      )}
    </div>
  );
}

// Fast-fail on obviously malformed model output before spending a sandbox round-trip.
// The backend's pydantic models are the real validator; this just catches the shapes
// that would produce a confusing 422, and the class-kind coherence the backend can't
// check on its own.
function validateContract(json) {
  if (!json || typeof json !== "object") throw new Error("model did not return a JSON object");
  for (const key of ["problem", "function_signature", "reference_solution", "test_cases"]) {
    if (!(key in json)) throw new Error(`model output is missing "${key}"`);
  }
  if (!Array.isArray(json.test_cases) || json.test_cases.length === 0) {
    throw new Error("model output has no test_cases");
  }
  if (typeof json.reference_solution?.code !== "string" || !json.reference_solution.code.trim()) {
    throw new Error("reference_solution.code is missing or empty");
  }
  const sig = json.function_signature;
  if (!sig?.name) throw new Error("function_signature.name is missing");
  if (sig.kind === "class") {
    if (!Array.isArray(sig.methods) || sig.methods.length === 0) {
      throw new Error('a "class" problem must declare at least one method in function_signature.methods');
    }
    const declared = new Set(sig.methods.map((m) => m.name));
    for (const c of json.test_cases) {
      for (const op of c.operations || []) {
        if (!declared.has(op.method)) {
          throw new Error(`test case "${c.id}" calls "${op.method}", which is not in function_signature.methods`);
        }
      }
    }
  }
  return json;
}
