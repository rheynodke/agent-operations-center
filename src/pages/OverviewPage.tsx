import { useMemo, useState, useEffect } from "react"
import {
  Bot,
  Activity,
  DollarSign,
  Clock,
  Wifi,
  Zap,
  Search,
  Terminal,
  Sparkles,
  TrendingUp,
  Code,
  MessageSquare,
  Loader2,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SessionDetailModal } from "@/components/sessions/SessionDetailModal"
import { GatewayControlCard } from "@/components/gateway/GatewayControlCard"
import { useAgentStore, useSessionStore, useOverviewStore, useWsStore } from "@/stores"
import { cn } from "@/lib/utils"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import type { Agent, Session } from "@/types"

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



/* ─────────────────────────────────────────────────────────────────── */
/*  STAT CARD                                                          */
/* ─────────────────────────────────────────────────────────────────── */

function StatCard({
  icon: Icon,
  label,
  value,
  valueSuffix,
  sub,
  subColor,
  pulseDot,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  valueSuffix?: string
  sub?: string
  subColor?: string
  pulseDot?: boolean
}) {
  return (
    <div className="bg-surface-low p-6 rounded-xl border border-transparent hover:border-[rgba(72,72,72,0.1)] transition-all group">
      <div className="flex justify-between items-start mb-4">
        <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-widest">
          {label}
        </span>
        <div className="p-1.5 rounded-lg bg-accent/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        {pulseDot && (
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 pulse-dot shrink-0" />
        )}
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-3xl font-bold text-foreground tracking-tighter tabular-nums">
            {value}
          </span>
          {valueSuffix && (
            <span className="text-muted-foreground text-sm font-medium ml-1">{valueSuffix}</span>
          )}
        </div>
      </div>
      {sub && (
        <p className={cn("text-[10px] mt-2 font-mono uppercase tracking-tighter", subColor ?? "text-muted-foreground")}>
          {sub}
        </p>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  STATUS / TYPE BADGES                                               */
/* ─────────────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active"
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
        isActive
          ? "text-emerald-400 bg-emerald-500/15 border border-emerald-500/20"
          : "text-muted-foreground bg-surface-highest border border-border/50"
      )}
    >
      {isActive ? "Active" : "Idle"}
    </span>
  )
}

function ProcessingBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider text-amber-400 bg-amber-500/15 border border-amber-500/20 animate-pulse">
      <Loader2 className="h-3 w-3 animate-spin" />
      Processing
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    telegram: "text-[#5da7e8] bg-[#5da7e8]/10 border-[#5da7e8]/20",
    main: "text-primary bg-primary/10 border-primary/20",
    hook: "text-[#ffb74d] bg-[#ffb74d]/10 border-[#ffb74d]/20",
    cron: "text-[#81c784] bg-[#81c784]/10 border-[#81c784]/20",
    subagent: "text-[#ce93d8] bg-[#ce93d8]/10 border-[#ce93d8]/20",
    opencode: "text-[#4dd0e1] bg-[#4dd0e1]/10 border-[#4dd0e1]/20",
    direct: "text-[#90caf9] bg-[#90caf9]/10 border-[#90caf9]/20",
  }

  return (
    <span
      className={cn(
        "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border",
        colors[type] ?? "text-muted-foreground bg-surface-highest border-border/50"
      )}
    >
      {type}
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  AGENT ICON UTILS                                                   */
/* ─────────────────────────────────────────────────────────────────── */

function getAgentIcon(name: string): React.ElementType {
  const lower = name.toLowerCase()
  if (lower.includes("search") || lower.includes("research")) return Search
  if (lower.includes("terminal") || lower.includes("dev")) return Terminal
  if (lower.includes("code") || lower.includes("review")) return Code
  if (lower.includes("sql") || lower.includes("odoo")) return Activity
  if (lower.includes("pm") || lower.includes("frontend")) return Sparkles
  if (lower.includes("main") || lower.includes("admin") || lower.includes("sys")) return Zap
  return Bot
}

/* ─────────────────────────────────────────────────────────────────── */
/*  SESSION ACTIVITY ENTRY                                             */
/* ─────────────────────────────────────────────────────────────────── */

interface SessionEntry {
  id: string
  name: string
  agent: string
  type: string
  subtype?: string
  status: string
  messageCount: number
  lastMessage: string
  updatedAt: number | string
  cost: number
  key?: string
  source?: string
  tokensIn?: number
  tokensOut?: number
  model?: string
}

function SessionActivityEntry({
  session,
  isProcessing,
  agentObj,
  onClick
}: {
  session: SessionEntry
  isProcessing: boolean
  agentObj?: Agent
  onClick: () => void
}) {
  const time = relativeTime(session.updatedAt)

  // Determine session type for badge
  const typeLabel = session.type || session.source || ""
  // Determine sub-type for second badge
  const subtypeLabel = session.subtype || ""
  
  const Icon = getAgentIcon(session.agent)

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
        "font-mono text-[11px] mt-1 shrink-0 w-14 text-right tabular-nums",
        isProcessing ? "text-amber-400" : "text-muted-foreground"
      )}>
        {time}
      </span>

      {/* Icon */}
      <div className="mt-0.5 shrink-0">
        <AgentAvatar
          avatarPresetId={(agentObj as any)?.avatarPresetId}
          emoji={agentObj?.emoji}
          size="w-9 h-9"
          className={cn(
            "rounded-lg border",
            isProcessing ? "border-amber-500/20" : "border-white/8"
          )}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Agent + session info */}
        <p className="text-sm font-medium text-foreground truncate">
          <span className="text-primary font-bold">{session.agent}</span>{" "}
          <span className="text-muted-foreground">{session.name}</span>
        </p>

        {/* Badges row */}
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {isProcessing ? <ProcessingBadge /> : <StatusBadge status={session.status} />}
          {typeLabel && <TypeBadge type={typeLabel} />}
          {subtypeLabel && <TypeBadge type={subtypeLabel} />}
          {session.messageCount > 0 && (
            <span className="text-[10px] text-muted-foreground font-medium">
              {session.messageCount} msgs
            </span>
          )}
          {((session.tokensIn || 0) + (session.tokensOut || 0) > 0) && (
            <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
              <Zap className="w-2.5 h-2.5 text-primary/70" />
              {((session.tokensIn || 0) + (session.tokensOut || 0)).toLocaleString()} tkns
            </span>
          )}
        </div>

        {/* Last message preview */}
        {session.lastMessage && (
          <p className="mt-1.5 text-xs text-muted-foreground/80 truncate max-w-[500px]">
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
/*  LIVE AGENT CARD                                                    */
/* ─────────────────────────────────────────────────────────────────── */

function LiveAgentCard({ agent, isProcessing, activeSessions }: {
  agent: Agent
  isProcessing: boolean
  activeSessions: number
}) {
  const Icon = getAgentIcon(agent.name)

  return (
    <div
      className={cn(
        "bg-surface-container p-4 rounded-xl border transition-all relative overflow-hidden",
        isProcessing
          ? "border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.08)]"
          : "border-[rgba(72,72,72,0.1)] hover:border-primary/20"
      )}
    >
      {/* Processing glow effect */}
      {isProcessing && (
        <div className="absolute inset-0 bg-linear-to-br from-amber-500/5 to-transparent pointer-events-none" />
      )}

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-3">
          <AgentAvatar
            avatarPresetId={(agent as any).avatarPresetId}
            emoji={agent.emoji}
            size="w-10 h-10"
            className={cn(
              "rounded-lg border",
              isProcessing ? "border-amber-500/20" : "border-white/8"
            )}
          />
          <div className="flex items-center gap-2">
            {isProcessing ? (
              <ProcessingBadge />
            ) : (
              <StatusBadge status={agent.status} />
            )}
          </div>
        </div>
        <h4 className="font-display font-bold text-sm text-foreground">{agent.name}</h4>
        {agent.model && (
          <p className="text-[11px] text-muted-foreground font-medium mt-0.5 truncate">{agent.model}</p>
        )}
        {isProcessing && activeSessions > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
            <span className="text-[10px] text-amber-400/80 font-medium">
              {activeSessions} active session{activeSessions > 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  OVERVIEW PAGE                                                      */
/* ─────────────────────────────────────────────────────────────────── */

export function OverviewPage() {
  const agents = useAgentStore((s) => s.agents)
  const sessions = useSessionStore((s) => s.sessions)
  const overviewData = useOverviewStore((s) => s.overview)
  const wsStatus = useWsStore((s) => s.status)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)

  // Auto-refresh tick every 10s to update relative timestamps & active states
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(interval)
  }, [])

  // Cast sessions to our internal SessionEntry format
  const sessionEntries = useMemo(() => {
    return (sessions as unknown as SessionEntry[])
      .slice(0, 50)
      .sort((a, b) => {
        const ta = typeof a.updatedAt === "number" ? a.updatedAt : new Date(a.updatedAt || 0).getTime()
        const tb = typeof b.updatedAt === "number" ? b.updatedAt : new Date(b.updatedAt || 0).getTime()
        return tb - ta
      })
  }, [sessions])

  // Build a map of agent → active session count (only sessions with status "active")
  const agentProcessingMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sessionEntries) {
      if (s.status === "active") {
        map.set(s.agent, (map.get(s.agent) || 0) + 1)
      }
    }
    return map
  }, [sessionEntries])

  // Set of session IDs that are currently processing (status must be "active")
  const processingSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const s of sessionEntries) {
      if (s.status === "active") {
        set.add(s.id)
      }
    }
    return set
  }, [sessionEntries])

  const stats = useMemo(() => {
    const ov = overviewData as Record<string, unknown> | null
    const ovSessions = ov?.sessions as Record<string, number> | undefined
    const ovAgents = ov?.agents as Record<string, number> | undefined
    const ovCost = ov?.cost as Record<string, number> | undefined
    const ovGateway = ov?.gateway as Record<string, string> | undefined

    return {
      gatewayStatus: ovGateway?.status || (wsStatus === "connected" ? "running" : "offline"),
      gatewayPort: ovGateway?.port || 18789,
      totalSessions: ovSessions?.total ?? sessions.length,
      activeSessions: ovSessions?.active ?? sessions.filter((s: any) => s.status === "active").length,
      gwSessions: ovSessions?.gateway ?? 0,
      totalAgents: ovAgents?.total ?? agents.length,
      activeAgents: ovAgents?.active ?? agents.filter((a) => a.status === "active").length,
      totalCost: ovCost?.total ?? agents.reduce((sum, a) => sum + (a.totalCost ?? 0), 0),
    }
  }, [overviewData, agents, sessions, wsStatus])

  const onlineCount = agents.filter(
    (a) => a.status === "active" || a.status === "idle"
  ).length

  const processingCount = agentProcessingMap.size

  return (
    <div className="flex flex-col gap-0 animate-fade-in max-w-[1600px] mx-auto">
      {/* ── Dashboard Header ── */}
      <div className="mb-8">
        <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">
          System Overview
        </h1>
      </div>

      {/* ── Stat Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        <StatCard
          icon={Wifi}
          label="Gateway"
          value={stats.gatewayStatus === "running" ? "Running" : "Offline"}
          pulseDot={stats.gatewayStatus === "running"}
          sub={stats.gatewayStatus === "running" ? `PORT ${stats.gatewayPort}` : "Reconnecting…"}
          subColor={stats.gatewayStatus === "running" ? undefined : "text-[var(--status-paused-text)]"}
        />
        <StatCard
          icon={MessageSquare}
          label="Sessions"
          value={stats.totalSessions}
          valueSuffix="total"
          sub={`${stats.activeSessions} Active • ${stats.gwSessions} Gateway`}
        />
        <StatCard
          icon={Bot}
          label="Agents"
          value={stats.totalAgents}
          valueSuffix="provisioned"
          sub={`${stats.activeAgents} Active`}
        />
        <StatCard
          icon={DollarSign}
          label="Total Cost"
          value={`$${stats.totalCost.toFixed(2)}`}
          valueSuffix="USD"
        />
      </div>

      {/* ── Main Content: Activity + Live Agents ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left Column — Recent Activity (built from sessions) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-display font-bold text-foreground">Recent Activity</h3>
              {processingCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                  </span>
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                    {processingCount} Processing
                  </span>
                </span>
              )}
            </div>
            <span className="text-primary text-xs font-medium cursor-pointer hover:underline">
              {sessionEntries.length} events
            </span>
          </div>

          <div className="bg-surface-low rounded-xl overflow-hidden">
            {sessionEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <div className="p-4 rounded-2xl bg-secondary">
                  <Clock className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No activity yet</p>
                <p className="text-xs text-muted-foreground/60">
                  Activity from agents and sessions will appear here
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[600px]">
                {sessionEntries.map((session) => {
                  const agentObj = agents.find((a) => a.name === session.agent || a.id === session.agent)
                  
                  return (
                    <SessionActivityEntry
                      key={session.id}
                      session={session}
                      isProcessing={processingSessionIds.has(session.id)}
                      agentObj={agentObj}
                      onClick={() => {
                        // Convert SessionEntry to Session shape for the modal
                        setSelectedSession({
                          id: session.id,
                          agentId: session.agent,
                          agentName: session.agent,
                          agentEmoji: agentObj?.emoji || "🤖",
                          type: (session.type || "telegram") as any,
                          status: session.status as any,
                          startTime: typeof session.updatedAt === "number" ? new Date(session.updatedAt).toISOString() : (session.updatedAt || ""),
                          totalCost: session.cost || 0,
                          totalTokens: (session.tokensIn || 0) + (session.tokensOut || 0),
                          model: session.model || "",
                          messageCount: session.messageCount || 0,
                          toolUseCount: 0,
                          taskSummary: `${session.agent} ${session.name}`,
                          trigger: session.name,
                        })
                      }}
                    />
                  )
                })}
              </ScrollArea>
            )}
          </div>
        </div>

        {/* Right Column — Live Agents */}
        <div className="lg:col-span-5 space-y-4">
          {/* Gateway Control Card */}
          <GatewayControlCard />

          <div className="flex items-center justify-between">
            <h3 className="text-lg font-display font-bold text-foreground">Live Agents</h3>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                {onlineCount} Online
              </span>
            </div>
          </div>

          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <div className="p-4 rounded-2xl bg-secondary">
                <Bot className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No agents configured</p>
              <p className="text-xs text-muted-foreground/60">
                Add agents to your openclaw.json configuration
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {agents.map((agent) => {
                  const activeCount = agentProcessingMap.get(agent.name) || agentProcessingMap.get(agent.id) || 0
                  return (
                    <LiveAgentCard
                      key={agent.id}
                      agent={agent}
                      isProcessing={activeCount > 0}
                      activeSessions={activeCount}
                    />
                  )
                })}
              </div>

              {/* System Status */}
              <div className="mt-4 bg-linear-to-br from-accent/20 to-transparent p-6 rounded-2xl border border-primary/10 relative overflow-hidden group">
                <div className="relative z-10">
                  <h5 className="text-primary font-bold font-display mb-2">System Status</h5>
                  <p className="text-xs text-foreground leading-relaxed">
                    {processingCount > 0 ? (
                      <>
                        <span className="text-amber-400 font-bold">{processingCount} agent{processingCount > 1 ? "s" : ""}</span>
                        {" "}currently processing. Total spend: ${stats.totalCost.toFixed(2)} across {stats.totalSessions} sessions.
                      </>
                    ) : (
                      <>
                        All agents are idle.{" "}
                        {stats.totalCost > 0
                          ? `Total spend: $${stats.totalCost.toFixed(2)} across ${stats.totalSessions} sessions.`
                          : "No sessions recorded yet."}
                      </>
                    )}
                  </p>
                </div>
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <TrendingUp className="h-[120px] w-[120px]" />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Session Detail Modal */}
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  )
}
