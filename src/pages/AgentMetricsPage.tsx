import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft, BarChart3, CheckCircle2, DollarSign, Timer, TrendingUp, ExternalLink, RefreshCw, Loader2,
} from "lucide-react"
import { api } from "@/lib/api"
import { useAgentStore } from "@/stores"
import type { MetricsRange, MetricsSummary, MetricsThroughput, MetricsLifecycle, MetricsAgentTasks } from "@/types"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { KpiCard } from "@/components/metrics/KpiCard"
import { StatusDistribution } from "@/components/metrics/StatusDistribution"
import { ThroughputChart } from "@/components/metrics/ThroughputChart"
import { LifecycleFunnel } from "@/components/metrics/LifecycleFunnel"
import { cn } from "@/lib/utils"

const RANGES: { value: MetricsRange; label: string }[] = [
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

const STATUS_BADGE: Record<string, string> = {
  backlog:     "bg-zinc-500/10    text-zinc-400    border-zinc-500/20",
  todo:        "bg-blue-500/10    text-blue-400    border-blue-500/20",
  in_progress: "bg-amber-500/10   text-amber-400   border-amber-500/20",
  in_review:   "bg-violet-500/10  text-violet-400  border-violet-500/20",
  blocked:     "bg-red-500/10     text-red-400     border-red-500/20",
  done:        "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
}
const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress",
  in_review: "In Review", blocked: "Blocked", done: "Done",
}

function formatCost(n: number | null): string {
  if (n == null) return "–"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "–"
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const d = Math.floor(hr / 24)
  return `${d}d ${hr % 24}h`
}

function relativeTime(iso: string | null): string {
  if (!iso) return "–"
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })
}

