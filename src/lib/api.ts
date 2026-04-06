import { useAuthStore } from "@/stores"
import type { AuthStatus, AuthResponse, SkillInfo, AgentTool, SkillScript, GlobalSkillInfo, GlobalToolInfo, ProvisionAgentOpts, ProvisionResult, AgentProfile, AgentChannelsResult, ChannelBinding } from "@/types"

const BASE = "/api"

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401) {
    useAuthStore.getState().clearAuth()
    throw new Error("Unauthorized")
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }

  return res.json()
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export const api = {
  // Auth (public — no token needed)
  getAuthStatus: () => request<AuthStatus>("/auth/status"),
  login: (username: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  setup: (username: string, password: string, displayName?: string) =>
    request<AuthResponse>("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password, displayName }),
    }),
  getMe: () => request<{ user: AuthResponse["user"] }>("/auth/me"),

  // Overview
  getOverview: () => request("/overview"),
  getActivity: () => request("/activity"),

  // Agents
  getAgents: () => request("/agents"),
  getAgent: (id: string) => request(`/agents/${id}`),
  getAgentDetail: (id: string) => request(`/agents/${id}/detail`),
  updateAgent: (id: string, updates: Record<string, unknown>) =>
    request(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
  getAgentSessions: (id: string) => request(`/agents/${id}/sessions`),
  provisionAgent: (opts: ProvisionAgentOpts) =>
    request<ProvisionResult>("/agents", { method: "POST", body: JSON.stringify(opts) }),
  getAgentProfile: (id: string) =>
    request<{ profile: AgentProfile | null }>(`/agents/${id}/profile`),
  updateAgentProfile: (id: string, updates: Partial<AgentProfile>) =>
    request<{ ok: boolean; profile: AgentProfile }>(`/agents/${id}/profile`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),
  uploadAvatar: (id: string, avatarData: string, avatarMime: string) =>
    request<{ ok: boolean; agentId: string }>(`/agents/${id}/avatar`, {
      method: "PUT",
      body: JSON.stringify({ avatarData, avatarMime }),
    }),
  getAvatar: (id: string) =>
    request<{ avatarData: string; avatarMime: string }>(`/agents/${id}/avatar`),
  getAgentFile: (id: string, filename: string) =>
    request<{ filename: string; content: string; path: string; exists: boolean; isGlobal: boolean }>(`/agents/${id}/files/${filename}`),
  saveAgentFile: (id: string, filename: string, content: string) =>
    request<{ ok: boolean; filename: string; path: string }>(`/agents/${id}/files/${filename}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  // Skills
  getAgentSkills: (id: string) =>
    request<{ skills: SkillInfo[] }>(`/agents/${id}/skills`),
  getSkillFile: (id: string, skillName: string) =>
    request<{ name: string; slug: string; content: string; path: string; source: string; editable: boolean }>(`/agents/${id}/skills/${encodeURIComponent(skillName)}/file`),
  saveSkillFile: (id: string, skillName: string, content: string) =>
    request<{ ok: boolean }>(`/agents/${id}/skills/${encodeURIComponent(skillName)}/file`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  createSkill: (id: string, name: string, scope: string, content: string) =>
    request<{ ok: boolean; slug: string; path: string }>(`/agents/${id}/skills`, {
      method: "POST",
      body: JSON.stringify({ name, scope, content }),
    }),
  toggleAgentSkill: (agentId: string, skillName: string, enabled: boolean) =>
    request<{ ok: boolean; allowlist: string[] | undefined }>(`/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),

  // Agent built-in tools management
  getAgentTools: (agentId: string) =>
    request<{ tools: AgentTool[] }>(`/agents/${encodeURIComponent(agentId)}/tools`),
  toggleAgentTool: (agentId: string, toolName: string, enabled: boolean) =>
    request<{ ok: boolean; toolsDeny: string[] }>(`/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolName)}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),

  // Skill Scripts
  listSkillScripts: (agentId: string, skillName: string) =>
    request<{ scripts: SkillScript[] }>(`/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/scripts`),
  getSkillScriptsPath: (agentId: string, skillName: string) =>
    request<{ scriptsDir: string; relPath: string; scriptsDirExists: boolean; scriptCount: number }>(
      `/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/scripts-path`
    ),
  getSkillScript: (agentId: string, skillName: string, filename: string) =>
    request<SkillScript & { content: string; execHint: string }>(`/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/scripts/${encodeURIComponent(filename)}`),
  saveSkillScript: (agentId: string, skillName: string, filename: string, content: string, appendToSkillMd = true) =>
    request<{ ok: boolean; name: string; path: string; size: number; executable: boolean; execHint: string; skillMdUpdated: boolean; isNew: boolean }>(
      `/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/scripts/${encodeURIComponent(filename)}`,
      { method: "PUT", body: JSON.stringify({ content, appendToSkillMd }) }
    ),
  deleteSkillScript: (agentId: string, skillName: string, filename: string) =>
    request<{ ok: boolean; deleted: boolean; name: string }>(
      `/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/scripts/${encodeURIComponent(filename)}`,
      { method: "DELETE" }
    ),

  // Global Skills & Tools Library
  getGlobalSkills: () =>
    request<{ skills: GlobalSkillInfo[]; agents: { id: string; name: string; emoji: string }[] }>("/skills"),
  getGlobalTools: () =>
    request<{ tools: GlobalToolInfo[]; agents: { id: string; name: string; emoji: string }[] }>("/tools"),
  getGlobalSkillFile: (slug: string) =>
    request<{ name: string; slug: string; content: string; path: string; source: string; sourceLabel: string; editable: boolean }>(`/skills/${encodeURIComponent(slug)}/file`),
  saveGlobalSkillFile: (slug: string, content: string) =>
    request<{ ok: boolean; name: string; slug: string; path: string }>(`/skills/${encodeURIComponent(slug)}/file`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  createGlobalSkill: (slug: string, scope: string, content: string) =>
    request<{ ok: boolean; slug: string; path: string; scope: string }>("/skills", {
      method: "POST",
      body: JSON.stringify({ slug, scope, content }),
    }),

  // Agent Channels
  getAgentChannels: (id: string) =>
    request<AgentChannelsResult>(`/agents/${id}/channels`),
  addAgentChannel: (id: string, opts: ChannelBinding) =>
    request<{ ok: boolean; channel: string; accountId: string; whatsappPairingRequired: boolean }>(
      `/agents/${id}/channels`,
      { method: "POST", body: JSON.stringify(opts) }
    ),
  updateAgentChannel: (id: string, channelType: string, accountId: string, updates: Partial<ChannelBinding>) =>
    request<{ ok: boolean; channel: string; accountId: string }>(
      `/agents/${id}/channels/${channelType}/${encodeURIComponent(accountId)}`,
      { method: "PATCH", body: JSON.stringify(updates) }
    ),
  removeAgentChannel: (id: string, channelType: string, accountId: string) =>
    request<{ ok: boolean; removed: { channel: string; accountId: string } }>(
      `/agents/${id}/channels/${channelType}/${encodeURIComponent(accountId)}`,
      { method: "DELETE" }
    ),

  // Sessions
  getSessions: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : ""
    return request(`/sessions${qs}`)
  },
  getSession: (id: string) => request(`/sessions/${id}`),
  getSessionMessages: (agentId: string, sessionId: string) =>
    request(`/sessions/${agentId}/${sessionId}/messages`),

  // Tasks
  getTasks: () => request("/tasks"),

  // Cron
  getCronJobs: () => request("/cron"),

  // Routes
  getRoutes: () => request("/routes"),

  // Gateway management
  getGatewayStatus: () =>
    request<{ running: boolean; pids: number[]; port: number; portOpen: boolean; mode: string; bind: string }>("/gateway/status"),
  restartGateway: () =>
    request<{ ok: boolean; killedPids: number[]; message: string }>("/gateway/restart", { method: "POST" }),
  stopGateway: () =>
    request<{ ok: boolean; killedPids: number[]; message: string }>("/gateway/stop", { method: "POST" }),

  // Health
  health: () => request("/health"),
}
