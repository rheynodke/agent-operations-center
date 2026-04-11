import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Agent, Session, Task, TaskStatus, TaskPriority, CronJob, GatewayRoute, Alert, ActivityEvent, LiveFeedEntry, DashboardOverview, AuthUser } from "@/types"

export * from "./useThemeStore"
export { useProjectStore } from './useProjectStore'

// ─── Auth Store ───────────────────────────────────────────────────────────────
interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
  needsSetup: boolean | null // null = not yet checked
  loading: boolean
  setAuth: (token: string, user: AuthUser) => void
  clearAuth: () => void
  setNeedsSetup: (v: boolean) => void
  setLoading: (v: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("aoc_token"),
  user: (() => {
    try {
      const raw = localStorage.getItem("aoc_user")
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })(),
  isAuthenticated: !!localStorage.getItem("aoc_token"),
  needsSetup: null,
  loading: false,
  setAuth: (token, user) => {
    localStorage.setItem("aoc_token", token)
    localStorage.setItem("aoc_user", JSON.stringify(user))
    set({ token, user, isAuthenticated: true })
  },
  clearAuth: () => {
    localStorage.removeItem("aoc_token")
    localStorage.removeItem("aoc_user")
    set({ token: null, user: null, isAuthenticated: false })
  },
  setNeedsSetup: (needsSetup) => set({ needsSetup }),
  setLoading: (loading) => set({ loading }),
}))

// DB-sourced fields that should survive a WS overwrite
const DB_FIELDS = ['avatarPresetId', 'color', 'description', 'hasAvatar'] as const
type DbField = typeof DB_FIELDS[number]

interface AgentState {
  agents: Agent[]
  loading: boolean
  setAgents: (agents: Agent[]) => void
  /** Merge incoming agent list but preserve DB-sourced fields from current store */
  mergeAgents: (incoming: Agent[]) => void
  updateAgent: (id: string, patch: Partial<Agent>) => void
  addAgent: (agent: Agent) => void
  removeAgent: (id: string) => void
  setLoading: (v: boolean) => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  loading: false,
  setAgents: (agents) => set({ agents }),
  mergeAgents: (incoming) =>
    set((s) => ({
      agents: incoming.map((newAgent) => {
        const existing = s.agents.find((a) => a.id === newAgent.id)
        if (!existing) return newAgent
        // Preserve DB-sourced fields if the incoming data lacks them
        const preserved: Partial<Agent> = {}
        for (const field of DB_FIELDS) {
          const existingVal = (existing as unknown as Record<string, unknown>)[field]
          const newVal = (newAgent as unknown as Record<string, unknown>)[field]
          if (existingVal != null && (newVal == null || newVal === undefined)) {
            ;(preserved as unknown as Record<string, unknown>)[field] = existingVal
          }
        }
        return { ...newAgent, ...preserved }
      }),
    })),
  updateAgent: (id, patch) =>
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  addAgent: (agent) => set((s) => ({ agents: [...s.agents, agent] })),
  removeAgent: (id) => set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),
  setLoading: (loading) => set({ loading }),
}))

// ─── Session Store ────────────────────────────────────────────────────────────
interface SessionState {
  sessions: Session[]
  loading: boolean
  setSessions: (sessions: Session[]) => void
  setLoading: (v: boolean) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  loading: false,
  setSessions: (sessions) => set({ sessions }),
  setLoading: (loading) => set({ loading }),
}))

// ─── Task Store ───────────────────────────────────────────────────────────────
interface TaskFilters {
  agentId?: string
  status?: string
  priority?: string
  tag?: string
  q?: string
}

export interface TaskStatusChange {
  uid: string          // unique per-event id for React key
  taskId: string
  title: string
  agentId?: string
  fromStatus: string
  toStatus: string
  at: number
}

interface TaskState {
  tasks: Task[]
  loading: boolean
  filters: TaskFilters
  recentChanges: TaskStatusChange[]
  setTasks: (tasks: Task[]) => void
  addTask: (task: Task) => void
  updateTask: (id: string, patch: Partial<Task>) => void
  removeTask: (id: string) => void
  setLoading: (v: boolean) => void
  setFilters: (filters: Partial<TaskFilters>) => void
  clearFilters: () => void
  dismissChange: (uid: string) => void
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  loading: false,
  filters: {},
  recentChanges: [],
  setTasks: (tasks) => set((s) => {
    // Detect status changes between old and new task list (from WS broadcast)
    const changes: TaskStatusChange[] = []
    for (const newTask of tasks) {
      const old = s.tasks.find(t => t.id === newTask.id)
      if (old && old.status !== newTask.status) {
        changes.push({
          uid: `${newTask.id}-${Date.now()}-${Math.random()}`,
          taskId: newTask.id,
          title: newTask.title,
          agentId: newTask.agentId,
          fromStatus: old.status,
          toStatus: newTask.status,
          at: Date.now(),
        })
      }
    }
    return {
      tasks,
      recentChanges: changes.length > 0
        ? [...s.recentChanges, ...changes].slice(-6) // keep last 6
        : s.recentChanges,
    }
  }),
  addTask:   (task)  => set((s) => ({ tasks: [task, ...s.tasks] })),
  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  clearFilters: () => set({ filters: {} }),
  dismissChange: (uid) => set((s) => ({
    recentChanges: s.recentChanges.filter(c => c.uid !== uid),
  })),
}))

// ─── Cron Store ───────────────────────────────────────────────────────────────
interface CronState {
  jobs: CronJob[]
  loading: boolean
  setJobs: (jobs: CronJob[]) => void
  setLoading: (v: boolean) => void
  addJob: (job: CronJob) => void
  updateJob: (id: string, patch: Partial<CronJob>) => void
  removeJob: (id: string) => void
}

