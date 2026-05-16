import { useMemo, useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  Bot,
  Activity,
  DollarSign,
  Clock,
  Wifi,
  WifiOff,
  Zap,
  Search,
  Terminal,
  Sparkles,
  TrendingUp,
  Code,
  MessageSquare,
  Loader2,
  Globe2,
  LayoutDashboard,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AreaChart, Area, ResponsiveContainer } from "recharts"
import { SessionDetailModal } from "@/components/sessions/SessionDetailModal"
import { GatewayControlCard } from "@/components/gateway/GatewayControlCard"
import { AgentWorldView } from "@/components/world/AgentWorldView"
import { useAgentStore, useSessionStore, useOverviewStore, useWsStore, useProcessingStore } from "@/stores"
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

const generateSparkline = (points = 10, min = 10, max = 50) => {
  return Array.from({ length: points }).map((_, i) => ({
    name: `P${i}`,
    value: Math.floor(Math.random() * (max - min + 1)) + min
  }));
};

const gatewayData = generateSparkline(10, 80, 100);
const sessionData = generateSparkline(10, 20, 80);
const agentData = generateSparkline(10, 5, 25);
const costData = generateSparkline(10, 10, 100);

function MascotCard({ stats }: { stats: any }) {
  const isOperational = stats?.gatewayStatus === "running";
  
  return (
    <div className="relative h-full min-h-[160px] flex flex-col justify-between overflow-visible rounded-[24px] border border-black/5 dark:border-white/5 bg-white dark:bg-[#0F0F13]">
      {/* Background soft glow at top left to mimic the reference's soft lighting */}
      <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-orange-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Section: Text Content & Button */}
      <div className="relative z-10 w-[70%] sm:w-[65%] p-4 md:p-5 flex flex-col justify-start">
        <h2 className="text-xl md:text-2xl lg:text-[2rem] font-display font-bold tracking-tight leading-[1.1] mb-1">
          <span className="text-foreground block">Control Your</span>
          <span className="text-orange-500 block mt-0.5">AI Mission</span>
        </h2>
        
        <p className="text-[10px] md:text-[11px] text-muted-foreground mb-3 max-w-[220px] leading-relaxed hidden sm:block">
          Monitor systems, manage agents, and orchestrate AI operations across your organization.
        </p>

        <div className="mt-1 sm:mt-0">
          <button 
            onClick={() => document.getElementById('recent-activity')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-[11px] md:text-[12px] font-semibold rounded-xl shadow-lg shadow-orange-500/20 transition-colors pointer-events-auto flex items-center gap-1.5"
          >
            View Activity 
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Floating Mascot Image on the Right */}
      <div className="absolute -right-4 sm:-right-8 md:-right-12 -top-24 sm:-top-32 md:-top-40 bottom-[40px] w-[65%] sm:w-[55%] md:w-[50%] lg:w-[48%] pointer-events-none flex items-end justify-end z-30">
        <style>{`
          @keyframes runHover {
            0%, 100% { transform: translateY(4px) rotate(1deg) scale(1.25); }
            50% { transform: translateY(-4px) rotate(-1deg) scale(1.25); }
          }
          .animate-run-hover {
            animation: runHover 4s ease-in-out infinite;
          }
        `}</style>
        <img 
          src="/robot_running_mascot.png" 
          alt="3D Robot Mascot Running" 
          className="w-full h-auto max-h-[220%] object-contain opacity-100 drop-shadow-[0_25px_45px_rgba(249,115,22,0.3)] animate-run-hover origin-bottom-right" 
          style={{ objectPosition: 'right bottom' }}
        />
      </div>

      {/* Bottom Floating Stats Bar */}
      <div className="relative z-20 m-2 mt-auto">
        <div className="bg-black/5 dark:bg-white/5 backdrop-blur-xl border border-black/10 dark:border-white/10 rounded-[14px] p-2.5 md:p-3 flex items-center justify-between divide-x divide-black/10 dark:divide-white/10 shadow-xl shadow-black/5 dark:shadow-2xl dark:shadow-black/50">
          
          {/* Stat 1: Active Sessions */}
          <div className="flex-1 px-2.5 flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold text-muted-foreground">Active Sessions</span>
            <div className="flex items-center gap-1.5">
              <span className="text-lg md:text-xl font-bold font-display tracking-tight leading-none">{stats?.activeSessions || 0}</span>
              {Number(stats?.activeSessions || 0) > 0 ? (
                <span className="text-[8px] font-bold text-emerald-400 flex items-center bg-emerald-500/10 px-1 py-0.5 rounded">
                  <ChevronUp className="w-2.5 h-2.5 mr-0.5" /> 12%
                </span>
              ) : (
                <span className="text-[8px] font-bold text-muted-foreground flex items-center bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded">
                  <span className="w-2.5 h-2.5 mr-0.5 flex items-center justify-center font-black">-</span> 0%
                </span>
              )}
            </div>
            <span className="text-[7px] text-muted-foreground/70 font-medium">vs yesterday</span>
          </div>

          {/* Stat 3: Alerts */}
          <div className="flex-1 px-2.5 flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold text-muted-foreground">Alerts</span>
            <div className="flex items-center gap-1.5">
              <span className="text-lg md:text-xl font-bold font-display tracking-tight leading-none">{!isOperational ? "1" : "0"}</span>
              {!isOperational ? (
                <span className="text-[8px] font-bold text-red-400 flex items-center bg-red-500/10 px-1 py-0.5 rounded">
                  <ChevronUp className="w-2.5 h-2.5 mr-0.5" /> 100%
                </span>
              ) : (
                <span className="text-[8px] font-bold text-emerald-400 flex items-center bg-emerald-500/10 px-1 py-0.5 rounded">
                  <ChevronDown className="w-2.5 h-2.5 mr-0.5" /> 25%
                </span>
              )}
            </div>
            <span className="text-[7px] text-muted-foreground/70 font-medium">vs yesterday</span>
          </div>

        </div>
      </div>
    </div>
  );
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
  chartData,
  chartColor = "#3b82f6",
}: {
  icon: React.ElementType
  label: string
  value: string | number
  valueSuffix?: string
  sub?: string
  subColor?: string
  pulseDot?: boolean
  chartData?: any[]
  chartColor?: string
}) {
  return (
    <div className="bg-surface-low p-5 rounded-xl border border-transparent hover:border-[rgba(72,72,72,0.1)] transition-all group relative overflow-hidden flex flex-col justify-between h-full min-h-[110px]">
      <div className="z-10 relative">
        <div className="flex justify-between items-start mb-2">
          <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-widest">
            {label}
          </span>
          <div className="p-1.5 rounded-lg bg-accent/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pulseDot && (
            <span className="h-2 w-2 rounded-full bg-emerald-500 pulse-dot shrink-0" />
          )}
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-bold text-foreground tracking-tighter tabular-nums">
              {value}
            </span>
            {valueSuffix && (
              <span className="text-muted-foreground text-xs font-medium ml-1">{valueSuffix}</span>
            )}
          </div>
        </div>
        {sub && (
          <p className={cn("text-[10px] mt-1 font-mono uppercase tracking-tighter", subColor ?? "text-muted-foreground")}>
            {sub}
          </p>
        )}
      </div>

      {chartData && (
        <div className="absolute bottom-0 left-0 right-0 h-16 opacity-20 group-hover:opacity-40 transition-opacity z-0 pointer-events-none">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
               <defs>
                 <linearGradient id={`color-${label.replace(/\\s+/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                   <stop offset="5%" stopColor={chartColor} stopOpacity={0.8}/>
                   <stop offset="95%" stopColor={chartColor} stopOpacity={0}/>
                 </linearGradient>
               </defs>
               <Area type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} fillOpacity={1} fill={`url(#color-${label.replace(/\\s+/g, '')})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
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

function LiveAgentCard({ agent, isProcessing, activeSessions, onClick }: {
  agent: Agent
  isProcessing: boolean
  activeSessions: number
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-surface-container p-3 rounded-xl border transition-all relative overflow-hidden cursor-pointer flex items-center justify-between gap-3",
        isProcessing
          ? "border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.08)]"
          : "border-[rgba(72,72,72,0.1)] hover:border-primary/20"
      )}
    >
      {/* Processing glow effect */}
      {isProcessing && (
        <div className="absolute inset-0 bg-linear-to-br from-amber-500/5 to-transparent pointer-events-none" />
      )}

      <div className="relative z-10 flex items-center gap-3 min-w-0 flex-1">
        <AgentAvatar
          avatarPresetId={(agent as any).avatarPresetId}
          emoji={agent.emoji}
          size="w-9 h-9"
          className={cn(
            "rounded-lg border shrink-0",
            isProcessing ? "border-amber-500/20" : "border-white/8"
          )}
        />
        <div className="flex flex-col min-w-0">
          <h4 className="font-display font-bold text-[13px] text-foreground truncate">{agent.name}</h4>
          {agent.model && (
            <p className="text-[10px] text-muted-foreground font-medium truncate">{agent.model}</p>
          )}
          {isProcessing && activeSessions > 0 && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
              </span>
              <span className="text-[9px] text-amber-400/80 font-medium truncate">
                {activeSessions} active session{activeSessions > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10 shrink-0 flex flex-col items-end gap-1">
        {isProcessing ? (
          <ProcessingBadge />
        ) : (
          <StatusBadge status={agent.status} />
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
  const navigate = useNavigate()
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
      .slice(0, 10)
      .sort((a, b) => {
        const ta = typeof a.updatedAt === "number" ? a.updatedAt : new Date(a.updatedAt || 0).getTime()
        const tb = typeof b.updatedAt === "number" ? b.updatedAt : new Date(b.updatedAt || 0).getTime()
        return tb - ta
      })
  }, [sessions])

  // Realtime processing state driven by WS processing_start/end events.
  // Subscribing ensures Overview flips the "active" badge instantly when the
  // agent starts/stops, without waiting for the next REST poll.
  const liveProcessingSessions = useProcessingStore((s) => s.sessions)
  const liveAgentCounts = useProcessingStore((s) => s.agentCounts)

  // Build a map of agent → active session count.
  // Primary source: WS-driven `liveAgentCounts`. Fallback: `session.status`
  // from REST (so pages still work before first WS event arrives).
  const agentProcessingMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const [agentId, n] of Object.entries(liveAgentCounts)) {
      if (n > 0) map.set(agentId, n)
    }
    for (const s of sessionEntries) {
      if (s.status === "active" && !map.has(s.agent)) {
        map.set(s.agent, (map.get(s.agent) || 0) + 1)
      }
    }
    return map
  }, [sessionEntries, liveAgentCounts])

  // Set of session IDs currently processing.
  const processingSessionIds = useMemo(() => {
    const set = new Set<string>()
    // Live sessions (keyed by sessionKey or file path). Sessions on Overview
    // use `s.id` which usually matches sessionKey suffix — also check if the
    // session path is tracked.
    for (const key of Object.keys(liveProcessingSessions)) {
      set.add(key)
      // Derive the session id (last path segment without extension) for match
      const short = key.split('/').pop()?.replace(/\.jsonl$/, '')
      if (short) set.add(short)
    }
    for (const s of sessionEntries) {
      if (s.status === "active") set.add(s.id)
    }
    return set
  }, [sessionEntries, liveProcessingSessions])

  const stats = useMemo(() => {
    const ov = overviewData as Record<string, unknown> | null
    const ovSessions = ov?.sessions as Record<string, number> | undefined
    const ovAgents = ov?.agents as Record<string, number> | undefined
    const ovCost = ov?.cost as Record<string, number> | undefined
    const ovGateway = ov?.gateway as Record<string, string> | undefined

    return {
      // When AOC WebSocket is disconnected, cached overview data is stale —
      // force gateway card to "offline" so it stays consistent with GatewayControlCard
      // (which polls live and shows OFFLINE on API failure).
      gatewayStatus: wsStatus !== "connected"
        ? "offline"
        : (ovGateway?.status || "offline"),
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

  const [activeTab, setActiveTab] = useState<"dashboard" | "world">("dashboard")

  const tabs = [
    { id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
    { id: "world" as const, label: "Agent World", icon: Globe2 },
  ]

  return (
    <div className="flex flex-col gap-0 animate-fade-in max-w-[1600px] mx-auto">
      {/* ── Dashboard Header ── */}
      <div className={cn(
        "flex flex-col sm:flex-row sm:items-end gap-3",
        activeTab === "world" ? "mb-2" : "mb-4 sm:mb-6"
      )}>
        {activeTab === "dashboard" && (
          <h1 className="text-2xl sm:text-4xl font-display font-bold tracking-tight text-foreground">
            System Overview
          </h1>
        )}
        {activeTab === "world" && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Agent World</span>
          </div>
        )}
        {/* Tab switcher — full-width on mobile, auto-width on desktop */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-low border border-white/5 sm:ml-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
                activeTab === id
                  ? "bg-surface-high text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Agent World Tab ── full-bleed: reclaim horizontal padding ── */}
      {activeTab === "world" && (
        <div className="-mx-3 md:-mx-6">
          <AgentWorldView />
        </div>
      )}

      {/* ── Dashboard Tab ── */}
      {activeTab === "dashboard" && <>

      {/* ── Top Row: Mascot + Stats ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <div className="lg:col-span-5">
          <MascotCard stats={stats} />
        </div>
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            icon={stats.gatewayStatus === "running" ? Wifi : WifiOff}
            label="Gateway"
            value={stats.gatewayStatus === "running" ? "Running" : "Offline"}
            pulseDot={stats.gatewayStatus === "running"}
            sub={stats.gatewayStatus === "running" ? `PORT ${stats.gatewayPort}` : "Reconnecting…"}
            subColor={stats.gatewayStatus === "running" ? undefined : "text-[var(--status-paused-text)]"}
            chartData={gatewayData}
            chartColor={stats.gatewayStatus === "running" ? "#10b981" : "#6b7280"}
          />
          <StatCard
            icon={MessageSquare}
            label="Sessions"
            value={stats.totalSessions}
            valueSuffix="total"
            sub={`${stats.activeSessions} Active • ${stats.gwSessions} Gateway`}
            chartData={sessionData}
            chartColor="#6366f1"
          />
          <StatCard
            icon={Bot}
            label="Agents"
            value={stats.totalAgents}
            valueSuffix="provisioned"
            sub={`${stats.activeAgents} Active`}
            chartData={agentData}
            chartColor="#8b5cf6"
          />
          <StatCard
            icon={DollarSign}
            label="Total Cost"
            value={`$${stats.totalCost.toFixed(2)}`}
            valueSuffix="USD"
            chartData={costData}
            chartColor="#f59e0b"
          />
        </div>
      </div>

      {/* ── Main Content: Activity + Live Agents ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left Column — Recent Activity (built from sessions) */}
        <div id="recent-activity" className="lg:col-span-7 space-y-4">
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
              <ScrollArea className="h-[520px]">
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
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {onlineCount} Online
                </span>
              </div>
              <button
                onClick={() => navigate("/agents")}
                className="text-[11px] font-medium text-primary/70 hover:text-primary transition-colors hover:underline"
              >
                See all →
              </button>
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
                {[...agents]
                  .sort((a, b) => {
                    const aActive = agentProcessingMap.get(a.name) || agentProcessingMap.get(a.id) || 0
                    const bActive = agentProcessingMap.get(b.name) || agentProcessingMap.get(b.id) || 0
                    return bActive - aActive
                  })
                  .slice(0, 4)
                  .map((agent) => {
                  const activeCount = agentProcessingMap.get(agent.name) || agentProcessingMap.get(agent.id) || 0
                  return (
                    <LiveAgentCard
                      key={agent.id}
                      agent={agent}
                      isProcessing={activeCount > 0}
                      activeSessions={activeCount}
                      onClick={() => navigate(`/agents/${agent.id}`)}
                    />
                  )
                })}
              </div>
              {agents.length > 4 && (
                <button
                  onClick={() => navigate("/agents")}
                  className="w-full py-2 text-xs font-medium text-muted-foreground hover:text-foreground border border-dashed border-white/8 hover:border-white/20 rounded-xl transition-all"
                >
                  +{agents.length - 4} more agents — See all
                </button>
              )}

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

      </> /* end dashboard tab */}
    </div>
  )
}
