import { useEffect, useMemo, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { api } from "@/lib/api"
import { useGatewayMetrics } from "@/hooks/useGatewayMetrics"
import { GatewayMetricsHeader } from "@/components/gateway-metrics/GatewayMetricsHeader"
import { ClusterKPIs } from "@/components/gateway-metrics/ClusterKPIs"
import { ResourceTrendsChart } from "@/components/gateway-metrics/ResourceTrendsChart"
import { ActivityThroughputChart } from "@/components/gateway-metrics/ActivityThroughputChart"
import { StateTimelineChart } from "@/components/gateway-metrics/StateTimelineChart"
import { GatewayLeaderboard } from "@/components/gateway-metrics/GatewayLeaderboard"
import type { ManagedUser } from "@/types"

interface UserOption {
  userId: number
  username: string
}

export default function GatewayMetricsPage() {
  const { aggregate, timeseries, stateTimeline, leaderboard, loading, refreshing, error, refresh } = useGatewayMetrics()
  const [users, setUsers] = useState<UserOption[]>([])

  useEffect(() => {
    let cancelled = false
    api.listUsers()
      .then((res) => {
        if (cancelled) return
        const opts = (res.users as ManagedUser[]).map((u) => ({ userId: u.id, username: u.username }))
        opts.sort((a, b) => a.username.localeCompare(b.username))
        setUsers(opts)
      })
      .catch(() => { /* non-fatal; user filter just stays at All */ })
    return () => { cancelled = true }
  }, [])

  const isEmpty = useMemo(() => {
    if (loading) return false
    return aggregate != null && aggregate.totalCount === 0
  }, [aggregate, loading])

  return (
    <div className="p-6 space-y-6">
      <GatewayMetricsHeader users={users} onRefresh={refresh} refreshing={refreshing} loading={loading} />

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 text-xs">
            <p className="font-medium text-red-300">Failed to load metrics</p>
            <p className="text-red-300/70 mt-0.5">{error.message}</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="text-xs px-3 py-1 rounded-md border border-red-500/40 text-red-300 hover:bg-red-500/10"
          >
            Retry
          </button>
        </div>
      )}

      <ClusterKPIs data={aggregate} loading={loading} />

      {isEmpty ? (
        <div className="rounded-xl border border-border/40 bg-card/40 p-12 flex flex-col items-center justify-center text-center space-y-2">
          <p className="text-sm font-medium text-foreground/80">Collecting metrics…</p>
          <p className="text-xs text-muted-foreground/60 max-w-md">
            First samples will appear shortly. The poller runs every 30 seconds; allow ~1 minute after server start for the chart to populate.
          </p>
        </div>
      ) : (
        <>
          <ResourceTrendsChart data={timeseries} loading={loading} />
          <ActivityThroughputChart data={timeseries} loading={loading} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StateTimelineChart data={stateTimeline} loading={loading} />
            <GatewayLeaderboard entries={leaderboard} loading={loading} />
          </div>
        </>
      )}
    </div>
  )
}
