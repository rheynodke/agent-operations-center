import { Suspense, lazy } from "react"
import { useThemeStore } from "@/stores/useThemeStore"
import { Loader2 } from "lucide-react"

// Lazy-load Monaco — it's ~2.5MB, only paid when this editor mounts.
// We bundle monaco-editor locally (instead of @monaco-editor/loader's default
// CDN fetch) so it works under our strict CSP (script-src 'self').
const MonacoEditor = lazy(async () => {
  // Set up Monaco's web-worker environment BEFORE loading the editor so
  // language services (JSON parser/completion) run off the main thread.
  // Vite's `?worker` query bundles each as its own worker chunk.
  const [editorWorker, jsonWorker, reactWrapper, monaco] = await Promise.all([
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("@monaco-editor/react"),
    import("monaco-editor"),
  ])
  ;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "json") return new jsonWorker.default()
      return new editorWorker.default()
    },
  }
  // Tell @monaco-editor/loader to use our bundled monaco instead of CDN
  reactWrapper.loader.config({ monaco })
  return { default: reactWrapper.Editor }
})

export interface JsonMonacoEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string | number
  readOnly?: boolean
  /** Triggered when user invokes "Format Document" (Shift+Alt+F) */
  onFormat?: () => void
  /** Triggered when user invokes Cmd/Ctrl+S */
  onSave?: () => void
}

/**
 * Monaco-based JSON editor with full LSP features:
 *  - syntax highlight + bracket matching
 *  - real-time error squiggles (parse errors)
 *  - code folding (gutter)
 *  - format document (Shift+Alt+F or external trigger)
 *  - minimap + find/replace (Cmd+F)
 *  - theme follows dashboard light/dark
 */
export function JsonMonacoEditor({
  value,
  onChange,
  height = "100%",
  readOnly = false,
  onFormat,
  onSave,
}: JsonMonacoEditorProps) {
  const theme = useThemeStore((s) => s.theme)

  return (
    <Suspense fallback={
      <div className="h-full w-full flex items-center justify-center text-muted-foreground/60 text-xs gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> loading editor…
      </div>
    }>
      <MonacoEditor
        height={height}
        defaultLanguage="json"
        language="json"
        value={value}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        onChange={(v) => onChange(v ?? "")}
        onMount={(editor, monaco) => {
          // Belt + suspenders: even with automaticLayout, force a re-layout
          // after the next animation frame so we cover the case where the
          // parent's flex resolution lands AFTER Monaco's first measure.
          requestAnimationFrame(() => {
            try { editor.layout() } catch { /* editor disposed */ }
          })
          // JSON language defaults — enable schema validation on
          monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: false,
            schemas: [],
            enableSchemaRequest: false,
          })
          // Format-on-save shortcut — Cmd/Ctrl+S
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            onSave?.()
          })
          // Format shortcut — Shift+Alt+F (Monaco default)
          editor.addAction({
            id: "aoc-format-json",
            label: "Format JSON",
            keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
            run: (ed) => {
              ed.getAction("editor.action.formatDocument")?.run()
              onFormat?.()
            },
          })
        }}
        options={{
          readOnly,
          // CRITICAL: re-measures container on resize via ResizeObserver. Without
          // this, Monaco only sizes itself once at mount — if the parent's height
          // is still settling at that moment (common with flex/lazy layouts),
          // the editor renders into a 0-height box and content is invisible.
          automaticLayout: true,
          fontSize: 12,
          fontFamily: '"JetBrains Mono", "Menlo", "Monaco", "Courier New", monospace',
          fontLigatures: true,
          minimap: { enabled: true, renderCharacters: false },
          lineNumbers: "on",
          folding: true,
          foldingStrategy: "indentation",
          wordWrap: "off",
          tabSize: 2,
          insertSpaces: true,
          formatOnPaste: true,
          formatOnType: true,
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          padding: { top: 12, bottom: 12 },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          quickSuggestions: { other: true, comments: false, strings: true },
          suggest: { showKeywords: false },
        }}
      />
    </Suspense>
  )
}

