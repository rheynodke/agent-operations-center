import { create } from "zustand"
import type { GatewayMessage, ChatSession } from "@/lib/chat-api"

export type AgentPhase = "thinking" | "tool_running" | "analyzing" | "responding" | "done"

export interface ChatMessageGroup {
  id: string
  role: "user" | "agent"
  agentId?: string
  // For user messages
  userText?: string
  userImages?: string[]   // base64 data URLs or public URLs
  // For agent messages — each phase is separate
  thinkingText?: string      // thinking/reasoning content
  thinkingDone?: boolean     // true when thinking phase is complete
  thinkingRedacted?: boolean // true when provider stripped thinking content (e.g. Anthropic returns signature only)
  toolCalls?: ChatToolCall[] // tool call sequence
  responseText?: string      // final response text (streaming)
  agentImages?: string[]     // image URLs/data-urls from agent content blocks
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

  // Pending outbound messages — used to suppress WS echo of messages we
  // already rendered optimistically. Key = `${sessionKey}::${text}`.
  pendingSentMessages: Set<string>
  markSent: (sessionKey: string, text: string) => void
  clearSent: (sessionKey: string, text: string) => void
  hasPendingSent: (sessionKey: string, text: string) => boolean
}

export const useChatStore = create<ChatState>((set, get) => ({
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

  pendingSentMessages: new Set(),
  markSent: (sessionKey, text) => set((s) => {
    const key = `${sessionKey}::${text}`
    const next = new Set(s.pendingSentMessages)
    next.add(key)
    return { pendingSentMessages: next }
  }),
  clearSent: (sessionKey, text) => set((s) => {
    const key = `${sessionKey}::${text}`
    const next = new Set(s.pendingSentMessages)
    next.delete(key)
    return { pendingSentMessages: next }
  }),
  hasPendingSent: (sessionKey, text) => {
    const key = `${sessionKey}::${text}`
    return get().pendingSentMessages.has(key)
  },
}))

// Matches: [media attached: /path/file.jpg (image/jpeg) | /path/file.jpg]
const MEDIA_BLOCK_RE = /\[media attached:\s*([^\s(]+)\s*\([^)]+\)\s*\|[^\]]*\]/g
// The boilerplate instructions injected after each media block by the gateway
const MEDIA_BOILERPLATE_RE = /\s*To send an image back,.*?Keep caption in the text body\./gs
// Plain absolute path to a known openclaw media directory (used on session
// reload — gateway history doesn't always keep the `[media attached: ...]`
// wrapper; sometimes the raw path ends up as the user text).
// Built via `new RegExp` to sidestep a Rollup parser quirk that rejects
// `\]` inside a character class in literal regex form.
const PLAIN_IMAGE_PATH_RE = new RegExp(
  "(/(?:tmp|var/folders|Users/[^/\\s]+/\\.(?:openclaw|claude))/[^\\s\"')]+\\.(?:png|jpe?g|gif|webp|bmp))",
  "gi",
)

/** Parse media attachments from gateway-injected text markers OR plain paths.
 *  Returns the file paths and the cleaned caption text. */
export function parseMediaAttachments(text: string): { paths: string[]; caption: string } {
  const paths: string[] = []
  let cleaned = text.replace(MEDIA_BLOCK_RE, (_, filePath) => {
    paths.push(filePath)
    return ""
  })
  cleaned = cleaned.replace(MEDIA_BOILERPLATE_RE, "").trim()
  // Fallback: detect plain paths to openclaw-staged images (on reload the
  // media marker is often stripped, leaving just the path in user text).
  cleaned = cleaned.replace(PLAIN_IMAGE_PATH_RE, (match) => {
    paths.push(match)
    return ""
  })
  // Tidy up leftover whitespace / dangling punctuation from path removal.
  cleaned = cleaned.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim()
  return { paths, caption: cleaned }
}

/**
 * Strip gateway-injected metadata envelope from a user message. The gateway
 * prepends one or two "(untrusted metadata)" JSON-fenced blocks plus an
 * optional "[Day YYYY-MM-DD HH:MM TZ]" timestamp before the user's actual
 * text. These are context for the agent, never for display.
 *
 * Example input:
 *   Conversation info (untrusted metadata): ```json {...} ```
 *   Sender (untrusted metadata): ```json {...} ```
 *   [Mon 2026-04-20 19:56 GMT+7] context.ai itu apa bro
 */
