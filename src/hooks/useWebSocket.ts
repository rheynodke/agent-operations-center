import { useEffect, useRef, useCallback } from "react"
import { useAuthStore, useWsStore, useActivityStore, useLiveFeedStore, useAgentStore, useSessionStore, useTaskStore, useCronStore, useSessionLiveStore, useGatewayLogStore, useConnectionsStore, useProcessingStore, useRoomStore, useOpenWorldStore } from "@/stores"
import { useChatStore, parseMediaAttachments, mediaPathToUrl, stripGatewayEnvelopes, stripUserMetadataEnvelope, isSystemInjectedUserMessage } from "@/stores/useChatStore"
import { useProjectStore } from '@/stores/useProjectStore'
import { useViewAsStore } from '@/stores/useViewAsStore'
import { api } from "@/lib/api"
import { queryClient, queryKeys } from "@/lib/queryClient"
import type { WsMessage, LiveFeedEntry } from "@/types"

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

      // Filter events by ownerUserId so users only see their own events.
      // Events without ownerUserId are treated as unscoped (allowed through).
      const ownerUid = (msg as unknown as { ownerUserId?: number }).ownerUserId
      if (ownerUid != null) {
        const me = useAuthStore.getState().user
        const myId = me?.id
        const myRole = me?.role
        // Use viewingAsUserId from view-as store for admin impersonation scoping.
        const effective = useViewAsStore.getState().viewingAsUserId ?? myId ?? null
        const eventOwner = Number(ownerUid)

        if (myRole === 'admin') {
          // Admin: show events for the effective scope
          if (effective != null && eventOwner !== effective) return
        } else {
          // Non-admin: only own events
          if (eventOwner !== myId) return
        }
      }

      switch (msg.type) {
        case "init": {
          // Initial snapshot from server on connect — use mergeAgents to preserve DB fields
          const payload = msg.payload as { agents?: unknown[]; sessions?: unknown[] }
          if (Array.isArray(payload?.agents)) useAgentStore.getState().mergeAgents(payload.agents as never)
          if (Array.isArray(payload?.sessions)) useSessionStore.getState().setSessions(payload.sessions as never)
          break
        }

        case "skills:updated": {
          window.dispatchEvent(new CustomEvent("aoc:skills-updated"))
          break
        }

        case "agents:updated": {
          const agents = (msg.payload as { agents?: unknown[] })?.agents
          if (Array.isArray(agents)) useAgentStore.getState().mergeAgents(agents as never)
          // Invalidate React Query caches so any useQuery-driven view re-fetches
          // with fresh data on the next render.
          queryClient.invalidateQueries({ queryKey: ["agents"] })
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
          const raw = msg as unknown as { sessionId?: string; sessionKey?: string; agent?: string; event?: Record<string, unknown> }
          if (raw.sessionId && raw.event) {
            useSessionLiveStore.getState().push(raw.sessionId, raw.event)
          }
          // Also update the live chat store for sessions we have messages for.
          // Watcher's claude-cli → gateway-sessionKey linkage is heuristic
          // (mtime-based). If it falls back to a synthetic key (e.g.
          // `agent:<id>:claude-cli:<uuid>`), the event would be routed to a
          // bucket the UI never created → tools/thinking silently dropped.
          // Fallback: when the event's sessionKey has no bucket but there IS
          // exactly one currently-running chat session for this agent, route
          // the event there.
          const chatStore = useChatStore.getState()
          let sessionKey = raw.sessionKey
          if (sessionKey && !chatStore.messages[sessionKey]?.length) {
            const runningKeys = Object.entries(chatStore.agentRunning)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .filter((k) => (chatStore.messages[k]?.length ?? 0) > 0)
              // If an agent id came with the event, prefer sessions for that agent.
              .filter((k) => !raw.agent || k.includes(`:${raw.agent}:`))
            if (runningKeys.length === 1) {
              sessionKey = runningKeys[0]
            }
          }
          if (sessionKey && chatStore.messages[sessionKey]?.length) {
            const evt = raw.event as { role?: string; text?: string; thinking?: string; thinkingRedacted?: boolean; stopReason?: string; tools?: Array<{name: string; output?: string; input?: string; toolCallId?: string|null}> } | undefined
            if (evt) {
              // Assistant tool_use blocks — surface as "running" tool calls the moment
              // the JSONL entry is polled (~2s after claude-cli writes it). Previously
              // ignored, which made the UI silent during claude-cli tool phases.
              if (evt.role === 'assistant' && evt.tools?.length) {
                chatStore.setAgentRunning(sessionKey, true)
                chatStore.updateLastAgentMessage(sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  const existing = m.toolCalls ?? []
                  const toAdd = evt.tools!
                    .filter((t) => {
                      const id = t.toolCallId || t.name
                      return !existing.some(ex => (ex.id === id) || (!ex.result && ex.toolName === t.name && ex.input === t.input))
                    })
                    .map((t) => ({
                      id: (t.toolCallId || `${t.name}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`) as string,
                      toolName: t.name,
                      input: t.input as string | Record<string, unknown> | undefined,
                      status: 'running' as const,
                    }))
                  if (!toAdd.length) return m
                  return { ...m, phase: 'tool_running' as const, toolCalls: [...existing, ...toAdd] }
                })
              }

              if (evt.role === 'assistant' && evt.text) {
                // JSONL assistant text entries can be INTERMEDIATE (a narration
                // segment between tool calls, e.g. "OK let me check X next…")
                // or TRULY final (the last text before the run ends). We cannot
                // tell which without waiting for `processing_end`, so we take
                // the safe route: always overwrite responseText with the latest
                // segment, but KEEP the running indicator alive. The authoritative
                // end-of-run signal is `session:update action=processing_end`,
                // which flips phase=done / isStreaming=false.
                //
                // Before: we marked each intermediate text as final → indicator
                // disappeared between tool calls, then the next tool start spun
                // up a new bubble → bubble fragmentation + flickering pill.
                chatStore.updateLastAgentMessage(sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  const hasRunningTool = (m.toolCalls ?? []).some(tc => tc.status === 'running')
                  return {
                    ...m,
                    // Keep tool_running phase if a tool hasn't completed yet,
                    // otherwise surface "responding" so the "Composing…" pill
                    // shows while we wait for the next step.
                    phase: hasRunningTool ? ("tool_running" as const) : ("responding" as const),
                    responseText: evt.text!,
                    responseDone: false,
                    isStreaming: true,
                  }
                })
                chatStore.setAgentRunning(sessionKey, true)
              }

              if (evt.role === 'assistant' && (evt.thinking || evt.thinkingRedacted)) {
                // Claude-cli runs may include multiple assistant turns within a
                // single run (thinking → tool → thinking → tool → text). ACCUMULATE
                // thinking across turns the same way `gatewayMessagesToGroups()`
                // does on history reload, so the user sees the full reasoning
                // trace, not just the last block.
                //
                // Anthropic redacts thinking for certain models (sonnet / rate-
                // limited fallbacks) — in that case `evt.thinking` is empty and
                // `evt.thinkingRedacted=true` so we surface a subtle indicator.
                chatStore.updateLastAgentMessage(sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  const incoming = (evt.thinking ?? '').trim()
                  if (incoming) {
                    const prev = m.thinkingText ?? ''
                    // Avoid double-appending the same segment if this JSONL
                    // entry was replayed (watcher re-reads on catch-up).
                    const already = prev.includes(incoming)
                    const merged = already ? prev : (prev ? `${prev}\n\n${incoming}` : incoming)
                    return {
                      ...m,
                      thinkingText: merged,
                      // Keep streaming while the run is active — authoritative
                      // "done" signal comes from processing_end.
                      thinkingDone: !!m.responseDone,
                      // Clear any earlier "redacted" flag — we now have real text.
                      thinkingRedacted: false,
                    }
                  }
                  if (evt.thinkingRedacted && !m.thinkingText) {
                    return { ...m, thinkingRedacted: true }
                  }
                  return m
                })
              }

              // Tool results from JSONL — mark matching running tool as done.
              // Match by toolCallId first (reliable), fall back to name+status.
              if (evt.role === 'toolResult' && evt.tools?.length) {
                for (const tool of evt.tools) {
                  if (tool.output) {
                    chatStore.updateLastAgentMessage(sessionKey, (m) => {
                      if (m.role !== 'agent') return m
                      const matchId = tool.toolCallId
                      return {
                        ...m,
                        toolCalls: (m.toolCalls ?? []).map(tc => {
                          const hit = matchId
                            ? tc.id === matchId
                            : tc.toolName === tool.name && tc.status === 'running'
                          return hit ? { ...tc, result: tool.output!, status: 'done' as const } : tc
                        }),
                      }
                    })
                  }
                }
              }
            }
          }

          // Push parsed JSONL events into the Live Feed tab
          {
            type ParsedEvt = {
              role?: string
              text?: string
              thinking?: string
              tools?: Array<{ name: string; input?: string; output?: string }>
              model?: string
              cost?: number
              tokens?: { total?: number }
              timestamp?: string
            }
            const liveRaw = msg as unknown as { agent?: string; event?: ParsedEvt }
            const agentId = liveRaw.agent ?? ''
            const agentInfo = useAgentStore.getState().agents.find(a => a.id === agentId)
            const agentName = agentInfo?.name ?? agentId
            const agentEmoji = agentInfo?.emoji ?? '🤖'
            const e = liveRaw.event ?? {}
            const feedTs = e.timestamp ?? new Date().toISOString()
            const model = e.model
            const cost = e.cost
            const tokens = e.tokens?.total

            const pushFeed = (type: LiveFeedEntry['type'], content: string) => {
              useLiveFeedStore.getState().addEntry({
                id: `lf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: feedTs,
                agentId,
                agentName,
                agentEmoji,
                type,
                content,
                model,
                cost,
                tokens,
              })
            }

            if (e.role === 'toolResult' && e.tools?.length) {
              const t = e.tools[0]
              pushFeed('tool_result', `${t.name}: ${String(t.output ?? '').slice(0, 200)}`)
            } else {
              if (e.thinking) pushFeed('system', e.thinking.slice(0, 200))
              if (e.tools?.length) {
                for (const t of e.tools) {
                  pushFeed('tool_call', `${t.name}${t.input ? ` ${String(t.input).slice(0, 100)}` : ''}`)
                }
              }
              if (e.text) pushFeed('message', e.text.slice(0, 300))
            }
          }

          // Also schedule a reload so the session list stays in sync
          scheduleReload()
          break
        }

        // These are the events the watcher broadcasts when session files change
        case "session:update": {
          // processing_start / processing_end drive the live "active" flags on
          // Overview, Agent Detail, and Mission Room TypingIndicator.
          // Key strategy:
          //   - sessionKey (when set) is the authoritative key — format is
          //     `agent:<id>:room:<roomId>` for room sessions, which is exactly
          //     what isAgentProcessingInScope looks for.
          //   - file key is the fallback for unlinked claude-cli sessions.
          //   - We register BOTH so nothing is lost.
          const su = msg as unknown as { action?: string; sessionKey?: string; agent?: string; file?: string }
          const procStore = useProcessingStore.getState()
          if (su.action === 'processing_start') {
            // Register sessionKey first (scope-aware room/task check depends on it)
            if (su.sessionKey) procStore.start(su.sessionKey, su.agent)
            // Also register file key as fallback (may differ from sessionKey)
            if (su.file && su.file !== su.sessionKey) procStore.start(su.file, su.agent)
          } else if (su.action === 'processing_end') {
            if (su.sessionKey) procStore.stop(su.sessionKey)
            if (su.file && su.file !== su.sessionKey) procStore.stop(su.file)
          }
          if (su.action === 'processing_end' && su.sessionKey) {
            // processing_end is the AUTHORITATIVE end-of-run signal. Finalize
            // regardless of whether `agentRunning` is still true — intermediate
            // session:live-event text entries no longer flip this (we keep the
            // indicator alive between tool calls), so processing_end is the
            // only place that truly flips phase=done / responseDone=true.
            const chatStore = useChatStore.getState()
            const msgs = chatStore.messages[su.sessionKey] ?? []
            const lastAgent = [...msgs].reverse().find(m => m.role === 'agent')
            if (lastAgent && !lastAgent.responseDone) {
              if (lastAgent.responseText) {
                // Response text already captured → finalize immediately.
                chatStore.setAgentRunning(su.sessionKey, false)
                chatStore.updateLastAgentMessage(su.sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  const toolCalls = (m.toolCalls ?? []).map(tc =>
                    tc.status === 'running' ? { ...tc, status: 'done' as const } : tc
                  )
                  return { ...m, phase: 'done' as const, isStreaming: false, responseDone: true, toolCalls }
                })
              } else {
                // Lock file gone but JSONL final response not yet polled (~2s lag).
                // IMPORTANT: only set phase='analyzing' (which shows "Composing final
                // answer" pill) when NO tools are currently running. Between sub-runs,
                // processing_end fires even when more tool rounds are coming — guard
                // against that by keeping the current phase if tools are still active.
                chatStore.updateLastAgentMessage(su.sessionKey, (m) => {
                  if (m.role !== 'agent') return m
                  // Check BEFORE remapping so we see actual current running state.
                  const stillHasRunning = (m.toolCalls ?? []).some(tc => tc.status === 'running')
                  const toolCalls = (m.toolCalls ?? []).map(tc =>
                    tc.status === 'running' ? { ...tc, status: 'done' as const } : tc
                  )
                  // If tools were running, this is a between-rounds processing_end —
                  // keep current phase rather than jumping to 'analyzing'.
                  const nextPhase = stillHasRunning ? (m.phase ?? 'analyzing') : ('analyzing' as const)
                  return { ...m, phase: nextPhase, isStreaming: true, toolCalls }
                })
                setTimeout(() => {
                  const store = useChatStore.getState()
                  const cur = (store.messages[su.sessionKey!] ?? []).slice(-1)[0]
                  if (cur?.role === 'agent' && !cur.responseDone) {
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
          // Dev progress changed — reload tasks for active project only
          const projId = useProjectStore.getState().activeProjectId
          api.getTasks(projId ? { projectId: projId } : {}).then((data) => {
            const tasks = (data as { tasks: never[] })?.tasks
            if (Array.isArray(tasks)) useTaskStore.getState().setTasks(tasks)
          }).catch(() => {})
          break
        }

        case "project:sync_start": {
          const { integrationId } = msg.payload as { integrationId: string }
          useProjectStore.getState().setSyncing(integrationId, true)
          break
        }
        case "project:sync_complete": {
          const { integrationId, projectId } = msg.payload as { integrationId: string; projectId: string }
          useProjectStore.getState().setSyncing(integrationId, false)
          useProjectStore.getState().fetchIntegrations(projectId)
          queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
          break
        }
        case "project:sync_error": {
          const { integrationId, projectId } = msg.payload as { integrationId: string; projectId: string }
          useProjectStore.getState().setSyncing(integrationId, false)
          useProjectStore.getState().fetchIntegrations(projectId)
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
          // Server broadcasts all tasks — filter to active project before setting store
          const allTasks = Array.isArray(msg.payload)
            ? msg.payload
            : (msg.payload as { tasks?: unknown[] })?.tasks
          if (Array.isArray(allTasks)) {
            const activePid = useProjectStore.getState().activeProjectId
            const filtered = activePid
              ? allTasks.filter((t: { projectId?: string }) => t.projectId === activePid)
              : allTasks
            useTaskStore.getState().setTasks(filtered as never)
          }
          break
        }

        case "task:comment_added":
        case "task:comment_edited":
        case "task:comment_deleted": {
          window.dispatchEvent(new CustomEvent('aoc:task-comment', {
            detail: { type: msg.type, ...(msg.payload as Record<string, unknown>) },
          }))
          break
        }

        case "task:output_added":
        case "task:output_removed": {
          // Lightweight notification for OutputsSection — re-fetch on the client side.
          // Payload: { agentId, taskId, filename, size?, mtime? }
          window.dispatchEvent(new CustomEvent('aoc:task-output', {
            detail: { type: msg.type, ...(msg.payload as Record<string, unknown>) },
          }))
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

        case "connection:auth_completed":
        case "connection:auth_expired": {
          // Google Workspace (or any connection) auth state changed on the server.
          // Refresh the connections list so UI picks up new authState + linkedEmail.
          // Payload shape: { connectionId }
          useConnectionsStore.getState().refresh().catch(() => {})
          queryClient.invalidateQueries({ queryKey: queryKeys.connections() })
          break
        }

        case "room:message": {
          const payload = msg.payload as { roomId?: string; message?: import("@/types").MissionMessage }
          if (payload?.roomId && payload.message) {
            useRoomStore.getState().appendMessage(payload.roomId, payload.message)
            // When an agent message arrives, clear their processing indicator
            // for this room — they've finished responding.
            if (payload.message.authorType === 'agent' && payload.message.authorId) {
              const procKey = `agent:${payload.message.authorId}:room:${payload.roomId}`
              useProcessingStore.getState().stop(procKey)
            }
          }
          break
        }

        case "room:created": {
          const room = (msg.payload as { room?: import("@/types").MissionRoom })?.room
          if (room) useRoomStore.getState().upsertRoom(room)
          queryClient.invalidateQueries({ queryKey: queryKeys.rooms() })
          break
        }

        case "announcement:new":
        case "announcement:dismissed":
        case "announcement:deactivated": {
          // Banner subscribes to this query key; admin page also lists all.
          // A single broadcast triggers both refreshes — cheap (count is small).
          queryClient.invalidateQueries({ queryKey: queryKeys.announcementsActive() })
          queryClient.invalidateQueries({ queryKey: queryKeys.announcementsAll() })
          break
        }

        case "room:stop": {
          const payload = msg.payload as { roomId?: string }
          if (payload?.roomId) {
             const procStore = useProcessingStore.getState()
             Object.keys(procStore.sessions).forEach(k => {
                if (k.includes(`:room:${payload.roomId}`)) procStore.stop(k)
             })
             const chatStore = useChatStore.getState()
             Object.keys(chatStore.agentRunning).forEach(k => {
                if (k.includes(`:room:${payload.roomId}`)) chatStore.setAgentRunning(k, false)
             })
          }
          break
        }

        case "open-world:changed": {
          // A master agent was provisioned or deleted somewhere — bump the
          // store so AgentWorldView refetches the Open World roster live.
          useOpenWorldStore.getState().bump()
          break
        }

        default: {
          // ── Gateway & Chat events (forwarded from gateway-ws.cjs) ──────────
          const chatStore = useChatStore.getState()
          if (msg.type === "gateway:connected") {
            chatStore.setGatewayConnected(true)
          } else if (msg.type === "gateway:disconnected") {
            chatStore.setGatewayConnected(false)
          } else if (msg.type === "chat:progress") {
            // Lightweight heartbeat — gateway is emitting delta chunks but we
            // intentionally DO NOT render them (see gateway-ws.cjs chat/delta).
            // Just keep the agent-running flag alive so the phase indicator
            // doesn't flicker off during long stretches without user-visible
            // output (e.g. tool execution).
            const { sessionKey } = (msg.payload ?? {}) as { sessionKey?: string }
            if (sessionKey) {
              chatStore.setAgentRunning(sessionKey, true)
              // Also update processingStore so TypingIndicator + RightRail
              // (which use isAgentProcessingInScope) light up for room sessions.
              // sessionKey from gateway is already in `agent:<id>:room:<roomId>`
              // format for room-triggered sessions — exactly what the scope
              // check prefix-matches against.
              const agentId = sessionKey.match(/^agent:([^:]+):/)?.[1]
              useProcessingStore.getState().start(sessionKey, agentId)
            }
            break
          } else if (msg.type === "chat:message") {
            const { sessionKey, role, text, thinking, done, toolName, toolInput, toolResult, toolCallId, replace } = (msg.payload ?? {}) as Record<string, unknown>
            if (sessionKey) {
              const sk = sessionKey as string
              const isThinking = role === "thinking" || !!thinking

              // Ensure an agent placeholder exists so updateLastAgentMessage has something to mutate.
              // Look at the last few messages (not just lastMsg) because a user-echo or
              // system message may have pushed the placeholder down by 1–2 positions.
              const currentMsgs = chatStore.messages[sk] ?? []
              const lastMsg = currentMsgs[currentMsgs.length - 1]
              // Our UI paradigm strictly groups all sequential agent responses into a single bubble
              // per turn (mirroring `gatewayMessagesToGroups` behavior). 
              // If the very last message in the UI is an agent message, we ALWAYS merge this incoming 
              // assistant text into it, preventing 'double bubbles' during multi-step internal loops.
              const recentMsgs = currentMsgs.slice(-4)
              const hasAgentPlaceholder = recentMsgs.some(m => m.role === "agent" && m.isStreaming)

              if (lastMsg?.role === "agent" && !isThinking) {
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  
                  const prevText = stripGatewayEnvelopes(m.responseText ?? "").trim()
                  const newText = stripGatewayEnvelopes((text as string) ?? "").trim()
                  
                  // If gateway says replace=true (e.g. state=final delta sync), or if the new text
                  // is longer (cumulative), use it. Otherwise, fallback to the existing text.
                  const merged = shouldReplace || newText.length > prevText.length ? newText : prevText
                  
                  return { ...m, responseText: merged, responseDone: !!done, isStreaming: !done, phase: done ? "done" : m.phase }
                })
                if (done) chatStore.setAgentRunning(sk, false)
                break
              }

              if (!hasAgentPlaceholder && (role === "assistant" || role === "thinking" || isThinking)) {
                chatStore.setAgentRunning(sk, true)
                // Update processingStore for room sessions so TypingIndicator lights up
                const agentId = sk.match(/^agent:([^:]+):/)?.[1]
                useProcessingStore.getState().start(sk, agentId)
                chatStore.appendMessage(sk, {
                  id: `agent-ws-${Date.now()}`,
                  role: "agent",
                  toolCalls: [],
                  isStreaming: true,
                  responseDone: false,
                  phase: isThinking ? "thinking" : "responding",
                  timestamp: Date.now(),
                })
              }

              // User message from external channel (e.g. Telegram) — may contain media.
              // Also echoed by the gateway for dashboard-sent messages: suppress those
              // using the pending-sent set populated by handleSend() in ChatPage.
              if (role === "user" && text) {
                const rawText = text as string
                // Skip system-injected user messages (skill invocation context).
                if (isSystemInjectedUserMessage(rawText)) {
                  // no-op — these belong to the LLM prompt, not the UI
                } else {
                  // Gateway wraps user messages with metadata envelopes (e.g.
                  // "Sender (untrusted metadata): ```json...```"). Strip those
                  // BEFORE media extraction + dedup so the cleaned caption
                  // matches what handleSend() stored via markSent().
                  const strippedText = stripUserMetadataEnvelope(rawText)
                  const { paths, caption } = parseMediaAttachments(strippedText)
                  if (caption || paths.length > 0) {
                    // Primary guard: suppress WS echo of messages we sent from this dashboard
                    // session. hasPendingSent is keyed by sessionKey+text, so it can't false-
                    // positive on messages from other sessions or external channels.
                    const isPendingEcho = caption ? chatStore.hasPendingSent(sk, caption) : false
                    if (isPendingEcho) {
                      // We already rendered this message optimistically — discard the echo.
                      // Clear the pending flag so future identical messages aren't blocked.
                      chatStore.clearSent(sk, caption)
                    } else {
                      // Fallback dedup: always use a fresh getState() snapshot (not the
                      // cached `chatStore`) so we can't miss optimistically-added messages
                      // due to snapshot staleness. Also check a 10-second time window to
                      // catch late echoes that arrive after markSent has been cleared.
                      const freshMsgs = useChatStore.getState().messages[sk] ?? []
                      const nowTs = Date.now()
                      const alreadyHas = freshMsgs
                        .filter(m => m.role === "user" && (nowTs - (m.timestamp ?? 0)) < 10_000)
                        .some(m => {
                          if (!m.userText) return false
                          const { caption: normExisting } = parseMediaAttachments(stripUserMetadataEnvelope(m.userText))
                          return normExisting === caption
                        })
                      if (!alreadyHas) {
                        chatStore.appendMessage(sk, {
                          id: `user-ws-${Date.now()}`,
                          role: "user",
                          userText: caption,
                          userImages: paths.length > 0 ? paths.map(mediaPathToUrl) : undefined,
                          timestamp: Date.now(),
                        })
                      }
                    }
                  }
                }
              }

              if (role === "assistant" || role === "thinking") {
                chatStore.setAgentRunning(sk, true)
                const hasText = !!(text as string)?.trim()
                // NEW STREAMING POLICY: we no longer render chunk-by-chunk.
                // The gateway proxy now only emits `chat:message` when the
                // assistant text is COMPLETE (state=final / session.message
                // snapshot) and sets `replace: true`. Anything else we treat
                // as a full-snapshot replace as well — never append — so the
                // UI shows either "working…" OR the complete final answer.
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  if (isThinking) {
                    const next = (thinking ?? text ?? "") as string
                    return { ...m, phase: "thinking" as const, thinkingText: next || m.thinkingText, thinkingDone: !!done, isStreaming: true }
                  }
                  const newText = (text as string | undefined) ?? ""
                  if (!newText) return m
                  const shouldReplace = !!replace || !m.responseText
                  const finalText = shouldReplace
                    ? newText
                    : (newText.length >= (m.responseText ?? "").length ? newText : (m.responseText ?? ""))
                  const reallyDone = !!done
                  return {
                    ...m,
                    phase: reallyDone ? "done" as const : "responding" as const,
                    responseText: finalText,
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
                // Update processingStore so TypingIndicator + RightRail light up
                const agentId = sk.match(/^agent:([^:]+):/)?.[1]
                useProcessingStore.getState().start(sk, agentId)
                // Ensure placeholder exists for tool events too
                const curMsgs = chatStore.messages[sk] ?? []
                const recentMsgs = curMsgs.slice(-4)
                const hasAgentPlaceholder = recentMsgs.some(m => m.role === "agent" && m.isStreaming)
                if (!hasAgentPlaceholder) {
                  chatStore.appendMessage(sk, {
                    id: `agent-ws-tool-${Date.now()}`,
                    role: "agent",
                    toolCalls: [],
                    isStreaming: true,
                    responseDone: false,
                    phase: "tool_running",
                    timestamp: Date.now(),
                  })
                }
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
              // Force clear processing flag to prevent 'Thinking...' from getting stuck
              useProcessingStore.getState().stop(sk)
              
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
                // Force-clear after 6s as safety fallback.
                // Guard: only switch to 'analyzing' if no tools are currently running.
                // chat:done can fire between sub-runs — don't show composing pill mid-run.
                chatStore.updateLastAgentMessage(sk, (m) => {
                  if (m.role !== "agent") return m
                  const hasRunning = (m.toolCalls ?? []).some(tc => tc.status === 'running')
                  if (hasRunning) return m  // between-rounds — keep current phase
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
          } else if (msg.type === "gateway:event") {
            const p = (msg.payload ?? {}) as { event?: string; data?: Record<string, unknown>; ts?: number }
            if (p.event) {
              useGatewayLogStore.getState().addEvent({
                id: `gevt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                ts: p.ts ?? Date.now(),
                event: p.event,
                data: p.data ?? {},
              })

              // Mirror meaningful session lifecycle events into the Live Feed
              const FEED_GATEWAY_EVENTS = new Set(['session.done', 'session.message', 'session.tool', 'session.error'])
              if (FEED_GATEWAY_EVENTS.has(p.event)) {
                const d = p.data ?? {}
                const agentId = (d.agentId ?? d.agent ?? '') as string
                const agentInfo = useAgentStore.getState().agents.find(a => a.id === agentId)
                const content = p.event === 'session.done'
                  ? `session finished${d.sessionId ? ` (${String(d.sessionId).slice(0, 8)})` : ''}`
                  : (d.text as string | undefined)?.slice(0, 200) ?? p.event
                const entryType: LiveFeedEntry['type'] = p.event === 'session.error' ? 'error' : 'system'
                useLiveFeedStore.getState().addEntry({
                  id: `lf-gw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  timestamp: new Date(p.ts ?? Date.now()).toISOString(),
                  agentId,
                  agentName: agentInfo?.name ?? agentId,
                  agentEmoji: agentInfo?.emoji ?? '🤖',
                  type: entryType,
                  content,
                })
              }
            }
          } else if (msg.type === "gateway:log") {
            const p = (msg.payload ?? {}) as { line?: string; ts?: number; direction?: "in" | "out" }
            if (p.line) {
              useGatewayLogStore.getState().addLog({
                id: `glog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                ts: p.ts ?? Date.now(),
                line: p.line,
                direction: p.direction ?? "in",
              })
            }
          } else if ((msg.type as string) === "onboarding:phase") {
            // Backend-driven progress for the onboarding wizard's step 6.
            // OwnerUserId filtering above already ensures we only see our own.
            const p = (msg.payload ?? {}) as { phase?: string; detail?: string; agentId?: string }
            if (p.phase) {
              import('@/stores/useOnboardingProgressStore').then(({ useOnboardingProgressStore }) => {
                useOnboardingProgressStore.getState().setPhase({
                  phase: p.phase as never,
                  detail: p.detail,
                  agentId: p.agentId,
                })
              })
            }
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
        // Clear live processing flags — any in-flight `processing_end` events
        // are now lost, so a stale "active" badge would be stuck until manual
        // refresh. On reconnect the next poll/events will repopulate.
        useProcessingStore.getState().reset()
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
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.onmessage = null
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close()
      }
      wsRef.current = null
    }
    setStatus("disconnected")
  }, [setStatus])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return { connect, disconnect }
}
