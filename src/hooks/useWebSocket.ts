import { useEffect, useRef, useCallback } from "react"
import { useAuthStore, useWsStore, useActivityStore, useLiveFeedStore, useAgentStore, useSessionStore, useTaskStore, useCronStore, useSessionLiveStore } from "@/stores"
import { useChatStore } from "@/stores/useChatStore"
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
          // Watcher events are flat: { type, sessionId, sessionKey, event, agent, timestamp }
          const raw = msg as unknown as { sessionId?: string; sessionKey?: string; event?: Record<string, unknown> }
          if (raw.sessionId && raw.event) {
            useSessionLiveStore.getState().push(raw.sessionId, raw.event)
          }
          // Also update the live chat store for sessions we have messages for
          const chatStore = useChatStore.getState()
          const sessionKey = raw.sessionKey
          if (sessionKey && chatStore.messages[sessionKey]?.length) {
            const evt = raw.event as { role?: string; text?: string; thinking?: string; stopReason?: string; tools?: Array<{name: string; output?: string; input?: string}> } | undefined
            if (evt) {
              if (evt.role === 'assistant' && evt.text) {
                // JSONL entries are written AFTER the response completes — always treat as final
                chatStore.updateLastAgentMessage(sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  return { ...m, phase: "done" as const, responseText: evt.text!, responseDone: true, isStreaming: false }
                })
                chatStore.setAgentRunning(sessionKey, false)
              }

              if (evt.role === 'assistant' && evt.thinking) {
                chatStore.updateLastAgentMessage(sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  return { ...m, thinkingText: evt.thinking!, thinkingDone: true }
                })
              }

              // Tool results from JSONL — mark matching running tool as done
              if (evt.role === 'toolResult' && evt.tools?.length) {
                for (const tool of evt.tools) {
                  if (tool.output) {
                    chatStore.updateLastAgentMessage(sessionKey, (m) => {
                      if (m.role !== 'agent') return m
                      return {
                        ...m,
                        toolCalls: (m.toolCalls ?? []).map(tc =>
                          tc.toolName === tool.name && tc.status === 'running'
                            ? { ...tc, result: tool.output!, status: 'done' as const }
                            : tc
                        ),
                      }
                    })
                  }
                }
              }
            }
          }
          // Also schedule a reload so the session list stays in sync
          scheduleReload()
          break
        }

        // These are the events the watcher broadcasts when session files change
        case "session:update": {
          // processing_end fires when the JSONL lock file is removed (agent finished)
          const su = msg as unknown as { action?: string; sessionKey?: string }
          if (su.action === 'processing_end' && su.sessionKey) {
            const chatStore = useChatStore.getState()
            if (chatStore.agentRunning[su.sessionKey]) {
              const msgs = chatStore.messages[su.sessionKey] ?? []
              const lastAgent = [...msgs].reverse().find(m => m.role === 'agent')
              if (lastAgent?.responseText) {
                // Response already in store — finalize immediately
                chatStore.setAgentRunning(su.sessionKey, false)
                chatStore.updateLastAgentMessage(su.sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  return { ...m, phase: 'done' as const, isStreaming: false, responseDone: true }
                })
              } else {
                // Lock file gone but JSONL final response not yet polled (~2s lag)
                // Keep "analyzing" indicator alive, force-clear after 5s
                chatStore.updateLastAgentMessage(su.sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  const toolCalls = (m.toolCalls ?? []).map(tc =>
                    tc.status === 'running' ? { ...tc, status: 'done' as const } : tc
                  )
                  return { ...m, phase: 'analyzing' as const, isStreaming: true, toolCalls }
                })
                setTimeout(() => {
                  const store = useChatStore.getState()
                  if (store.agentRunning[su.sessionKey!]) {
                    store.setAgentRunning(su.sessionKey!, false)
                    store.updateLastAgentMessage(su.sessionKey!, (m) => {
                      if (m.role !== 'agent') return m
                      return { ...m, phase: 'done' as const, isStreaming: false, responseDone: true }
                    })
                  }
                }, 5000)
              }
            }
          }
          scheduleReload()
          break
        }
        case "opencode:event":
        case "subagent:update": {
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
          // ── Gateway & Chat events (forwarded from gateway-ws.cjs) ──────────
          const chatStore = useChatStore.getState()
          if (msg.type === "gateway:connected") {
            chatStore.setGatewayConnected(true)
          } else if (msg.type === "gateway:disconnected") {
            chatStore.setGatewayConnected(false)
          } else if (msg.type === "chat:message") {
            const { sessionKey, role, text, thinking, done, toolName, toolInput, toolResult, toolCallId } = (msg.payload ?? {}) as Record<string, unknown>
            if (sessionKey) {
              const sk = sessionKey as string
              const isThinking = role === "thinking" || !!thinking
              if (role === "assistant" || role === "thinking") {
                const hasText = !!(text as string)?.trim()
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  if (isThinking) {
                    return { ...m, phase: "thinking" as const, thinkingText: (m.thinkingText ?? "") + ((thinking ?? text ?? "") as string), thinkingDone: !!done, isStreaming: true }
                  }
                  const newText = (text as string | undefined) ?? ""
                  const hasContent = !!(newText || m.responseText)
                  const reallyDone = !!done && hasContent
                  return {
                    ...m,
                    phase: reallyDone ? "done" as const : "responding" as const,
                    responseText: newText ? (m.responseText ?? "") + newText : m.responseText,
                    responseDone: reallyDone,
                    isStreaming: !reallyDone,
                  }
                })
                if (done && hasText) chatStore.setAgentRunning(sk, false)
              } else if (role === "tool_start") {
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  const id = (toolCallId ?? toolName ?? String(Date.now())) as string
                  return { ...m, phase: "tool_running" as const, toolCalls: [...(m.toolCalls ?? []), { id, toolName: (toolName as string) ?? "tool", input: toolInput as string|Record<string,unknown>, status: "running" as const }] }
                })
              } else if (role === "tool_result") {
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  return { ...m, toolCalls: (m.toolCalls ?? []).map((tc) => tc.id === ((toolCallId ?? toolName) as string) ? { ...tc, result: toolResult as string|Record<string,unknown>, status: "done" as const } : tc) }
                })
              }
            }
          } else if (msg.type === "chat:tool") {
            const { sessionKey, toolName, toolInput, toolResult, toolCallId, status } = (msg.payload ?? {}) as Record<string, unknown>
            if (sessionKey) {
              const sk = sessionKey as string
              if (status === "start") {
                chatStore.setAgentRunning(sk, true)
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  const existing = m.toolCalls?.find((tc) => tc.id === ((toolCallId ?? toolName) as string))
                  if (existing) return m
                  const id = (toolCallId ?? toolName ?? String(Date.now())) as string
                  return { ...m, phase: "tool_running" as const, isStreaming: true, toolCalls: [...(m.toolCalls ?? []), { id, toolName: (toolName as string) ?? "tool", input: toolInput as string|Record<string,unknown>, status: "running" as const }] }
                })
              } else {
                // Tool done — check if all tools complete → move to "analyzing" phase
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  const updatedTools = (m.toolCalls ?? []).map((tc) =>
                    tc.id === ((toolCallId ?? toolName) as string)
                      ? { ...tc, result: toolResult as string|Record<string,unknown>, status: (status as "done"|"error") ?? "done" }
                      : tc
                  )
                  const stillRunning = updatedTools.some(tc => tc.status === "running")
                  return {
                    ...m,
                    phase: stillRunning ? "tool_running" as const : "analyzing" as const,
                    isStreaming: true,
                    toolCalls: updatedTools,
                  }
                })
              }
            }
          } else if (msg.type === "chat:done") {
            // Gateway signals the run is over. Delay clearing so JSONL polling
            // (2s interval) can deliver the final response first.
            const { sessionKey } = (msg.payload ?? {}) as Record<string, unknown>
            if (sessionKey) {
              const sk = sessionKey as string
              // If response already arrived (from streaming), clear immediately
              const lastAgent = [...(chatStore.messages[sk] ?? [])].reverse().find(m => m.role === "agent")
              if (lastAgent?.responseText) {
                // Response already here — finalize immediately
                chatStore.setAgentRunning(sk, false)
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  const toolCalls = (m.toolCalls ?? []).map(tc =>
                    tc.status === "running" ? { ...tc, status: "done" as const } : tc
                  )
                  return { ...m, phase: "done" as const, responseDone: true, isStreaming: false, toolCalls }
                })
              } else {
                // No response yet — keep "analyzing" phase while waiting for JSONL (2s poll)
                // Force-clear after 6s as safety fallback
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  return { ...m, phase: "analyzing" as const, isStreaming: true }
                })
                setTimeout(() => {
                  const store = useChatStore.getState()
                  if (store.agentRunning[sk]) {
                    store.setAgentRunning(sk, false)
                    store.updateLastAgentMessage(sk, (m) => {
                      if (m.role !== "agent") return m
                      const toolCalls = (m.toolCalls ?? []).map(tc =>
                        tc.status === "running" ? { ...tc, status: "done" as const } : tc
                      )
                      return { ...m, phase: "done" as const, responseDone: true, isStreaming: false, toolCalls }
                    })
                  }
                }, 6000)
              }
            }
          } else if (msg.type === "chat:sessions-changed") {
            // refresh list
            import("@/lib/chat-api").then(({ chatApi }) => {
              chatApi.getSessions().then((r) => { if (r.sessions) chatStore.setSessions(r.sessions) }).catch(() => {})
            })
          } else {
            // Unknown event type — might be a new watcher event, schedule a reload
            console.debug("[WS] Unhandled event type:", msg.type)
            scheduleReload()
          }
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
