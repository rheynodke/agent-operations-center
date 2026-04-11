import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react"
const ReactMarkdown = lazy(() => import("react-markdown").then(m => ({ default: m.default })))
import remarkGfm from "remark-gfm"
import { Search, Bot, Plus, Filter, ChevronDown, ChevronUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAgentStore, useSessionStore } from "@/stores"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types"
import { useNavigate } from "react-router-dom"
import { ProvisionAgentWizard } from "@/components/agents/ProvisionAgentWizard"
import { TemplateEntryModal } from "@/components/agents/TemplateEntryModal"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import type { AgentRoleTemplate } from "@/types"
import { getTemplateColor, getTemplateLabel, getTemplateById } from "@/data/agentRoleTemplates"

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

/** Strip gateway markers and noise from feed messages */
function sanitizeFeedMessage(msg: string): string {
  return msg
    .replace(/\[\[reply_to_current\]\]/g, "")
    .replace(/\[\[[\w_]+\]\]/g, "")           // any [[marker]]
    .replace(/<!--[\s\S]*?-->/g, "")           // HTML comments
    .replace(/^>\s?/gm, "")                    // leading blockquote markers
    .replace(/\n{3,}/g, "\n\n")               // collapse excess blank lines
    .trim()
}

/* ─────────────────────────────────────────────────────────────────── */
/*  AGENT CARD  (profile card style)                                   */
/* ─────────────────────────────────────────────────────────────────── */

function StatusBadge({ status, isProcessing }: { status: string; isProcessing: boolean }) {
  if (isProcessing) return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 backdrop-blur-sm">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400" />
      </span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300">Working</span>
    </div>
  )
  if (status === "active") return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 backdrop-blur-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
      <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">Active</span>
    </div>
  )
  if (status === "idle") return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-foreground/8 border border-border/60 backdrop-blur-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-foreground/25" />
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50">Idle</span>
    </div>
  )
  if (status === "paused") return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 backdrop-blur-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
      <span className="text-[9px] font-bold uppercase tracking-wider text-sky-300">Paused</span>
    </div>
  )
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 backdrop-blur-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      <span className="text-[9px] font-bold uppercase tracking-wider text-red-300">{status}</span>
    </div>
  )
}

