import { formatArgs, formatValue } from "../lib/format.js";

// Failing cases reveal their input and expected output — including hidden ones. That's
// the point of Submit: you find out which case broke you. Passing cases stay collapsed
// so a green run doesn't leak the whole suite.
export default function ResultList({ results }) {
  if (!results?.length) return <p className="hint">No cases were run.</p>;

  const failed = results.filter((r) => !r.passed);
  const ordered = [...failed, ...results.filter((r) => r.passed)];

  return ordered.map((r) => (
    <div className={`result-row ${r.passed ? "pass" : "fail"}`} key={r.id}>
      <div className="result-head">
        <span className="result-status">{r.passed ? "PASS" : "FAIL"}</span>
        <span className="result-id">{r.id}</span>
        <span className="hint">{r.runtime_s}s</span>
      </div>

      {/* stdout shows even on a passing case — if you printed something, you want to
          see it, and that's the whole point of print-debugging. */}
      {r.stdout && (
        <div className="result-detail">
          <span className="lbl">Output:</span>
          <span className="val">{r.stdout}</span>
        </div>
      )}

      {!r.passed && (
        <div className="result-detail">
          {r.steps ? (
            <StepDetail steps={r.steps} input={r.input} error={r.error} />
          ) : (
            <>
              <div>
                <span className="lbl">Input: </span>
                <span className="val">{formatArgs(r.input)}</span>
              </div>
              {r.error ? (
                <div>
                  <span className="lbl">Error: </span>
                  <span className="val">{r.error}</span>
                </div>
              ) : (
                <>
                  <div>
                    <span className="lbl">Your output: </span>
                    <span className="val">{formatValue(r.actual_output)}</span>
                  </div>
                  <div>
                    <span className="lbl">Expected: </span>
                    <span className="val">{formatValue(r.expected_output)}</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  ));
}

function StepDetail({ steps, input, error }) {
  return (
    <>
      <div>
        <span className="lbl">Init: </span>
        <span className="val">{formatArgs(input)}</span>
      </div>
      {steps.map((s, i) => (
        <div className={`step-line ${s.passed ? "pass" : "fail"}`} key={i}>
          <span className="val">
            {s.method}({formatArgs(s.args)})
          </span>
          {s.error ? (
            <>
              {" "}
              <span className="lbl">errored: </span>
              <span className="val">{s.error}</span>
            </>
          ) : (
            <>
              {" "}
              <span className="lbl">→ got </span>
              <span className="val">{formatValue(s.actual_output)}</span>
              {!s.passed && (
                <>
                  <span className="lbl">, expected </span>
                  <span className="val">{formatValue(s.expected_output)}</span>
                </>
              )}
            </>
          )}
        </div>
      ))}
      {/* Constructor blew up before any step ran. */}
      {steps.length === 0 && error && (
        <div>
          <span className="lbl">Error: </span>
          <span className="val">{error}</span>
        </div>
      )}
    </>
  );
}
