/**
 * SyntaxEditor — textarea overlay on a syntax-highlighted pre.
 *
 * Architecture:
 *  ┌─ GUTTER (fixed 48px) ─┬─ CODE AREA ─────────────────────┐
 *  │  line numbers          │  highlight layer (pointer-none)  │
 *  │  (read-only)           │  textarea (transparent + caret)  │
 *  └───────────────────────┴──────────────────────────────────┘
 *
 * The gutter is a fixed-width column so we never have em-calculation
 * drift between the highlight layer and the textarea cursor.
 */
import React, { useRef, lazy, Suspense } from "react"
import { cn } from "@/lib/utils"

// ─── Language map ─────────────────────────────────────────────────────────────

export const EXT_LANGUAGE: Record<string, string> = {
  ".sh":   "bash",   ".bash": "bash", ".zsh": "bash", ".fish": "bash",
  ".py":   "python",
  ".js":   "javascript",
  ".ts":   "typescript",
  ".rb":   "ruby",
  ".lua":  "lua",
  ".md":   "markdown",
  ".json": "json",
}

// ─── Highlight style ─────────────────────────────────────────────────────────

const SH_STYLE: Record<string, React.CSSProperties> = {
  "hljs-keyword":    { color: "#c792ea" },
  "hljs-string":     { color: "#c3e88d" },
  "hljs-comment":    { color: "#546e7a", fontStyle: "italic" },
  "hljs-number":     { color: "#f78c6c" },
  "hljs-built_in":   { color: "#82aaff" },
  "hljs-variable":   { color: "#f07178" },
  "hljs-title":      { color: "#82aaff" },
  "hljs-params":     { color: "#e5c07b" },
  "hljs-attr":       { color: "#ffcb6b" },
  "hljs-subst":      { color: "#e06c75" },
  "hljs-meta":       { color: "#89ddff" },
  "hljs-literal":    { color: "#f78c6c" },
  "hljs-type":       { color: "#ffcb6b" },
  "hljs-operator":   { color: "#89ddff" },
}

const SyntaxHighlighter = lazy(() =>
  import("react-syntax-highlighter").then(m => ({ default: m.default }))
)

// ─── Config ───────────────────────────────────────────────────────────────────

const FONT        = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
const FONT_PX     = 13          // px — must be an integer for exact match
const LINE_H      = 1.65
const GUTTER_W    = 48          // fixed px — line number column width
const PAD_TOP     = 12          // px
const PAD_RIGHT   = 16          // px
const PAD_BOTTOM  = 16          // px

// ─── Component ────────────────────────────────────────────────────────────────

interface SyntaxEditorProps {
  value: string
  onChange: (v: string) => void
  ext: string
  readOnly?: boolean
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

export function SyntaxEditor({
  value, onChange, ext, readOnly = false, className, onKeyDown,
}: SyntaxEditorProps) {
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const codeAreaRef  = useRef<HTMLDivElement>(null)
  const gutterRef    = useRef<HTMLDivElement>(null)
  const lang = EXT_LANGUAGE[ext] || "plaintext"

  const lines = value.split("\n")
  // Count lines — always show at least the number of actual lines + 1
  const lineCount = lines.length

  // Sync vertical scroll of gutter and highlight layer with textarea
  function syncScroll() {
    const ta = textareaRef.current
    if (!ta) return
    if (codeAreaRef.current) codeAreaRef.current.scrollTop = ta.scrollTop
    if (gutterRef.current)   gutterRef.current.scrollTop  = ta.scrollTop
  }

  const sharedStyle: React.CSSProperties = {
    fontFamily:  FONT,
    fontSize:    `${FONT_PX}px`,
    lineHeight:  LINE_H,
    margin:      0,
    whiteSpace:  "pre",
    overflowWrap:"normal",
  }

  return (
    <div className={cn("flex w-full h-full overflow-hidden bg-[#0d0d0f]", className)}>

      {/* ── Gutter: fixed-width line numbers ── */}
      <div
        ref={gutterRef}
        aria-hidden
        className="shrink-0 overflow-hidden pointer-events-none select-none"
        style={{
          width: GUTTER_W,
          paddingTop: PAD_TOP,
          paddingBottom: PAD_BOTTOM,
          overflowY: "hidden",
          borderRight: "1px solid rgba(255,255,255,0.04)",
          background: "#0b0b0d",
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            style={{
              ...sharedStyle,
              height: `${FONT_PX * LINE_H}px`,
              textAlign: "right",
              paddingRight: 10,
              paddingLeft: 8,
              color: "#3a3f4b",
              fontSize: 11,
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* ── Code area: highlight layer + textarea overlay ── */}
      <div className="relative flex-1 min-w-0 overflow-hidden">

        {/* Highlight layer — sits behind the textarea */}
        <div
          ref={codeAreaRef}
          aria-hidden
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{ overflowY: "hidden" }}
        >
          <Suspense fallback={
            <pre style={{
              ...sharedStyle,
              padding: `${PAD_TOP}px ${PAD_RIGHT}px ${PAD_BOTTOM}px 12px`,
              color: "#abb2bf",
            }}>
              {value}
            </pre>
          }>
            <SyntaxHighlighter
              language={lang}
              useInlineStyles
              customStyle={{
                ...sharedStyle,
                background: "transparent",
                padding: `${PAD_TOP}px ${PAD_RIGHT}px ${PAD_BOTTOM}px 12px`,
                overflowX: "visible",
                overflowY: "hidden",
              }}
              style={SH_STYLE as never}
              // NO showLineNumbers — gutter handles it separately
              showLineNumbers={false}
            >
              {value.endsWith("\n") ? value : value + "\n"}
            </SyntaxHighlighter>
          </Suspense>
        </div>

        {/* Textarea — same geometry, transparent text, visible caret */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onScroll={syncScroll}
          readOnly={readOnly}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="absolute inset-0 w-full h-full resize-none focus:outline-none z-10"
          style={{
            ...sharedStyle,
            background: "transparent",
            // MUST match highlight layer padding exactly
            padding: `${PAD_TOP}px ${PAD_RIGHT}px ${PAD_BOTTOM}px 12px`,
            color: "transparent",
            caretColor: "#abb2bf",
            tabSize: 2,
            overflowX: "auto",
            overflowY: "auto",
          }}
          onKeyDown={e => {
            if (e.key === "Tab") {
              e.preventDefault()
              const ta  = e.currentTarget
              const s   = ta.selectionStart
              const end = ta.selectionEnd
              const nv  = value.slice(0, s) + "  " + value.slice(end)
              onChange(nv)
              requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = s + 2
                syncScroll()
              })
            }
            onKeyDown?.(e)
          }}
        />
      </div>
    </div>
  )
}
