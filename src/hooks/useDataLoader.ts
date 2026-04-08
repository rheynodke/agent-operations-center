import { useEffect, useRef } from "react"
import { useAuthStore, useAgentStore, useSessionStore, useTaskStore, useCronStore, useOverviewStore, useActivityStore, useRoutingStore } from "@/stores"
import { api } from "@/lib/api"
import type { ActivityEvent, DashboardOverview } from "@/types"

const POLL_INTERVAL = 30_000 // 30s fallback polling

export function useDataLoader() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function loadAll() {
    try {
      const [agents, sessions, tasks, overview, activity, routes] = await Promise.allSettled([
        api.getAgents(),
        api.getSessions(),
        api.getTasks(),
        api.getOverview(),
        api.getActivity(),
        api.getRoutes(),
      ])

      if (agents.status === "fulfilled") {
        const data = agents.value as { agents: never[] }
        useAgentStore.getState().setAgents(data?.agents ?? [])
      }
      if (sessions.status === "fulfilled") {
        const data = sessions.value as { sessions: never[] }
        useSessionStore.getState().setSessions(data?.sessions ?? [])
      }
      if (tasks.status === "fulfilled") {
        const data = tasks.value as { tasks: never[] }
        useTaskStore.getState().setTasks(data?.tasks ?? [])
      }
      if (overview.status === "fulfilled") {
        const overviewData = overview.value as DashboardOverview
        useOverviewStore.getState().setOverview(overviewData as never)

        // Seed activity store from overview.recentActivity if /activity endpoint didn't return data
        if (activity.status !== "fulfilled") {
          const recentActivity = overviewData?.recentActivity
          if (Array.isArray(recentActivity) && recentActivity.length > 0) {
            const store = useActivityStore.getState()
            if (store.events.length === 0) {
              recentActivity.forEach((ev: ActivityEvent) => store.addEvent(ev))
            }
          }
        }
      }

      if (routes.status === "fulfilled") {
        const data = routes.value as { routes: never[] }
        useRoutingStore.getState().setRoutes(data?.routes ?? [])
      }

      // Load activity events from dedicated endpoint
      if (activity.status === "fulfilled") {
        const data = activity.value as { events?: ActivityEvent[] } | ActivityEvent[]
        const events = Array.isArray(data) ? data : data?.events
        if (Array.isArray(events) && events.length > 0) {
          const store = useActivityStore.getState()
          // Replace all events with fresh data from the API
          store.clearEvents()
          events.forEach((ev: ActivityEvent) => store.addEvent(ev))
        }
      }
    } catch (e) {
      console.error("[DataLoader] error", e)
    }
  }

  async function loadCron() {
    try {
      const data = await api.getCronJobs() as { jobs: never[] }
      useCronStore.getState().setJobs(data?.jobs ?? [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!isAuthenticated) return

    // Initial load
    loadAll()
    loadCron()

    // Polling fallback
    timerRef.current = setInterval(loadAll, POLL_INTERVAL)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isAuthenticated])
}
