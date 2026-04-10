import React, { useEffect, useRef, useState, lazy, Suspense } from "react"
import { chatApi, GatewayMessage } from "@/lib/chat-api"
import { cn } from "@/lib/utils"
import {
  ChevronDown, ChevronRight, Brain, Terminal,
  CheckCircle2, Loader2, Zap, AlertCircle
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
          ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mb-3 space-y-1 pl-1">{children}</ol>,
          li: ({ children }) => <li className="text-sm text-foreground/90 leading-relaxed">{children}</li>,
          code: ({ inline, children, ...props }: { inline?: boolean; children?: React.ReactNode } & Record<string, unknown>) =>
            inline ? (
              <code className="bg-muted/60 text-foreground font-mono text-[11px] px-1.5 py-0.5 rounded" {...props}>{children}</code>
            ) : (
              <code className="block bg-muted/40 text-foreground/85 font-mono text-[11px] p-3 rounded-md overflow-x-auto leading-relaxed whitespace-pre" {...props}>{children}</code>
            ),
          pre: ({ children }) => <pre className="mb-3 rounded-md overflow-hidden">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 my-3 text-muted-foreground italic">{children}</blockquote>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          table: ({ children }) => <div className="overflow-x-auto mb-3"><table className="w-full text-xs border-collapse">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
          th: ({ children }) => <th className="border border-border/40 px-3 py-1.5 font-semibold text-left text-foreground">{children}</th>,
          td: ({ children }) => <td className="border border-border/40 px-3 py-1.5 text-foreground/85">{children}</td>,
          a: ({ children, href }) => <a href={href} className="text-primary underline underline-offset-2 hover:text-primary/80" target="_blank" rel="noopener noreferrer">{children}</a>,
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

interface Turn {
  id: number
  thinkingBlocks: string[]
  toolCalls: ToolCallItem[]
  intermediateText?: string
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
  const inputStr = typeof item.input === "object" ? JSON.stringify(item.input, null, 2) : (item.input || "")
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

function TurnGroup({ turn, isLast }: { turn: Turn; isLast: boolean }) {
  // Always collapsed by default — user opens explicitly
  const [open, setOpen] = useState(false)
  const hasEvents = turn.thinkingBlocks.length > 0 || turn.toolCalls.length > 0 || !!turn.intermediateText

  const toolNames = turn.toolCalls.map(tc => tc.name).filter(n => n !== "tool_result")
  const uniqueTools = [...new Set(toolNames)]

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/20 hover:bg-muted/30 text-left transition-colors"
      >
        {/* Turn label */}
        <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
          Turn {turn.id + 1}
          {isLast && turn.isStreaming && (
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
          )}
        </span>

        {/* Summary chips */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
          {turn.thinkingBlocks.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-purple-400/80 bg-purple-500/10 border border-purple-500/20 rounded px-1.5 py-0.5 shrink-0">
              <Brain className="h-2.5 w-2.5" />
              thinking
            </span>
          )}
          {uniqueTools.slice(0, 4).map((name, i) => (
            <span key={i} className="flex items-center gap-1 text-[10px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 shrink-0">
              <Terminal className="h-2.5 w-2.5" />
              {name}
            </span>
          ))}
          {(turn.toolCalls.length > uniqueTools.slice(0, 4).length || toolNames.length < turn.toolCalls.length) && (
            <span className="text-[10px] text-muted-foreground/40 shrink-0">
              +{turn.toolCalls.length - Math.min(uniqueTools.slice(0, 4).length, turn.toolCalls.length)} more
            </span>
          )}
        </div>

        <span className="ml-auto text-muted-foreground/40 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>

      {open && hasEvents && (
        <div className="px-3 py-2 space-y-1.5 border-t border-border/30 bg-muted/5">
          {turn.thinkingBlocks.map((text, i) => (
            <ThinkingBlock key={`th-${i}`} text={text} />
          ))}
          {turn.toolCalls.map((tc, i) => (
            <ToolCallBlock key={`tc-${i}`} item={tc} index={i} />
          ))}
          {turn.intermediateText && (
            <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Intermediate Response</p>
              <p className="text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed">{turn.intermediateText}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentResultBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/15">
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
      <div className="px-4 py-4">
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

function groupMessagesIntoTurns(messages: GatewayMessage[]): {
  turns: Turn[]
  finalResult: string | null
  finalIsStreaming: boolean
} {
  const turns: Turn[] = []
  let current: Turn = { id: 0, thinkingBlocks: [], toolCalls: [] }
  const allAssistantTexts: { text: string; streaming: boolean }[] = []
  const pairedResultIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === "user") continue

    if (m.thinking) {
      current.thinkingBlocks.push(m.thinking)
      continue
    }

    if (m.role === "tool" && m.toolName) {
      const resultMsg = messages.slice(i + 1).find(
        r => r.role === "toolResult" && (r.toolCallId === m.toolCallId || r.toolCallId === m.id)
      )
      if (resultMsg?.id) pairedResultIds.add(resultMsg.id)
      current.toolCalls.push({
        name: m.toolName,
        input: m.toolInput,
        result: resultMsg?.toolResult ?? resultMsg?.content,
        isError: m.isError || resultMsg?.isError,
      })
      continue
    }

    if (m.role === "toolResult") {
      if (!pairedResultIds.has(m.id || "")) {
        current.toolCalls.push({
          name: "tool_result",
          result: m.toolResult ?? m.content,
          isError: m.isError,
        })
      }
      continue
    }

    if (m.role === "assistant") {
      const text = extractText(m.content) || m.text || ""
      if (isSystemMessage(text)) continue

      allAssistantTexts.push({ text, streaming: !!m.streaming })
      current.intermediateText = text
      current.isStreaming = !!m.streaming
      turns.push({ ...current, thinkingBlocks: [...current.thinkingBlocks], toolCalls: [...current.toolCalls] })
      current = { id: turns.length, thinkingBlocks: [], toolCalls: [] }
    }
  }

  // Flush dangling events (streaming turn without assistant response yet)
  if (current.thinkingBlocks.length > 0 || current.toolCalls.length > 0) {
    current.isStreaming = true
    turns.push({ ...current, thinkingBlocks: [...current.thinkingBlocks], toolCalls: [...current.toolCalls] })
  }

  const lastAssistant = allAssistantTexts[allAssistantTexts.length - 1] ?? null
  const finalResult = lastAssistant?.text ?? null
  const finalIsStreaming = lastAssistant?.streaming ?? false

  // Remove intermediateText from the last closed turn — it's shown in Result section
  if (finalResult) {
    const lastTurnWithText = [...turns].reverse().find(t => t.intermediateText === finalResult)
    if (lastTurnWithText) delete lastTurnWithText.intermediateText
  }

  return { turns, finalResult, finalIsStreaming }
}

// ── Main component ────────────────────────────────────────────────────────────

interface AgentWorkSectionProps {
  sessionKey: string
  isActive: boolean
  taskStatus?: string
  completionNoteFallback?: string
}

export function AgentWorkSection({ sessionKey, isActive, taskStatus, completionNoteFallback }: AgentWorkSectionProps) {
  const [messages, setMessages] = useState<GatewayMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(false)

  // Real-time: read from useChatStore which is updated by WS gateway events.
  // Use module-level EMPTY constant as fallback — inline `[]` would create a new reference
  // on every render, causing Zustand to infinitely trigger re-renders.
  const liveMessages = useChatStore(s => (sessionKey ? s.messages[sessionKey] : null) ?? EMPTY)
  const agentRunning = useChatStore(s => (sessionKey ? s.agentRunning[sessionKey] : false) ?? false)

  // isLive = gateway is actively streaming (WS tells us) OR taskStatus is in_progress
  const isLive = agentRunning || taskStatus === "in_progress"

  async function fetchHistory() {
    if (!activeRef.current) return
    try {
      const res = await chatApi.getHistory(sessionKey)
      const msgs = res.messages || []
      setMessages(msgs)
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
    // Subscribe so gateway pushes WS events → useChatStore gets updated in real-time
    chatApi.subscribe(sessionKey).catch(() => {})
    fetchHistory()
    // Poll committed history as fallback (slower when done, faster when in_progress)
    const interval = taskStatus === "in_progress" ? 2000 : 8000
    pollRef.current = setInterval(fetchHistory, interval)
    return () => {
      activeRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isActive, sessionKey, taskStatus])

  // Auto-scroll when new live messages arrive
  useEffect(() => {
    if (isLive || liveMessages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
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
        <div ref={bottomRef} />
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

  const { turns, finalResult, finalIsStreaming } = groupMessagesIntoTurns(messages)
  const toolCount = turns.reduce((n, t) => n + t.toolCalls.length, 0)
  // Current live streaming message from WS store (if agent is still running)
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
            {taskStatus === "done" || taskStatus === "in_review" ? "Completed" : "Session Replay"}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/40 font-mono">
          {turns.length > 0 && <span>{turns.length} turn{turns.length !== 1 ? "s" : ""}</span>}
          {toolCount > 0 && <span>· {toolCount} tool{toolCount !== 1 ? "s" : ""}</span>}
          <span>· {sessionKey.slice(-8)}</span>
        </span>
      </div>

      {/* Turn groups */}
      {turns.length > 0 && (
        <div className="space-y-1.5">
          {turns.map((turn, i) => (
            <TurnGroup key={turn.id} turn={turn} isLast={i === turns.length - 1} />
          ))}
        </div>
      )}

      {/* Final result from committed history */}
      {finalResult && (
        <div className="space-y-1.5">
          {turns.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-emerald-500/20" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/50">
                {taskStatus === "done" ? "Final Result" : "Result"}
              </span>
              <div className="h-px flex-1 bg-emerald-500/20" />
            </div>
          )}
          <AgentResultBlock text={finalResult} isStreaming={finalIsStreaming} />
        </div>
      )}

      {/* Live streaming layer from WS (useChatStore) — shown when agent is actively running */}
      {liveStreamMsg && (
        <div className="space-y-1.5 border-t border-border/20 pt-2 mt-1">
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

      <div ref={bottomRef} />
    </div>
  )
}
