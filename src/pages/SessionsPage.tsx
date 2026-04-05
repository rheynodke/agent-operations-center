import { useState, useMemo, useEffect } from "react"
import { Search, Zap, MessageSquare, Clock, Loader2, Wrench } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SessionDetailModal } from "@/components/sessions/SessionDetailModal"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { useSessionStore, useAgentStore } from "@/stores"
import { cn } from "@/lib/utils"
import type { Session } from "@/types"

/* ─────────────────────────────────────────────────────────────────── */
/*  RAW API SHAPE (what the backend actually sends)                    */
/* ─────────────────────────────────────────────────────────────────── */

interface RawSession {
  id: string
  key?: string
  name: string
  agent: string
  agentName: string
  agentEmoji?: string
  model: string
  type: string
  subtype?: string
  channelId?: string
  messageCount: number
  toolCalls: number
  tokensIn: number
  tokensOut: number
  cost: number
  lastMessage: string
  lastRole?: string
  updatedAt: number | string
  hasLog?: boolean
  fileSize?: number
  status: string
  source?: string
  // code-agent fields
  duration?: string
  durationMs?: number
  startedAt?: string
  completedAt?: string
}

/* ─────────────────────────────────────────────────────────────────── */
/*  HELPERS                                                            */
/* ─────────────────────────────────────────────────────────────────── */

