import React, { useEffect, useRef, useState } from "react"
import { chatApi, GatewayMessage } from "@/lib/chat-api"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, Brain, Wrench, CheckCircle2, Loader2 } from "lucide-react"

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(content: GatewayMessage["content"]): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content
    .map(b => ("text" in b ? b.text : ""))
    .filter(Boolean)
    .join("")
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 text-left transition-colors"
      >
        <Brain className="h-3 w-3 text-purple-400 shrink-0" />
        <span className="text-muted-foreground font-medium">Thinking</span>
        <span className="ml-auto text-muted-foreground/60">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</span>
      </button>
      {open && (
        <pre className="px-3 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/10 overflow-x-auto">
          {text}
        </pre>
      )}
    </div>
  )
}

function ToolCallBlock({ name, input, result, isError }: {
  name: string
  input?: string | Record<string, unknown>
  result?: string | Record<string, unknown>
  isError?: boolean
}) {
  const [open, setOpen] = useState(false)
  const inputStr = typeof input === "object" ? JSON.stringify(input, null, 2) : (input || "")
  const resultStr = typeof result === "object" ? JSON.stringify(result, null, 2) : (result || "")

  return (
    <div className={cn("rounded-lg border overflow-hidden text-xs", isError ? "border-destructive/40" : "border-border/50")}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 text-left transition-colors"
      >
        <Wrench className={cn("h-3 w-3 shrink-0", isError ? "text-destructive" : "text-amber-400")} />
        <span className="font-mono font-medium text-foreground/80 truncate">{name}</span>
        {isError && <span className="text-destructive text-[10px] ml-1">error</span>}
        <span className="ml-auto text-muted-foreground/60 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border/30">
          {inputStr && (
            <div className="px-3 py-2 bg-muted/5">
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">Input</p>
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap overflow-x-auto">{inputStr}</pre>
            </div>
          )}
          {resultStr && (
            <div className="px-3 py-2 bg-muted/5">
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">Result</p>
              <pre className={cn("text-[11px] whitespace-pre-wrap overflow-x-auto", isError ? "text-destructive/80" : "text-muted-foreground")}>
                {resultStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AssistantMessage({ text, isFinal, isStreaming }: { text: string; isFinal: boolean; isStreaming: boolean }) {
  return (
    <div className={cn(
      "rounded-lg px-3 py-3 text-xs whitespace-pre-wrap leading-relaxed border",
      isFinal
        ? "bg-emerald-500/8 border-emerald-500/20"
        : "bg-card border-border/50"
    )}>
      {isFinal && (
        <div className="flex items-center gap-1.5 mb-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span className="text-emerald-500 font-semibold text-[11px] uppercase tracking-wide">Final Result</span>
        </div>
      )}
      <span className="text-foreground/90">{text}</span>
      {isStreaming && <span className="inline-flex gap-0.5 ml-1">
        <span className="animate-bounce delay-0 w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "0ms" }} />
        <span className="animate-bounce w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "150ms" }} />
        <span className="animate-bounce w-1 h-1 rounded-full bg-current inline-block" style={{ animationDelay: "300ms" }} />
      </span>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface AgentWorkTabProps {
  sessionKey: string
  agentId: string
  isActive: boolean          // whether this tab is currently visible
  taskStatus?: string
}

export function AgentWorkTab({ sessionKey, agentId, isActive, taskStatus }: AgentWorkTabProps) {
  const [messages, setMessages] = useState<GatewayMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [isLive, setIsLive] = useState(false)
  const [error, setError] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(false)

  async function fetchHistory() {
    if (!activeRef.current) return
    try {
      const res = await chatApi.getHistory(sessionKey)
      const msgs = res.messages || []
      setMessages(msgs)
      const streaming = msgs.some(m => m.streaming)
      setIsLive(streaming)
      setError("")
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to load session")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isActive || !sessionKey) return
    activeRef.current = true
    setLoading(true)

    // Subscribe for real-time WS push from gateway
    chatApi.subscribe(sessionKey).catch(() => {})

    // Initial fetch
    fetchHistory()

    // Poll every 2s while in_progress; slow to 5s when done
    const interval = taskStatus === "in_progress" ? 2000 : 5000
    pollRef.current = setInterval(fetchHistory, interval)

    return () => {
      activeRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isActive, sessionKey, taskStatus])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages.length])

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading session…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-10 text-center text-destructive/70 text-xs space-y-1">
        <p>Failed to load session</p>
        <p className="text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground text-sm space-y-1">
        <p>Agent belum mengirim response.</p>
        <p className="text-xs text-muted-foreground/60">Session: {sessionKey.slice(-12)}</p>
      </div>
    )
  }

  // Group messages for rendering
  // Collect tool calls + their results together
  const toolCallMap = new Map<string, { msg: GatewayMessage; result?: GatewayMessage }>()
  const renderedIds = new Set<string>()
  const renderOrder: Array<{ kind: "user" | "thinking" | "tool" | "assistant"; msg: GatewayMessage; toolResult?: GatewayMessage }> = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const id = m.id || String(i)

    if (m.role === "user") {
      renderOrder.push({ kind: "user", msg: m })
    } else if (m.thinking) {
      renderOrder.push({ kind: "thinking", msg: m })
    } else if (m.role === "tool" && m.toolName) {
      // Find the matching toolResult
      const resultMsg = messages.slice(i + 1).find(
        r => r.role === "toolResult" && (r.toolCallId === m.toolCallId || r.toolCallId === m.id)
      )
      renderOrder.push({ kind: "tool", msg: m, toolResult: resultMsg })
    } else if (m.role === "toolResult") {
      // Skip if already consumed by a tool call
      const alreadyPaired = renderOrder.some(
        r => r.toolResult?.id === m.id || r.toolResult?.toolCallId === m.toolCallId
      )
      if (!alreadyPaired) {
        renderOrder.push({ kind: "tool", msg: { role: "tool", toolName: "tool_result", toolResult: m.toolResult, isError: m.isError }, toolResult: m })
      }
    } else if (m.role === "assistant") {
      renderOrder.push({ kind: "assistant", msg: m })
    }
  }

  const lastAssistantIdx = renderOrder.reduce((last, r, i) => r.kind === "assistant" ? i : last, -1)

  return (
    <div className="space-y-2 pb-2">
      {/* Live indicator */}
      <div className="flex items-center gap-2 pb-1 border-b border-border/30">
        {isLive ? (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium uppercase tracking-wide">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            Live
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">
            {taskStatus === "done" ? "Completed" : "Session replay"}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/40 font-mono">
          {messages.length} events · {sessionKey.slice(-8)}
        </span>
      </div>

      {/* Messages */}
      {renderOrder.map((item, i) => {
        if (item.kind === "user") {
          const text = extractText(item.msg.content) || item.msg.text || ""
          return (
            <div key={i} className="flex justify-end">
              <div className="bg-primary/10 border border-primary/20 text-foreground text-xs rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-wrap leading-relaxed">
                {text}
              </div>
            </div>
          )
        }

        if (item.kind === "thinking") {
          return <ThinkingBlock key={i} text={item.msg.thinking!} />
        }

        if (item.kind === "tool") {
          return (
            <ToolCallBlock
              key={i}
              name={item.msg.toolName || "tool"}
              input={item.msg.toolInput}
              result={item.toolResult?.toolResult ?? item.toolResult?.content}
              isError={item.msg.isError || item.toolResult?.isError}
            />
          )
        }

        if (item.kind === "assistant") {
          const text = extractText(item.msg.content) || item.msg.text || ""
          if (!text) return null
          const isFinal = i === lastAssistantIdx && taskStatus === "done"
          const isStreaming = !!item.msg.streaming
          return (
            <AssistantMessage key={i} text={text} isFinal={isFinal} isStreaming={isStreaming} />
          )
        }

        return null
      })}

      <div ref={bottomRef} />
    </div>
  )
}
