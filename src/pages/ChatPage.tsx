import { useEffect, useRef, useCallback, useState, useMemo } from "react"
import { useChatStore, gatewayMessagesToGroups, type ChatMessageGroup } from "@/stores/useChatStore"
import { useAgentStore } from "@/stores"
import { chatApi, type ChatSession } from "@/lib/chat-api"
import { ChatMessage } from "@/components/chat/ChatMessage"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { cn } from "@/lib/utils"
import {
  MessageSquarePlus,
  Send,
  StopCircle,
  WifiOff,
  Loader2,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Clock,
} from "lucide-react"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSessionKey(key: string): { agentId: string; channel: string } {
  // key format: "agent:{agentId}:{channel}:{uuid}"
  const parts = key.split(":")
  if (parts[0] === "agent" && parts.length >= 3) {
    return { agentId: parts[1], channel: parts[2] }
  }
  return { agentId: "", channel: "unknown" }
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "telegram") return <img src="/telegram.webp" alt="Telegram" className="w-3 h-3 rounded-full object-cover" />
  if (channel === "whatsapp" || channel === "wa") return <img src="/wa.png" alt="WhatsApp" className="w-3 h-3 rounded-full object-cover" />
  if (channel === "dashboard" || channel === "webchat") return <span className="text-[10px] leading-none">🖥️</span>
  if (channel === "slack") return <span className="text-[10px] leading-none">💬</span>
  if (channel === "discord") return <span className="text-[10px] leading-none">🎮</span>
  return <span className="text-[10px] leading-none">📡</span>
}

function channelLabel(channel: string) {
  if (channel === "dashboard" || channel === "webchat") return "Dashboard"
  return channel.charAt(0).toUpperCase() + channel.slice(1)
}

function relativeTime(ts?: number): string {
  if (!ts) return ""
  const diff = Date.now() - ts
  if (diff < 60_000) return "just now"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}

// ─── Chat Sidebar ─────────────────────────────────────────────────────────────