function relativeTime(timestamp: string | number | null | undefined): string {
  if (!timestamp) return ""
  const now = Date.now()
  const ts = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime()
  if (isNaN(ts) || ts <= 0) return ""

  const diff = now - ts
  if (diff < 0) return "just now"
  if (diff < 1000) return "just now"
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

/* ─────────────────────────────────────────────────────────────────── */
/*  STATUS / TYPE BADGES                                               */
/* ─────────────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active"
  const isFailed = status === "failed" || status === "killed"
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0",
        isActive
          ? "text-emerald-400 bg-emerald-500/15 border border-emerald-500/20"
          : isFailed
            ? "text-red-400 bg-red-500/15 border border-red-500/20"
            : "text-muted-foreground bg-surface-highest border border-border/50"
      )}
    >
      {isActive ? "Active" : isFailed ? "Failed" : status === "completed" ? "Done" : "Idle"}
    </span>
  )
}

function ProcessingBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider text-amber-400 bg-amber-500/15 border border-amber-500/20 animate-pulse shrink-0">
      <Loader2 className="h-3 w-3 animate-spin" />
      Processing
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    telegram: "text-[#5da7e8] bg-[#5da7e8]/10 border-[#5da7e8]/20",
    hook: "text-[#ffb74d] bg-[#ffb74d]/10 border-[#ffb74d]/20",
    cron: "text-[#81c784] bg-[#81c784]/10 border-[#81c784]/20",
    opencode: "text-[#4dd0e1] bg-[#4dd0e1]/10 border-[#4dd0e1]/20",
    direct: "text-[#90caf9] bg-[#90caf9]/10 border-[#90caf9]/20",
    slash: "text-[#ce93d8] bg-[#ce93d8]/10 border-[#ce93d8]/20",
    main: "text-primary bg-primary/10 border-primary/20",
    webchat: "text-primary bg-primary/10 border-primary/20",
  }

  return (
    <span
      className={cn(
        "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border shrink-0",
        colors[type] ?? "text-muted-foreground bg-surface-highest border-border/50"
      )}
    >
      {type}
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  SESSION ROW                                                        */
/* ─────────────────────────────────────────────────────────────────── */

function SessionRow({ session, isProcessing, avatarPresetId, onClick }: {
  session: RawSession
  isProcessing: boolean
  avatarPresetId?: string | null
  onClick: () => void
}) {
  const time = relativeTime(session.updatedAt)
  const totalTokens = (session.tokensIn || 0) + (session.tokensOut || 0)
  const emoji = session.agentEmoji || (session.agent === "main" ? "✨" : "🤖")

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-4 flex items-start gap-4 hover:bg-surface-container transition-colors border-b border-[rgba(72,72,72,0.08)] last:border-0 cursor-pointer",
        isProcessing && "bg-amber-500/3 border-l-2 border-l-amber-500/50"
      )}
    >
      {/* Time */}
      <span className={cn(
        "font-mono text-[11px] mt-1 shrink-0 w-16 text-right tabular-nums",
        isProcessing ? "text-amber-400" : "text-muted-foreground"
      )}>
        {time}
      </span>

      {/* Avatar */}
      <AgentAvatar
        avatarPresetId={avatarPresetId}
        emoji={session.agentEmoji || (session.agent === "main" ? "✨" : "🤖")}
        size="w-8 h-8"
        className="rounded-lg mt-0.5 border border-white/8"
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Agent + session info */}
        <p className="text-sm font-medium text-foreground truncate">
          <span className="text-primary font-bold">{session.agentName || session.agent}</span>{" "}
          <span className="text-muted-foreground">{session.name}</span>
        </p>

        {/* Badges row */}
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {isProcessing ? <ProcessingBadge /> : <StatusBadge status={session.status} />}
          {session.type && <TypeBadge type={session.type} />}
          {session.subtype && <TypeBadge type={session.subtype} />}

          {session.messageCount > 0 && (
            <span className="text-[10px] text-muted-foreground font-medium inline-flex items-center gap-1">
              <MessageSquare className="w-2.5 h-2.5" />
              {session.messageCount}
            </span>
          )}
          {session.toolCalls > 0 && (
            <span className="text-[10px] text-muted-foreground font-medium inline-flex items-center gap-1">
              <Wrench className="w-2.5 h-2.5" />
              {session.toolCalls}
            </span>
          )}
          {totalTokens > 0 && (
            <span className="text-[10px] text-muted-foreground font-medium inline-flex items-center gap-1">
              <Zap className="w-2.5 h-2.5 text-primary/70" />
              {formatTokens(totalTokens)}
            </span>
          )}
          {session.model && (
            <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-[160px]">
              {session.model}
            </span>
          )}
        </div>

        {/* Last message preview */}
        {session.lastMessage && (
          <p className="mt-1.5 text-xs text-muted-foreground/70 truncate max-w-[600px]">
            {session.lastMessage}
          </p>
        )}
      </div>

      {/* Processing pulse indicator */}
      {isProcessing && (
        <div className="shrink-0 mt-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
          </span>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  SESSIONS PAGE                                                      */
/* ─────────────────────────────────────────────────────────────────── */

export function SessionsPage() {
  const sessions = useSessionStore((s) => s.sessions) as unknown as RawSession[]
  const agents = useAgentStore((s) => s.agents)
  // Build avatarPresetId lookup by agent id or name
  const avatarMap = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const a of agents) {
      const presetId = (a as any).avatarPresetId ?? null
      if (a.id) m.set(a.id, presetId)
      if (a.name) m.set(a.name, presetId)
    }
    return m
  }, [agents])
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)

  // Auto-refresh tick for relative timestamps
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(interval)
  }, [])

  // Discover available types from actual data
  const availableTypes = useMemo(() => {
    const types = new Set<string>()
    for (const s of sessions) {
      if (s.type) types.add(s.type)
    }
    return Array.from(types).sort()
  }, [sessions])

  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const ta = typeof a.updatedAt === "number" ? a.updatedAt : new Date(a.updatedAt || 0).getTime()
      const tb = typeof b.updatedAt === "number" ? b.updatedAt : new Date(b.updatedAt || 0).getTime()
      return tb - ta
    })
  }, [sessions])

  const filtered = useMemo(() => {
    return sorted.filter((s) => {
      const q = search.toLowerCase()
      const matchSearch =
        !q ||
        (s.agentName || "").toLowerCase().includes(q) ||
        (s.agent || "").toLowerCase().includes(q) ||
        (s.name || "").toLowerCase().includes(q) ||
        (s.lastMessage || "").toLowerCase().includes(q) ||
        (s.model || "").toLowerCase().includes(q)
      const matchType = typeFilter === "all" || s.type === typeFilter
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && s.status === "active") ||
        (statusFilter === "idle" && s.status === "idle") ||
        (statusFilter === "completed" && s.status === "completed") ||
        (statusFilter === "failed" && (s.status === "failed" || s.status === "killed"))
      return matchSearch && matchType && matchStatus
    })
  }, [sorted, search, typeFilter, statusFilter])

  const activeSessions = sessions.filter((s) => s.status === "active")
  const processingIds = useMemo(() => new Set(activeSessions.map((s) => s.id)), [activeSessions])

  function openModal(session: RawSession) {
    setSelectedSession({
      id: session.id,
      agentId: session.agent,
      agentName: session.agentName || session.agent,
      agentEmoji: session.agentEmoji || (session.agent === "main" ? "✨" : "🤖"),
      type: (session.type || "telegram") as Session["type"],
      status: session.status as Session["status"],
      startTime: typeof session.updatedAt === "number"
        ? new Date(session.updatedAt).toISOString()
        : (session.updatedAt || ""),
      totalCost: session.cost || 0,
      totalTokens: (session.tokensIn || 0) + (session.tokensOut || 0),
      model: session.model || "",
      messageCount: session.messageCount || 0,
      toolUseCount: session.toolCalls || 0,
      taskSummary: session.lastMessage || `${session.agentName} ${session.name}`,
      trigger: session.name,
    })
  }

  return (
    <div className="flex flex-col gap-0 animate-fade-in max-w-[1600px] mx-auto">
      {/* ── Header ── */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">
              Sessions
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Active & historical sessions across all agents
            </p>
          </div>
          <div className="flex items-center gap-3">
            {activeSessions.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                  {activeSessions.length} Active
                </span>
              </span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {filtered.length} session{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search agent, message, model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Type filter — dynamic from data */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTypeFilter("all")}
            className={cn(
              "px-3 py-1 rounded-full text-xs transition-all",
              typeFilter === "all"
                ? "bg-accent/20 text-accent-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
          >
            All
          </button>
          {availableTypes.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                "px-3 py-1 rounded-full text-xs capitalize transition-all",
                typeFilter === t
                  ? "bg-accent/20 text-accent-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1">
          {["all", "active", "idle", "completed", "failed"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1 rounded-full text-xs capitalize transition-all",
                statusFilter === s
                  ? "bg-accent/20 text-accent-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Session List ── */}
      <div className="bg-surface-low rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="p-4 rounded-2xl bg-secondary">
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No sessions match your filters</p>
            <p className="text-xs text-muted-foreground/60">
              Try adjusting your search or filter criteria
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-300px)]">
            {filtered.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isProcessing={processingIds.has(session.id)}
                avatarPresetId={avatarMap.get(session.agent) ?? avatarMap.get(session.agentName) ?? null}
                onClick={() => openModal(session)}
              />
            ))}
          </ScrollArea>
        )}
      </div>

      {/* Session Detail Modal */}
      {selectedSession && (
        <SessionDetailModal session={selectedSession} onClose={() => setSelectedSession(null)} />
      )}
    </div>
  )
}
