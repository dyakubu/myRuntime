import { useCallback, useEffect, useRef, useState } from "react";
import ProblemPanel from "./ProblemPanel.jsx";
import CodeEditor from "./CodeEditor.jsx";
import ConsolePanel from "./ConsolePanel.jsx";

const SPLIT_KEY = "myruntime.split";

export default function SolveView({
  contract,
  suite,
  code,
  onCodeChange,
  theme,
  onRun,
  running,
  results,
  runError,
}) {
  const splitRef = useRef(null);
  const [leftPct, setLeftPct] = useState(() => Number(localStorage.getItem(SPLIT_KEY)) || 42);
  const draggingRef = useRef(false);

  const onMove = useCallback((clientX) => {
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.min(70, Math.max(22, ((clientX - rect.left) / rect.width) * 100));
    setLeftPct(pct);
  }, []);

  useEffect(() => {
    const move = (e) => draggingRef.current && onMove(e.clientX);
    const touchMove = (e) => draggingRef.current && e.touches[0] && onMove(e.touches[0].clientX);
    const stop = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove("is-resizing");
      setLeftPct((pct) => {
        localStorage.setItem(SPLIT_KEY, String(pct));
        return pct;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", touchMove, { passive: true });
    window.addEventListener("touchend", stop);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("touchend", stop);
    };
  }, [onMove]);

  function startDrag(e) {
    draggingRef.current = true;
    document.body.classList.add("is-resizing");
    if (e.type === "mousedown") e.preventDefault();
  }

  const gradableCount = suite.test_cases.filter((c) => c.verified).length;

  return (
    <main className="split-view" ref={splitRef}>
      <section className="pane pane-left" style={{ flexBasis: `${leftPct}%` }}>
        <ProblemPanel contract={contract} suite={suite} />
      </section>

      <div
        className="divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />

      <section className="pane pane-right">
        <div className="editor-pane">
          <div className="editor-header">
            <span className="section-label">Python</span>
            <div className="row">
              {runError && <span className="hint error">{runError}</span>}
              <button
                className="btn btn-small"
                type="button"
                onClick={() => onRun("run")}
                disabled={!!running || gradableCount === 0}
              >
                {running === "run" ? "Running…" : "Run"}
              </button>
              <button
                className="btn btn-success btn-small"
                type="button"
                onClick={() => onRun("submit")}
                disabled={!!running || gradableCount === 0}
              >
                {running === "submit" ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>

          <div className="editor-host">
            <CodeEditor value={code} onChange={onCodeChange} theme={theme} />
          </div>

          <ConsolePanel contract={contract} suite={suite} results={results} running={running} />
        </div>
      </section>
    </main>
  );
}
