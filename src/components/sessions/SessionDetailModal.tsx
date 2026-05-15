import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { parseMediaAttachments, mediaPathToUrl } from "@/stores/useChatStore"
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage"
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { confirmDialog } from "@/lib/dialogs"
import { Loader2, ChevronDown, Wrench, User, Zap, Hash, DollarSign, Coins, OctagonX } from "lucide-react"
import { useSessionStore, useSessionLiveStore, useAgentStore, useAuthStore } from "@/stores"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import type { Session } from "@/types"

/* ─────────────────────────────────────────────────────────────────── */
/*  TYPES                                                              */
/* ─────────────────────────────────────────────────────────────────── */

interface ToolCall {
  name: string
  input?: string
  output?: string
}

interface SessionEvent {
  id?: string
  role: string
  text: string
  sender?: string | { name?: string; username?: string; id?: string | number } | null
  thinking?: string
  tools: ToolCall[]
  model?: string
  cost: number
  tokens?: {
    input: number
    output: number
    cacheRead: number
    total: number
  } | null
  timestamp?: string
  stopReason?: string | null
}

interface SessionDetail extends Session {
  events: SessionEvent[]
  result?: {
    summary?: string
    status?: string
  } | null
}

type EventType = "user" | "agent" | "thinking" | "tool_use" | "tool_result"

interface FlatEvent {
  id: string
  timestamp: string | null | undefined
  cost: number
  tokens: number
  type: EventType
  title: string
  content: string
  toolName?: string
  images?: string[]
}

/* ─────────────────────────────────────────────────────────────────── */
/*  HELPERS                                                            */
/* ─────────────────────────────────────────────────────────────────── */

