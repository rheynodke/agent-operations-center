import { create } from "zustand"
import type { GatewayMessage, ChatSession } from "@/lib/chat-api"

export type AgentPhase = "thinking" | "tool_running" | "analyzing" | "responding" | "done"

export interface ChatMessageGroup {
  id: string
  role: "user" | "agent"
  agentId?: string
  // For user messages
  userText?: string
  // For agent messages — each phase is separate
  thinkingText?: string      // thinking/reasoning content
  thinkingDone?: boolean     // true when thinking phase is complete
  toolCalls?: ChatToolCall[] // tool call sequence
  responseText?: string      // final response text (streaming)
  responseDone?: boolean     // final response complete
  isStreaming?: boolean
  phase?: AgentPhase         // explicit state machine phase for UX indicators
  timestamp?: number
}

export interface ChatToolCall {
  id: string
  toolName: string
  input?: string | Record<string, unknown>
  result?: string | Record<string, unknown>
  status: "running" | "done" | "error"
}

interface ChatState {
  // Gateway connection
  gatewayConnected: boolean
  setGatewayConnected: (v: boolean) => void

  // Sessions
  sessions: ChatSession[]
  setSessions: (sessions: ChatSession[]) => void
  activeSessionKey: string | null
  setActiveSessionKey: (key: string | null) => void

  // Messages per session
  messages: Record<string, ChatMessageGroup[]>
  setMessages: (sessionKey: string, msgs: ChatMessageGroup[]) => void
  appendMessage: (sessionKey: string, msg: ChatMessageGroup) => void
  updateLastAgentMessage: (sessionKey: string, updater: (msg: ChatMessageGroup) => ChatMessageGroup) => void

  // Agent running state
  agentRunning: Record<string, boolean>
  setAgentRunning: (sessionKey: string, running: boolean) => void

  // Selected agent for new chat
  selectedAgentId: string | null
  setSelectedAgentId: (id: string | null) => void
}

export const useChatStore = create<ChatState>((set) => ({
  gatewayConnected: false,
  setGatewayConnected: (v) => set({ gatewayConnected: v }),

  sessions: [],
  setSessions: (sessions) => set({ sessions }),
  activeSessionKey: null,
  setActiveSessionKey: (key) => set({ activeSessionKey: key }),

  messages: {},
  setMessages: (sessionKey, msgs) =>
    set((s) => ({ messages: { ...s.messages, [sessionKey]: msgs } })),
  appendMessage: (sessionKey, msg) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [sessionKey]: [...(s.messages[sessionKey] ?? []), msg],
      },
    })),
  updateLastAgentMessage: (sessionKey, updater) =>
    set((s) => {
      const msgs = s.messages[sessionKey] ?? []
      // Find last agent message
      const idx = [...msgs].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === "agent")?.i
      if (idx === undefined) return {}
      const updated = msgs.slice()
      updated[idx] = updater(updated[idx])
      return { messages: { ...s.messages, [sessionKey]: updated } }
    }),

  agentRunning: {},
  setAgentRunning: (sessionKey, running) =>
    set((s) => ({ agentRunning: { ...s.agentRunning, [sessionKey]: running } })),

  selectedAgentId: null,
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
}))

/** Strip text-encoded tool call markers from a string (used by models that encode tool calls inline) */
function stripToolCallMarkers(text: string): string {
  if (!text || !text.includes('<|tool_calls_section_begin|>')) return text
  return text.replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, '').trim()
}

/** Extract plain text from gateway content (can be string, {type,text} object, or array of blocks) */
function extractText(content: unknown): string {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map(extractText).join("")
  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>
    // Only extract from text-type content blocks; skip thinking, toolCall, tool_use, tool_result
    if (obj.type && obj.type !== "text") return ""
    if (typeof obj.text === "string") return obj.text
    if (typeof obj.content === "string") return obj.content
  }
  return ""
}

