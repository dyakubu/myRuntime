import { useEffect, useState } from "react";
import { formatArgs } from "../lib/format.js";
import ResultList from "./ResultList.jsx";

export default function ConsolePanel({ contract, suite, results, running }) {
  const [tab, setTab] = useState("testcase");

  // Jump to Result the moment a run starts, so output isn't hidden behind a tab.
  useEffect(() => {
    if (running) setTab("result");
  }, [running]);

  const examples = suite.test_cases.filter((c) => c.category === "example" && c.verified);

  return (
    <div className="console">
      <div className="console-tabs" role="tablist">
        <button
          className="console-tab"
          role="tab"
          aria-selected={tab === "testcase"}
          onClick={() => setTab("testcase")}
        >
          Testcase
        </button>
        <button
          className="console-tab"
          role="tab"
          aria-selected={tab === "result"}
          onClick={() => setTab("result")}
        >
          Result
        </button>
      </div>

      <div className="console-body">
        {tab === "testcase" ? (
          <TestcaseTab sig={contract.function_signature} examples={examples} />
        ) : (
          <ResultTab results={results} running={running} />
        )}
      </div>
    </div>
  );
}

function TestcaseTab({ sig, examples }) {
  if (!examples.length) return <p className="hint">No example cases available.</p>;
  return examples.map((c, i) => (
    <div className="example-block" key={c.id}>
      <h4>Case {i + 1}</h4>
      {sig.kind === "class" ? (
        <>
          <div className="example-row">
            <span className="k">Init: </span>
            {sig.name}({formatArgs(c.input)})
          </div>
          {(c.operations || []).map((op, j) => (
            <div className="example-row" key={j}>
              <span className="k">Call: </span>
              {op.method}({formatArgs(op.args)})
            </div>
          ))}
        </>
      ) : (
        <div className="example-row">{formatArgs(c.input)}</div>
      )}
    </div>
  ));
}

function ResultTab({ results, running }) {
  if (running) {
    return (
      <p className="hint">
        <span className="spinner-dot" /> Running in the sandbox…
      </p>
    );
  }
  if (!results) return <p className="hint">Run or submit to see results here.</p>;

  const { passed_count: passed, total_count: total, mode } = results;
  const allPassed = total > 0 && passed === total;

  return (
    <>
      <div className={`verdict ${allPassed ? "pass" : "fail"}`}>
        {allPassed ? "Accepted" : "Wrong Answer"}
        <span className="hint" style={{ marginLeft: "0.6rem", fontWeight: 400 }}>
          {passed}/{total} passed · {mode === "run" ? "examples only" : "full suite"}
        </span>
      </div>
      <ResultList results={results.results} />
    </>
  );
}
