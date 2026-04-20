import { useState, useMemo } from "react"
import { Wrench, ChevronDown, ChevronRight, CheckCircle2, Loader2, Braces } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChatToolCall } from "@/stores/useChatStore"

interface Props {
  toolCalls: ChatToolCall[]
  /** When true, collapse the whole block behind a header so the final chat
   *  message stays clean. Click to expand and inspect tool logs. */
  defaultCollapsed?: boolean
}

// ─── JSON Value Renderer ──────────────────────────────────────────────────────

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1)

  if (value === null) return <span className="text-muted-foreground/40 italic">null</span>
  if (typeof value === "boolean") return <span className="text-amber-500">{String(value)}</span>
  if (typeof value === "number") return <span className="text-sky-500">{String(value)}</span>
  if (typeof value === "string") {
    const truncated = value.length > 300 ? value.slice(0, 300) + "…" : value
    return <span className="text-emerald-600 dark:text-emerald-400 break-all">"{truncated}"</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground/60">[]</span>
    const label = `Array (${value.length})`
    return (
      <span>
        <button onClick={() => setCollapsed(c => !c)}
          className="inline-flex items-center gap-0.5 text-muted-foreground/50 hover:text-foreground/70 transition-colors">
          {collapsed ? <ChevronRight className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
          <span className="text-[10px] font-mono">{label}</span>
        </button>
        {!collapsed && (
          <span className="block ml-3 border-l border-border/50 pl-2 space-y-0.5 mt-0.5">
            {value.slice(0, 20).map((item, i) => (
              <span key={i} className="block text-[11px] font-mono">
                <span className="text-muted-foreground/40">{i}: </span>
                <JsonValue value={item} depth={depth + 1} />
              </span>
            ))}
            {value.length > 20 && (
              <span className="block text-[10px] text-muted-foreground/40 italic">…{value.length - 20} more</span>
            )}
          </span>
        )}
      </span>
    )
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-muted-foreground/60">{"{}"}</span>
    const label = `Object (${entries.length} key${entries.length !== 1 ? "s" : ""})`
    return (
      <span>
        <button onClick={() => setCollapsed(c => !c)}
          className="inline-flex items-center gap-0.5 text-muted-foreground/50 hover:text-foreground/70 transition-colors">
          {collapsed ? <ChevronRight className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
          <span className="text-[10px] font-mono">{label}</span>
        </button>
        {!collapsed && (
          <span className="block ml-3 border-l border-border/50 pl-2 space-y-0.5 mt-0.5">
            {entries.slice(0, 30).map(([k, v]) => (
              <span key={k} className="block text-[11px] font-mono">
                <span className="text-primary/70">"{k}"</span>
                <span className="text-muted-foreground/40">: </span>
                <JsonValue value={v} depth={depth + 1} />
              </span>
            ))}
            {entries.length > 30 && (
              <span className="block text-[10px] text-muted-foreground/40 italic">…{entries.length - 30} more</span>
            )}
          </span>
        )}
      </span>
    )
  }
  return <span className="text-muted-foreground/60">{String(value)}</span>
}

function parseJson(str: string): unknown | null {
  try { return JSON.parse(str) } catch { return null }
}

// ─── Tool Call Card ───────────────────────────────────────────────────────────

function ToolCallCard({ call }: { call: ChatToolCall }) {
  const [inputExpanded, setInputExpanded] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)

  const inputStr = call.input
    ? typeof call.input === "string" ? call.input : JSON.stringify(call.input, null, 2)
    : null

  const resultStr = call.result
    ? typeof call.result === "string" ? call.result : JSON.stringify(call.result, null, 2)
    : null

  const resultParsed = useMemo(() => {
    if (!resultStr) return null
    if (typeof call.result === "object") return call.result
    return parseJson(resultStr)
  }, [resultStr, call.result])

  const inputParsed = useMemo(() => {
    if (!inputStr) return null
    if (typeof call.input === "object") return call.input
    return parseJson(inputStr)
  }, [inputStr, call.input])

  const isRunning = call.status === "running"
  const hasResult = !!resultStr

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-all duration-200",
      isRunning ? "border-amber-500/25 bg-amber-500/3" : "border-border bg-card"
    )}>
      {/* ── Tool header ── */}
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-border/50">
        <div className={cn(
          "flex items-center justify-center w-4 h-4 rounded-full shrink-0",
          isRunning ? "bg-amber-500/20" : "bg-emerald-500/15"
        )}>
          {isRunning
            ? <Loader2 className="w-2.5 h-2.5 text-amber-400 animate-spin" />
            : <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500/70" />
          }
        </div>
        <Wrench className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <span className={cn(
          "text-xs font-mono font-semibold flex-1",
          isRunning ? "text-amber-400/80" : "text-foreground/70"
        )}>
          {call.toolName}
        </span>
        {isRunning && (
          <span className="flex gap-0.5 shrink-0">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-1 h-1 rounded-full bg-amber-400/50 animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </span>
        )}
        <span className={cn(
          "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0",
          isRunning ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
        )}>
          {isRunning ? "running" : "done"}
        </span>
      </div>

      {/* ── Input (collapsible) ── */}
      {inputStr && (
        <div className="border-b border-border/40">
          <button
            onClick={() => setInputExpanded(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-foreground/3 transition-colors text-left"
          >
            {inputExpanded
              ? <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/30 shrink-0" />
              : <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/30 shrink-0" />
            }
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Input</span>
          </button>
          {inputExpanded && (
            <div className={cn(
              "px-3 pb-3 text-[11px] font-mono leading-relaxed overflow-x-auto",
              isRunning ? "bg-amber-500/5" : ""
            )}>
              {isRunning ? (
                <div className="relative">
                  <span className="opacity-40 whitespace-pre-wrap text-muted-foreground/60">{inputStr}</span>
                  <div className="absolute inset-0 shimmer-horizontal pointer-events-none rounded" />
                </div>
              ) : inputParsed !== null ? (
                <div className="py-1">
                  <JsonValue value={inputParsed} depth={0} />
                </div>
              ) : (
                <span className="text-muted-foreground/60 whitespace-pre-wrap">{inputStr}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tool Output (collapsible) ── */}
      {hasResult && (
        <div>
          <button
            onClick={() => setOutputExpanded(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-foreground/3 hover:bg-foreground/5 transition-colors text-left"
          >
            {outputExpanded
              ? <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" />
              : <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" />
            }
            <Braces className="w-3 h-3 text-primary/50 shrink-0" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex-1">Tool output</span>
            <span className="text-[9px] font-mono text-muted-foreground/30">{call.toolName}</span>
          </button>
          {outputExpanded && (
            <div className="px-3 py-2.5 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-64 overflow-y-auto border-t border-border/40">
              {resultParsed !== null ? (
                <JsonValue value={resultParsed} depth={0} />
              ) : (
                <span className="text-muted-foreground/60 whitespace-pre-wrap">{resultStr}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Public Export ────────────────────────────────────────────────────────────

export function ToolCallBlock({ toolCalls, defaultCollapsed = false }: Props) {
  const [open, setOpen] = useState(!defaultCollapsed)
  if (!toolCalls.length) return null
  const runningCount = toolCalls.filter((tc) => tc.status === "running").length
  const doneCount    = toolCalls.length - runningCount
  const summaryBits: string[] = []
  if (runningCount > 0) summaryBits.push(`${runningCount} running`)
  if (doneCount > 0)    summaryBits.push(`${doneCount} done`)
  const summary = summaryBits.join(" · ") || `${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}`

  // When not collapsible (live run), render as before.
  if (!defaultCollapsed) {
    return (
      <div className="flex flex-col gap-2">
        {toolCalls.map((tc) => (
          <ToolCallCard key={tc.id} call={tc} />
        ))}
      </div>
    )
  }
  // Collapsed wrapper — keeps tool logs accessible but out of the way.
  return (
    <div className="rounded-xl border border-border/50 bg-foreground/3 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-foreground/5 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
        }
        <Wrench className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex-1">
          Tool calls · {toolCalls.length}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/40">{summary}</span>
      </button>
      {open && (
        <div className="border-t border-border/40 p-2.5 flex flex-col gap-2 bg-background/50">
          {toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} call={tc} />
          ))}
        </div>
      )}
    </div>
  )
}
