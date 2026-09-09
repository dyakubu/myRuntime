import { formatArgs, formatValue } from "../lib/format.js";

// Deliberately renders ONLY the "example" cases and never the reference solution.
// The /verify response contains both the solution and every edge case's expected
// output — not showing them is the whole point (docs/myruntime-v0-spec.md §9's display
// policy). With the prompt now asking for an edge case per scenario the model can think
// of, each carrying a descriptive label, listing them would hand over exactly the
// reasoning the exercise is meant to provoke.
export default function ProblemPanel({ contract, suite }) {
  const { problem, function_signature: sig, constraints } = contract;
  const examples = suite.test_cases.filter((c) => c.category === "example" && c.verified);
  const hiddenCount = suite.test_cases.filter((c) => c.verified && c.category !== "example").length;

  return (
    <>
      <div className="problem-title-row">
        <h2>{problem.title}</h2>
        {problem.difficulty && (
          <span className="badge" data-difficulty={problem.difficulty}>
            {problem.difficulty}
          </span>
        )}
      </div>

      {problem.topics?.length > 0 && (
        <div className="badges">
          {problem.topics.map((t) => (
            <span className="badge" key={t}>
              {t}
            </span>
          ))}
        </div>
      )}

      <p className="statement">{problem.normalized_statement}</p>

      {examples.length > 0 && (
        <>
          <span className="section-label">Examples</span>
          {examples.map((c, i) => (
            <div className="example-block" key={c.id}>
              <h4>Example {i + 1}</h4>
              {sig.kind === "class" ? (
                <ClassExample sig={sig} testCase={c} />
              ) : (
                <>
                  <div className="example-row">
                    <span className="k">Input: </span>
                    {formatArgs(c.input)}
                  </div>
                  <div className="example-row">
                    <span className="k">Output: </span>
                    {formatValue(c.expected_output)}
                  </div>
                </>
              )}
            </div>
          ))}
        </>
      )}

      {constraints?.raw && (
        <>
          <span className="section-label">Constraints</span>
          <p className="constraints">{constraints.raw}</p>
        </>
      )}

      <p className="hint">
        {examples.length} example{examples.length === 1 ? "" : "s"} shown
        {hiddenCount > 0 && ` · ${hiddenCount} hidden test${hiddenCount === 1 ? "" : "s"} run on Submit`}
      </p>
    </>
  );
}

function ClassExample({ sig, testCase }) {
  return (
    <>
      <div className="example-row">
        <span className="k">Init: </span>
        {sig.name}({formatArgs(testCase.input)})
      </div>
      {(testCase.operations || []).map((op, i) => (
        <div className="example-row" key={i}>
          <span className="k">Call: </span>
          {op.method}({formatArgs(op.args)}) <span className="k">→ </span>
          {formatValue(op.expected_output)}
        </div>
      ))}
    </>
  );
}
