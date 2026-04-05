import { useState, useMemo, useEffect, useRef } from "react"
import { Search, Bot, Plus, Filter, ChevronDown, ChevronUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAgentStore, useSessionStore } from "@/stores"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types"
import { useNavigate } from "react-router-dom"
import { ProvisionAgentWizard } from "@/components/agents/ProvisionAgentWizard"
import { AgentAvatar } from "@/components/agents/AgentAvatar"

/* ─────────────────────────────────────────────────────────────────── */
/*  RAW SESSION SHAPE (same as SessionsPage)                           */
/* ─────────────────────────────────────────────────────────────────── */

interface RawSession {
  id: string
  agent: string
  agentName: string
  agentEmoji?: string
  name: string
  type: string
  subtype?: string
  status: string
  messageCount: number
  lastMessage: string
  updatedAt: number | string
  model?: string
  cost: number
  tokensIn?: number
  tokensOut?: number
  toolCalls?: number
}

/* ─────────────────────────────────────────────────────────────────── */
/*  HELPERS                                                            */
/* ─────────────────────────────────────────────────────────────────── */

function fmtTime(timestamp: number | string): string {
  const ts = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime()
  if (isNaN(ts) || ts <= 0) return ""
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

/* ─────────────────────────────────────────────────────────────────── */
/*  AGENT CARD                                                         */
/* ─────────────────────────────────────────────────────────────────── */

function AgentCard({ agent, isProcessing, activeSessions, onClick }: {
  agent: Agent
  isProcessing: boolean
  activeSessions: number
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer bg-[#1A1C21]/60 hover:bg-[#22252C] border border-white/5 rounded-xl transition-all duration-300 hover:border-white/10 group flex flex-col p-5 relative overflow-hidden",
        isProcessing && "border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.06)]"
      )}
    >
      {/* Processing glow */}
      {isProcessing && (
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none" />
      )}

      <div className="relative z-10">
        {/* Top row: Avatar & Status */}
        <div className="flex items-start justify-between mb-4">
          <AgentAvatar avatarPresetId={agent.avatarPresetId} emoji={agent.emoji} size="w-12 h-12" />

          {isProcessing ? (
            <div className="flex items-center gap-1.5 px-2 bg-amber-500/10 py-1 border border-amber-500/20 rounded-full">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">Active</span>
            </div>
          ) : agent.status === "active" || agent.status === "idle" ? (
            <div className="flex items-center gap-1.5 px-2 bg-black/40 py-1 border border-white/5 rounded-full">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                agent.status === "active" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-white/20"
              )} />
              <span className={cn(
                "text-[9px] font-bold uppercase tracking-wider",
                agent.status === "active" ? "text-emerald-400" : "text-white/40"
              )}>
                {agent.status === "active" ? "Active" : "Idle"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 bg-red-500/10 py-1 border border-red-500/20 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-red-400">{agent.status}</span>
            </div>
          )}
        </div>

        {/* Name & Role */}
        <div className="mb-4">
          <h3 className="font-bold text-white/90 text-base tracking-tight leading-none mb-1.5">{agent.name}</h3>
          <p className="text-[11px] text-white/40 font-medium leading-snug">
            {agent.description || "Autonomous Agent"}
          </p>
        </div>

        {/* Active sessions indicator */}
        {isProcessing && activeSessions > 0 && (
          <div className="mb-3 flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
            <span className="text-[10px] text-amber-400/80 font-medium">
              {activeSessions} active session{activeSessions > 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Footer: Model & ID */}
        <div className="flex items-center justify-between pt-3 border-t border-white/[0.04]">
          <span className="text-[10px] font-medium text-white/30 truncate max-w-[60%]">
            {agent.model || "Default Model"}
          </span>
          <span className="text-[10px] font-mono text-white/20 tracking-widest uppercase">
            ID: {agent.id.slice(0, 4).toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  LIVE FEED (embedded in page)                                       */
/* ─────────────────────────────────────────────────────────────────── */

interface FeedEntry {
  id: string
  timestamp: number | string
  agentName: string
  agentEmoji: string
  message: string
  type: "activity" | "error" | "idle" | "system"
}

function LiveFeedEntry({ entry }: { entry: FeedEntry }) {
  const colors: Record<string, string> = {
    activity: "text-emerald-400",
    error: "text-red-400",
    idle: "text-white/30",
    system: "text-primary",
  }

  return (
    <div className="flex gap-3 py-1.5 px-4 hover:bg-white/[0.02] transition-colors text-xs font-mono leading-relaxed">
      <span className="shrink-0 text-white/25 tabular-nums">
        [{fmtTime(entry.timestamp)}]
      </span>
      <span className={cn("shrink-0 font-bold", colors[entry.type] || "text-white/50")}>
        {entry.agentEmoji} {entry.agentName}:
      </span>
      <span className={cn(
        "flex-1",
        entry.type === "idle" ? "text-white/30 italic" : "text-white/60"
      )}>
        {entry.message}
      </span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  AGENTS PAGE                                                        */
/* ─────────────────────────────────────────────────────────────────── */

export function AgentsPage() {
  const navigate = useNavigate()
  const agents = useAgentStore((s) => s.agents)
  const setAgents = useAgentStore((s) => s.setAgents)
  const sessions = useSessionStore((s) => s.sessions) as unknown as RawSession[]
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [feedMinimized, setFeedMinimized] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const feedEndRef = useRef<HTMLDivElement>(null)

  // Auto-refresh tick for live feed timestamps
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5_000)
    return () => clearInterval(interval)
  }, [])

  // Build agent → active sessions map
  const agentProcessingMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sessions) {
      if (s.status === "active") {
        const key = s.agent || s.agentName
        map.set(key, (map.get(key) || 0) + 1)
      }
    }
    return map
  }, [sessions])

  // Build live feed entries from recent session activity
  const feedEntries = useMemo(() => {
    const entries: FeedEntry[] = []

    // Get the most recent sessions sorted by updatedAt
    const sorted = [...sessions]
      .sort((a, b) => {
        const ta = typeof a.updatedAt === "number" ? a.updatedAt : new Date(a.updatedAt || 0).getTime()
        const tb = typeof b.updatedAt === "number" ? b.updatedAt : new Date(b.updatedAt || 0).getTime()
        return tb - ta
      })
      .slice(0, 30)

    for (const s of sorted) {
      const emoji = s.agentEmoji || (s.agent === "main" ? "✨" : "🤖")
      const name = s.agentName || s.agent || "Unknown"
      const isActive = s.status === "active"
      const isFailed = s.status === "failed" || s.status === "killed"

      let message = ""
      let type: FeedEntry["type"] = "activity"

      if (isFailed) {
        message = `Session failed — ${s.name || s.type}`
        type = "error"
      } else if (isActive && s.lastMessage) {
        message = s.lastMessage
        type = "activity"
      } else if (isActive) {
        message = `Processing ${s.name || s.type} session…`
        type = "activity"
      } else if (s.lastMessage) {
        message = s.lastMessage
        type = "idle"
      } else {
        message = `${s.name || s.type} session — ${s.messageCount || 0} messages`
        type = "idle"
      }

      entries.push({
        id: s.id,
        timestamp: s.updatedAt,
        agentName: name,
        agentEmoji: emoji,
        message,
        type,
      })
    }

    return entries
  }, [sessions])

  // Auto-scroll feed when new entries arrive
  useEffect(() => {
    if (!feedMinimized && feedEndRef.current) {
      feedEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [feedEntries, feedMinimized])

  const filtered = useMemo(() => {
    return agents.filter((a) => {
      const matchSearch =
        !search ||
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.id.toLowerCase().includes(search.toLowerCase()) ||
        (a.description || "").toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === "all" || a.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [agents, search, statusFilter])

  const statusCounts = useMemo(() => {
    return agents.reduce(
      (acc, a) => {
        acc[a.status] = (acc[a.status] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>
    )
  }, [agents])

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">
            Agent Registry
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage and monitor your active autonomous observers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface-high transition-colors">
            <Filter className="w-3.5 h-3.5" /> Filter
          </button>
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Provision Agent
          </button>
        </div>
      </div>

      {/* ── Search & Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5 shrink-0">
        <div className="relative w-full sm:w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search agents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="flex items-center gap-1">
          {(["all", "active", "idle", "paused", "error"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] font-medium capitalize transition-all",
                statusFilter === s
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-transparent text-muted-foreground hover:text-foreground border border-transparent"
              )}
            >
              {s} {s !== "all" && statusCounts[s] ? `(${statusCounts[s]})` : ""}
            </button>
          ))}
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {agents.length} agents
        </div>
      </div>

      {/* ── Agent Grid ── */}
      <div className="flex-1 overflow-y-auto min-h-0 mb-4">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="p-4 rounded-2xl bg-secondary">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-foreground/80 font-medium">No agents configured</p>
            <p className="text-xs text-muted-foreground">
              Add agents to your openclaw.json configuration
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((agent) => {
              const activeCount = agentProcessingMap.get(agent.id) || agentProcessingMap.get(agent.name) || 0
              return (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  isProcessing={activeCount > 0}
                  activeSessions={activeCount}
                  onClick={() => navigate(`/agents/${agent.id}`)}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* ── Live Feed ── */}
      <div className="shrink-0 bg-[#0D0E11] rounded-xl border border-white/5 overflow-hidden">
        {/* Feed header */}
        <button
          onClick={() => setFeedMinimized(!feedMinimized)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              {feedEntries.some(e => e.type === "activity") ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white/20" />
              )}
            </span>
            <span className="text-sm font-bold text-white/80">Live Feed</span>
            <span className="text-[10px] text-white/25 font-mono">{feedEntries.length} entries</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/30">
            {feedMinimized ? "Expand" : "Minimize"}
            {feedMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </button>

        {/* Feed content */}
        {!feedMinimized && (
          <div className="border-t border-white/5">
            <ScrollArea className="h-[200px]">
              {feedEntries.length === 0 ? (
                <div className="flex items-center justify-center h-[180px] text-xs text-white/20 font-mono">
                  Waiting for agent activity…
                </div>
              ) : (
                <div className="py-1">
                  {feedEntries.map((entry) => (
                    <LiveFeedEntry key={entry.id} entry={entry} />
                  ))}
                  <div ref={feedEndRef} />
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Provision Agent Wizard */}
      {showWizard && (
        <ProvisionAgentWizard
          onClose={async () => {
            setShowWizard(false)
            try {
              const { api } = await import("@/lib/api")
              const data = await api.getAgents() as any
              setAgents(data.agents || [])
            } catch {}
          }}
        />
      )}

    </div>
  )
}
