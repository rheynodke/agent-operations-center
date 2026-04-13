import React, { useEffect, useRef, useState, lazy, Suspense } from "react"
import { chatApi, GatewayMessage } from "@/lib/chat-api"
import { cn } from "@/lib/utils"
import {
  ChevronDown, ChevronRight, Brain, Terminal,
  CheckCircle2, Loader2, Zap, AlertCircle, ExternalLink, Link2
} from "lucide-react"
import { useChatStore } from "@/stores/useChatStore"

// Stable fallback — module-level constant so the selector returns the same reference when empty,
// preventing Zustand from triggering re-renders on every call (would cause infinite loop).
const EMPTY: never[] = []

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(content: GatewayMessage["content"]): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content.map(b => ("text" in b ? b.text : "")).filter(Boolean).join("")
}

function isSystemMessage(text: string): boolean {
  const t = text.trim()
  return /^HEARTBEAT_OK$/i.test(t) || /^\[HEARTBEAT\]$/i.test(t) || t === ""
}

/** Detect if a user message is a heartbeat dispatch (should be hidden from task detail) */
function isHeartbeatMessage(m: GatewayMessage): boolean {
  const text = extractText(m.content) || ""
  const t = text.trim().toLowerCase()
  return t.includes("[heartbeat]") || t.includes("heartbeat_ok") || t.includes("heartbeat check")
    || /^\[system[_-]?event\].*heartbeat/i.test(t)
    || /^heartbeat/i.test(t)
}

/** Strip provider-injected markers from assistant response text */
function sanitizeResult(text: string): string {
  return text
    .replace(/\[\[reply_to_current\]\]/gi, "")
    .replace(/\[\[.*?\]\]/g, "")        // any [[...]] marker
    .replace(/^---\s*\n/gm, "")         // stray dividers
    .trim()
}

// ── Markdown ──────────────────────────────────────────────────────────────────

const ReactMarkdown = lazy(() => import("react-markdown"))

function MarkdownContent({ children }: { children: string }) {
  const [plugins, setPlugins] = useState<unknown[]>([])
  useEffect(() => { import("remark-gfm").then(m => setPlugins([m.default])) }, [])
  return (
    <Suspense fallback={<pre className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{children}</pre>}>
      <ReactMarkdown
        remarkPlugins={plugins as never}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed text-sm text-foreground/90">{children}</p>,
          h1: ({ children }) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 text-foreground border-b border-border/40 pb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mb-2 mt-4 first:mt-0 text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mb-2 mt-3 first:mt-0 text-foreground">{children}</h3>,
          ul: ({ children }) => <ul className="mb-3 space-y-1.5 pl-4 list-disc marker:text-muted-foreground/40">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 space-y-1.5 pl-4 list-decimal marker:text-muted-foreground/50">{children}</ol>,
          li: ({ children }) => <li className="text-sm text-foreground/90 leading-relaxed pl-1">{children}</li>,
          code: ({ inline, className: codeClass, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode } & Record<string, unknown>) =>
            inline ? (
              <code className="bg-primary/8 text-primary/90 font-mono text-[11px] px-1.5 py-0.5 rounded border border-primary/10" {...props}>{children}</code>
            ) : (
              <code className={cn("block bg-muted/50 text-foreground/85 font-mono text-[11px] p-3 rounded-md overflow-x-auto leading-relaxed whitespace-pre border border-border/30", codeClass)} {...props}>{children}</code>
            ),
          pre: ({ children }) => <pre className="mb-3 rounded-md overflow-hidden">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 my-3 text-muted-foreground italic">{children}</blockquote>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="text-muted-foreground/80">{children}</em>,
          hr: () => <hr className="my-4 border-border/30" />,
          table: ({ children }) => <div className="overflow-x-auto mb-3 rounded-md border border-border/30"><table className="w-full text-xs border-collapse">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
          th: ({ children }) => <th className="border-b border-border/40 px-3 py-2 font-semibold text-left text-foreground text-[11px] uppercase tracking-wider">{children}</th>,
          td: ({ children }) => <td className="border-b border-border/20 px-3 py-1.5 text-foreground/85">{children}</td>,
          tr: ({ children }) => <tr className="hover:bg-muted/20 transition-colors">{children}</tr>,
          a: ({ children, href }) => (
            <a
              href={href}
              className="inline-flex items-center gap-1 text-primary underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 hover:text-primary/80 break-all"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
              <ExternalLink className="h-2.5 w-2.5 shrink-0 inline opacity-50" />
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </Suspense>
  )
}

// ── Turn types ────────────────────────────────────────────────────────────────

interface ToolCallItem {
  name: string
  input?: string | Record<string, unknown>
  result?: string | Record<string, unknown>
  isError?: boolean
}

// Unified ordered event — preserves sequence of thinking / tool calls / intermediate texts
type TurnEvent =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; item: ToolCallItem }
  | { kind: "intermediate"; text: string }