function AgentCard({ agent, isProcessing, activeSessions, onClick }: {
  agent: Agent
  isProcessing: boolean
  activeSessions: number
  onClick: () => void
}) {
  const roleTemplate = agent.role ? getTemplateById(agent.role) : undefined
  const roleColor = roleTemplate?.color
  const roleLabel = roleTemplate?.role
  const roleNumber = roleTemplate?.adlcAgentNumber
  const roleEmoji = roleTemplate?.emoji

  // Derive a subtle hero bg tint — role color > emerald fallback
  const heroBg = roleColor
    ? `radial-gradient(ellipse at 50% 0%, ${roleColor}22 0%, transparent 70%)`
    : isProcessing
      ? "radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.12) 0%, transparent 70%)"
      : "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 70%)"

  const borderColor = isProcessing
    ? "rgba(245,158,11,0.25)"
    : roleColor
      ? `${roleColor}40`
      : undefined

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer bg-card border border-border rounded-2xl transition-all duration-300",
        "hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20",
        "group flex flex-col relative overflow-hidden",
        isProcessing && "shadow-[0_0_24px_rgba(245,158,11,0.08)]"
      )}
      style={borderColor ? { borderColor } : undefined}
    >
      {/* Role accent strip at top */}
      {roleColor && (
        <div
          className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
          style={{ background: `linear-gradient(90deg, transparent, ${roleColor}90, transparent)` }}
        />
      )}

      {/* Hero gradient header */}
      <div
        className="relative px-4 pt-5 pb-3 flex flex-col items-center"
        style={{ background: heroBg }}
      >
        {/* Status badge — top-right */}
        <div className="absolute top-3 right-3">
          <StatusBadge status={agent.status} isProcessing={isProcessing} />
        </div>

        {/* Agent ID — top-left */}
        <div className="absolute top-3.5 left-3.5">
          <span className="text-[8px] font-mono font-bold text-muted-foreground/30 uppercase tracking-widest">
            #{agent.id.slice(0, 4).toUpperCase()}
          </span>
        </div>

        {/* Avatar */}
        <div className={cn(
          "mt-1 mb-3 transition-transform duration-300 group-hover:scale-105",
          isProcessing && "drop-shadow-[0_0_12px_rgba(245,158,11,0.4)]"
        )}>
          <AgentAvatar
            avatarPresetId={agent.avatarPresetId}
            emoji={agent.emoji}
            size="w-16 h-16"
          />
        </div>

        {/* Name */}
        <h3 className="font-bold text-foreground text-sm tracking-tight leading-tight text-center mb-1">
          {agent.name}
        </h3>

        {/* Role badge */}
        {roleLabel && roleColor ? (
          <div className="flex items-center gap-1 max-w-full px-0.5">
            {/* ADLC number chip */}
            {roleNumber != null && (
              <span
                className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black leading-none"
                style={{ backgroundColor: roleColor, color: "#000" }}
              >
                {roleNumber}
              </span>
            )}
            {/* emoji */}
            {roleEmoji && (
              <span className="text-[10px] leading-none shrink-0">{roleEmoji}</span>
            )}
            {/* role name, truncated */}
            <span
              className="text-[9px] font-bold uppercase tracking-wider truncate"
              style={{ color: roleColor }}
              title={roleLabel}
            >
              {roleLabel}
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground/40 font-medium">Autonomous Agent</span>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-border/60 mx-4" />

      {/* Body */}
      <div className="flex flex-col flex-1 px-4 py-3 gap-2.5">
        {/* Vibe from IDENTITY.md (fallback to description) */}
        {(agent.vibe || agent.description) ? (
          <p className="text-[10.5px] text-muted-foreground/60 leading-snug line-clamp-2 text-center min-h-[2.5em] italic">
            {agent.vibe || agent.description}
          </p>
        ) : (
          <div className="min-h-[2.5em]" />
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-1.5 mt-auto">
          <div className="flex flex-col items-center gap-0.5 bg-foreground/3 rounded-lg py-1.5 px-1">
            <span className={cn(
              "text-[11px] font-bold tabular-nums leading-none",
              isProcessing && activeSessions > 0 ? "text-amber-400" : "text-foreground/70"
            )}>
              {isProcessing && activeSessions > 0 ? activeSessions : (agent.sessionCount ?? 0)}
            </span>
            <span className={cn(
              "text-[8px] uppercase tracking-wide font-semibold",
              isProcessing && activeSessions > 0 ? "text-amber-400/60" : "text-muted-foreground/40"
            )}>
              {isProcessing && activeSessions > 0 ? "Running" : "Sessions"}
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 bg-foreground/3 rounded-lg py-1.5 px-1">
            <span className="text-[11px] font-bold text-foreground/70 tabular-nums leading-none">
              {agent.totalCost != null && agent.totalCost > 0
                ? agent.totalCost >= 1
                  ? `$${agent.totalCost.toFixed(2)}`
                  : `$${agent.totalCost.toFixed(4)}`
                : "—"}
            </span>
            <span className="text-[8px] text-muted-foreground/40 uppercase tracking-wide font-semibold">Cost</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 bg-foreground/3 rounded-lg py-1.5 px-1">
            <span className="text-[11px] font-bold text-foreground/70 tabular-nums leading-none">
              {agent.totalTokens != null && agent.totalTokens > 0
                ? agent.totalTokens >= 1_000_000
                  ? `${(agent.totalTokens / 1_000_000).toFixed(1)}M`
                  : agent.totalTokens >= 1000
                    ? `${(agent.totalTokens / 1000).toFixed(0)}k`
                    : agent.totalTokens
                : "—"}
            </span>
            <span className="text-[8px] text-muted-foreground/40 uppercase tracking-wide font-semibold">Tokens</span>
          </div>
        </div>

        {/* Channel binding indicators */}
        {agent.channels && agent.channels.length > 0 && (
          <div className="flex items-center justify-center gap-2 mt-2.5 pt-2.5 border-t border-border/40">
            <span className="text-[8px] text-muted-foreground/30 uppercase tracking-wider font-semibold mr-0.5">Channels</span>
            {agent.channels.includes("telegram") && (
              <img src="/telegram.webp" alt="Telegram" title="Telegram" className="w-4 h-4 rounded object-contain opacity-70 hover:opacity-100 transition-opacity" />
            )}
            {agent.channels.includes("whatsapp") && (
              <img src="/wa.png" alt="WhatsApp" title="WhatsApp" className="w-4 h-4 rounded object-contain opacity-70 hover:opacity-100 transition-opacity" />
            )}
            {agent.channels.includes("discord") && (
              <img src="/discord.png" alt="Discord" title="Discord" className="w-4 h-4 rounded object-contain opacity-70 hover:opacity-100 transition-opacity" />
            )}
          </div>
        )}
      </div>

      {/* Footer: model */}
      <div className="flex items-center justify-center gap-1.5 px-4 py-2 border-t border-border/40 bg-foreground/[0.015]">
        <span className="w-1 h-1 rounded-full bg-muted-foreground/25" />
        <span className="text-[9.5px] font-mono text-muted-foreground/40 truncate max-w-full">
          {agent.model || "default model"}
        </span>
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
  agentId?: string
  avatarPresetId?: string | null
  message: string
  type: "activity" | "error" | "idle" | "system"
}

function LiveFeedEntry({ entry }: { entry: FeedEntry }) {
  const colors: Record<string, string> = {
    activity: "text-emerald-500",
    error: "text-red-400",
    idle: "text-muted-foreground/40",
    system: "text-primary",
  }

  const clean = sanitizeFeedMessage(entry.message)

  return (
    <div className="flex gap-3 py-1.5 px-4 hover:bg-foreground/2 transition-colors text-xs font-mono leading-relaxed items-baseline">
      <span className="shrink-0 text-muted-foreground/40 tabular-nums">
        [{fmtTime(entry.timestamp)}]
      </span>
      <span className={cn("shrink-0 font-bold flex items-center gap-1.5 self-start mt-px", colors[entry.type] || "text-muted-foreground/60")}>
        <AgentAvatar
          avatarPresetId={entry.avatarPresetId}
          emoji={entry.agentEmoji}
          size="w-4 h-4"
          className="!rounded"
        />
        {entry.agentName}:
      </span>
      <span className={cn(
        "flex-1 min-w-0 wrap-break-word",
        entry.type === "idle" ? "text-muted-foreground/50" : "text-foreground/70"
      )}>
        <Suspense fallback={<span>{clean}</span>}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <span className="inline">{children}</span>,
              strong: ({ children }) => <strong className="font-semibold text-foreground/90">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              code: ({ children }) => <code className="px-1 py-0.5 rounded bg-foreground/8 text-[0.85em]">{children}</code>,
              a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground transition-colors">{children}</a>,
              // Flatten block-level nodes to inline for compact feed
              h1: ({ children }) => <strong className="font-bold">{children}</strong>,
              h2: ({ children }) => <strong className="font-bold">{children}</strong>,
              h3: ({ children }) => <strong className="font-semibold">{children}</strong>,
              ul: ({ children }) => <span className="inline">{children}</span>,
              ol: ({ children }) => <span className="inline">{children}</span>,
              li: ({ children }) => <span className="inline before:content-['·_'] before:text-muted-foreground/50">{children}{' '}</span>,
              blockquote: ({ children }) => <span className="italic text-muted-foreground/60">{children}</span>,
            }}
          >
            {clean}
          </ReactMarkdown>
        </Suspense>
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
  const [showEntryModal, setShowEntryModal] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<AgentRoleTemplate | undefined>(undefined)
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

    // Build agent lookup map for avatar resolution
    const agentMap = new Map(agents.map(a => [a.id, a]))

    for (const s of sorted) {
      const emoji = s.agentEmoji || (s.agent === "main" ? "✨" : "🤖")
      const name = s.agentName || s.agent || "Unknown"
      const agentRecord = s.agent ? agentMap.get(s.agent) : undefined
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
        agentId: s.agent,
        avatarPresetId: agentRecord?.avatarPresetId ?? null,
        message,
        type,
      })
    }

    return entries
  }, [sessions, agents])

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
            onClick={() => setShowEntryModal(true)}
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
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
      <div className="shrink-0 bg-card rounded-xl border border-border overflow-hidden">
        {/* Feed header */}
        <button
          onClick={() => setFeedMinimized(!feedMinimized)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-foreground/2 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              {feedEntries.some(e => e.type === "activity") ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-foreground/20" />
              )}
            </span>
            <span className="text-sm font-bold text-foreground/80">Live Feed</span>
            <span className="text-[10px] text-muted-foreground/40 font-mono">{feedEntries.length} entries</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
            {feedMinimized ? "Expand" : "Minimize"}
            {feedMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </button>

        {/* Feed content */}
        {!feedMinimized && (
          <div className="border-t border-border">
            <ScrollArea className="h-[200px]">
              {feedEntries.length === 0 ? (
                <div className="flex items-center justify-center h-[180px] text-xs text-muted-foreground/40 font-mono">
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

      {/* Template Entry Modal */}
      {showEntryModal && (
        <TemplateEntryModal
          onSelectTemplate={(template) => {
            setSelectedTemplate(template)
            setShowEntryModal(false)
            setShowWizard(true)
          }}
          onSelectBlank={() => {
            setSelectedTemplate(undefined)
            setShowWizard(true)
          }}
          onClose={() => setShowEntryModal(false)}
        />
      )}

      {/* Provision Agent Wizard */}
      {showWizard && (
        <ProvisionAgentWizard
          template={selectedTemplate}
          onClose={async () => {
            setShowWizard(false)
            setSelectedTemplate(undefined)
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
