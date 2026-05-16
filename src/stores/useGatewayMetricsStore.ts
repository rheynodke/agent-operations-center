import { create } from "zustand"
import type { GatewayMetricsRange, GatewayMetricsMetric } from "@/types"

interface GatewayMetricsState {
  range: GatewayMetricsRange
  userId: number | null
  leaderboardMetric: GatewayMetricsMetric
  resourceMetric: 'rss' | 'cpu'
  lastRefreshAt: number
  setRange: (r: GatewayMetricsRange) => void
  setUserId: (id: number | null) => void
  setLeaderboardMetric: (m: GatewayMetricsMetric) => void
  setResourceMetric: (m: 'rss' | 'cpu') => void
  touchRefresh: () => void
}

export const useGatewayMetricsStore = create<GatewayMetricsState>((set) => ({
  range: '24h',
  userId: null,
  leaderboardMetric: 'rss',
  resourceMetric: 'rss',
  lastRefreshAt: 0,
  setRange: (range) => set({ range }),
  setUserId: (userId) => set({ userId }),
  setLeaderboardMetric: (leaderboardMetric) => set({ leaderboardMetric }),
  setResourceMetric: (resourceMetric) => set({ resourceMetric }),
  touchRefresh: () => set({ lastRefreshAt: Date.now() }),
}))