export function stripUserMetadataEnvelope(text: string): string {
  if (!text) return text
  let out = text
  // Remove any "<Label> (untrusted metadata): ```json … ```" blocks (labels
  // observed: "Conversation info", "Sender"). Non-greedy across newlines.
  out = out.replace(/(?:^|\n)\s*[A-Za-z][\w\s]*\(untrusted metadata\):\s*```json[\s\S]*?```/g, "")
  // Remove leading "[Day YYYY-MM-DD HH:MM TZ+N]" timestamp that the gateway
  // injects right before the user text.
  out = out.replace(/^\s*\[[A-Za-z]{3,}\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s+[A-Z]{2,5}[+-]?\d*\]\s*/, "")
  return out.replace(/^\s+/, "").replace(/\s+$/, "")
}

/**
 * Detect whether a user-role message is actually a system-injected skill
 * invocation context (SKILL.md content + "Base directory for this skill: …"
 * prefix that the gateway/LLM framework feeds to the agent on skill use).
 * These are not things the user typed — they should never render in the UI.
 */
export function isSystemInjectedUserMessage(text: string): boolean {
  if (!text) return false
  const t = text.trimStart()
  // Common markers observed in chat history:
  return (
    /^Base directory for this skill:\s*/.test(t) ||
    /^#\s*\S+\s+A specialized companion/m.test(t) ||  // SKILL.md header-ish
    /^<\s*skill[:\s=]/.test(t) ||                      // future <skill:...> envelopes
    /^\[skill-invocation\]/.test(t) ||
    /^\{"source":"skill"/.test(t)
  )
}

/** Convert a local openclaw file path to a dashboard /api/media URL */
export function mediaPathToUrl(filePath: string): string {
  return `/api/media?path=${encodeURIComponent(filePath)}`
}

/** Extract image URLs from assistant content blocks (type=image) */
function extractImageUrls(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const urls: string[] = []
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue
    const obj = block as Record<string, unknown>
    if (obj.type === "image") {
      const src = obj.source as Record<string, unknown> | undefined
      if (src?.type === "url" && typeof src.url === "string") urls.push(src.url)
      if (src?.type === "base64" && typeof src.media_type === "string" && typeof src.data === "string") {
        urls.push(`data:${src.media_type};base64,${src.data}`)
      }
      if (typeof obj.url === "string") urls.push(obj.url)
    }
  }
  return urls
}

/** Convert MEDIA:url or MEDIA:./path inline references in agent text to markdown images */
function convertMediaInlineToMarkdown(text: string): string {
  // MEDIA:https://... or MEDIA:./path or MEDIA:relative/path
  return text.replace(/MEDIA:([^\s"')\]]+)/g, (_, ref) => {
    const url = ref.startsWith('http') ? ref : `/api/media?path=${encodeURIComponent(ref)}`
    return `![image](${url})`
  })
}

/** Strip text-encoded tool call markers from a string (used by models that encode tool calls inline) */
function stripToolCallMarkers(text: string): string {
  if (!text || !text.includes('<|tool_calls_section_begin|>')) return text
  return text.replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, '').trim()
}

/**
 * Strip gateway-injected envelope markers that sometimes leak into assistant
 * text. These are directives meant for routing/context management, never for
 * the human reader — they showed up inline otherwise (e.g. at the start of a
 * message: "[chat.history omitted: message too large]✅ Sudah muncul, bro!").
 */