export const useCronStore = create<CronState>((set) => ({
  jobs: [],
  loading: false,
  setJobs: (jobs) => set({ jobs }),
  setLoading: (loading) => set({ loading }),
  addJob: (job) => set((s) => ({ jobs: [...s.jobs, job] })),
  updateJob: (id, patch) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
  removeJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
}))

// ─── Routing Store ────────────────────────────────────────────────────────────
interface RoutingState {
  routes: GatewayRoute[]
  loading: boolean
  setRoutes: (routes: GatewayRoute[]) => void
  addRoute: (route: GatewayRoute) => void
  removeRoute: (id: string) => void
  updateRoute: (id: string, patch: Partial<GatewayRoute>) => void
  setLoading: (v: boolean) => void
}

export const useRoutingStore = create<RoutingState>((set) => ({
  routes: [],
  loading: false,
  setRoutes: (routes) => set({ routes }),
  addRoute: (route) => set((s) => ({ routes: [...s.routes, route] })),
  removeRoute: (id) => set((s) => ({ routes: s.routes.filter((r) => r.id !== id) })),
  updateRoute: (id, patch) =>
    set((s) => ({ routes: s.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  setLoading: (loading) => set({ loading }),
}))

// ─── Alert Store ──────────────────────────────────────────────────────────────
interface AlertState {
  alerts: Alert[]
  addAlert: (alert: Alert) => void
  acknowledgeAlert: (id: string) => void
  clearAllAlerts: () => void
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  addAlert: (alert) => set((s) => ({ alerts: [alert, ...s.alerts].slice(0, 100) })),
  acknowledgeAlert: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
    })),
  clearAllAlerts: () => set({ alerts: [] }),
}))

// ─── Activity Store ───────────────────────────────────────────────────────────
interface ActivityState {
  events: ActivityEvent[]
  addEvent: (event: ActivityEvent) => void
  clearEvents: () => void
}

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  addEvent: (event) => set((s) => ({ events: [event, ...s.events].slice(0, 200) })),
  clearEvents: () => set({ events: [] }),
}))

// ─── Live Feed Store ──────────────────────────────────────────────────────────
interface LiveFeedState {
  entries: LiveFeedEntry[]
  isOpen: boolean
  addEntry: (entry: LiveFeedEntry) => void
  clearFeed: () => void
  toggleFeed: () => void
  setOpen: (open: boolean) => void
}

export const useLiveFeedStore = create<LiveFeedState>()(
  persist(
    (set) => ({
      entries: [],
      isOpen: false,
      addEntry: (entry) => set((s) => ({ entries: [entry, ...s.entries].slice(0, 500) })),
      clearFeed: () => set({ entries: [] }),
      toggleFeed: () => set((s) => ({ isOpen: !s.isOpen })),
      setOpen: (isOpen) => set({ isOpen }),
    }),
    {
      name: "aoc-live-feed",
      partialize: (s) => ({ entries: s.entries }),
    }
  )
)

// ─── Gateway Log Store ────────────────────────────────────────────────────────

export interface GatewayEventEntry {
  id: string
  ts: number
  event: string         // e.g. "health", "tick", "session.message"
  data: Record<string, unknown>
}

export interface GatewayLogEntry {
  id: string
  ts: number
  line: string          // raw JSON line from the gateway WS
  direction?: "in" | "out"
}

interface GatewayLogState {
  events: GatewayEventEntry[]
  logs: GatewayLogEntry[]
  addEvent: (e: GatewayEventEntry) => void
  addLog: (e: GatewayLogEntry) => void
  clearEvents: () => void
  clearLogs: () => void
}

export const useGatewayLogStore = create<GatewayLogState>()(
  persist(
    (set) => ({
      events: [],
      logs: [],
      addEvent: (e) => set((s) => ({ events: [e, ...s.events].slice(0, 500) })),
      addLog:   (e) => set((s) => ({ logs:   [e, ...s.logs  ].slice(0, 500) })),
      clearEvents: () => set({ events: [] }),
      clearLogs:   () => set({ logs: [] }),
    }),
    { name: "aoc-gateway-logs" }
  )
)

// ─── Overview Store ───────────────────────────────────────────────────────────
interface OverviewState {
  overview: DashboardOverview | null
  loading: boolean
  setOverview: (overview: DashboardOverview) => void
  setLoading: (v: boolean) => void
}

export const useOverviewStore = create<OverviewState>((set) => ({
  overview: null,
  loading: false,
  setOverview: (overview) => set({ overview }),
  setLoading: (loading) => set({ loading }),
}))

// ─── WebSocket Store ──────────────────────────────────────────────────────────
type WsStatus = "connecting" | "connected" | "disconnected" | "error"

interface WsState {
  status: WsStatus
  setStatus: (status: WsStatus) => void
}

export const useWsStore = create<WsState>((set) => ({
  status: "disconnected",
  setStatus: (status) => set({ status }),
}))

// ─── Session Live Events Store ────────────────────────────────────────────────
// Receives individual parsed events streamed via WebSocket as they're written to JSONL.
// The SessionDetailModal subscribes to this for true real-time event rendering.
interface SessionLiveEvent {
  sessionId: string
  event: Record<string, unknown>
  ts: number
}

interface SessionLiveState {
  lastEvent: SessionLiveEvent | null
  push: (sessionId: string, event: Record<string, unknown>) => void
  clear: () => void
}

export const useSessionLiveStore = create<SessionLiveState>((set) => ({
  lastEvent: null,
  push: (sessionId, event) => set({ lastEvent: { sessionId, event, ts: Date.now() } }),
  clear: () => set({ lastEvent: null }),
}))
