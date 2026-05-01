import { Suspense, lazy } from "react"
import { useThemeStore } from "@/stores/useThemeStore"
import { Loader2 } from "lucide-react"

// Lazy-load Monaco — only paid when this editor mounts. Bundle-local (no CDN)
// so it works under our strict CSP. Web workers run language services off the
// main thread; loaded once globally per page.
const MonacoEditor = lazy(async () => {
  const [editorWorker, jsonWorker, tsWorker, reactWrapper, monaco] = await Promise.all([
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
    import("@monaco-editor/react"),
    import("monaco-editor"),
  ])
  ;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      if (label === "json") return new jsonWorker.default()
      if (label === "typescript" || label === "javascript") return new tsWorker.default()
      return new editorWorker.default()
    },
  }
  reactWrapper.loader.config({ monaco })
  return { default: reactWrapper.Editor }
})

const EXT_LANGUAGE: Record<string, string> = {
  ".sh":   "shell",
  ".bash": "shell",
  ".zsh":  "shell",
  ".fish": "shell",
  ".py":   "python",
  ".js":   "javascript",
  ".ts":   "typescript",
  ".tsx":  "typescript",
  ".jsx":  "javascript",
  ".rb":   "ruby",
  ".lua":  "lua",
  ".json": "json",
  ".yml":  "yaml",
  ".yaml": "yaml",
  ".md":   "markdown",
}

function detectLanguage(filenameOrExt: string): string {
  const lower = filenameOrExt.toLowerCase()
  for (const [ext, lang] of Object.entries(EXT_LANGUAGE)) {
    if (lower.endsWith(ext)) return lang
  }
  return "plaintext"
}

export interface MonacoCodeEditorProps {
  value: string
  onChange?: (value: string) => void
  /** filename, e.g. "runbook-run.sh", or extension like ".py" — used to pick the language */
  filename?: string
  /** explicit language override (overrides filename detection) */
  language?: string
  height?: string | number
  readOnly?: boolean
  onSave?: () => void
  /** show minimap (default: true). Disable for narrow panels. */
  minimap?: boolean
}

/**
 * General-purpose Monaco editor for code files (bash, python, js/ts, json, yaml, md, etc.).
 * Same lazy-loading + CSP-safe + theme-aware setup as JsonMonacoEditor.
 */
export function MonacoCodeEditor({
  value,
  onChange,
  filename,
  language,
  height = "100%",
  readOnly = false,
  onSave,
  minimap = true,
}: MonacoCodeEditorProps) {
  const theme = useThemeStore((s) => s.theme)
  const lang = language || (filename ? detectLanguage(filename) : "plaintext")

  return (
    <Suspense fallback={
      <div className="h-full w-full flex items-center justify-center text-muted-foreground/60 text-xs gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> loading editor…
      </div>
    }>
      <MonacoEditor
        height={height}
        language={lang}
        value={value}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        onChange={onChange ? (v) => onChange(v ?? "") : undefined}
        onMount={(editor, monaco) => {
          requestAnimationFrame(() => {
            try { editor.layout() } catch { /* disposed */ }
          })
          if (onSave) {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave())
          }
        }}
        options={{
          readOnly,
          automaticLayout: true,
          fontSize: 12,
          fontFamily: '"JetBrains Mono", "Menlo", "Monaco", "Courier New", monospace',
          fontLigatures: true,
          minimap: { enabled: minimap, renderCharacters: false },
          lineNumbers: "on",
          folding: true,
          foldingStrategy: "indentation",
          wordWrap: "off",
          tabSize: 2,
          insertSpaces: true,
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          padding: { top: 12, bottom: 12 },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
        }}
      />
    </Suspense>
  )
}