function ChatSidebar({
  onSelectSession,
  onNewChat,
}: {
  onSelectSession: (key: string) => void
  onNewChat: () => void
}) {
  const { sessions, activeSessionKey, gatewayConnected } = useChatStore()
  const agents = useAgentStore((s) => s.agents)
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set())
  const [collapsedChannels, setCollapsedChannels] = useState<Set<string>>(new Set())
  const [allCollapsed, setAllCollapsed] = useState(false)

  // Group sessions: agent → channel, each sorted newest first
  const grouped = useMemo(() => {
    const agentMap = new Map<string, Map<string, typeof sessions>>()
    const sorted = [...sessions].sort((a, b) =>
      ((b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
    )
    for (const s of sorted) {
      const key = s.sessionKey ?? s.key ?? ""
      const { agentId, channel } = parseSessionKey(key)
      const aid = agentId || s.agentId || "unknown"
      if (!agentMap.has(aid)) agentMap.set(aid, new Map())
      const channelMap = agentMap.get(aid)!
      if (!channelMap.has(channel)) channelMap.set(channel, [])
      channelMap.get(channel)!.push(s)
    }
    return new Map(
      [...agentMap.entries()].sort(([, aMap], [, bMap]) => {
        const latestA = Math.max(...[...aMap.values()].flat().map(s => s.updatedAt ?? s.createdAt ?? 0))
        const latestB = Math.max(...[...bMap.values()].flat().map(s => s.updatedAt ?? s.createdAt ?? 0))
        return latestB - latestA
      })
    )
  }, [sessions])

  const agentIds = useMemo(() => Array.from(grouped.keys()), [grouped])

  // Auto-collapse all agents except the first (most recent) on initial load
  useEffect(() => {
    if (agentIds.length > 1) {
      setCollapsedAgents(new Set(agentIds.slice(1)))
    }
  }, [agentIds.join(",")])  // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAgent = (id: string) => setCollapsedAgents(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const toggleChannel = (key: string) => setCollapsedChannels(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const handleCollapseAll = () => {
    setAllCollapsed(true)
    setCollapsedAgents(new Set(agentIds))
    setCollapsedChannels(new Set())
  }

  const handleExpandAll = () => {
    setAllCollapsed(false)
    setCollapsedAgents(new Set())
    setCollapsedChannels(new Set())
  }

  return (
    <aside className="w-64 shrink-0 flex flex-col h-full border-r border-border bg-background">
      {/* Header */}
      <div className="px-3 pt-4 pb-3 space-y-3">
        {/* Status + collapse controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-1.5 h-1.5 rounded-full transition-colors",
              gatewayConnected ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-foreground/20"
            )} />
            <span className="text-[11px] font-medium text-muted-foreground/50">
              {gatewayConnected ? "Gateway Live" : "Gateway Offline"}
            </span>
          </div>
          {sessions.length > 0 && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleExpandAll}
                className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/40 hover:text-foreground/60 hover:bg-foreground/5 transition-all"
                title="Expand all"
              >
                Expand
              </button>
              <span className="text-muted-foreground/20 text-[10px]">·</span>
              <button
                onClick={handleCollapseAll}
                className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/40 hover:text-foreground/60 hover:bg-foreground/5 transition-all"
                title="Collapse all"
              >
                Collapse
              </button>
            </div>
          )}
        </div>

        {/* New conversation button */}
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/15 border border-primary/20 hover:border-primary/35 text-sm font-medium text-primary/90 hover:text-primary transition-all duration-200 group"
        >
          <MessageSquarePlus className="w-4 h-4 shrink-0 group-hover:scale-110 transition-transform" />
          New Conversation
          <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-40 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all" />
        </button>
      </div>

      <div className="h-px bg-border mx-3" />

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-10 px-4 text-center">
            <div className="w-10 h-10 rounded-2xl bg-foreground/4 border border-foreground/8 flex items-center justify-center">
              <MessageSquarePlus className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <p className="text-xs text-muted-foreground/40 leading-relaxed">
              No conversations yet.<br />Start a new chat above.
            </p>
          </div>
        ) : (
          <div className="px-2 space-y-1">
            {(Array.from(grouped.entries()) as [string, Map<string, typeof sessions>][]).map(([agentId, channelMap]) => {
              const agent = agents.find((a) => a.id === agentId)
              const agentName = agent?.name ?? agentId
              const isAgentCollapsed = collapsedAgents.has(agentId)
              const totalSessions = [...channelMap.values()].reduce((n, arr) => n + arr.length, 0)

              return (
                <div key={agentId} className="rounded-xl overflow-hidden border border-border bg-card">
                  {/* ── Agent row ── */}
                  <button
                    onClick={() => toggleAgent(agentId)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-foreground/4 transition-colors"
                  >
                    <AgentAvatar
                      avatarPresetId={agent?.avatarPresetId}
                      emoji={agent?.emoji ?? "🤖"}
                      size="w-7 h-7"
                    />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-xs font-bold text-foreground/90 truncate leading-tight">{agentName}</p>
                      <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                        {totalSessions} session{totalSessions !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <ChevronDown className={cn(
                      "w-3.5 h-3.5 text-muted-foreground/30 transition-transform duration-200 shrink-0",
                      isAgentCollapsed && "-rotate-90"
                    )} />
                  </button>

                  {/* ── Channels ── */}
                  {!isAgentCollapsed && (
                    <div className="border-t border-border/60">
                      {(Array.from(channelMap.entries()) as [string, typeof sessions][]).map(([channel, chSessions], chIdx) => {
                        const channelGroupKey = `${agentId}:${channel}`
                        const isChannelCollapsed = collapsedChannels.has(channelGroupKey)

                        return (
                          <div key={channel} className={cn(chIdx > 0 && "border-t border-border/40")}>
                            {/* Channel header */}
                            <button
                              onClick={() => toggleChannel(channelGroupKey)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-foreground/3 transition-colors"
                            >
                              <div className="w-3.5 flex justify-center shrink-0">
                                <ChannelIcon channel={channel} />
                              </div>
                              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/45 flex-1 text-left">
                                {channelLabel(channel)}
                              </span>
                              <span className="text-[9px] tabular-nums text-muted-foreground/40 bg-foreground/6 px-1.5 py-0.5 rounded-full">
                                {chSessions.length}
                              </span>
                              <ChevronDown className={cn(
                                "w-2.5 h-2.5 text-muted-foreground/25 ml-1 transition-transform duration-200 shrink-0",
                                isChannelCollapsed && "-rotate-90"
                              )} />
                            </button>

                            {/* Session rows */}
                            {!isChannelCollapsed && (
                              <div className="pb-1">
                                {chSessions.map((s: typeof sessions[0]) => {
                                  const key = s.sessionKey ?? s.key ?? ""
                                  const isActive = key === activeSessionKey
                                  const ts = relativeTime(s.updatedAt ?? s.createdAt)
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => onSelectSession(key)}
                                      className={cn(
                                        "w-full text-left px-3 py-2 mx-0 transition-all duration-150 border-l-2",
                                        isActive
                                          ? "border-l-primary bg-primary/8 text-foreground"
                                          : "border-l-transparent hover:bg-foreground/4 hover:border-l-foreground/15 text-muted-foreground hover:text-foreground"
                                      )}
                                    >
                                      <p className={cn(
                                        "text-[11px] truncate leading-snug",
                                        isActive ? "font-semibold text-foreground" : "text-foreground/65"
                                      )}>
                                        {s.lastMessage || "New chat"}
                                      </p>
                                      {ts && (
                                        <p className="text-[10px] text-muted-foreground/35 mt-0.5 flex items-center gap-1">
                                          <Clock className="w-2.5 h-2.5 shrink-0" />
                                          {ts}
                                        </p>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

// ─── Agent Picker ─────────────────────────────────────────────────────────────

function AgentPicker({ onPick }: { onPick: (agentId: string) => void }) {
  const agents = useAgentStore((s) => s.agents)

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="relative inline-flex mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/25 flex items-center justify-center shadow-[0_0_40px_hsl(var(--primary)/0.15)]">
            <Sparkles className="w-7 h-7 text-primary/70" />
          </div>
          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-400/20 border border-emerald-400/40 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </span>
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2 tracking-tight">Start a Conversation</h2>
        <p className="text-sm text-muted-foreground/60 max-w-xs leading-relaxed">
          Pick an agent to chat with in real-time. Your thinking, tool calls, and responses will stream live.
        </p>
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-2xl">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onPick(agent.id)}
            className="relative flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border border-border bg-card hover:bg-primary/5 hover:border-primary/30 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.15),0_0_20px_hsl(var(--primary)/0.05)] transition-all duration-200 text-left group"
          >
            <AgentAvatar
              avatarPresetId={agent.avatarPresetId}
              emoji={agent.emoji ?? "🤖"}
              size="w-11 h-11"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground group-hover:text-primary/90 transition-colors leading-tight">
                {agent.name}
              </p>
              {agent.description ? (
                <p className="text-[11px] text-muted-foreground/50 mt-0.5 line-clamp-2 leading-snug">{agent.description}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground/30 mt-0.5">Click to start</p>
              )}
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground/20 group-hover:text-primary/50 group-hover:translate-x-0.5 transition-all shrink-0" />
          </button>
        ))}

        {agents.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-3 py-12 text-muted-foreground/40">
            <AlertTriangle className="w-8 h-8" />
            <p className="text-sm">No agents found. Deploy an agent first.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Chat Input ───────────────────────────────────────────────────────────────

function ChatInput({
  onSend,
  onAbort,
  disabled,
  agentRunning,
  agentName,
}: {
  onSend: (text: string) => void
  onAbort: () => void
  disabled?: boolean
  agentRunning?: boolean
  agentName?: string
}) {
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    const t = text.trim()
    if (!t || disabled || agentRunning) return
    onSend(t)
    setText("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }

  return (
    <div className="px-4 pb-4 pt-3">
      <div className={cn(
        "rounded-3xl border transition-all duration-200 shadow-sm",
        agentRunning
          ? "bg-card border-border shadow-amber-500/5"
          : disabled
          ? "bg-muted/50 border-border/50 opacity-60"
          : "bg-card border-border hover:shadow-md focus-within:shadow-md focus-within:border-primary/30"
      )}>
        {/* Input area */}
        <div className="px-5 pt-4 pb-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={
              agentRunning
                ? `${agentName ?? "Agent"} is thinking…`
                : disabled
                ? "Gateway offline – cannot send messages"
                : `Message ${agentName ?? "agent"}…`
            }
            disabled={disabled || agentRunning}
            rows={1}
            className="w-full bg-transparent text-sm text-foreground placeholder-muted-foreground/40 resize-none outline-none leading-relaxed max-h-48 min-h-[24px]"
          />
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          {/* Left: gateway indicator */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
              disabled
                ? "bg-foreground/5 text-muted-foreground/40"
                : "bg-foreground/6 text-muted-foreground/60 hover:bg-foreground/8"
            )}>
              <span className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                disabled ? "bg-foreground/25" : agentRunning ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
              )} />
              {disabled ? "Offline" : agentRunning ? "Responding" : "Gateway"}
            </div>
          </div>

          {/* Right: send / stop */}
          {agentRunning ? (
            <button
              onClick={onAbort}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition-all"
            >
              <StopCircle className="w-3.5 h-3.5" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!text.trim() || disabled}
              className={cn(
                "flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
                text.trim() && !disabled
                  ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_16px_hsl(var(--primary)/0.4)] hover:shadow-[0_0_20px_hsl(var(--primary)/0.5)] scale-100 hover:scale-105"
                  : "bg-foreground/8 text-muted-foreground/30 cursor-not-allowed"
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <p className="text-center text-[10px] text-muted-foreground/20 mt-2">
        Messages route through OpenClaw Gateway
      </p>
    </div>
  )
}

// ─── Chat View ────────────────────────────────────────────────────────────────

function ChatView({ sessionKey }: { sessionKey: string }) {
  const {
    messages,
    appendMessage,
    updateLastAgentMessage,
    agentRunning,
    setAgentRunning,
    sessions,
    gatewayConnected,
  } = useChatStore()
  const agents = useAgentStore((s) => s.agents)

  const session = sessions.find((s) => (s.sessionKey ?? s.key) === sessionKey)
  const agentId = session?.agentId ?? ""
  const agent = agents.find((a) => a.id === agentId)

  const msgs = messages[sessionKey] ?? []
  const isRunning = agentRunning[sessionKey] ?? false
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load history + subscribe for real-time events
  const reloadHistory = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setLoadError(null)
    try {
      const data = await chatApi.getHistory(sessionKey) // also triggers subscribe server-side
      const groups = gatewayMessagesToGroups(data.messages ?? [])
      // Only overwrite if agent is NOT streaming — otherwise we'd clobber live updates
      const currentlyRunning = useChatStore.getState().agentRunning[sessionKey]
      if (!currentlyRunning) {
        useChatStore.getState().setMessages(sessionKey, groups)
      }
    } catch (err: unknown) {
      if (!silent) setLoadError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [sessionKey])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const data = await chatApi.getHistory(sessionKey)
        if (cancelled) return
        const groups = gatewayMessagesToGroups(data.messages ?? [])
        useChatStore.getState().setMessages(sessionKey, groups)
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sessionKey])

  // After agentRunning goes false (agent finished), reload history to get final persisted state
  const prevRunning = useRef(false)
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      // Agent just finished — wait briefly for JSONL to flush, then reload
      const t = setTimeout(() => reloadHistory(true), 2500)
      return () => clearTimeout(t)
    }
    prevRunning.current = isRunning
  }, [isRunning, reloadHistory])

  // Scroll to bottom instantly on initial load, smooth for new messages
  const initialScrollDone = useRef(false)
  useEffect(() => {
    if (!loading && !initialScrollDone.current) {
      initialScrollDone.current = true
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
    }
  }, [loading])
  useEffect(() => {
    if (!initialScrollDone.current) return
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [msgs.length, msgs[msgs.length - 1]?.responseText, msgs[msgs.length - 1]?.toolCalls?.length])

  const handleSend = async (text: string) => {
    if (isRunning) return

    const userMsg: ChatMessageGroup = {
      id: `user-${Math.random().toString(36).slice(2, 10)}`,
      role: "user",
      userText: text,
      timestamp: Date.now(),
    }
    appendMessage(sessionKey, userMsg)

    const agentMsg: ChatMessageGroup = {
      id: `agent-${Math.random().toString(36).slice(2, 10)}`,
      role: "agent",
      agentId,
      toolCalls: [],
      isStreaming: true,
      responseDone: false,
      timestamp: Date.now(),
    }
    appendMessage(sessionKey, agentMsg)
    setAgentRunning(sessionKey, true)

    try {
      await chatApi.sendMessage(sessionKey, text, agentId)
    } catch (err: unknown) {
      updateLastAgentMessage(sessionKey, (m) => ({
        ...m,
        responseText: `❌ Failed to send: ${err instanceof Error ? err.message : "Unknown error"}`,
        responseDone: true,
        isStreaming: false,
      }))
      setAgentRunning(sessionKey, false)
    }
  }

  const handleAbort = async () => {
    try { await chatApi.abortRun(sessionKey) } catch { /* ignore */ }
    setAgentRunning(sessionKey, false)
    updateLastAgentMessage(sessionKey, (m) => ({ ...m, isStreaming: false, responseDone: true }))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="flex items-center gap-3.5 px-6 py-4 border-b border-border bg-background/60 backdrop-blur-sm shrink-0">
        {agent && (
          <AgentAvatar
            avatarPresetId={agent.avatarPresetId}
            emoji={agent.emoji ?? "🤖"}
            size="w-9 h-9"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground leading-tight">{agent?.name ?? agentId}</p>
          <p className="text-[11px] mt-0.5">
            {isRunning ? (
              <span className="text-amber-400/80 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Responding…
              </span>
            ) : (
              <span className={gatewayConnected ? "text-emerald-400/60" : "text-muted-foreground/40"}>
                {gatewayConnected ? "Ready" : "Gateway offline"}
              </span>
            )}
          </p>
        </div>

        {!gatewayConnected && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-destructive/8 border border-destructive/15 text-[11px] text-destructive/70">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            Offline
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-8 space-y-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground/40">
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className="text-sm">Loading conversation…</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24">
              <AlertTriangle className="w-8 h-8 text-destructive/40" />
              <p className="text-sm text-muted-foreground/60">Failed to load history</p>
              <p className="text-xs text-muted-foreground/40">{loadError}</p>
            </div>
          ) : msgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <AgentAvatar
                avatarPresetId={agent?.avatarPresetId}
                emoji={agent?.emoji ?? "🤖"}
                size="w-20 h-20"
              />
              <div>
                <p className="text-base font-bold text-foreground/80 mb-1">{agent?.name ?? "Agent"}</p>
                <p className="text-sm text-muted-foreground/50 max-w-xs">
                  {agent?.description ?? "Send a message to start the conversation."}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/30 mt-2">
                <Sparkles className="w-3 h-3" />
                Thinking, tool calls & responses stream in real-time
              </div>
            </div>
          ) : (
            msgs.map((group, i) => (
              <ChatMessage
                key={group.id}
                group={group}
                agentName={agent?.name}
                agentAvatarPresetId={agent?.avatarPresetId}
                agentEmoji={agent?.emoji}
                isLast={i === msgs.length - 1}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 bg-background/80 backdrop-blur-md">
        <ChatInput
          onSend={handleSend}
          onAbort={handleAbort}
          disabled={!gatewayConnected}
          agentRunning={isRunning}
          agentName={agent?.name}
        />
      </div>
    </div>
  )
}

// ─── ChatPage ─────────────────────────────────────────────────────────────────

export function ChatPage() {
  const {
    activeSessionKey,
    setActiveSessionKey,
    setGatewayConnected,
    sessions,
    setSessions,
  } = useChatStore()
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)

  // Poll gateway status + sessions
  useEffect(() => {
    async function init() {
      try {
        const statusRes = await chatApi.getGatewayStatus()
        setGatewayConnected(!!statusRes.connected)
        if (statusRes.connected) {
          const sessionsRes = await chatApi.getSessions()
          if (sessionsRes.sessions) setSessions(sessionsRes.sessions)
        }
      } catch { /* ignore */ }
    }
    init()
    const t = setInterval(init, 5000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectSession = useCallback(async (key: string) => {
    setActiveSessionKey(key)
    setNewChatOpen(false)
    chatApi.subscribe(key).catch(() => {})
  }, [setActiveSessionKey])

  const handleNewChat = () => {
    setNewChatOpen(true)
    setActiveSessionKey(null)
  }

  const handlePickAgent = async (agentId: string) => {
    if (creatingSession) return
    setCreatingSession(true)
    try {
      const result = await chatApi.createSession(agentId) as Record<string, unknown>
      const key = (result.key as string)
        ?? (result.sessionKey as string)
        ?? ((result.session as Record<string, unknown>)?.key as string)
      if (!key) throw new Error("No session key returned")

      const newSession: ChatSession = {
        sessionKey: key, agentId, channel: "webchat",
        createdAt: Date.now(), updatedAt: Date.now(),
      }
      setSessions([newSession, ...sessions])
      await chatApi.subscribe(key)
      setActiveSessionKey(key)
      setNewChatOpen(false)
    } catch (err: unknown) {
      alert(`Failed to create session: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setCreatingSession(false)
    }
  }

  // ESC → close active session, return to empty state
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeSessionKey) {
        e.stopPropagation()
        setActiveSessionKey(null)
        setNewChatOpen(false)
      }
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [activeSessionKey, setActiveSessionKey])

  const showPicker = newChatOpen || (!activeSessionKey && sessions.length === 0)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <ChatSidebar
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
      />

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background/40">
        {showPicker ? (
          creatingSession ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-muted-foreground/50">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
                  </div>
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary/30 border border-primary/40 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-pulse" />
                  </span>
                </div>
                <p className="text-sm font-medium">Creating session…</p>
                <p className="text-xs text-muted-foreground/30">Connecting to OpenClaw Gateway</p>
              </div>
            </div>
          ) : (
            <AgentPicker onPick={handlePickAgent} />
          )
        ) : activeSessionKey ? (
          <ChatView key={activeSessionKey} sessionKey={activeSessionKey} />
        ) : (
          <AgentPicker onPick={handlePickAgent} />
        )}
      </div>
    </div>
  )
}
