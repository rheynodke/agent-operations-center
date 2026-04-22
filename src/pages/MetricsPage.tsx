import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BarChart3, CheckCircle2, DollarSign, Users, ShieldAlert, RefreshCw, Loader2 } from "lucide-react"
import { api } from "@/lib/api"
import { useProjectStore, useAgentStore } from "@/stores"
import type { MetricsRange, MetricsSummary, MetricsThroughput, MetricsAgents, MetricsLifecycle } from "@/types"
import { KpiCard } from "@/components/metrics/KpiCard"
import { StatusDistribution } from "@/components/metrics/StatusDistribution"
import { ThroughputChart } from "@/components/metrics/ThroughputChart"
import { AgentLeaderboard } from "@/components/metrics/AgentLeaderboard"
import { LifecycleFunnel } from "@/components/metrics/LifecycleFunnel"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const RANGES: { value: MetricsRange; label: string }[] = [
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

const ALL_PROJECTS = "__all__"

function formatCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export default function MetricsPage() {
  const projects = useProjectStore(s => s.projects)
  const knownAgents = useAgentStore(s => s.agents)
  const [range, setRange] = useState<MetricsRange>('30d')
  const [projectId, setProjectId] = useState<string>(ALL_PROJECTS)
  const [summary, setSummary] = useState<MetricsSummary | null>(null)
  const [throughput, setThroughput] = useState<MetricsThroughput | null>(null)
  const [leaderboard, setLeaderboard] = useState<MetricsAgents | null>(null)
  const [lifecycle, setLifecycle] = useState<MetricsLifecycle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastFetchRef = useRef<number>(0)

  const effectiveProjectId = projectId === ALL_PROJECTS ? null : projectId

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sumRes, thrRes, agentsRes, lifeRes] = await Promise.all([
        api.getMetricsSummary(range, effectiveProjectId),
        api.getMetricsThroughput(range, effectiveProjectId),
        api.getMetricsAgents(range, effectiveProjectId),
        api.getMetricsLifecycle(range, effectiveProjectId),
      ])
      setSummary(sumRes)
      setThroughput(thrRes)
      setLeaderboard(agentsRes)
      setLifecycle(lifeRes)
      lastFetchRef.current = Date.now()
    } catch (e) {
      setError((e as Error).message || "Failed to load metrics")
    } finally { setLoading(false) }
  }, [range, effectiveProjectId])

  // Fetch on mount + whenever range/project changes
  useEffect(() => { load() }, [load])

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(() => load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  const compareLabel = useMemo(() => {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
    return `vs previous ${days}d`
  }, [range])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <BarChart3 className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Metrics</h1>
            <p className="text-[11px] text-muted-foreground/60">
              {summary && !loading
                ? `Window: ${new Date(summary.since).toLocaleDateString()} → ${new Date(summary.until).toLocaleDateString()}`
                : 'Loading…'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Project filter */}
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-8 text-xs w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
              {projects.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Range toggle */}
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
            title="Refresh now"
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

      {/* KPI strip */}
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
          invertGood  // cost going up is bad
          compareLabel={compareLabel}
          loading={loading && !summary}
        />
        <KpiCard
          label="Active agents"
          icon={Users}
          tone="blue"
          value={summary?.kpis.activeAgents.current ?? 0}
          deltaPct={summary?.kpis.activeAgents.deltaPct ?? null}
          compareLabel={compareLabel}
          loading={loading && !summary}
        />
        <KpiCard
          label="Blocked"
          icon={ShieldAlert}
          tone="red"
          value={summary?.kpis.blocked.current ?? 0}
          deltaPct={null} // snapshot — no historical baseline in MVP
          invertGood
          compareLabel="current"
          loading={loading && !summary}
        />
      </div>

      {/* Status distribution */}
      <StatusDistribution
        distribution={summary?.statusDistribution ?? { backlog: 0, todo: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 }}
        loading={loading && !summary}
      />

      {/* Throughput chart */}
      <ThroughputChart data={throughput} loading={loading && !throughput} />

      {/* Two-column: leaderboard + lifecycle funnel (stacks on mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgentLeaderboard
          agents={leaderboard?.agents ?? []}
          knownAgents={knownAgents}
          loading={loading && !leaderboard}
        />
        <LifecycleFunnel
          transitions={lifecycle?.transitions ?? []}
          loading={loading && !lifecycle}
        />
      </div>
    </div>
  )
}
