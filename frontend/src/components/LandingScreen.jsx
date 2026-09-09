export default function LandingScreen({
  problemText,
  onProblemTextChange,
  onGenerate,
  onLoadExample,
  generating,
  status,
}) {
  return (
    <main className="landing">
      <div className="landing-card">
        <div>
          <h1>Paste a problem</h1>
          <p className="landing-lede">
            From CTCI, a textbook, anywhere. You'll get a signature, sandbox-checked tests, and an
            editor to solve it in.
          </p>
        </div>

        <textarea
          value={problemText}
          onChange={(e) => onProblemTextChange(e.target.value)}
          placeholder="Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target…"
          spellCheck="false"
          disabled={generating}
        />

        <div className="row">
          <button className="btn btn-primary" type="button" onClick={onGenerate} disabled={generating}>
            {generating ? "Working…" : "Generate"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onLoadExample} disabled={generating}>
            Load example (Two Sum)
          </button>
          {status && <span className={`hint${status.kind ? ` ${status.kind}` : ""}`}>{status.text}</span>}
        </div>
      </div>
    </main>
  );
}
