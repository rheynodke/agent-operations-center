import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import { useGatewayMetricsStore } from "@/stores"
import type {
  GatewayAggregate,
  GatewayTimeseries,
  GatewayStateTimeline,
  GatewayLeaderboardEntry,
  GatewayMetricsMetric,
} from "@/types"

const AUTO_REFRESH_INTERVAL_MS = 60_000

export interface GatewayMetricsBundle {
  aggregate: GatewayAggregate | null
  timeseries: GatewayTimeseries | null
  stateTimeline: GatewayStateTimeline | null
  leaderboard: GatewayLeaderboardEntry[] | null
}

export interface UseGatewayMetricsResult extends GatewayMetricsBundle {
  loading: boolean
  refreshing: boolean
  error: Error | null
  refresh: () => void
}

/**
 * Fetches all 4 admin gateway-metrics endpoints in parallel and
 * auto-refreshes every 60s while mounted. Re-fetches on range / userId /
 * leaderboard metric change. Exposes manual `refresh()`.
 */
export function useGatewayMetrics(): UseGatewayMetricsResult {
  const range = useGatewayMetricsStore((s) => s.range)
  const userId = useGatewayMetricsStore((s) => s.userId)
  const leaderboardMetric = useGatewayMetricsStore((s) => s.leaderboardMetric)
  const touchRefresh = useGatewayMetricsStore((s) => s.touchRefresh)

  const [aggregate, setAggregate] = useState<GatewayAggregate | null>(null)
  const [timeseries, setTimeseries] = useState<GatewayTimeseries | null>(null)
  const [stateTimeline, setStateTimeline] = useState<GatewayStateTimeline | null>(null)
  const [leaderboard, setLeaderboard] = useState<GatewayLeaderboardEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reqIdRef = useRef(0)

  const fetchAll = useCallback(
    async (isInitial: boolean, metric: GatewayMetricsMetric) => {
      const reqId = ++reqIdRef.current
      if (isInitial) setLoading(true)
      else setRefreshing(true)
      try {
        const [agg, ts, st, lb] = await Promise.all([
          api.getAdminGatewayMetricsAggregate(range),
          api.getAdminGatewayMetricsTimeseries(range, userId != null ? { userId } : {}),
          api.getAdminGatewayMetricsStateTimeline(range),
          api.getAdminGatewayMetricsLeaderboard(range, metric, 10),
        ])
        if (reqId !== reqIdRef.current) return
        setAggregate(agg)
        setTimeseries(ts)
        setStateTimeline(st)
        setLeaderboard(lb)
        setError(null)
        touchRefresh()
      } catch (err) {
        if (reqId !== reqIdRef.current) return
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [range, userId, touchRefresh],
  )

  // Refetch when range / userId / leaderboard metric changes
  useEffect(() => {
    fetchAll(aggregate == null, leaderboardMetric)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, userId, leaderboardMetric])

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(() => {
      fetchAll(false, leaderboardMetric)
    }, AUTO_REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchAll, leaderboardMetric])

  const refresh = useCallback(() => {
    fetchAll(false, leaderboardMetric)
  }, [fetchAll, leaderboardMetric])

  return { aggregate, timeseries, stateTimeline, leaderboard, loading, refreshing, error, refresh }
}
