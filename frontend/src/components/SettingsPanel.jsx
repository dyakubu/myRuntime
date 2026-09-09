import { useEffect, useRef, useState } from "react";
import { PROVIDERS } from "../lib/providers.js";
import { Settings } from "../lib/storage.js";

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [{ provider, model, apiKey }, setForm] = useState(() => {
    const saved = Settings.getLlmA();
    return { ...saved, model: saved.model || PROVIDERS[saved.provider]?.defaultModel || "" };
  });
  const [saved, setSaved] = useState(false);
  const anchorRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  function update(patch) {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // Switching provider invalidates the selected model — fall back to its default.
      if (patch.provider) next.model = PROVIDERS[patch.provider].defaultModel;
      return next;
    });
    setSaved(false);
  }

  function save() {
    Settings.setLlmA({ provider, model, apiKey });
    setSaved(true);
  }

  const models = PROVIDERS[provider]?.models || [];

  return (
    <div className="settings-anchor" ref={anchorRef}>
      <button
        className="icon-btn"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="LLM settings"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>Settings</span>
      </button>

      {open && (
        <div className="settings-popover">
          <p className="hint">
            Runs in your browser with your own key — never sent to the backend. Only Anthropic and
            Gemini allow direct browser calls.
          </p>
          <label>
            Provider
            <select value={provider} onChange={(e) => update({ provider: e.target.value })}>
              {Object.values(PROVIDERS).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <select value={model} onChange={(e) => update({ model: e.target.value })}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            API key
            <input
              type="password"
              autoComplete="off"
              placeholder="paste your key"
              value={apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
          </label>
          <div className="row">
            <button className="btn btn-primary btn-small" type="button" onClick={save}>
              Save
            </button>
            {saved && <span className="hint success">Saved.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
