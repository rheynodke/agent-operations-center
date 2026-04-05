import { useEffect, useRef, useCallback } from "react"
import { useAuthStore, useWsStore, useActivityStore, useLiveFeedStore, useAgentStore, useSessionStore, useTaskStore, useCronStore, useSessionLiveStore } from "@/stores"
import { api } from "@/lib/api"
import type { WsMessage } from "@/types"

const WS_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]
const DEBOUNCE_MS = 1000 // debounce session/agent reloads

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempts = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { token } = useAuthStore()
  const { setStatus } = useWsStore()

  // Debounced data reload — triggered when watcher events arrive
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(async () => {
      try {
        const [sessionsRes, agentsRes, overviewRes] = await Promise.allSettled([
          api.getSessions(),
          api.getAgents(),
          api.getOverview(),
        ])
        if (sessionsRes.status === "fulfilled") {
          const data = sessionsRes.value as { sessions: never[] }
          useSessionStore.getState().setSessions(data?.sessions ?? [])
        }
        if (agentsRes.status === "fulfilled") {
          const data = agentsRes.value as { agents: never[] }
          useAgentStore.getState().setAgents(data?.agents ?? [])
        }
        // Overview store is optional but good to keep in sync
        if (overviewRes.status === "fulfilled") {
          const { useOverviewStore } = await import("@/stores")
          useOverviewStore.getState().setOverview(overviewRes.value as never)
        }
      } catch (e) {
        console.error("[WS] Reload error", e)
      }
    }, DEBOUNCE_MS)
  }, [])

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg: WsMessage = JSON.parse(event.data)

      switch (msg.type) {
        case "init": {
          // Initial snapshot from server on connect — use mergeAgents to preserve DB fields
          const payload = msg.payload as { agents?: unknown[]; sessions?: unknown[] }
          if (Array.isArray(payload?.agents)) useAgentStore.getState().mergeAgents(payload.agents as never)
          if (Array.isArray(payload?.sessions)) useSessionStore.getState().setSessions(payload.sessions as never)
          break
        }

        case "agents:updated": {
          const agents = (msg.payload as { agents?: unknown[] })?.agents
          if (Array.isArray(agents)) useAgentStore.getState().mergeAgents(agents as never)
          break
        }

        case "sessions:updated": {
          const sessions = (msg.payload as { sessions?: unknown[] })?.sessions
          if (Array.isArray(sessions)) useSessionStore.getState().setSessions(sessions as never)
          break
        }

        // ─── Events from the LiveFeedWatcher (the REAL real-time source) ───

        // Individual parsed event streamed from a gateway session JSONL tail
        case "session:live-event": {
          // Watcher events are flat: { type, sessionId, event, agent, timestamp }
          const raw = msg as unknown as { sessionId?: string; event?: Record<string, unknown> }
          if (raw.sessionId && raw.event) {
            useSessionLiveStore.getState().push(raw.sessionId, raw.event)
          }
          // Also schedule a reload so the session list stays in sync
          scheduleReload()
          break
        }

        // These are the events the watcher broadcasts when session files change
        case "session:update":
        case "opencode:event":
        case "subagent:update": {
          // A session was updated — debounce reload sessions + agents
          scheduleReload()
          break
        }

        case "progress:update":
        case "progress:step": {
          // Dev progress changed — reload tasks
          api.getTasks().then((data) => {
            const tasks = (data as { tasks: never[] })?.tasks
            if (Array.isArray(tasks)) useTaskStore.getState().setTasks(tasks)
          }).catch(() => {})
          break
        }

        case "cron:update": {
          // Cron file changed — reload cron jobs
          api.getCronJobs().then((data) => {
            const jobs = (data as { jobs: never[] })?.jobs
            if (Array.isArray(jobs)) useCronStore.getState().setJobs(jobs)
          }).catch(() => {})
          break
        }

        case "tasks:updated": {
          const tasks = (msg.payload as { tasks?: unknown[] })?.tasks
          if (Array.isArray(tasks)) useTaskStore.getState().setTasks(tasks as never)
          break
        }

        case "cron:updated": {
          const jobs = (msg.payload as { jobs?: unknown[] })?.jobs
          if (Array.isArray(jobs)) useCronStore.getState().setJobs(jobs as never)
          break
        }

        case "activity:event": {
          const event = msg.payload as never
          if (event) useActivityStore.getState().addEvent(event)
          break
        }

        case "live:entry": {
          const entry = msg.payload as never
          if (entry) useLiveFeedStore.getState().addEntry(entry)
          break
        }

        case "agent:status": {
          const { agentId, status } = msg.payload as { agentId: string; status: string }
          if (agentId) useAgentStore.getState().updateAgent(agentId, { status: status as never })
          break
        }

        case "connected": {
          // Server greeting, no action needed
          break
        }

        default: {
          // Unknown event type — might be a new watcher event, schedule a reload
          console.debug("[WS] Unhandled event type:", msg.type)
          scheduleReload()
          break
        }
      }
    } catch (e) {
      console.error("[WS] Failed to parse message", e)
    }
  }, [scheduleReload])

  const connect = useCallback(() => {
    if (!token) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setStatus("connecting")
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    // In dev mode (Vite typically on 5173), connect directly to the backend port for WebSockets
    const host = window.location.port === "5173" ? "localhost:18800" : window.location.host
    const wsUrl = `${protocol}//${host}/ws?token=${token}`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus("connected")
        reconnectAttempts.current = 0
      }

      ws.onmessage = handleMessage

      ws.onclose = () => {
        setStatus("disconnected")
        wsRef.current = null
        scheduleReconnect()
      }

      ws.onerror = () => {
        setStatus("error")
      }
    } catch (e) {
      console.error("[WS] Connection error", e)
      setStatus("error")
      scheduleReconnect()
    }
  }, [token, handleMessage, setStatus])

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    const delay = WS_RECONNECT_DELAYS[Math.min(reconnectAttempts.current, WS_RECONNECT_DELAYS.length - 1)]
    reconnectAttempts.current++
    reconnectTimer.current = setTimeout(connect, delay)
  }, [connect])

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    wsRef.current?.close()
    wsRef.current = null
    setStatus("disconnected")
  }, [setStatus])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return { connect, disconnect }
}