function fmtTime(ts?: string | null): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function fmtTokens(n?: number): string {
  if (!n) return "0"
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

function fmtCost(n?: number): string {
  if (!n) return "$0.00"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function getSenderName(sender?: string | { name?: string; username?: string; id?: string | number } | null): string {
  if (!sender) return "User"
  if (typeof sender === "string") return sender
  return sender.name || sender.username || "User"
}

function computeIsProcessing(status: string | undefined): boolean {
  return status === "active" || status === "running"
}

/* ─────────────────────────────────────────────────────────────────── */
/*  MAIN COMPONENT                                                     */
/* ─────────────────────────────────────────────────────────────────── */

interface Props {
  session: Session
  onClose: () => void
}

export function SessionDetailModal({ session, onClose }: Props) {
  // Enrich session agent avatar from the agent store (already merged with DB data)
  const authUser = useAuthStore(s => s.user)
  const storeAgents = useAgentStore(s => s.agents)
  const agentInfo = useMemo(() => {
    const found = storeAgents.find(a => a.id === session.agentId || a.name === session.agentName)
    return {
      avatarPresetId: found?.avatarPresetId ?? session.avatarPresetId ?? null,
      agentEmoji: found?.emoji ?? session.agentEmoji ?? "🤖",
    }
  }, [storeAgents, session.agentId, session.agentName, session.avatarPresetId, session.agentEmoji])
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aborting, setAborting] = useState(false)
  const [abortMsg, setAbortMsg] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null)
  const prevEventCountRef = useRef(0)
  const loadingRef = useRef(false)
  const userScrolledRef = useRef(false)
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)

  const storeSessions = useSessionStore(s => s.sessions)

  const retryCountRef = useRef(0)

  const loadDetail = useCallback(async (showLoader = true) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (showLoader) setLoading(true)
    try {
      // Detail modal shows the full transcript; pass a generous cap to bypass
      // the parser default (5000 events) for very long sessions.
      const data = await api.getSession(session.id, { limit: 20_000 }) as SessionDetail
      setDetail(data)
      setError(null) // clear error only on success
      retryCountRef.current = 0
    } catch {
      // Only set error if we have no data at all — don't wipe loaded data
      if (!detail) {
        setError("Could not load session detail")
      }
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [session.id, detail])

  const handleAbort = useCallback(async () => {
    if (!session.id) return
    if (!await confirmDialog({
      title: "Stop this session?",
      description: "The gateway will abort the current generation. The session stays alive — the user can continue the conversation afterwards.",
      confirmLabel: "Stop",
      destructive: true,
    })) return
    setAborting(true)
    setAbortMsg(null)
    try {
      await api.abortSession(session.id)
      setAbortMsg("🛑 Session interrupted")
      setTimeout(() => setAbortMsg(null), 6000)
    } catch (e) {
      setAbortMsg((e as Error).message || "Abort failed")
      setTimeout(() => setAbortMsg(null), 6000)
    } finally { setAborting(false) }
  }, [session.id])

  // Initial load with retry — new sessions may not be readable immediately
  // (agent is actively writing JSONL, lock file held, sessions.json not flushed yet)
  useEffect(() => {
    loadDetail()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Retry initial load if it failed (up to 5 retries with increasing delay)
  useEffect(() => {
    if (error && !detail && retryCountRef.current < 5) {
      const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current), 4000)
      retryCountRef.current++
      const timer = setTimeout(() => loadDetail(false), delay)
      return () => clearTimeout(timer)
    }
  }, [error, detail, loadDetail])

  const liveStatus = detail?.status ?? session.status
  const events = detail?.events ?? []
  const isProcessing = useMemo(() => computeIsProcessing(liveStatus), [liveStatus])

  const prevStoreRef = useRef<{ status?: string; messageCount?: number }>({})
  useEffect(() => {
    const storeSession = storeSessions.find(s => s.id === session.id)
    if (storeSession && detail) {
      const prev = prevStoreRef.current
      if (storeSession.status !== prev.status || storeSession.messageCount !== prev.messageCount) {
        prevStoreRef.current = { status: storeSession.status, messageCount: storeSession.messageCount }
        loadDetail(false)
      }
    }
  }, [storeSessions, session.id, detail, loadDetail])

  const lastLiveEvent = useSessionLiveStore(s => s.lastEvent)
  useEffect(() => {
    if (!lastLiveEvent || !detail) return
    if (lastLiveEvent.sessionId !== session.id) return
    const newEvt = lastLiveEvent.event as unknown as SessionEvent
    if (!newEvt || !newEvt.role) return
    setDetail(prev => {
      if (!prev) return prev
      if (newEvt.id && prev.events.some(e => e.id === newEvt.id)) return prev
      const last = prev.events[prev.events.length - 1]
      if (last && last.timestamp === newEvt.timestamp && last.role === newEvt.role && last.text === newEvt.text) return prev
      return { ...prev, events: [...prev.events, newEvt] }
    })
  }, [lastLiveEvent, session.id, detail])

  useEffect(() => {
    const interval = isProcessing ? 1500 : 8000
    pollRef.current = setInterval(() => loadDetail(false), interval)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [isProcessing, loadDetail])

  // Auto-scroll to bottom when new events arrive (unless user scrolled up)
  useEffect(() => {
    if (events.length > prevEventCountRef.current) {
      if (!userScrolledRef.current || prevEventCountRef.current === 0) {
        bottomSentinelRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
      }
    }
    prevEventCountRef.current = events.length
  }, [events.length])

  /* ── Flatten events — chronological order (oldest → newest) ── */
  const dashboardUserName = authUser?.displayName || authUser?.username || "User"

  const flatEvents = useMemo(() => {
    const arr: FlatEvent[] = []
    events.forEach((e, idx) => {
      const baseId = e.id || String(idx)
      const rawSender = getSenderName(e.sender)
      const senderName = rawSender === "cli" ? dashboardUserName : rawSender

      if (e.role === "human" || e.role === "user") {
        // mediaFiles comes from backend (extracted before cleanUserMessage strips the block)
        // Fall back to parsing e.text for older/external session formats
        const backendPaths: string[] = (e as { mediaFiles?: string[] }).mediaFiles ?? []
        const { paths: parsedPaths, caption } = parseMediaAttachments(e.text || "")
        const allPaths = backendPaths.length > 0 ? backendPaths : parsedPaths
        arr.push({
          id: `${baseId}-user`,
          timestamp: e.timestamp,
          cost: 0,
          tokens: 0,
          type: "user",
          title: senderName,
          content: caption || e.text || (allPaths.length > 0 ? "" : "<Empty Message>"),
          images: allPaths.length > 0 ? allPaths.map(mediaPathToUrl) : undefined,
        })
      }

      if (e.role === "assistant" && e.thinking) {
        arr.push({ id: `${baseId}-think`, timestamp: e.timestamp, cost: 0, tokens: 0, type: "thinking", title: "Thinking", content: e.thinking })
      }

      if (e.tools && e.tools.length > 0) {
        e.tools.forEach((t, tIdx) => {
          if (t.input) arr.push({ id: `${baseId}-tin-${tIdx}`, timestamp: e.timestamp, cost: 0, tokens: 0, type: "tool_use", title: t.name || "tool", content: t.input, toolName: t.name })
          if (t.output) arr.push({ id: `${baseId}-tout-${tIdx}`, timestamp: e.timestamp, cost: 0, tokens: 0, type: "tool_result", title: t.name || "result", content: t.output, toolName: t.name })
        })
      }

      if (e.role === "toolResult" && e.tools && e.tools.length > 0) {
        e.tools.forEach((t, tIdx) => {
          if (t.output) arr.push({ id: `${baseId}-tresult-${tIdx}`, timestamp: e.timestamp, cost: 0, tokens: 0, type: "tool_result", title: t.name || "result", content: t.output, toolName: t.name })
        })
      }

      if (e.role === "assistant" && e.text) {
        // Extract MEDIA:path inline refs from agent text
        const MEDIA_RE = /MEDIA:([^\s"')\]]+)/g
        const agentImages: string[] = []
        const agentText = e.text.replace(MEDIA_RE, (_, ref) => {
          const url = ref.startsWith("http") ? ref : mediaPathToUrl(ref)
          agentImages.push(url)
          return ""
        }).trim()
        arr.push({
          id: `${baseId}-agent`,
          timestamp: e.timestamp,
          cost: e.cost || 0,
          tokens: e.tokens?.total || 0,
          type: "agent",
          title: "Agent",
          content: agentText,
          images: agentImages.length > 0 ? agentImages : undefined,
        })
      }

      if (e.role === "assistant" && !e.text && (!e.tools || e.tools.length === 0) && !e.thinking) {
        arr.push({ id: `${baseId}-agent-empty`, timestamp: e.timestamp, cost: e.cost || 0, tokens: e.tokens?.total || 0, type: "agent", title: "Agent", content: "<Processing...>" })
      }
    })
    return arr // chronological — no reverse
  }, [events, dashboardUserName])

  const toolCallCount = events.reduce((sum, e) => sum + (e.tools?.filter(t => t.input).length || 0), 0)
  const totalCost = events.reduce((sum, e) => sum + (e.cost || 0), 0) || session.totalCost || 0
  const totalTokens = events.reduce((sum, e) => sum + ((e.tokens?.input || 0) + (e.tokens?.output || 0)), 0) || session.totalTokens || 0
  const INTERNAL_MODELS = ["unknown", "delivery-mirror", "gateway-injected"]
  const displayModel = session.model || events.find(e => e.model && !INTERNAL_MODELS.includes(e.model))?.model || "—"

  const [mobileTab, setMobileTab] = useState<"timeline" | "info">("timeline")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-background border-border sm:rounded-xl shadow-2xl">

        {/* ── Header ── */}
        <DialogHeader className="px-4 md:px-6 pt-4 pb-3.5 shrink-0 border-b border-border">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-mono font-semibold text-sm text-foreground">{session.id.split("-")[0]}</span>
            </div>
            <div className="hidden md:block w-px h-4 bg-border shrink-0" />
            <span className="hidden md:block text-sm text-muted-foreground shrink-0">Agent</span>
            <span className="text-sm font-semibold text-foreground truncate min-w-0 flex-1">{session.agentName}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant="outline" className="hidden sm:inline-flex bg-muted/60 text-muted-foreground border-transparent text-[10px] px-2 py-0 uppercase tracking-wider font-mono">
                {session.trigger || "TELEGRAM"}
              </Badge>
              <Badge className={cn(
                "text-[10px] px-2 py-0 uppercase tracking-wider font-mono border-0 transition-all",
                isProcessing
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              )}>
                {isProcessing ? (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                    LIVE
                  </span>
                ) : "IDLE"}
              </Badge>
              {isProcessing && (
                <button
                  onClick={handleAbort}
                  disabled={aborting}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md border border-red-500/40 text-red-500 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  title="Abort the current generation. The session stays alive."
                >
                  {aborting ? <Loader2 className="h-3 w-3 animate-spin" /> : <OctagonX className="h-3 w-3" />}
                  {aborting ? "Stopping…" : "Stop"}
                </button>
              )}
            </div>
          </div>
          {abortMsg && (
            <p className="mt-2 text-[11px] text-muted-foreground/80">{abortMsg}</p>
          )}
        </DialogHeader>

        {/* ── Mobile tab switcher (hidden on md+) ── */}
        <div className="md:hidden flex shrink-0 border-b border-border">
          {(["timeline", "info"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className={cn(
                "flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                mobileTab === tab
                  ? "text-foreground border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "timeline" ? `Timeline · ${flatEvents.length}` : "Session Info"}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 min-h-0">

          {/* Left: Chat / Timeline */}
          <div
            className={cn(
              "flex-1 flex-col min-w-0 overflow-hidden border-r border-border",
              mobileTab === "info" ? "hidden md:flex" : "flex"
            )}
            ref={scrollAreaRef}
            onScrollCapture={() => { userScrolledRef.current = true }}
          >
            {/* Sub-header — desktop only (mobile uses the tab strip above) */}
            <div className="hidden md:flex px-5 py-2.5 shrink-0 border-b border-border bg-muted/20 items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timeline</span>
              <span className="text-[10px] font-mono text-muted-foreground">{flatEvents.length} events · oldest first</span>
            </div>

            {loading && !detail ? (
              <div className="flex items-center justify-center flex-1 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : !detail && error ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-2">
                {retryCountRef.current < 5 ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Session loading… retrying ({retryCountRef.current}/5)</span>
                  </>
                ) : (
                  <span className="text-sm text-red-500">{error}</span>
                )}
              </div>
            ) : (
              <ScrollArea className="flex-1" type="scroll">
                <div className="px-4 md:px-5 py-4 space-y-1">

                  {/* Non-fatal background poll error — shown inline, doesn't replace timeline */}
                  {error && detail && (
                    <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-red-500/8 border border-red-500/20 text-[11px] text-red-500/80">
                      <span className="shrink-0">⚠</span>
                      <span>Refresh failed — showing cached data</span>
                    </div>
                  )}

                  {flatEvents.length === 0 && !isProcessing && (
                    <div className="text-sm text-muted-foreground text-center py-12">No events in this session.</div>
                  )}

                  {flatEvents.map((ev, i) => (
                    <ChatBubble
                      key={ev.id}
                      ev={ev}
                      prevEv={i > 0 ? flatEvents[i - 1] : undefined}
                      avatarPresetId={agentInfo.avatarPresetId}
                      agentEmoji={agentInfo.agentEmoji}
                    />
                  ))}

                  {/* Processing indicator at bottom (newest activity) */}
                  {isProcessing && (
                    <div className="flex items-center gap-3 py-3 px-4 mt-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                        <Loader2 className="h-3.5 w-3.5 text-emerald-500 animate-spin" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Processing…</div>
                        <div className="text-[11px] text-emerald-600/60 dark:text-emerald-400/50">New events will appear here</div>
                      </div>
                    </div>
                  )}

                  <div ref={bottomSentinelRef} className="h-2" />
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Right: Session Metadata */}
          <div className={cn(
            "shrink-0 flex-col overflow-hidden",
            "w-full md:w-[260px] md:border-none",
            mobileTab === "timeline" ? "hidden md:flex" : "flex"
          )}>
            <div className="hidden md:flex px-5 py-2.5 shrink-0 border-b border-border bg-muted/20">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Session Info</span>
            </div>
            <ScrollArea className="flex-1" type="scroll">
              <div className="px-4 md:px-5 py-4 space-y-4">

                {/* Identity */}
                <div className="space-y-2">
                  <MetaItem icon={<AgentAvatar avatarPresetId={agentInfo.avatarPresetId} emoji={agentInfo.agentEmoji} size="w-4 h-4" />} label="Agent" value={session.agentName} />
                  <MetaItem icon={<Zap className="h-3.5 w-3.5" />} label="Channel" value={session.trigger || "Telegram"} />
                  <MetaItem
                    icon={<span className={cn("w-2 h-2 rounded-full inline-block", isProcessing ? "bg-emerald-500" : "bg-zinc-400")} />}
                    label="Status"
                    value={isProcessing ? "Processing" : liveStatus || "idle"}
                    valueClass={isProcessing ? "text-emerald-600 dark:text-emerald-400" : undefined}
                  />
                </div>

                <div className="h-px bg-border" />

                {/* Model */}
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Model</div>
                  <div className="text-xs font-mono text-foreground/80 bg-muted/40 rounded-lg px-3 py-2 break-all leading-relaxed">
                    {displayModel}
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Stats grid */}
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Stats</div>
                  <div className="grid grid-cols-2 gap-2">
                    <StatTile icon={<Hash className="h-3 w-3" />} label="Messages" value={events.length} />
                    <StatTile icon={<Wrench className="h-3 w-3" />} label="Tool Calls" value={toolCallCount} />
                    <StatTile icon={<Coins className="h-3 w-3" />} label="Tokens" value={totalTokens > 0 ? fmtTokens(totalTokens) : "—"} />
                    <StatTile icon={<DollarSign className="h-3 w-3" />} label="Cost" value={totalTokens > 0 ? fmtCost(totalCost) : "—"} />
                  </div>
                </div>

                {/* Session ID */}
                <div className="h-px bg-border" />
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Session ID</div>
                  <div className="text-[10px] font-mono text-muted-foreground/70 break-all leading-relaxed">{session.id}</div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  IMAGE BLOCK                                                        */
/* ─────────────────────────────────────────────────────────────────── */

function SessionImageBlock({ src }: { src: string }) {
  const [zoomed, setZoomed] = useState(false)
  return (
    <>
      <AuthenticatedImage
        src={src}
        alt="attachment"
        className="max-h-40 max-w-[200px] rounded-xl border border-border object-cover cursor-zoom-in"
        onClick={() => setZoomed(true)}
      />
      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out p-4"
          onClick={() => setZoomed(false)}
        >
          <AuthenticatedImage src={src} alt="attachment" className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl" />
        </div>
      )}
    </>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  CHAT BUBBLE                                                        */
/* ─────────────────────────────────────────────────────────────────── */

function ChatBubble({
  ev,
  prevEv,
  avatarPresetId,
  agentEmoji,
}: {
  ev: FlatEvent
  prevEv?: FlatEvent
  avatarPresetId?: string | null
  agentEmoji?: string
}) {
  const [expanded, setExpanded] = useState(false)

  // Tool/thinking events use compact code block style
  const isBlock = ev.type === "tool_use" || ev.type === "tool_result" || ev.type === "thinking"
  const isUser = ev.type === "user"
  const isAgent = ev.type === "agent"

  // Collapse threshold: shorter for block types
  const COLLAPSE_THRESHOLD = isBlock ? 300 : 600
  const isLong = ev.content.length > COLLAPSE_THRESHOLD
  const displayContent = isLong && !expanded ? ev.content.slice(0, COLLAPSE_THRESHOLD) + "…" : ev.content

  // Show timestamp only when it changes from previous event or first event
  const showTime = !!ev.timestamp && ev.timestamp !== prevEv?.timestamp

  /* ── Block-style events: tool use / tool result / thinking ── */
  if (isBlock) {
    const config = {
      tool_use: {
        label: ev.toolName || "Tool",
        labelClass: "text-violet-700 dark:text-violet-300",
        bg: "bg-violet-500/5 dark:bg-violet-500/8 border-violet-500/15",
        headerBg: "bg-violet-500/10",
        dot: "bg-violet-500",
      },
      tool_result: {
        label: ev.toolName ? `${ev.toolName} → result` : "Result",
        labelClass: "text-amber-700 dark:text-amber-400",
        bg: "bg-amber-500/5 dark:bg-amber-500/8 border-amber-500/15",
        headerBg: "bg-amber-500/10",
        dot: "bg-amber-500",
      },
      thinking: {
        label: "Internal Reasoning",
        labelClass: "text-purple-700 dark:text-purple-300",
        bg: "bg-purple-500/5 dark:bg-purple-500/8 border-purple-500/15",
        headerBg: "bg-purple-500/10",
        dot: "bg-purple-500",
      },
    }[ev.type as "tool_use" | "tool_result" | "thinking"]

    return (
      <div className="pl-4 py-0.5">
        <div className={cn("rounded-lg border overflow-hidden", config.bg)}>
          {/* Block header */}
          <div className={cn("flex items-center gap-2 px-3 py-1.5 min-w-0", config.headerBg)}>
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", config.dot)} />
            <span className={cn("text-[11px] font-semibold tracking-wide shrink-0", config.labelClass)}>
              {ev.type === "tool_use" ? "TOOL" : ev.type === "tool_result" ? "RESULT" : "THINKING"}
            </span>
            <span className="text-[11px] text-muted-foreground truncate min-w-0">{config.label !== "Internal Reasoning" ? config.label : ""}</span>
            {showTime && (
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/50 shrink-0 pl-2">{fmtTime(ev.timestamp)}</span>
            )}
          </div>
          {/* Block body — wrap long lines, horizontal scroll only if truly needed */}
          <div className="overflow-x-auto">
            <pre className="text-[11px] font-mono leading-relaxed px-3 py-2.5 whitespace-pre-wrap break-words text-foreground/70 dark:text-foreground/60 min-w-0" style={{ overflowWrap: 'anywhere' }}>
              {displayContent}
            </pre>
          </div>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground border-t border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform duration-150", expanded && "rotate-180")} />
              {expanded ? "Show less" : `Show all (${ev.content.length.toLocaleString()} chars)`}
            </button>
          )}
        </div>
      </div>
    )
  }

  /* ── User message ── */
  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1 py-1">
        <div className="flex items-end gap-2 max-w-[80%] min-w-0">
          <div className="flex flex-col items-end gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">{fmtTime(ev.timestamp)}</span>
              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">{ev.title}</span>
            </div>
            {ev.images && ev.images.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-end">
                {ev.images.map((src, i) => <SessionImageBlock key={i} src={src} />)}
              </div>
            )}
            {ev.content && (
              <div className="bg-blue-500/10 dark:bg-blue-500/15 border border-blue-500/20 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words min-w-0" style={{ overflowWrap: 'anywhere' }}>
                {displayContent}
                {isLong && (
                  <button onClick={() => setExpanded(!expanded)} className="block mt-1 text-xs text-blue-500 hover:underline cursor-pointer">
                    {expanded ? "show less" : "show more"}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0 mb-0.5">
            <User className="h-3.5 w-3.5 text-blue-500" />
          </div>
        </div>
      </div>
    )
  }

  /* ── Agent message ── */
  if (isAgent) {
    const isEmpty = ev.content === "<Processing...>"
    return (
      <div className="flex flex-col items-start gap-1 py-1">
        <div className="flex items-end gap-2 max-w-[80%] min-w-0">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mb-0.5 overflow-hidden">
            <AgentAvatar avatarPresetId={avatarPresetId} emoji={agentEmoji ?? "🤖"} size="w-8 h-8" />
          </div>
          <div className="flex flex-col items-start gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{ev.title}</span>
              {fmtTime(ev.timestamp) && <span className="text-[11px] text-muted-foreground">{fmtTime(ev.timestamp)}</span>}
            </div>
            {ev.images && ev.images.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ev.images.map((src, i) => <SessionImageBlock key={i} src={src} />)}
              </div>
            )}
            {(ev.content || isEmpty) && (
              <div className={cn(
                "border rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words w-full min-w-0",
                isEmpty
                  ? "bg-muted/30 border-border text-muted-foreground italic"
                  : "bg-emerald-500/8 dark:bg-emerald-500/12 border-emerald-500/20 text-foreground/90"
              )} style={{ overflowWrap: 'anywhere' }}>
                {displayContent}
                {isLong && !isEmpty && (
                  <button onClick={() => setExpanded(!expanded)} className="block mt-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">
                    {expanded ? "show less" : "show more"}
                  </button>
                )}
              </div>
            )}
            {(ev.tokens > 0 || ev.cost > 0) && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/50">
                {ev.tokens > 0 && <span className="flex items-center gap-1"><Coins className="h-2.5 w-2.5" />{fmtTokens(ev.tokens)}</span>}
                {ev.cost > 0 && <span className="flex items-center gap-1"><DollarSign className="h-2.5 w-2.5" />{ev.cost.toFixed(4)}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return null
}

/* ─────────────────────────────────────────────────────────────────── */
/*  SUB-COMPONENTS                                                     */
/* ─────────────────────────────────────────────────────────────────── */

function MetaItem({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn("ml-auto font-medium text-right truncate max-w-[120px]", valueClass || "text-foreground")}>
        {value}
      </span>
    </div>
  )
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-muted/30 border border-border/60 rounded-lg px-3 py-2.5 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span></div>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}