const GATEWAY_ENVELOPE_PATTERNS: RegExp[] = [
  /\[chat\.history omitted:[^\]]*\]/g,           // "[chat.history omitted: message too large]"
  /\[\[reply_to_current\]\]/g,                    // reply-targeting directive
  /\[\[reply_to:[^\]]*\]\]/g,                     // explicit reply target
  /\[\[silent\]\]/g,                              // silent-reply token
  /\[chat\.resume(?:d)?(?::\s*[^\]]+)?\]/g,       // history resume marker
]
export function stripGatewayEnvelopes(text: string): string {
  if (!text) return text
  let out = text
  for (const re of GATEWAY_ENVELOPE_PATTERNS) out = out.replace(re, "")
  // Collapse whitespace/newlines left behind by leading strips so the response
  // doesn't start with orphan blank lines.
  return out.replace(/^\s+/, "").replace(/[ \t]+\n/g, "\n")
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

/** Extract tool result text from a toolResult message's content field */
function extractToolResultText(content: unknown): string {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === "string") return c
      if (typeof c === "object" && c !== null) {
        const obj = c as Record<string, unknown>
        if (obj.type === "text" && typeof obj.text === "string") return obj.text
        if (typeof obj.content === "string") return obj.content
        return JSON.stringify(c, null, 2)
      }
      return ""
    }).filter(Boolean).join("\n")
  }
  if (typeof content === "object") return JSON.stringify(content, null, 2)
  return String(content)
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
      const rawText = stripUserMetadataEnvelope(extractText(msg.content || msg.text))
      // Skip system-injected "user" messages (skill invocation context
      // dumped by the LLM framework — not something the human typed).
      if (isSystemInjectedUserMessage(rawText)) continue
      const { paths, caption } = parseMediaAttachments(rawText)
      // If after stripping the only remaining content would be empty AND
      // there are no images either, skip the bubble entirely.
      if (!caption && paths.length === 0) continue
      groups.push({
        id: msg.id ?? `user-${msg.timestamp ?? Date.now()}`,
        role: "user",
        userText: caption,
        userImages: paths.length > 0 ? paths.map(mediaPathToUrl) : undefined,
        timestamp: msg.timestamp,
      })
    } else if (role === "assistant") {
      const rawText = stripToolCallMarkers(extractText(msg.content || msg.text))
      const text = convertMediaInlineToMarkdown(rawText)
      const thinking = msg.thinking || extractThinking(msg.content)
      const contentTools = extractToolCalls(msg.content)
      const inlineImages = extractImageUrls(msg.content)
      const hasThinking = !!thinking || !!msg.isThinking
      // Skip assistant messages that were only tool call markers (nothing left after stripping)
      if (!text && !hasThinking && contentTools.length === 0 && inlineImages.length === 0) continue
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
          agentImages: inlineImages.length > 0 ? inlineImages : undefined,
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
        if (inlineImages.length > 0) {
          agentGroup.agentImages = [...(agentGroup.agentImages ?? []), ...inlineImages]
        }
        for (const tc of contentTools) {
          agentGroup.toolCalls = [...(agentGroup.toolCalls ?? []), {
            id: tc.id, toolName: tc.name, input: tc.input, status: "done" as const,
          }]
        }
      }
    } else if (role === "tool" || role === "toolResult") {
      // "tool" = WS streaming, "toolResult" = gateway history JSONL format
      if (!agentGroup) {
        agentGroup = {
          id: `agent-${msg.timestamp ?? Date.now()}`,
          role: "agent",
          toolCalls: [],
          responseDone: false,
          timestamp: msg.timestamp,
        }
      }
      // For toolResult, result text may live in msg.content (gateway history
      // format) OR in msg.toolResult (our claude-cli-as-gateway conversion).
      // For plain "tool" (WS streaming), it's always msg.toolResult.
      let resultValue: unknown
      if (role === "toolResult") {
        const fromContent = extractToolResultText(msg.content)
        resultValue = fromContent || msg.toolResult
      } else {
        resultValue = msg.toolResult
      }

      // Match by toolCallId first, then by id/toolName
      const matchId = msg.toolCallId ?? msg.id ?? msg.toolName
      const existing = agentGroup.toolCalls!.find(
        (tc) => tc.id === matchId || tc.id === msg.toolCallId || tc.id === msg.id
      )
      if (existing) {
        existing.result = resultValue
        existing.status = "done"
      } else {
        agentGroup.toolCalls!.push({
          id: matchId ?? String(Date.now()),
          toolName: msg.toolName ?? "unknown",
          input: msg.toolInput,
          result: resultValue,
          status: resultValue !== undefined ? "done" : "running",
        })
      }
    }
  }
  flushAgent()
  return groups
}
