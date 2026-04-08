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
  deleteAgent: (id: string) =>
    request<{ ok: boolean }>(`/agents/${id}`, { method: "DELETE" }),
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
  getCronDeliveryTargets: () => request("/cron/delivery-targets"),
  createCronJob: (opts: Record<string, unknown>) =>
    request("/cron", { method: "POST", body: JSON.stringify(opts) }),
  updateCronJob: (id: string, opts: Record<string, unknown>) =>
    request(`/cron/${id}`, { method: "PATCH", body: JSON.stringify(opts) }),
  deleteCronJob: (id: string) =>
    request(`/cron/${id}`, { method: "DELETE" }),
  runCronJob: (id: string) =>
    request(`/cron/${id}/run`, { method: "POST" }),
  getCronJobRuns: (id: string, limit = 50) =>
    request(`/cron/${id}/runs?limit=${limit}`),
  toggleCronJob: (id: string, enabled: boolean) =>
    request(`/cron/${id}/toggle`, { method: "POST", body: JSON.stringify({ enabled }) }),

  // Agent Custom Tools (both scopes)
  getAgentCustomTools: (agentId: string) => request(`/agents/${agentId}/custom-tools`),
  toggleAgentCustomTool: (agentId: string, filename: string, enabled: boolean, scope: "shared" | "agent") =>
    request(`/agents/${agentId}/custom-tools/${encodeURIComponent(filename)}/toggle`, {
      method: "POST", body: JSON.stringify({ enabled, scope }),
    }),
  // Agent workspace scripts (full CRUD)
  listAgentScripts: (agentId: string) => request(`/agents/${agentId}/scripts`),
  getAgentScript: (agentId: string, filename: string) => request(`/agents/${agentId}/scripts/${encodeURIComponent(filename)}`),
  saveAgentScript: (agentId: string, filename: string, content: string) =>
    request(`/agents/${agentId}/scripts/${encodeURIComponent(filename)}`, { method: "PUT", body: JSON.stringify({ content }) }),
  deleteAgentScript: (agentId: string, filename: string) =>
    request(`/agents/${agentId}/scripts/${encodeURIComponent(filename)}`, { method: "DELETE" }),
  renameAgentScript: (agentId: string, filename: string, newName: string) =>
    request(`/agents/${agentId}/scripts/${encodeURIComponent(filename)}/rename`, { method: "PATCH", body: JSON.stringify({ newName }) }),
  updateAgentScriptMeta: (agentId: string, filename: string, meta: { name?: string; description?: string }) =>
    request(`/agents/${agentId}/scripts/${encodeURIComponent(filename)}/meta`, { method: "PATCH", body: JSON.stringify(meta) }),

  // Workspace Scripts
  listScripts: () => request("/scripts"),
  getScript: (filename: string) => request(`/scripts/${encodeURIComponent(filename)}`),
  saveScript: (filename: string, content: string) =>
    request(`/scripts/${encodeURIComponent(filename)}`, { method: "PUT", body: JSON.stringify({ content }) }),
  deleteScript: (filename: string) =>
    request(`/scripts/${encodeURIComponent(filename)}`, { method: "DELETE" }),
  renameScript: (filename: string, newName: string) =>
    request(`/scripts/${encodeURIComponent(filename)}/rename`, { method: "PATCH", body: JSON.stringify({ newName }) }),
  updateScriptMeta: (filename: string, meta: { name?: string; description?: string }) =>
    request(`/scripts/${encodeURIComponent(filename)}/meta`, { method: "PATCH", body: JSON.stringify(meta) }),

  // Routes & Channels
  getRoutes: () => request("/routes"),
  getChannels: () => request("/channels"),

  // ClawHub skill install
  clawHubTargets: () =>
    request<{ targets: import("@/types").ClawHubInstallTarget[] }>("/skills/clawhub/targets"),
  clawHubPreview: (url: string) =>
    request<import("@/types").ClawHubSkillPreview>("/skills/clawhub/preview", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  clawHubInstall: (url: string, target: string, agentId?: string, bufferB64?: string) =>
    request<{ ok: boolean; slug: string; path: string; target: string }>("/skills/clawhub/install", {
      method: "POST",
      body: JSON.stringify({ url, target, agentId, bufferB64 }),
    }),

  // SkillsMP
  skillsmpKeyStatus: () =>
    request<import("@/types").SkillsmpKeyStatus>("/settings/skillsmp"),
  skillsmpSetKey: (apiKey: string) =>
    request<{ ok: boolean; preview: string }>("/settings/skillsmp", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  skillsmpDeleteKey: () =>
    request<{ ok: boolean }>("/settings/skillsmp", { method: "DELETE" }),
  skillsmpSearch: (q: string) =>
    request<{ skills: import("@/types").SkillsmpSkill[] }>(`/skills/skillsmp/search?q=${encodeURIComponent(q)}`),
  skillsmpPreview: (skill: import("@/types").SkillsmpSkill) =>
    request<{ content: string; sourceUrl: string; security: import("@/types").ClawHubSecurityResult | null }>("/skills/skillsmp/preview", {
      method: "POST",
      body: JSON.stringify({ skill }),
    }),
  skillsmpInstall: (skill: import("@/types").SkillsmpSkill, target: string, agentId?: string) =>
    request<{ ok: boolean; slug: string; path: string; target: string }>("/skills/skillsmp/install", {
      method: "POST",
      body: JSON.stringify({ skill, target, agentId }),
    }),

  // Channel login (QR flow)
  channelLoginStart: (channel: string, account: string) =>
    request<{ qrDataUrl: string | null; [key: string]: unknown }>(`/channels/${channel}/${account}/login/start`, { method: "POST" }),
  channelLoginWait: (channel: string, account: string) =>
    request<{ ok: boolean; [key: string]: unknown }>(`/channels/${channel}/${account}/login/wait`, { method: "POST" }),

  // Gateway management
  getGatewayStatus: () =>
    request<{ running: boolean; pids: number[]; port: number; portOpen: boolean; mode: string; bind: string }>("/gateway/status"),
  restartGateway: () =>
    request<{ ok: boolean; killedPids: number[]; message: string }>("/gateway/restart", { method: "POST" }),
  stopGateway: () =>
    request<{ ok: boolean; killedPids: number[]; message: string }>("/gateway/stop", { method: "POST" }),

  // OpenClaw config
  getConfig: () =>
    request<{ config: Record<string, unknown>; path: string }>("/config"),
  updateConfigSection: (section: string, value: unknown) =>
    request<{ ok: boolean; section: string }>(`/config/${section}`, {
      method: "PATCH",
      body: JSON.stringify({ value }),
    }),

  // Health
  health: () => request("/health"),
}