/** Extract thinking text from content blocks */
function extractThinking(content: unknown): string {
  if (content == null) return ""
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (typeof block === "object" && block !== null) {
          const obj = block as Record<string, unknown>
          if (obj.type === "thinking") return (obj.thinking as string) || (obj.text as string) || ""
        }
        return ""
      })
      .filter(Boolean)
      .join("")
  }
  return ""
}

/** Extract tool calls from content blocks */
function extractToolCalls(content: unknown): Array<{ name: string; input: string | Record<string, unknown>; id: string }> {
  if (!Array.isArray(content)) return []
  const tools: Array<{ name: string; input: string | Record<string, unknown>; id: string }> = []
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue
    const obj = block as Record<string, unknown>
    if (obj.type === "toolCall" || obj.type === "tool_use" || obj.type === "tool_call") {
      tools.push({
        name: ((obj.name as string) || "unknown").replace(/^functions\./, ""),
        input: (obj.arguments ?? obj.input ?? {}) as string | Record<string, unknown>,
        id: (obj.id as string) || String(Date.now()),
      })
    }
  }
  return tools
}

/** Convert gateway GatewayMessage[] → ChatMessageGroup[] */
export function gatewayMessagesToGroups(msgs: GatewayMessage[]): ChatMessageGroup[] {
  const groups: ChatMessageGroup[] = []
  let agentGroup: ChatMessageGroup | null = null

  const flushAgent = () => {
    if (agentGroup) {
      groups.push({ ...agentGroup, responseDone: true, thinkingDone: true })
      agentGroup = null
    }
  }

  for (const msg of msgs) {
    const role = msg.role
    if (role === "user") {
      flushAgent()
      groups.push({
        id: msg.id ?? `user-${msg.timestamp ?? Date.now()}`,
        role: "user",
        userText: extractText(msg.content || msg.text),
        timestamp: msg.timestamp,
      })
    } else if (role === "assistant") {
      const text = stripToolCallMarkers(extractText(msg.content || msg.text))
      const thinking = msg.thinking || extractThinking(msg.content)
      const contentTools = extractToolCalls(msg.content)
      const hasThinking = !!thinking || !!msg.isThinking
      // Skip assistant messages that were only tool call markers (nothing left after stripping)
      if (!text && !hasThinking && contentTools.length === 0) continue
      if (!agentGroup) {
        agentGroup = {
          id: `agent-${msg.timestamp ?? Date.now()}`,
          role: "agent",
          thinkingText: thinking || undefined,
          thinkingDone: !msg.isThinking,
          toolCalls: contentTools.map(tc => ({
            id: tc.id, toolName: tc.name, input: tc.input, status: "done" as const,
          })),
          responseText: text || undefined,
          responseDone: false,
          timestamp: msg.timestamp,
        }
      } else {
        // Thinking and response text are independent — a message can have both
        if (thinking) {
          agentGroup.thinkingText = (agentGroup.thinkingText ?? "") + thinking
        }
        if (text) {
          agentGroup.responseText = (agentGroup.responseText ?? "") + text
        }
        for (const tc of contentTools) {
          agentGroup.toolCalls = [...(agentGroup.toolCalls ?? []), {
            id: tc.id, toolName: tc.name, input: tc.input, status: "done" as const,
          }]
        }
      }
    } else if (role === "tool") {
      if (!agentGroup) {
        agentGroup = {
          id: `agent-${msg.timestamp ?? Date.now()}`,
          role: "agent",
          toolCalls: [],
          responseDone: false,
          timestamp: msg.timestamp,
        }
      }
      const existing = agentGroup.toolCalls!.find((tc) => tc.id === (msg.id ?? msg.toolName))
      if (existing) {
        existing.result = msg.toolResult
        existing.status = "done"
      } else {
        agentGroup.toolCalls!.push({
          id: msg.id ?? msg.toolName ?? String(Date.now()),
          toolName: msg.toolName ?? "unknown",
          input: msg.toolInput,
          result: msg.toolResult,
          status: msg.toolResult !== undefined ? "done" : "running",
        })
      }
    }
  }
  flushAgent()
  return groups
}
