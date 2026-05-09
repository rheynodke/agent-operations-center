import { useAuthStore } from "@/stores"

const BASE = "/api"

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (res.status === 401) { useAuthStore.getState().clearAuth(); throw new Error("Unauthorized") }
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `HTTP ${res.status}`) }
  return res.json()
}

export const chatApi = {
  getGatewayStatus: () => request<{ connected: boolean }>("/chat/gateway/status"),
  getSessions: (agentId?: string) =>
    request<{ sessions?: ChatSession[] }>(`/chat/sessions${agentId ? `?agentId=${agentId}` : ""}`),
  createSession: (agentId: string, channel?: string) =>
    request<{ ok?: boolean; key?: string; sessionId?: string; sessionKey?: string; session?: ChatSession }>("/chat/sessions", {
      method: "POST",
      body: JSON.stringify({ agentId, channel }),
    }),
  getHistory: (sessionKey: string, opts?: { maxChars?: number; taskId?: string }) => {
    const params = new URLSearchParams()
    if (opts?.maxChars) params.set("maxChars", String(opts.maxChars))
    if (opts?.taskId) params.set("taskId", opts.taskId)
    const qs = params.toString()
    return request<{ messages?: GatewayMessage[] }>(`/chat/history/${encodeURIComponent(sessionKey)}${qs ? `?${qs}` : ""}`)
  },
  getHistoryMulti: (sessionKeys: string[], maxChars?: number) =>
    request<{ sessions?: Array<{ key: string; messages: GatewayMessage[]; ok: boolean }> }>(
      `/chat/history-multi?keys=${sessionKeys.map(encodeURIComponent).join(",")}${maxChars ? `&maxChars=${maxChars}` : ""}`
    ),
  sendMessage: (sessionKey: string, text: string, agentId?: string, images?: string[]) =>
    request<{ ok?: boolean; status?: string }>("/chat/send", {
      method: "POST",
      body: JSON.stringify({ sessionKey, text, agentId, images }),
    }),
  abortRun: (sessionKey: string) =>
    request<{ ok?: boolean }>("/chat/abort", { method: "POST", body: JSON.stringify({ sessionKey }) }),
  subscribe: (sessionKey: string) =>
    request<{ ok: boolean; subscribed: string }>("/chat/subscribe", {
      method: "POST",
      body: JSON.stringify({ sessionKey }),
    }),

  // List artifacts produced during this chat session. Server walks the
  // agent's `<workspace>/outputs/` recursively and surfaces legacy paths
  // (files written outside the convention during the same time window).
  getOutputs: (sessionKey: string) =>
    request<{
      agentId: string
      sessionId: string
      sinceMs: number | null
      outputsRoot: string
      truncated: boolean
      files: ChatOutputFile[]
    }>(`/chat/outputs?sessionKey=${encodeURIComponent(sessionKey)}`),

  // Build the URL for streaming a single output file. The server is
  // auth-gated, so callers must fetch with the auth header — we return a
  // fully-qualified path the caller can fetch + blob for download/preview.
  outputFileUrl: (sessionKey: string, relPath: string, opts?: { download?: boolean }) =>
    `${BASE}/chat/outputs/file?sessionKey=${encodeURIComponent(sessionKey)}` +
    `&path=${encodeURIComponent(relPath)}` +
    (opts?.download ? "&download=1" : ""),

  // Convenience: fetch a file as a Blob with the auth header attached, so
  // the caller can pipe it into a download / preview without leaking the
  // bearer token in the URL bar.
  fetchOutputBlob: async (sessionKey: string, relPath: string): Promise<Blob> => {
    const token = useAuthStore.getState().token
    const url = `${BASE}/chat/outputs/file?sessionKey=${encodeURIComponent(sessionKey)}&path=${encodeURIComponent(relPath)}`
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (res.status === 401) { useAuthStore.getState().clearAuth(); throw new Error("Unauthorized") }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  },
}

export interface ChatOutputFile {
  relPath: string
  name: string
  size: number
  mtime: string
  mtimeMs: number
  mimeType: string
  ext: string
  isText: boolean
  source: "outputs" | "legacy"
  outOfConvention: boolean
}

export interface ChatSession {
  sessionKey?: string
  key?: string
  agentId?: string
  channel?: string
  createdAt?: number
  updatedAt?: number
  messageCount?: number
  lastMessage?: string
}

export interface GatewayMessage {
  role: "user" | "assistant" | "system" | "tool" | "toolResult"
  content?: string | Array<{ type: string; text?: string; content?: unknown }>
  text?: string
  timestamp?: number
  id?: string
  // thinking / reasoning
  thinking?: string
  // tool use
  toolName?: string
  toolCallId?: string          // links toolResult back to the assistant's tool_call
  toolInput?: string | Record<string, unknown>
  toolResult?: string | Record<string, unknown>
  isError?: boolean
  // streaming state (client-side)
  streaming?: boolean
  isThinking?: boolean
  isTool?: boolean
}