interface Turn {
  id: number
  events: TurnEvent[]      // ordered: thinking → tools → intermediate texts, in actual sequence
  intermediateText?: string // final result text (last assistant response in this turn)
  isStreaming?: boolean
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = text.split("\n").length
  return (
    <div className="rounded-md border border-purple-500/20 overflow-hidden bg-purple-500/3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-purple-500/5 text-left transition-colors"
      >
        <Brain className="h-3 w-3 text-purple-400 shrink-0" />
        <span className="text-[11px] font-medium text-purple-300/80">Thinking</span>
        <span className="ml-1 text-[10px] text-muted-foreground/40">({lines} lines)</span>
        <span className="ml-auto text-muted-foreground/50 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <pre className="px-3 py-2.5 text-[11px] text-purple-200/60 whitespace-pre-wrap leading-relaxed bg-purple-500/5 border-t border-purple-500/10 overflow-x-auto max-h-56">
          {text}
        </pre>
      )}
    </div>
  )
}

function ToolCallBlock({ item, index }: { item: ToolCallItem; index: number }) {
  const [open, setOpen] = useState(false)

  const rawInput = item.input
  const inputStr = rawInput == null || (typeof rawInput === "object" && Object.keys(rawInput as object).length === 0)
    ? ""
    : typeof rawInput === "object" ? JSON.stringify(rawInput, null, 2) : String(rawInput)
  const resultStr = typeof item.result === "object" ? JSON.stringify(item.result, null, 2) : (item.result || "")
  return (
    <div className={cn("rounded-md border overflow-hidden", item.isError ? "border-destructive/30 bg-destructive/3" : "border-amber-500/20 bg-amber-500/3")}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/3 text-left transition-colors"
      >
        <span className={cn("flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold shrink-0", item.isError ? "bg-destructive/20 text-destructive" : "bg-amber-500/15 text-amber-400")}>
          {index + 1}
        </span>
        <Terminal className={cn("h-3 w-3 shrink-0", item.isError ? "text-destructive" : "text-amber-400")} />
        <span className="font-mono text-[11px] font-medium text-foreground/80 truncate">{item.name}</span>
        {item.isError && <span className="text-destructive text-[9px] ml-1 font-semibold uppercase">error</span>}
        <span className="ml-auto text-muted-foreground/50 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border/20 border-t border-border/20">
          {inputStr && (
            <div className="px-3 py-2 bg-black/5 dark:bg-black/20">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Input</p>
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-40 leading-relaxed">{inputStr}</pre>
            </div>
          )}
          {resultStr && (
            <div className="px-3 py-2 bg-black/3 dark:bg-black/15">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Output</p>
              <pre className={cn("text-[11px] whitespace-pre-wrap overflow-x-auto max-h-40 leading-relaxed", item.isError ? "text-destructive/80" : "text-muted-foreground")}>
                {resultStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProcessLogs({ events }: { events: TurnEvent[] }) {
  const [open, setOpen] = useState(false)
  const toolCount = events.filter(e => e.kind === "tool").length
  if (events.length === 0) return null
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/20 text-left transition-colors"
      >
        <Terminal className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        <span className="text-[10px] text-muted-foreground/50 font-medium">Process logs</span>
        {toolCount > 0 && (
          <span className="text-[10px] text-muted-foreground/35 font-mono tabular-nums">
            {toolCount} tool{toolCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto text-muted-foreground/35 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1.5 border-t border-border/20 bg-muted/5 pt-2">
          {events.map((ev, i) => {
            if (ev.kind === "thinking") return <ThinkingBlock key={i} text={ev.text} />
            if (ev.kind === "tool")     return <ToolCallBlock key={i} item={ev.item} index={i} />
            // intermediate — collapsed note
            return (
              <IntermediateNote key={i} index={i} text={ev.text} />
            )
          })}
        </div>
      )}
    </div>
  )
}

function IntermediateNote({ text, index }: { text: string; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border/20 bg-muted/10 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 text-left transition-colors"
      >
        <span className="flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold shrink-0 bg-muted/30 text-muted-foreground/60">
          {index + 1}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground/60 italic truncate">intermediate note</span>
        <span className="ml-auto text-muted-foreground/40 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-border/20 bg-muted/5">
          <p className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">
            {sanitizeResult(text)}
          </p>
        </div>
      )}
    </div>
  )
}

/** Extract unique, clean URLs from a text blob */
function extractUrls(text: string): string[] {
  // Capture both plain URLs and markdown link URLs [text](url)
  const mdUrls = [...text.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)].map(m => m[2])
  const plainUrls = text.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, " ").match(/https?:\/\/[^\s\)\]\>\"\'\`<]+/g) || []
  const all = [...mdUrls, ...plainUrls]
  const cleaned = all.map(u => u.replace(/[.,;:!?\)\]\>\"\'`]+$/, ""))
  return [...new Set(cleaned)].filter(u => {
    try { new URL(u); return true } catch { return false }
  })
}

function SourcesSection({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const urls = extractUrls(text)
  if (urls.length === 0) return null

  return (
    <div className="border-t border-border/20">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/20 text-left transition-colors"
      >
        <Link2 className="h-3 w-3 text-blue-400/50 shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400/60">Sources</span>
        <span className="text-[10px] text-muted-foreground/35 font-mono tabular-nums ml-1">{urls.length}</span>
        <span className="ml-auto text-muted-foreground/35 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-1 space-y-1 bg-blue-500/2">
          {urls.map((url, i) => {
            let domain = url
            try { domain = new URL(url).hostname.replace(/^www\./, "") } catch {}
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/20 hover:bg-blue-500/8 border border-border/20 hover:border-blue-500/20 transition-colors group"
              >
                <ExternalLink className="h-3 w-3 text-muted-foreground/40 group-hover:text-blue-400/70 shrink-0" />
                <span className="text-[11px] font-medium text-muted-foreground/60 group-hover:text-blue-300/80 shrink-0">{domain}</span>
                <span className="text-[10px] text-muted-foreground/30 truncate font-mono">{url}</span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TurnGroup({ turn, isLast, label, hideLabel }: { turn: Turn; isLast: boolean; label?: string; hideLabel?: boolean }) {
  // Last turn starts open (focus on latest), previous turns collapsed (history)
  const [open, setOpen] = useState(isLast)
  const hasEvents = turn.events.length > 0 || !!turn.intermediateText

  return (
    <div className={cn(
      "rounded-lg border overflow-hidden",
      isLast ? "border-emerald-500/25" : "border-border/40"
    )}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          isLast ? "bg-emerald-500/5 hover:bg-emerald-500/8" : "bg-muted/20 hover:bg-muted/30"
        )}
      >
        {/* Turn label — hidden when single turn */}
        {!hideLabel && (
          <span className={cn(
            "text-[10px] font-semibold uppercase tracking-wider shrink-0 flex items-center gap-1.5",
            isLast ? "text-emerald-400/70" : "text-muted-foreground/50"
          )}>
            {label || `Turn ${turn.id + 1}`}
            {isLast && <span className="text-[9px] font-normal opacity-60">· latest</span>}
          </span>
        )}
        {isLast && turn.isStreaming && (
          <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
        )}

        <span className="flex-1" />

        <span className={cn("text-muted-foreground/40 shrink-0", isLast && "text-emerald-400/40")}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>

      {open && hasEvents && (
        <div className="border-t border-border/30 divide-y divide-border/20">
          {/* Result — shown first and prominently */}
          {turn.intermediateText && (
            <div className="px-3 py-3">
              <MarkdownContent>{turn.intermediateText}</MarkdownContent>
            </div>
          )}

          {/* Sources — auto-extracted URLs from result text */}
          {turn.intermediateText && <SourcesSection text={turn.intermediateText} />}

          {/* Process logs — ordered events (thinking, tools, intermediate notes) */}
          {turn.events.length > 0 && <ProcessLogs events={turn.events} />}
        </div>
      )}
    </div>
  )
}

function AgentResultBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-linear-to-b from-emerald-500/5 to-transparent overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-emerald-500/15 bg-emerald-500/5">
        {isStreaming ? (
          <>
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">Generating…</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">Agent Result</span>
          </>
        )}
      </div>
      <div className="px-4 py-4 space-y-0">
        <MarkdownContent>{text}</MarkdownContent>
        {isStreaming && (
          <span className="inline-flex gap-0.5 ml-1">
            <span className="animate-bounce w-1 h-1 rounded-full bg-emerald-400 inline-block" style={{ animationDelay: "0ms" }} />
            <span className="animate-bounce w-1 h-1 rounded-full bg-emerald-400 inline-block" style={{ animationDelay: "150ms" }} />
            <span className="animate-bounce w-1 h-1 rounded-full bg-emerald-400 inline-block" style={{ animationDelay: "300ms" }} />
          </span>
        )}
      </div>
    </div>
  )
}

// ── Turn grouping ─────────────────────────────────────────────────────────────

/** Extract thinking string from message — handles both direct field and content blocks */
function extractThinkingFromMessage(m: GatewayMessage): string {
  if (m.thinking) return m.thinking
  if (!Array.isArray(m.content)) return ""
  for (const block of m.content as Array<{ type?: string; thinking?: string; text?: string }>) {
    if (block?.type === "thinking" && block.thinking) return block.thinking
    if (block?.type === "thinking" && block.text)     return block.text
  }
  return ""
}

/** Extract tool_use blocks from assistant content array */
function extractToolUseBlocks(m: GatewayMessage): Array<{ id: string; name: string; input: unknown }> {
  if (!Array.isArray(m.content)) return []
  return (m.content as Array<{
    type?: string; id?: string; name?: string
    input?: unknown; arguments?: unknown; parameters?: unknown
    function?: { name?: string; arguments?: unknown }
  }>)
    .filter(b => b?.type === "tool_use" || b?.type === "tool_call" || b?.type === "toolCall")
    .map(b => {
      // Try all known input field names; leave undefined if nothing found
      const input = b.input ?? b.arguments ?? b.parameters ?? b.function?.arguments
      return { id: b.id || "", name: b.name || b.function?.name || "unknown", input }
    })
}

/** Extract tool_result blocks from a user message (Anthropic raw format) */
function extractToolResultBlocks(m: GatewayMessage): Array<{ toolUseId: string; content: unknown; isError?: boolean }> {
  if (m.role !== "user" || !Array.isArray(m.content)) return []
  return (m.content as Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }>)
    .filter(b => b?.type === "tool_result")
    .map(b => ({ toolUseId: b.tool_use_id || "", content: b.content, isError: !!b.is_error }))
}

/** Returns true if a user message is a real dispatch message, not a tool_result carrier or heartbeat */
function isRealUserMessage(m: GatewayMessage): boolean {
  if (m.role !== "user") return false
  if (isHeartbeatMessage(m)) return false
  if (!Array.isArray(m.content)) return !!m.content
  // Pure tool_result carrier — skip
  const blocks = m.content as Array<{ type?: string }>
  return !blocks.every(b => b?.type === "tool_result")
}

function groupMessagesIntoTurns(messages: GatewayMessage[]): {
  turns: Turn[]
  finalResult: string | null
  finalIsStreaming: boolean
} {
  // ── Pre-pass: build toolResult map (Anthropic raw format) ────────────────
  const toolResultMap = new Map<string, { content: unknown; isError?: boolean }>()
  for (const m of messages) {
    for (const r of extractToolResultBlocks(m)) {
      if (r.toolUseId) toolResultMap.set(r.toolUseId, { content: r.content, isError: r.isError })
    }
  }

  // ── Strip heartbeat sequences from messages ─────────────────────────────
  // Heartbeat dispatches create noise (read + exec tool calls with no meaningful output).
  // Remove the heartbeat user message and all subsequent messages until the next real user message.
  const cleanMessages: GatewayMessage[] = []
  let skippingHeartbeat = false
  for (const m of messages) {
    if (m.role === "user" && isHeartbeatMessage(m)) {
      skippingHeartbeat = true
      continue
    }
    if (skippingHeartbeat) {
      // Stop skipping when we hit the next real user message
      if (m.role === "user" && isRealUserMessage(m)) {
        skippingHeartbeat = false
      } else {
        continue
      }
    }
    cleanMessages.push(m)
  }

  // ── Segment messages into turns by real user messages ────────────────────
  // Each dispatch = 1 user message → 1 turn. All intermediate assistant texts
  // within one dispatch cycle go into process logs, not separate turns.
  const segments: GatewayMessage[][] = []
  let seg: GatewayMessage[] = []

  for (const m of cleanMessages) {
    if (isRealUserMessage(m)) {
      // New dispatch = new turn boundary
      if (seg.length > 0) segments.push(seg)
      seg = [m]
    } else {
      seg.push(m)
    }
  }
  if (seg.length > 0) segments.push(seg)

  // ── Process each segment into a Turn ────────────────────────────────────
  const turns: Turn[] = []

  for (const segment of segments) {
    const events: TurnEvent[] = []
    const pairedResultKeys = new Set<string>()
    const assistantTexts: { text: string; streaming: boolean; eventIdx: number }[] = []
    let isStreaming = false

    for (let i = 0; i < segment.length; i++) {
      const m = segment[i]

      if (m.role === "user") continue

      const thinking = extractThinkingFromMessage(m)

      if (m.role === "tool" && m.toolName) {
        const resultMsg = segment.slice(i + 1).find(
          r => r.role === "toolResult" && (r.toolCallId === m.toolCallId || r.toolCallId === m.id)
        )
        if (resultMsg?.id)         pairedResultKeys.add(resultMsg.id)
        if (resultMsg?.toolCallId) pairedResultKeys.add(resultMsg.toolCallId)
        events.push({ kind: "tool", item: {
          name: m.toolName,
          input: m.toolInput,
          result: resultMsg?.toolResult ?? resultMsg?.content,
          isError: m.isError || resultMsg?.isError,
        }})
        continue
      }

      if (m.role === "toolResult") {
        const alreadyPaired =
          pairedResultKeys.has(m.id || "__never__") ||
          pairedResultKeys.has(m.toolCallId || "__never__") ||
          (m.toolCallId ? toolResultMap.has(m.toolCallId) : false)
        if (!alreadyPaired) {
          events.push({ kind: "tool", item: {
            name: m.toolName || "tool_result",
            result: m.toolResult ?? m.content,
            isError: m.isError,
          }})
        }
        continue
      }

      if (m.role === "assistant") {
        if (thinking) events.push({ kind: "thinking", text: thinking })

        const toolUseBlocks = extractToolUseBlocks(m)
        for (const tc of toolUseBlocks) {
          const resultEntry = toolResultMap.get(tc.id)
          if (tc.id) pairedResultKeys.add(tc.id)
          events.push({ kind: "tool", item: {
            name: tc.name,
            input: tc.input as GatewayMessage["toolInput"],
            result: resultEntry?.content as GatewayMessage["toolResult"],
            isError: resultEntry?.isError,
          }})
        }

        const text = extractText(m.content) || m.text || ""
        if (!isSystemMessage(text) && text) {
          // Record position in events so intermediate texts appear in sequence
          assistantTexts.push({ text, streaming: !!m.streaming, eventIdx: events.length })
          events.push({ kind: "intermediate", text }) // placeholder — will be removed if it's the final
          isStreaming = !!m.streaming
        }
      }
    }

    // Last assistant text = final result (shown as the turn's prominent result block)
    // All earlier assistant texts = stay as "intermediate" events in process logs
    let intermediateText: string | undefined
    if (assistantTexts.length > 0) {
      const last = assistantTexts[assistantTexts.length - 1]
      intermediateText = sanitizeResult(last.text)
      isStreaming = last.streaming
      // Remove the placeholder event for the final text (it's shown outside process logs)
      events.splice(last.eventIdx, 1)
    }

    if (events.length > 0 || intermediateText) {
      turns.push({ id: turns.length, events, intermediateText, isStreaming })
    }
  }

  // Flush: if last segment had no user message (e.g. streaming mid-turn)
  // already handled above via segments

  const lastTurn = turns[turns.length - 1] ?? null
  const finalResult = lastTurn?.intermediateText ?? null
  const finalIsStreaming = lastTurn?.isStreaming ?? false

  return { turns, finalResult, finalIsStreaming }
}

// ── Main component ────────────────────────────────────────────────────────────
// 1 Ticket = 1 Session — no multi-session tracking

interface AgentWorkSectionProps {
  sessionKey: string
  taskId?: string
  isActive: boolean
  taskStatus?: string
  completionNoteFallback?: string
}

export function AgentWorkSection({ sessionKey, taskId, isActive, taskStatus, completionNoteFallback }: AgentWorkSectionProps) {
  const [messages, setMessages] = useState<GatewayMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const livePreviewRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(false)

  // Real-time from WS
  const liveMessages = useChatStore(s => (sessionKey ? s.messages[sessionKey] : null) ?? EMPTY)
  const agentRunning = useChatStore(s => (sessionKey ? s.agentRunning[sessionKey] : false) ?? false)
  const isLive = agentRunning || taskStatus === "in_progress"

  async function fetchHistory() {
    if (!activeRef.current || !sessionKey) return
    try {
      const res = await chatApi.getHistory(sessionKey, { taskId })
      setMessages(res.messages || [])
      setError("")
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to load session")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isActive || !sessionKey) {
      setLoading(false)
      return
    }
    activeRef.current = true
    setLoading(true)
    chatApi.subscribe(sessionKey).catch(() => {})
    fetchHistory()
    const interval = taskStatus === "in_progress" ? 2000 : 8000
    pollRef.current = setInterval(fetchHistory, interval)
    return () => {
      activeRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sessionKey, taskStatus])

  // Auto-scroll to live preview (result area) on new polling data — NOT to bottom
  useEffect(() => {
    if (isLive || liveMessages.length > 0) {
      livePreviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [messages.length, liveMessages.length, isLive])

  if (loading) return (
    <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Loading session…</span>
    </div>
  )

  if (error) return (
    <div className="py-8 flex flex-col items-center gap-2 text-center">
      <AlertCircle className="h-5 w-5 text-destructive/60" />
      <p className="text-sm text-destructive/70">Failed to load session</p>
      <p className="text-xs text-muted-foreground">{error}</p>
    </div>
  )

  // Fallback: no session but task has completion note from activity
  if (messages.length === 0 && completionNoteFallback) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-muted/20 border border-border/30">
          <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider">Completed</span>
          <span className="ml-auto text-[10px] text-amber-400/70 font-mono">session log unavailable</span>
        </div>
        <AgentResultBlock text={completionNoteFallback} isStreaming={false} />
      </div>
    )
  }

  // Show live streaming placeholder if agent is running but no committed history yet
  if (messages.length === 0 && agentRunning) {
    const streamingMsg = liveMessages.findLast(m => m.role === "agent")
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-muted/20 border border-border/30">
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            Live — agent working
          </span>
        </div>
        {streamingMsg?.thinking && (
          <div className="rounded-lg border border-purple-500/20 overflow-hidden bg-purple-500/3 px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <Brain className="h-3 w-3 text-purple-400" />
              <span className="text-[10px] text-purple-300/70 font-medium">Thinking…</span>
              <Loader2 className="h-2.5 w-2.5 animate-spin text-purple-400/60 ml-auto" />
            </div>
            <pre className="text-[11px] text-purple-200/60 whitespace-pre-wrap leading-relaxed max-h-32 overflow-hidden">{streamingMsg.thinking}</pre>
          </div>
        )}
        {streamingMsg?.text && (
          <div className="rounded-lg bg-card border border-border/50 px-3 py-3 text-xs text-foreground/80 whitespace-pre-wrap">
            {streamingMsg.text}
            <span className="inline-flex gap-0.5 ml-1 align-middle">
              <span className="animate-bounce w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "0ms" }} />
              <span className="animate-bounce w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "150ms" }} />
              <span className="animate-bounce w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "300ms" }} />
            </span>
          </div>
        )}
        {!streamingMsg && (
          <div className="flex items-center gap-2 text-muted-foreground/60 text-xs py-4 justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Waiting for agent response…</span>
          </div>
        )}
      </div>
    )
  }

  if (messages.length === 0) return (
    <div className="py-8 text-center text-muted-foreground text-sm space-y-1">
      <Zap className="h-5 w-5 mx-auto mb-2 opacity-30" />
      <p>Agent belum mengirim response.</p>
      <p className="text-xs text-muted-foreground/50 font-mono">session: {sessionKey.slice(-12)}</p>
    </div>
  )

  // Group messages from single session into turns
  const { turns, finalResult, finalIsStreaming } = groupMessagesIntoTurns(messages)
  const totalTools = turns.reduce((n, t) => n + t.events.filter(e => e.kind === "tool").length, 0)
  const liveStreamMsg = agentRunning ? liveMessages.findLast(m => m.role === "agent") : null

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-muted/20 border border-border/30">
        {isLive ? (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            Live
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider">
            {taskStatus === "done" || taskStatus === "in_review" ? "Completed" : "Session"}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/40 font-mono">
          {turns.length > 0 && <span>{turns.length} turn{turns.length !== 1 ? "s" : ""}</span>}
          {totalTools > 0 && <span>· {totalTools} tool{totalTools !== 1 ? "s" : ""}</span>}
          <span>· {sessionKey.slice(-8)}</span>
        </span>
      </div>

      {/* Scroll anchor — auto-scroll lands here (shows live preview / latest turn result, not process logs) */}
      <div ref={livePreviewRef} />

      {/* ── Live streaming (when agent is actively running) ── */}
      {liveStreamMsg && (
        <div className="space-y-1.5">
          {liveStreamMsg.thinking && (
            <div className="rounded-lg border border-purple-500/20 overflow-hidden bg-purple-500/3 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <Brain className="h-3 w-3 text-purple-400" />
                <span className="text-[10px] text-purple-300/70 font-medium">Thinking…</span>
                <Loader2 className="h-2.5 w-2.5 animate-spin text-purple-400/60 ml-auto" />
              </div>
              <pre className="text-[11px] text-purple-200/60 whitespace-pre-wrap leading-relaxed max-h-32 overflow-hidden">{liveStreamMsg.thinking}</pre>
            </div>
          )}
          {liveStreamMsg.text && (
            <div className="rounded-lg bg-card border border-emerald-500/20 px-3 py-3 text-xs text-foreground/80 whitespace-pre-wrap">
              {liveStreamMsg.text}
              <span className="inline-flex gap-0.5 ml-1 align-middle">
                <span className="animate-bounce w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "0ms" }} />
                <span className="animate-bounce w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "150ms" }} />
                <span className="animate-bounce w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Turns — last turn on top (focus), previous turns below (history) ── */}
      {turns.length > 0 && (() => {
        const lastTurn = turns[turns.length - 1]
        const prevTurns = turns.slice(0, -1)
        return (
          <div className="space-y-1.5">
            {/* Latest turn — always on top, open by default */}
            <TurnGroup
              key={lastTurn.id}
              turn={lastTurn}
              isLast
              hideLabel={turns.length === 1}
            />
            {/* Previous turns — history, collapsed */}
            {prevTurns.length > 0 && (
              <>
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest font-medium px-1 pt-1">
                  History
                </p>
                {[...prevTurns].reverse().map(turn => (
                  <TurnGroup
                    key={turn.id}
                    turn={turn}
                    isLast={false}
                    hideLabel={false}
                  />
                ))}
              </>
            )}
          </div>
        )
      })()}

    </div>
  )
}
