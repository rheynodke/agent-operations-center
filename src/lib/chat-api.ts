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
    request<{ sessionKey?: string; session?: ChatSession }>("/chat/sessions", {
      method: "POST",
      body: JSON.stringify({ agentId, channel }),
    }),
  getHistory: (sessionKey: string, maxChars?: number) =>
    request<{ messages?: GatewayMessage[] }>(`/chat/history/${encodeURIComponent(sessionKey)}${maxChars ? `?maxChars=${maxChars}` : ""}`),
  sendMessage: (sessionKey: string, text: string, agentId?: string) =>
    request<{ ok?: boolean; status?: string }>("/chat/send", {
      method: "POST",
      body: JSON.stringify({ sessionKey, text, agentId }),
    }),
  abortRun: (sessionKey: string) =>
    request<{ ok?: boolean }>("/chat/abort", { method: "POST", body: JSON.stringify({ sessionKey }) }),
  subscribe: (sessionKey: string) =>
    request<{ ok: boolean; subscribed: string }>("/chat/subscribe", {
      method: "POST",
      body: JSON.stringify({ sessionKey }),
    }),
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
