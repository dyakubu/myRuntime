(() => {
  "use strict";

  // Same-origin by default (the FastAPI app serves this static directory itself — see
  // api/app/main.py). Override by setting window.MYRUNTIME_API_BASE before this script
  // runs, if the frontend ever ends up hosted separately from the API.
  const API_BASE = window.MYRUNTIME_API_BASE || "";

  const { Settings, Cache } = window.MyRuntimeStorage;
  const PROVIDERS = window.MyRuntimeProviders;
  const generateContract = window.MyRuntimeGenerate;

  const el = (id) => document.getElementById(id);
  const els = {
    themeToggle: el("theme-toggle"),
    iconSun: el("icon-sun"),
    iconMoon: el("icon-moon"),
    themeToggleLabel: el("theme-toggle-label"),
    settingsToggle: el("settings-toggle"),
    settingsPanel: el("settings-panel"),
    providerSelect: el("provider-select"),
    modelSelect: el("model-select"),
    apiKeyInput: el("api-key-input"),
    settingsSave: el("settings-save"),
    settingsSaved: el("settings-saved"),
    inputSection: el("input-section"),
    problemInput: el("problem-input"),
    generateBtn: el("generate-btn"),
    loadExampleBtn: el("load-example-btn"),
    generateStatus: el("generate-status"),
    problemPanel: el("problem-panel"),
    newProblemBtn: el("new-problem-btn"),
    problemTitle: el("problem-title"),
    problemDifficulty: el("problem-difficulty"),
    problemTopics: el("problem-topics"),
    problemStatement: el("problem-statement"),
    functionSignature: el("function-signature"),
    referenceSolution: el("reference-solution"),
    testCaseList: el("test-case-list"),
    verifyStatus: el("verify-status"),
    editorEmptyState: el("editor-empty-state"),
    editorPanel: el("editor-panel"),
    codeInput: el("code-input"),
    runBtn: el("run-btn"),
    runStatus: el("run-status"),
    resultsPanel: el("results-panel"),
    resultsSummary: el("results-summary"),
    resultsList: el("results-list"),
    splitView: el("split-view"),
    paneLeft: el("pane-left"),
    divider: el("divider"),
  };

  const state = { contract: null, suite: null };

  // ---------- theme ----------

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    // Icon + label both reflect the CURRENT theme (moon = dark is on), not the
    // destination — the more common convention, and less ambiguous than the reverse.
    const isDark = theme === "dark";
    els.iconMoon.hidden = !isDark;
    els.iconSun.hidden = isDark;
    els.themeToggleLabel.textContent = isDark ? "Dark" : "Light";
  }

  function initTheme() {
    applyTheme(Settings.getTheme());
    els.themeToggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      Settings.setTheme(next);
    });
  }

  // ---------- settings panel ----------

  function populateModelSelect(providerId, selectedModel) {
    const provider = PROVIDERS[providerId];
    els.modelSelect.innerHTML = "";
    for (const m of provider.models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      els.modelSelect.appendChild(opt);
    }
    els.modelSelect.value = provider.models.some((m) => m.id === selectedModel) ? selectedModel : provider.defaultModel;
  }

  function initSettingsPanel() {
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = provider.label;
      els.providerSelect.appendChild(opt);
    }

    const saved = Settings.getLlmA();
    els.providerSelect.value = saved.provider;
    populateModelSelect(saved.provider, saved.model);
    els.apiKeyInput.value = saved.apiKey;

    els.providerSelect.addEventListener("change", () => {
      populateModelSelect(els.providerSelect.value, "");
    });

    els.settingsToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const willShow = els.settingsPanel.hidden;
      els.settingsPanel.hidden = !willShow;
      els.settingsToggle.setAttribute("aria-expanded", String(willShow));
    });

    document.addEventListener("click", (e) => {
      if (els.settingsPanel.hidden) return;
      if (els.settingsPanel.contains(e.target) || els.settingsToggle.contains(e.target)) return;
      els.settingsPanel.hidden = true;
      els.settingsToggle.setAttribute("aria-expanded", "false");
    });

    els.settingsSave.addEventListener("click", () => {
      Settings.setLlmA({
        provider: els.providerSelect.value,
        model: els.modelSelect.value,
        apiKey: els.apiKeyInput.value.trim(),
      });
      els.settingsSaved.hidden = false;
      setTimeout(() => (els.settingsSaved.hidden = true), 1500);
    });
  }

  // ---------- split view (draggable divider) ----------

  const SPLIT_KEY = "myruntime.splitPct";
  const SPLIT_MIN = 25;
  const SPLIT_MAX = 75;

  function initSplitView() {
    const saved = parseFloat(localStorage.getItem(SPLIT_KEY));
    if (!Number.isNaN(saved)) {
      els.paneLeft.style.flexBasis = `${saved}%`;
    }

    let dragging = false;

    const onMove = (clientX) => {
      const rect = els.splitView.getBoundingClientRect();
      let pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct));
      els.paneLeft.style.flexBasis = `${pct}%`;
    };

    const stop = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-resizing");
      const pct = parseFloat(els.paneLeft.style.flexBasis);
      if (!Number.isNaN(pct)) localStorage.setItem(SPLIT_KEY, String(pct));
    };

    els.divider.addEventListener("mousedown", (e) => {
      dragging = true;
      document.body.classList.add("is-resizing");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (dragging) onMove(e.clientX);
    });
    window.addEventListener("mouseup", stop);

    els.divider.addEventListener(
      "touchstart",
      (e) => {
        dragging = true;
        document.body.classList.add("is-resizing");
      },
      { passive: true }
    );
    window.addEventListener(
      "touchmove",
      (e) => {
        if (dragging && e.touches[0]) onMove(e.touches[0].clientX);
      },
      { passive: true }
    );
    window.addEventListener("touchend", stop);
  }

  // ---------- generation ----------

  function validateContract(json) {
    if (!json || typeof json !== "object") throw new Error("model did not return a JSON object");
    for (const key of ["problem", "function_signature", "reference_solution", "test_cases"]) {
      if (!(key in json)) throw new Error(`model output is missing "${key}"`);
    }
    if (!Array.isArray(json.test_cases) || json.test_cases.length === 0) {
      throw new Error("model output has no test_cases");
    }
    return json;
  }

  function setStatus(elm, text, kind) {
    elm.textContent = text;
    elm.className = "hint" + (kind ? ` ${kind}` : "");
  }

  function flattenDetail(detail) {
    if (Array.isArray(detail)) return detail.join("; ");
    return detail;
  }

  async function runVerify(contract) {
    const resp = await fetch(`${API_BASE}/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(contract),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => null);
      const detail = flattenDetail(body?.detail);
      throw new Error(`verify failed: ${resp.status}${detail ? ` — ${detail}` : ` ${resp.statusText}`}`);
    }
    return resp.json();
  }

  async function cacheAndRender(hash, contract, suite, statusMessage) {
    state.contract = contract;
    state.suite = suite;
    await Cache.set(hash, { contract, suite });
    renderProblem();
    setStatus(
      els.generateStatus,
      statusMessage ?? `Done. ${suite.verified_count}/${suite.total_count} test cases checked.`,
      suite.verification_status === "ok" ? "success" : "error"
    );
  }

  async function processContract(contract, cacheKeyText) {
    const hash = await Cache.hashOf(cacheKeyText);
    const cached = await Cache.get(hash);
    if (cached) {
      state.contract = cached.contract;
      state.suite = cached.suite;
      renderProblem();
      setStatus(els.generateStatus, "Loaded from cache.", "success");
      return;
    }

    setStatus(els.generateStatus, "Checking reference solution in sandbox...", "");
    const suite = await runVerify(contract);
    await cacheAndRender(hash, contract, suite);
  }

  async function onGenerate() {
    const problemText = els.problemInput.value.trim();
    if (!problemText) {
      setStatus(els.generateStatus, "Paste a problem first.", "error");
      return;
    }
    const { provider: providerId, model, apiKey } = Settings.getLlmA();
    if (!apiKey) {
      setStatus(els.generateStatus, "Set an API key in Settings first.", "error");
      return;
    }
    const provider = PROVIDERS[providerId];

    els.generateBtn.disabled = true;
    try {
      const hash = await Cache.hashOf(problemText);
      const cached = await Cache.get(hash);
      if (cached) {
        state.contract = cached.contract;
        state.suite = cached.suite;
        renderProblem();
        setStatus(els.generateStatus, "Loaded from cache.", "success");
        return;
      }

      const { contract, suite } = await generateContract({
        provider,
        apiKey,
        model,
        problemText,
        verify: async (parsed) => {
          validateContract(parsed);
          return runVerify(parsed);
        },
        onStatus: (attempt, maxAttempts) => {
          setStatus(
            els.generateStatus,
            attempt === 1
              ? `Generating with ${provider.label}...`
              : `Model output needed a fix — retrying with ${provider.label} (attempt ${attempt}/${maxAttempts})...`,
            ""
          );
        },
      });
      await cacheAndRender(hash, contract, suite);
    } catch (err) {
      setStatus(els.generateStatus, err.message || String(err), "error");
    } finally {
      els.generateBtn.disabled = false;
    }
  }

  function exampleContract() {
    return {
      problem: {
        title: "Two Sum",
        difficulty: "easy",
        topics: ["array", "hash-map"],
        normalized_statement:
          "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
      },
      function_signature: {
        name: "two_sum",
        parameters: [
          { name: "nums", type: "List[int]" },
          { name: "target", type: "int" },
        ],
        return_type: "List[int]",
      },
      constraints: {
        raw: "2 <= nums.length <= 10^4, -10^9 <= nums[i] <= 10^9",
        input_bounds: {
          nums: { length_min: 2, length_max: 10000, value_min: -1000000000, value_max: 1000000000 },
          target: { value_min: -2000000000, value_max: 2000000000 },
        },
      },
      reference_solution: {
        language: "python",
        code:
          "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []",
        expected_time_complexity: "O(n)",
        expected_space_complexity: "O(n)",
      },
      test_cases: [
        {
          id: "example_1",
          category: "example",
          description: "given example from the problem statement",
          input_mode: "literal",
          input: { nums: [2, 7, 11, 15], target: 9 },
        },
        {
          id: "edge_duplicates",
          category: "edge",
          description: "duplicate values, correct pair must use distinct indices",
          input_mode: "literal",
          input: { nums: [3, 3], target: 6 },
        },
        {
          id: "stress_large_n",
          category: "stress",
          description: "n at upper bound, checks O(n) vs O(n^2) in practice",
          input_mode: "generated",
          generator: { type: "random_int_array", param: "nums", length: 10000, value_range: [-1000000000, 1000000000], seed: 42 },
          fixed_params: { target: 999999998 },
        },
      ],
      generation_meta: { provider: "example", model: "none", prompt_version: "v1", warnings: [] },
    };
  }

  async function onLoadExample() {
    const contract = exampleContract();
    els.problemInput.value = contract.problem.normalized_statement;
    els.loadExampleBtn.disabled = true;
    try {
      setStatus(els.generateStatus, "Loading example...", "");
      await processContract(contract, contract.problem.normalized_statement);
    } catch (err) {
      setStatus(els.generateStatus, err.message || String(err), "error");
    } finally {
      els.loadExampleBtn.disabled = false;
    }
  }

  // ---------- rendering ----------

  function formatSignature(sig) {
    if (sig.kind === "class") {
      const ctorParams = sig.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
      const lines = [`class ${sig.name}:`, `    def __init__(self, ${ctorParams}):`];
      for (const m of sig.methods || []) {
        const params = m.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
        lines.push(`    def ${m.name}(self${params ? ", " + params : ""}) -> ${m.return_type}:`);
      }
      return lines.join("\n");
    }
    const params = sig.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
    return `def ${sig.name}(${params}) -> ${sig.return_type}:`;
  }

  function stubCode(sig) {
    if (sig.kind === "class") {
      const ctorParams = sig.parameters.map((p) => p.name).join(", ");
      const lines = [`class ${sig.name}:`, `    def __init__(self, ${ctorParams}):`, `        # your solution here`, `        pass`];
      for (const m of sig.methods || []) {
        const params = m.parameters.map((p) => p.name).join(", ");
        lines.push("", `    def ${m.name}(self${params ? ", " + params : ""}):`, `        # your solution here`, `        pass`);
      }
      return lines.join("\n") + "\n";
    }
    const params = sig.parameters.map((p) => p.name).join(", ");
    return `def ${sig.name}(${params}):\n    # your solution here\n    pass\n`;
  }

  function renderProblem() {
    const { contract, suite } = state;
    els.inputSection.hidden = true;
    els.problemPanel.hidden = false;
    els.problemTitle.textContent = contract.problem.title;
    els.problemDifficulty.textContent = contract.problem.difficulty;
    els.problemDifficulty.dataset.difficulty = contract.problem.difficulty;
    els.problemTopics.innerHTML = "";
    for (const topic of contract.problem.topics || []) {
      const span = document.createElement("span");
      span.className = "badge";
      span.textContent = topic;
      els.problemTopics.appendChild(span);
    }
    els.problemStatement.textContent = contract.problem.normalized_statement;
    els.functionSignature.textContent = formatSignature(contract.function_signature);
    els.referenceSolution.textContent = contract.reference_solution.code;

    els.testCaseList.innerHTML = "";
    const descriptionById = Object.fromEntries(contract.test_cases.map((c) => [c.id, c.description]));
    const operationsCountById = Object.fromEntries(
      contract.test_cases.map((c) => [c.id, c.operations ? c.operations.length : null])
    );
    for (const c of suite.test_cases) {
      const li = document.createElement("li");
      const desc = descriptionById[c.id] ? ` — ${descriptionById[c.id]}` : "";
      if (c.verified) {
        li.textContent = `✓ ${c.id} (${c.category})${desc}`;
      } else {
        const totalOps = operationsCountById[c.id];
        // c.operations holds only the steps that ran before the failing one — see
        // routers/verify.py — so this shows exactly how far the sequence got.
        const stepProgress = totalOps != null ? ` (succeeded ${c.operations.length}/${totalOps} steps)` : "";
        li.textContent = `✗ ${c.id} (${c.category})${desc} — reference solution errored: ${c.error}${stepProgress}`;
      }
      els.testCaseList.appendChild(li);
    }

    setStatus(
      els.verifyStatus,
      `${suite.verified_count}/${suite.total_count} test cases checked` +
        (suite.verification_status === "partial" ? ` — ${suite.error_count} excluded (reference solution errored)` : ""),
      suite.verification_status === "ok" ? "success" : "error"
    );

    els.codeInput.value = stubCode(contract.function_signature);
    els.editorEmptyState.hidden = true;
    els.editorPanel.hidden = false;
    els.resultsPanel.hidden = true;
  }

  function resetToInput() {
    state.contract = null;
    state.suite = null;
    els.problemPanel.hidden = true;
    els.inputSection.hidden = false;
    els.editorPanel.hidden = true;
    els.editorEmptyState.hidden = false;
    els.resultsPanel.hidden = true;
    setStatus(els.generateStatus, "", "");
  }

  function renderResults(resp) {
    els.resultsPanel.hidden = false;
    els.resultsSummary.textContent = `${resp.passed_count}/${resp.total_count} passed`;
    els.resultsList.innerHTML = "";
    for (const r of resp.results) {
      const li = document.createElement("li");
      li.className = `result-item ${r.passed ? "pass" : "fail"}`;
      const status = document.createElement("span");
      status.className = "status";
      status.textContent = r.passed ? "PASS" : "FAIL";
      li.appendChild(status);
      li.append(` ${r.id} (${r.runtime_s}s)`);

      if (!r.passed) {
        const detail = document.createElement("div");
        detail.className = "result-detail";
        if (r.steps) {
          // "class"-kind case: walk the operation sequence. r.steps holds only the
          // steps that actually ran (see routers/submissions.py) — a step count short
          // of what the problem defines means a later call crashed and was never tried.
          const lines = [`input: ${JSON.stringify(r.input)}`];
          for (const s of r.steps) {
            const call = `${s.method}(${JSON.stringify(s.args)})`;
            lines.push(
              s.error
                ? `✗ ${call} — error: ${s.error}`
                : `${s.passed ? "✓" : "✗"} ${call} -> your output: ${JSON.stringify(s.actual_output)}, expected: ${JSON.stringify(s.expected_output)}`
            );
          }
          if (r.error && r.steps.length === 0) lines.push(`error: ${r.error}`); // constructor itself failed
          detail.textContent = lines.join("\n");
        } else {
          detail.textContent = r.error
            ? `input: ${JSON.stringify(r.input)}\nerror: ${r.error}`
            : `input: ${JSON.stringify(r.input)}\nyour output: ${JSON.stringify(r.actual_output)}\nexpected: ${JSON.stringify(r.expected_output)}`;
        }
        li.appendChild(detail);
      }
      els.resultsList.appendChild(li);
    }
  }

  async function onRun() {
    if (!state.contract || !state.suite) return;
    els.runBtn.disabled = true;
    try {
      setStatus(els.runStatus, "Running against sandbox...", "");
      const resp = await fetch(`${API_BASE}/api/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          function_signature: state.contract.function_signature,
          code: els.codeInput.value,
          test_cases: state.suite.test_cases,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        const detail = flattenDetail(body?.detail);
        throw new Error(`run failed: ${resp.status}${detail ? ` — ${detail}` : ` ${resp.statusText}`}`);
      }
      const result = await resp.json();
      renderResults(result);
      setStatus(els.runStatus, "", "");
    } catch (err) {
      setStatus(els.runStatus, err.message || String(err), "error");
    } finally {
      els.runBtn.disabled = false;
    }
  }

  // ---------- init ----------

  initTheme();
  initSettingsPanel();
  initSplitView();
  els.generateBtn.addEventListener("click", onGenerate);
  els.loadExampleBtn.addEventListener("click", onLoadExample);
  els.runBtn.addEventListener("click", onRun);
  els.newProblemBtn.addEventListener("click", resetToInput);
})();
