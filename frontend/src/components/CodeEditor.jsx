import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { indentUnit } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";

// indentWithTab is opt-in in CodeMirror 6 — without it Tab moves focus out of the
// editor (the accessibility default). In a code editor that's the wrong trade, and it
// was the single worst thing about the old <textarea>.
const extensions = [python(), indentUnit.of("    "), keymap.of([indentWithTab])];

export default function CodeEditor({ value, onChange, theme }) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      height="100%"
      theme={theme === "dark" ? oneDark : "light"}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: false,
        highlightActiveLine: true,
        foldGutter: false,
      }}
    />
  );
}