export default function AgentMetricsPage() {
  const { agentId = "" } = useParams()
  const navigate = useNavigate()
  const knownAgents = useAgentStore(s => s.agents)
  const knownAgent = knownAgents.find(a => a.id === agentId)

  const [range, setRange] = useState<MetricsRange>('30d')
  const [summary, setSummary] = useState<MetricsSummary | null>(null)
  const [throughput, setThroughput] = useState<MetricsThroughput | null>(null)
  const [lifecycle, setLifecycle] = useState<MetricsLifecycle | null>(null)
  const [tasksRes, setTasksRes] = useState<MetricsAgentTasks | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!agentId) return
    setLoading(true)
    setError(null)
    try {
      const [s, t, l, tsk] = await Promise.all([
        api.getMetricsSummary(range, null, agentId),
        api.getMetricsThroughput(range, null, agentId),
        api.getMetricsLifecycle(range, null, agentId),
        api.getMetricsAgentTasks(agentId, null, 20),
      ])
      setSummary(s); setThroughput(t); setLifecycle(l); setTasksRes(tsk)
    } catch (e) {
      setError((e as Error).message || "Failed to load agent metrics")
    } finally { setLoading(false) }
  }, [agentId, range])

  useEffect(() => { load() }, [load])

  // Auto-refresh 60s
  useEffect(() => {
    const t = setInterval(() => load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  const agent = tasksRes?.agent || (knownAgent ? { id: knownAgent.id, name: knownAgent.name, emoji: knownAgent.emoji } : null)
  const tasks = tasksRes?.tasks ?? []

  const compareLabel = useMemo(() => {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
    return `vs previous ${days}d`
  }, [range])

  // Derive "average duration" for KPI strip from completed tasks in window
  const avgDurationMs = useMemo(() => {
    const done = tasks.filter(t => t.status === 'done' && t.durationMs != null && t.durationMs > 0)
    if (done.length === 0) return null
    return done.reduce((s, t) => s + (t.durationMs as number), 0) / done.length
  }, [tasks])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/metrics')}
            className="h-8 w-8 rounded-md border border-border/40 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/30 shrink-0"
            title="Back to metrics"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          {knownAgent ? (
            <AgentAvatar avatarPresetId={knownAgent.avatarPresetId} emoji={knownAgent.emoji} size="w-10 h-10" className="rounded-lg shrink-0" />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <BarChart3 className="h-5 w-5 text-violet-400" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">{agent?.name || agentId}</h1>
            <p className="text-[11px] text-muted-foreground/60 truncate">
              Agent metrics · {summary && !loading
                ? `${new Date(summary.since).toLocaleDateString()} → ${new Date(summary.until).toLocaleDateString()}`
                : 'loading…'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate(`/board?agentId=${agentId}`)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30"
          >
            View tasks <ExternalLink className="h-3 w-3" />
          </button>
          <div className="inline-flex h-8 rounded-md border border-border/40 overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={cn(
                  "px-3 text-xs font-medium transition-colors",
                  range === r.value
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30 disabled:opacity-50"
            title="Refresh"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* KPI strip (agent-scoped). Trade activeAgents+blocked for avgDuration+completionRate. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Completed"
          icon={CheckCircle2}
          tone="emerald"
          value={summary?.kpis.completed.current ?? 0}
          deltaPct={summary?.kpis.completed.deltaPct ?? null}
          compareLabel={compareLabel}
          loading={loading && !summary}
        />
        <KpiCard
          label="Cost"
          icon={DollarSign}
          tone="violet"
          value={summary ? formatCost(summary.kpis.cost.current) : "–"}
          deltaPct={summary?.kpis.cost.deltaPct ?? null}
          invertGood
          compareLabel={compareLabel}
          loading={loading && !summary}
        />
        <KpiCard
          label="Avg duration"
          icon={Timer}
          tone="blue"
          value={formatDuration(avgDurationMs)}
          deltaPct={null}
          compareLabel="done tasks in window"
          loading={loading && !tasksRes}
        />
        <KpiCard
          label="Throughput"
          icon={TrendingUp}
          tone="amber"
          value={throughput?.buckets.reduce((s, b) => s + b.count, 0) ?? 0}
          deltaPct={null}
          compareLabel="total completions in window"
          loading={loading && !throughput}
        />
      </div>

      {/* Status distribution */}
      <StatusDistribution
        distribution={summary?.statusDistribution ?? { backlog: 0, todo: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 }}
        loading={loading && !summary}
      />

      {/* Throughput chart */}
      <ThroughputChart data={throughput} loading={loading && !throughput} />

      {/* Lifecycle funnel */}
      <LifecycleFunnel transitions={lifecycle?.transitions ?? []} loading={loading && !lifecycle} />

      {/* Recent tasks */}
      <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10">
          <span className="text-xs font-semibold text-foreground/80 tracking-wide">Recent tasks</span>
          <span className="text-[10px] text-muted-foreground/50">last {tasks.length}</span>
        </div>

        {loading && tasks.length === 0 ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="h-8 rounded bg-muted/20 animate-pulse" />)}
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic px-4 py-6 text-center">
            No tasks assigned to this agent yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 bg-muted/5">
                  <th className="text-left font-semibold uppercase tracking-wider text-[10px] text-muted-foreground/60 px-4 py-2">Title</th>
                  <th className="text-left font-semibold uppercase tracking-wider text-[10px] text-muted-foreground/60 px-3 py-2">Status</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[10px] text-muted-foreground/60 px-3 py-2">Cost</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[10px] text-muted-foreground/60 px-3 py-2">Duration</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[10px] text-muted-foreground/60 px-4 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/board?taskId=${t.id}`)}
                    className="border-b border-border/20 last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                    title="Open on the task board"
                  >
                    <td className="px-4 py-2 max-w-[320px]">
                      <div className="truncate text-foreground/90 font-medium" title={t.title}>{t.title}</div>
                      {t.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {t.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-[9px] bg-muted/40 text-muted-foreground/70 px-1 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border",
                        STATUS_BADGE[t.status] || STATUS_BADGE.backlog
                      )}>
                        {STATUS_LABEL[t.status] || t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground/80">{formatCost(t.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground/80">{formatDuration(t.durationMs)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground/70">{relativeTime(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
