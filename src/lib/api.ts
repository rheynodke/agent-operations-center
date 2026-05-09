import { useAuthStore } from "@/stores"
import { useViewAsStore } from "@/stores/useViewAsStore"
import type { AuthStatus, AuthResponse, SkillInfo, AgentTool, SkillScript, GlobalSkillInfo, GlobalToolInfo, ProvisionAgentOpts, ProvisionResult, AgentProfile, AgentChannelsResult, ChannelBinding, Task, TaskStatus, TaskPriority, TaskActivity, Project, ProjectIntegration, Connection, ConnectionFeatureFlags, AgentCapabilities, ProjectWorkspaceMode, ValidatePathResult, FetchBranchesResult, CreateProjectExtendedPayload, FsBrowseResult, MissionRoom, MissionMessage, Artifact, ArtifactVersion, OpenWorldMaster } from "@/types"

export interface SkillFileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  ext?: string
  isText?: boolean
  children?: SkillFileNode[]
}

const BASE = "/api"

/**
 * Append ?owner=<viewingAsUserId> to a URL when an admin is impersonating.
 * Non-admin users get no scope param (server enforces self-only via auth).
 */
function withScope(url: string): string {
  const me = useAuthStore.getState().user
  const scope = useViewAsStore.getState().viewingAsUserId
  if (!me || me.role !== 'admin') return url
  if (scope == null || scope === me.id) return url
  return url + (url.includes('?') ? '&' : '?') + `owner=${scope}`
}

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
    const err = new Error(body.error || `HTTP ${res.status}`) as Error & { status?: number; code?: string; body?: Record<string, unknown> }
    err.status = res.status
    err.code = body.code
    err.body = body
    throw err
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

  // Invitations (public validation + register)
  validateInvitation: (token: string) =>
    request<{ valid: boolean; defaultRole?: string; expiresAt?: string; error?: string }>(`/invitations/validate/${encodeURIComponent(token)}`),
  registerWithInvite: (token: string, username: string, password: string, displayName?: string) =>
    request<AuthResponse>("/auth/register-invite", {
      method: "POST",
      body: JSON.stringify({ token, username, password, displayName }),
    }),

  // Admin: Invitations
  listInvitations: () => request<{ invitations: import("@/types").Invitation[] }>("/invitations"),
  createInvitation: (opts: { expiresAt: string; defaultRole?: string; note?: string }) =>
    request<{ invitation: import("@/types").Invitation }>("/invitations", {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  revokeInvitation: (id: number) =>
    request<{ invitation: import("@/types").Invitation }>(`/invitations/${id}/revoke`, { method: "POST" }),
  deleteInvitation: (id: number) =>
    request<{ ok: boolean }>(`/invitations/${id}`, { method: "DELETE" }),

  // Admin: Users
  listUsers: () => request<{ users: import("@/types").ManagedUser[] }>("/users"),
  updateUser: (id: number, patch: { displayName?: string; role?: string; password?: string; canUseClaudeTerminal?: boolean; dailyTokenQuota?: number | null }) =>
    request<{ user: import("@/types").ManagedUser }>(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" }),
  resetUserPassword: (id: number, password: string) =>
    request<{ ok: boolean }>(`/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  // Overview
  getOverview: () => request(withScope("/overview")),
  getActivity: () => request(withScope("/activity")),

  // Agents — explicit `opts.owner` wins; otherwise admin's view-as scope is threaded.
  getAgents: (opts: { owner?: "me" | "all" | number } = {}) => {
    const qs = opts.owner != null ? `?owner=${encodeURIComponent(String(opts.owner))}` : ""
    return request(withScope(`/agents${qs}`))
  },
  getAgent: (id: string) => request(`/agents/${id}`),
  checkAgentName: (name: string, id?: string) => {
    const params = new URLSearchParams()
    if (name) params.set("name", name)
    if (id) params.set("id", id)
    return request<{ available: boolean; slug?: string; reason?: string }>(`/agent-availability?${params.toString()}`)
  },
  getAgentDetail: (id: string) => request(`/agents/${id}/detail`),
  updateAgent: (id: string, updates: Record<string, unknown>) =>
    request(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
  getAgentSessions: (id: string) => request(withScope(`/agents/${id}/sessions`)),
  provisionAgent: (opts: ProvisionAgentOpts) =>
    request<ProvisionResult>("/agents", { method: "POST", body: JSON.stringify(opts) }),
  provisionMaster: (body: {
    name: string
    emoji?: string
    color?: string
    description?: string
    avatarPresetId?: string
    soulContent?: string
    channels?: import("@/types").ChannelBinding[]
    /** legacy single-binding shape — kept for back-compat. */
    channelBinding?: { channel: string; accountId?: string; token?: string } | null
    templateId?: string
  }) =>
    request<{
      ok: true
      agentId: string
      agentName: string
      isMaster: true
      whatsappPairingRequired?: boolean
    }>(
      "/onboarding/master",
      { method: "POST", body: JSON.stringify(body) }
    ),

  // Open World — list all master agents across users (public-safe view)
  getOpenWorldMasters: () =>
    request<{ masters: OpenWorldMaster[] }>("/master/world"),

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

  // Mission Rooms
  getRooms: () => request<{ rooms: { global: MissionRoom[]; project: MissionRoom[] } }>("/rooms"),
  getRoom: (id: string) => request<{ room: MissionRoom; agents: import("@/types").Agent[] }>(`/rooms/${encodeURIComponent(id)}`),
  createRoom: (data: { kind: "global" | "project"; projectId?: string | null; name: string; description?: string; memberAgentIds?: string[] }) =>
    request<{ room: MissionRoom }>("/rooms", { method: "POST", body: JSON.stringify(data) }),
  patchRoomMembers: (id: string, memberAgentIds: string[]) =>
    request<{ room: MissionRoom }>(`/rooms/${encodeURIComponent(id)}/members`, { method: "PATCH", body: JSON.stringify({ memberAgentIds }) }),
  deleteRoom: (id: string) => request<{ ok: boolean }>(`/rooms/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getProjectRoom: (projectId: string) =>
    request<{ room: MissionRoom }>(`/projects/${encodeURIComponent(projectId)}/room`),
  getRoomMessages: (id: string, opts: { before?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (opts.before) qs.set("before", opts.before)
    if (opts.limit) qs.set("limit", String(opts.limit))
    const tail = qs.toString() ? `?${qs}` : ""
    return request<{ messages: MissionMessage[] }>(`/rooms/${encodeURIComponent(id)}/messages${tail}`)
  },
  postRoomMessage: (id: string, body: string, mentions: string[] = [], meta?: Record<string, any>) =>
    request<{ message: MissionMessage }>(`/rooms/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ body, mentions, meta }) }),
  getRoomCommands: (id: string) =>
    request<{ commands: { name: string; description: string; argHint: string; skillSlug: string }[] }>(`/rooms/${encodeURIComponent(id)}/commands`),
  getAvatar: (id: string) =>
    request<{ avatarData: string; avatarMime: string }>(`/agents/${id}/avatar`),
  getAgentFile: (id: string, filename: string) =>
    request<{ filename: string; content: string; path: string; exists: boolean; isGlobal: boolean }>(`/agents/${id}/files/${filename}`),
  saveAgentFile: (id: string, filename: string, content: string) =>
    request<{ ok: boolean; filename: string; path: string }>(`/agents/${id}/files/${filename}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  /** Read-only workspace browser — list a directory's children */
  getWorkspaceTree: (id: string, relPath = "") =>
    request<{
      path: string
      parent: string | null
      workspaceRoot: string
      entries: Array<{
        name: string
        type: "dir" | "file"
        size: number
        mtime: string
        ext: string
        hidden: boolean
        previewable: "text" | "image" | "binary" | null
      }>
    }>(`/agents/${id}/workspace/tree?path=${encodeURIComponent(relPath)}`),
  /** Read a small text file inline (returns content); use getWorkspaceFileUrl for binaries/images */
  getWorkspaceFile: (id: string, relPath: string) =>
    request<{
      mode: "text"
      content: string | null
      oversize: boolean
      size: number
      mtime: string
      ext: string
      contentType: string
    }>(`/agents/${id}/workspace/file?path=${encodeURIComponent(relPath)}`),
  /** Streaming URL — used by <img src> and download links. Token is passed via query
   *  param because <img> can't carry Authorization headers. */
  getWorkspaceFileUrl: (id: string, relPath: string, opts: { download?: boolean } = {}) => {
    const token = useAuthStore.getState().token
    const qs = new URLSearchParams({ path: relPath, stream: "1" })
    if (opts.download) qs.set("download", "1")
    if (token) qs.set("token", token)
    return `/api/agents/${id}/workspace/file?${qs}`
  },
  /** Inject AOC research output standard into a single agent's SOUL.md */
  applySoulStandard: (id: string) =>
    request<{ ok: boolean; status: "injected" | "already_applied" | "error"; error?: string }>(`/agents/${id}/soul-standard`, { method: "POST" }),
  /** Bulk inject research output standard into all (or specified) agents */
  applyAllSoulStandard: (agentIds?: string[]) =>
    request<{ ok: boolean; results: Array<{ agentId: string; status: string; error?: string }> }>("/agents/soul-standard", {
      method: "POST",
      body: JSON.stringify(agentIds ? { agentIds } : {}),
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
  getAgentSkillDirTree: (agentId: string, skillName: string) =>
    request<{ skillDir: string; tree: SkillFileNode[] }>(`/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/tree`),
  getAgentSkillAnyFile: (agentId: string, skillName: string, filePath: string) =>
    request<{ path: string; content: string; size: number }>(`/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/anyfile?path=${encodeURIComponent(filePath)}`),
  saveAgentSkillAnyFile: (agentId: string, skillName: string, filePath: string, content: string) =>
    request<{ ok: boolean; path: string; size: number }>(`/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/anyfile?path=${encodeURIComponent(filePath)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  toggleAgentSkill: (agentId: string, skillName: string, enabled: boolean) =>
    request<{ ok: boolean; allowlist: string[] | undefined }>(`/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  deleteAgentSkill: (agentId: string, skillName: string) =>
    request<{ ok: boolean; deleted: string; path: string }>(`/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}`, {
      method: "DELETE",
    }),

  // Global skills library
  deleteGlobalSkill: (slug: string) =>
    request<{ ok: boolean; deleted: string; path: string }>(`/skills/${encodeURIComponent(slug)}`, {
      method: "DELETE",
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
  getSkillDirTree: (slug: string) =>
    request<{ slug: string; name: string; source: string; editable: boolean; skillDir: string; tree: SkillFileNode[] }>(`/skills/${encodeURIComponent(slug)}/tree`),
  getSkillAnyFile: (slug: string, filePath: string) =>
    request<{ slug: string; path: string; content: string; size: number; editable: boolean }>(`/skills/${encodeURIComponent(slug)}/anyfile?path=${encodeURIComponent(filePath)}`),
  saveSkillAnyFile: (slug: string, filePath: string, content: string) =>
    request<{ ok: boolean; slug: string; path: string; size: number }>(`/skills/${encodeURIComponent(slug)}/anyfile?path=${encodeURIComponent(filePath)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
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
    return request(withScope(`/sessions${qs}`))
  },
  getSession: (id: string) => request(withScope(`/sessions/${id}`)),
  getSessionMessages: (agentId: string, sessionId: string) =>
    request(withScope(`/sessions/${agentId}/${sessionId}/messages`)),

  // Tasks
  getTasks: (filters?: { agentId?: string; status?: string; priority?: string; tag?: string; q?: string; projectId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.agentId)    params.set('agentId',    filters.agentId);
    if (filters?.status)     params.set('status',     filters.status);
    if (filters?.priority)   params.set('priority',   filters.priority);
    if (filters?.tag)        params.set('tag',        filters.tag);
    if (filters?.q)          params.set('q',          filters.q);
    if (filters?.projectId)  params.set('projectId',  filters.projectId);
    const qs = params.toString();
    return request<{ tasks: Task[] }>(`/tasks${qs ? `?${qs}` : ''}`);
  },
  createTask: (data: { title: string; description?: string; status?: TaskStatus; priority?: TaskPriority; agentId?: string; tags?: string[]; projectId?: string; stage?: string | null; role?: string | null; epicId?: string | null }) =>
    request<{ task: Task }>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'tags' | 'cost' | 'sessionId'>> & { assignTo?: string; note?: string; newAttachmentIds?: string[]; stage?: string | null; role?: string | null; epicId?: string | null }) =>
    request<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
  getTaskActivity: (id: string) =>
    request<{ activity: TaskActivity[] }>(`/tasks/${id}/activity`),
  syncAgentTaskScript: (agentId: string) =>
    request<{ ok: boolean }>(`/agents/${agentId}/sync-task-script`, { method: 'POST' }),
  dispatchTask: (taskId: string) =>
    request<{ ok: boolean; sessionKey: string; agentId: string }>(`/tasks/${taskId}/dispatch`, { method: 'POST' }),
  approveTask: (taskId: string, note?: string) =>
    request<{ ok: boolean; task: Task }>(`/tasks/${taskId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note: note || undefined }),
    }),
  requestTaskChange: (taskId: string, reason: string) =>
    request<{ ok: boolean; task: Task }>(`/tasks/${taskId}/request-change`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  interruptTask: (taskId: string, note?: string) =>
    request<{ ok: boolean; sessionKey: string }>(`/tasks/${taskId}/interrupt`, {
      method: 'POST',
      body: JSON.stringify({ note: note || undefined }),
    }),
  abortSession: (sessionKey: string, note?: string) =>
    request<{ ok: boolean; sessionKey: string }>(`/sessions/${encodeURIComponent(sessionKey)}/abort`, {
      method: 'POST',
      body: JSON.stringify({ note: note || undefined }),
    }),

  // Attachments
  uploadTaskAttachments: (
    taskId: string,
    files: File[],
    onProgress?: (pct: number) => void,
  ): Promise<{ task: Task; added: import('@/types').TaskAttachment[] }> => {
    const token = useAuthStore.getState().token;
    const form = new FormData();
    for (const f of files) form.append('files', f);
    // Use XHR so we can report upload progress (fetch() lacks a progress event)
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/tasks/${taskId}/attachments`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (onProgress) {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) onProgress(Math.round((evt.loaded / evt.total) * 100));
        };
      }
      xhr.onload = () => {
        if (xhr.status === 401) {
          useAuthStore.getState().clearAuth();
          reject(new Error('Unauthorized'));
          return;
        }
        let body: { task?: Task; added?: import('@/types').TaskAttachment[]; error?: string } = {};
        try { body = JSON.parse(xhr.responseText || '{}'); } catch {}
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(body.error || `Upload failed (HTTP ${xhr.status})`));
          return;
        }
        resolve(body as { task: Task; added: import('@/types').TaskAttachment[] });
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(form);
    });
  },
  deleteTaskAttachment: (taskId: string, attachmentId: string) =>
    request<{ task: Task }>(`/tasks/${taskId}/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }),
  attachmentUrl: (att: import('@/types').TaskAttachment): string => {
    if (att.source === 'sheet') return att.url;
    const token = useAuthStore.getState().token;
    return token ? `${att.url}?token=${encodeURIComponent(token)}` : att.url;
  },

  // Metrics dashboard
  getMetricsSummary: (range: import('@/types').MetricsRange = '30d', projectId?: string | null, agentId?: string | null) => {
    const params = new URLSearchParams({ range });
    if (projectId) params.set('projectId', projectId);
    if (agentId)   params.set('agentId',   agentId);
    return request<import('@/types').MetricsSummary>(withScope(`/metrics/summary?${params.toString()}`));
  },
  getMetricsThroughput: (range: import('@/types').MetricsRange = '30d', projectId?: string | null, agentId?: string | null) => {
    const params = new URLSearchParams({ range });
    if (projectId) params.set('projectId', projectId);
    if (agentId)   params.set('agentId',   agentId);
    return request<import('@/types').MetricsThroughput>(withScope(`/metrics/throughput?${params.toString()}`));
  },
  getMetricsAgents: (range: import('@/types').MetricsRange = '30d', projectId?: string | null) => {
    const params = new URLSearchParams({ range });
    if (projectId) params.set('projectId', projectId);
    return request<import('@/types').MetricsAgents>(withScope(`/metrics/agents?${params.toString()}`));
  },
  getMetricsLifecycle: (range: import('@/types').MetricsRange = '30d', projectId?: string | null, agentId?: string | null) => {
    const params = new URLSearchParams({ range });
    if (projectId) params.set('projectId', projectId);
    if (agentId)   params.set('agentId',   agentId);
    return request<import('@/types').MetricsLifecycle>(withScope(`/metrics/lifecycle?${params.toString()}`));
  },
  getMetricsAgentTasks: (agentId: string, projectId?: string | null, limit = 20) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (projectId) params.set('projectId', projectId);
    return request<import('@/types').MetricsAgentTasks>(withScope(`/metrics/agents/${encodeURIComponent(agentId)}/tasks?${params.toString()}`));
  },

  // Task comments — user ↔ agent discussion thread
  getTaskComments: (taskId: string) =>
    request<{ comments: import('@/types').TaskComment[] }>(`/tasks/${encodeURIComponent(taskId)}/comments`),
  postTaskComment: (taskId: string, body: string) =>
    request<{ comment: import('@/types').TaskComment }>(`/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  updateTaskComment: (taskId: string, commentId: string, body: string) =>
    request<{ comment: import('@/types').TaskComment }>(`/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }),
  deleteTaskComment: (taskId: string, commentId: string) =>
    request<{ ok: boolean }>(`/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),

  // Task outputs — agent-produced deliverables under {workspace}/outputs/{taskId}/
  getTaskOutputs: (taskId: string) =>
    request<{ outputs: import('@/types').TaskOutput[] }>(`/tasks/${encodeURIComponent(taskId)}/outputs`),
  outputUrl: (taskId: string, filename: string): string => {
    const token = useAuthStore.getState().token;
    const base = `${BASE}/tasks/${encodeURIComponent(taskId)}/outputs/${encodeURIComponent(filename)}`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
  analyzeTask: (taskId: string) =>
    request<{ ok: boolean; analysis: import('@/types').TaskAnalysis }>(`/tasks/${taskId}/analyze`, { method: 'POST' }),

  // Directory browsing
  browseDirs: (dirPath?: string) =>
    request<{ path: string; dirs: string[]; isGitRepo: boolean; parent: string }>(
      `/browse-dirs${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`
    ),

  // Connections
  getConnections: () =>
    request<{ connections: Connection[] }>('/connections'),
  createConnection: (data: { name: string; type: string; credentials?: string; metadata?: Record<string, unknown>; enabled?: boolean }) =>
    request<{ ok: boolean; connection: Connection; authUrl?: string }>('/connections', { method: 'POST', body: JSON.stringify(data) }),
  updateConnection: (id: string, patch: { name?: string; credentials?: string; metadata?: Record<string, unknown>; enabled?: boolean }) =>
    request<{ connection: Connection }>(`/connections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteConnection: (id: string) =>
    request<{ ok: boolean }>(`/connections/${id}`, { method: 'DELETE' }),
  testConnection: (id: string) =>
    request<{ ok: boolean; message?: string; error?: string; preview?: string }>(`/connections/${id}/test`, { method: 'POST' }),

  // Connection sharing (org-wide boolean — owner toggles, anyone can use).
  setConnectionShared: (id: string, shared: boolean) =>
    request<{ ok: boolean; connection: Connection }>(
      `/connections/${encodeURIComponent(id)}/share`,
      { method: 'PATCH', body: JSON.stringify({ shared }) },
    ),
  getConnectionUsage: (id: string) =>
    request<{ usage: import('@/types').ConnectionUsageEntry[] }>(`/connections/${encodeURIComponent(id)}/usage`),

  // Google Workspace connection flows
  getConnectionFeatures: () =>
    request<{ features: ConnectionFeatureFlags; redirectUri: string | null }>('/connections/config/features'),
  reauthGoogleConnection: (id: string) =>
    request<{ authUrl: string }>(`/connections/${encodeURIComponent(id)}/google/reauth`, { method: 'POST' }),
  disconnectGoogleConnection: (id: string) =>
    request<{ ok: true }>(`/connections/${encodeURIComponent(id)}/google/disconnect`, { method: 'POST' }),
  healthCheckGoogleConnection: (id: string) =>
    request<{ ok: boolean; authState: string; error?: string }>(`/connections/${encodeURIComponent(id)}/google/health`),

  // MCP OAuth flows
  startMcpOauth: (id: string) =>
    request<{ authUrl: string }>(`/connections/${encodeURIComponent(id)}/mcp-oauth/start`, { method: 'POST' }),
  disconnectMcpOauth: (id: string) =>
    request<{ ok: true }>(`/connections/${encodeURIComponent(id)}/mcp-oauth/disconnect`, { method: 'POST' }),

  // Composio
  composioListConnected: (id: string) =>
    request<{ accounts: import('@/types').ComposioConnectedAccount[] }>(`/connections/${encodeURIComponent(id)}/composio/connected`),
  composioListToolkits: (id: string) =>
    request<{ toolkits: Array<{ slug?: string; name?: string }> }>(`/connections/${encodeURIComponent(id)}/composio/toolkits`),
  composioCreateLink: (id: string, toolkit: string, alias?: string) =>
    request<{ redirectUrl: string; connectedAccountId: string; linkToken: string }>(
      `/connections/${encodeURIComponent(id)}/composio/link`,
      { method: 'POST', body: JSON.stringify({ toolkit, alias }) },
    ),
  composioDisconnectAccount: (id: string, accountId: string) =>
    request<{ ok: true }>(`/connections/${encodeURIComponent(id)}/composio/connected/${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
  composioRefreshSession: (id: string, toolkits?: string[]) =>
    request<{ ok: true; sessionId: string }>(`/connections/${encodeURIComponent(id)}/composio/refresh-session`, {
      method: 'POST',
      body: JSON.stringify(toolkits ? { toolkits } : {}),
    }),
  // Discover toolkits already connected on Composio for the given (apiKey, userId)
  // — used by the New Connection modal so the toolkit allowlist reflects the
  // user's actual connected accounts instead of a hardcoded suggestion list.
  composioDiscoverToolkits: (apiKey: string, userId?: string) =>
    request<{ userId: string; accountCount: number; toolkits: Array<{ slug: string; label: string; accountCount: number }> }>(
      `/composio/discover`,
      { method: 'POST', body: JSON.stringify({ apiKey, userId }) },
    ),
  composioDiscoverToolkitsForConn: (id: string) =>
    request<{ userId: string; accountCount: number; toolkits: Array<{ slug: string; label: string; accountCount: number }> }>(
      `/connections/${encodeURIComponent(id)}/composio/discover`,
    ),

  // Agent ↔ Connection assignments
  getAgentConnections: (agentId: string) =>
    request<{ connectionIds: string[]; connections: Connection[] }>(`/agents/${agentId}/connections`),
  setAgentConnections: (agentId: string, connectionIds: string[]) =>
    request<{ ok: boolean }>(`/agents/${agentId}/connections`, { method: 'PUT', body: JSON.stringify({ connectionIds }) }),
  getConnectionAssignments: () =>
    request<{ assignments: Record<string, string[]> }>('/connections/assignments'),

  // Projects
  getProjects: () =>
    request<{ projects: Project[] }>('/projects'),
  createProject: (data: { name: string; color?: string; description?: string }) =>
    request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  /** Workspace-aware variant — accepts greenfield/brownfield fields. */
  createProjectV2: (data: CreateProjectExtendedPayload) =>
    request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'color' | 'description' | 'kind'>>) =>
    request<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProject: (id: string, opts?: { unbind?: boolean; hard?: boolean }) => {
    const q = opts?.unbind ? `?unbind=true${opts.hard ? '&hard=true' : ''}` : ''
    return request<{ ok: boolean; unbindResult?: { gitignoreRemoved: boolean; aocRemoved: boolean } }>(
      `/projects/${id}${q}`, { method: 'DELETE' }
    )
  },
  /** Pre-flight: validate workspace path + detect git repo + existing binding. */
  validateProjectPath: (data: { path: string; mode: ProjectWorkspaceMode; name?: string }) =>
    request<ValidatePathResult>('/projects/_validate-path', { method: 'POST', body: JSON.stringify(data) }),
  /** `git fetch` then list branches. Manual trigger (no debounce). */
  fetchProjectBranches: (data: { path: string; projectId?: string }) =>
    request<FetchBranchesResult>('/projects/_fetch-branches', { method: 'POST', body: JSON.stringify(data) }),
  /** Switch active branch on a bound project. Refuses dirty tree. */
  switchProjectBranch: (id: string, branch: string) =>
    request<{ project: Project; switched: boolean; headSha: string }>(`/projects/${id}/branch`, {
      method: 'PATCH', body: JSON.stringify({ branch }),
    }),
  /** Manual fetch + return latest branch list for a bound project. */
  refetchProjectBranches: (id: string) =>
    request<FetchBranchesResult & { project: Project }>(`/projects/${id}/refetch`, {
      method: 'POST', body: JSON.stringify({}),
    }),

  /** Server-driven directory browser (for the wizard's path picker). */
  browseProjectDir: (path: string = '~', showHidden = false) => {
    const q = `?path=${encodeURIComponent(path)}${showHidden ? '&showHidden=true' : ''}`
    return request<FsBrowseResult>(`/projects/_browse-dir${q}`)
  },

  // ─── Epics (Phase B) ──────────────────────────────────────────────────────
  listEpics: (projectId: string) =>
    request<{ epics: import('@/types').Epic[] }>(`/projects/${encodeURIComponent(projectId)}/epics`),
  createEpic: (projectId: string, data: { title: string; description?: string; status?: string; color?: string }) =>
    request<{ epic: import('@/types').Epic }>(`/projects/${encodeURIComponent(projectId)}/epics`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateEpic: (id: string, patch: Partial<{ title: string; description: string; status: string; color: string }>) =>
    request<{ epic: import('@/types').Epic }>(`/epics/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  deleteEpic: (id: string) =>
    request<{ ok: boolean }>(`/epics/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ─── Task dependencies (Phase B) ──────────────────────────────────────────
  listTaskDependencies: (taskId: string) =>
    request<{ dependencies: import('@/types').TaskDependency[] }>(`/tasks/${encodeURIComponent(taskId)}/dependencies`),
  addTaskDependency: (taskId: string, body: { blockerTaskId?: string; blockedTaskId?: string; kind?: 'blocks' | 'relates' }) =>
    request<{ dependency: import('@/types').TaskDependency }>(`/tasks/${encodeURIComponent(taskId)}/dependencies`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  removeTaskDependency: (taskId: string, depId: string) =>
    request<{ ok: boolean }>(`/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(depId)}`, { method: 'DELETE' }),
  listProjectDependencies: (projectId: string) =>
    request<{ dependencies: import('@/types').TaskDependency[] }>(`/projects/${encodeURIComponent(projectId)}/dependencies`),

  // ─── Project memory (Phase A2) ────────────────────────────────────────────
  listProjectMemory: (projectId: string, opts: { kind?: import('@/types').ProjectMemoryKind; status?: import('@/types').ProjectMemoryStatus } = {}) => {
    const qs = new URLSearchParams()
    if (opts.kind) qs.set('kind', opts.kind)
    if (opts.status) qs.set('status', opts.status)
    const tail = qs.toString() ? `?${qs}` : ''
    return request<{ items: import('@/types').ProjectMemoryItem[] }>(`/projects/${encodeURIComponent(projectId)}/memory${tail}`)
  },
  createProjectMemory: (projectId: string, body: {
    kind: import('@/types').ProjectMemoryKind
    title: string
    body?: string
    status?: import('@/types').ProjectMemoryStatus
    meta?: import('@/types').ProjectMemoryMeta
    sourceTaskId?: string | null
  }) =>
    request<{ item: import('@/types').ProjectMemoryItem }>(`/projects/${encodeURIComponent(projectId)}/memory`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateProjectMemory: (id: string, patch: Partial<{
    title: string; body: string;
    status: import('@/types').ProjectMemoryStatus;
    meta: import('@/types').ProjectMemoryMeta;
    sourceTaskId: string | null;
  }>) =>
    request<{ item: import('@/types').ProjectMemoryItem }>(`/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  deleteProjectMemory: (id: string) =>
    request<{ ok: boolean }>(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Project Integrations
  getProjectIntegrations: (projectId: string) =>
    request<{ integrations: ProjectIntegration[] }>(`/projects/${projectId}/integrations`),
  createIntegration: (projectId: string, data: object) =>
    request<{ integration: ProjectIntegration }>(`/projects/${projectId}/integrations`, { method: 'POST', body: JSON.stringify(data) }),
  updateIntegration: (projectId: string, id: string, patch: object) =>
    request<{ integration: ProjectIntegration }>(`/projects/${projectId}/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteIntegration: (projectId: string, id: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/integrations/${id}`, { method: 'DELETE' }),
  testIntegrationConnection: (projectId: string, data: { type: string; credentials: string; spreadsheetId: string }) =>
    request<{ ok: boolean; sheets?: string[]; error?: string }>(`/projects/${projectId}/integrations/_new/test`, { method: 'POST', body: JSON.stringify(data) }),
  getIntegrationHeaders: (projectId: string, data: { credentials?: string; spreadsheetId?: string; sheetName: string; integrationId?: string }) => {
    const iid = data.integrationId || '_new';
    const { integrationId: _, ...body } = data;
    return request<{ headers: string[] }>(`/projects/${projectId}/integrations/${iid}/headers`, { method: 'POST', body: JSON.stringify(body) });
  },
  syncIntegrationNow: (projectId: string, id: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/integrations/${id}/sync`, { method: 'POST' }),

  // Cron
  getCronJobs: () => request(withScope("/cron")),
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

  // Hooks / Inbound Webhooks
  getHooksConfig: () => request("/hooks/config"),
  saveHooksConfig: (updates: Record<string, unknown>) =>
    request("/hooks/config", { method: "PUT", body: JSON.stringify(updates) }),
  generateHookToken: () => request("/hooks/token", { method: "POST" }),
  getHookSessions: (limit = 50) => request(`/hooks/sessions?limit=${limit}`),

  // Routes & Channels
  getRoutes: () => request(withScope("/routes")),
  getChannels: () => request(withScope("/channels")),

  // ClawHub skill install
  clawHubTargets: () =>
    request<{ targets: import("@/types").ClawHubInstallTarget[] }>("/skills/clawhub/targets"),
  clawHubPreview: (url: string) =>
    request<import("@/types").ClawHubSkillPreview>("/skills/clawhub/preview", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  clawHubInstall: (url: string, target: string, agentId?: string, bufferB64?: string, overwrite?: boolean) =>
    request<{ ok: boolean; slug: string; path: string; target: string; updated?: boolean }>("/skills/clawhub/install", {
      method: "POST",
      body: JSON.stringify({ url, target, agentId, bufferB64, overwrite }),
    }),

  // Role templates (Phase 1: read-only)
  listRoleTemplates: () =>
    request<{ templates: import("@/types").RoleTemplateSummary[] }>("/role-templates"),
  getRoleTemplate: (id: string) =>
    request<{ template: import("@/types").RoleTemplateRecord }>(`/role-templates/${encodeURIComponent(id)}`),
  getRoleTemplateUsage: (id: string) =>
    request<{ agentIds: string[]; count: number }>(`/role-templates/${encodeURIComponent(id)}/usage`),

  // Role templates (Phase 2: CRUD)
  createRoleTemplate: (data: Partial<import("@/types").RoleTemplateRecord>) =>
    request<{ template: import("@/types").RoleTemplateRecord }>("/role-templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateRoleTemplate: (id: string, patch: Partial<import("@/types").RoleTemplateRecord>) =>
    request<{ template: import("@/types").RoleTemplateRecord }>(`/role-templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteRoleTemplate: (id: string, force = false) =>
    request<{ ok: boolean; id: string; cleared: string[] }>(
      `/role-templates/${encodeURIComponent(id)}${force ? "?force=true" : ""}`,
      { method: "DELETE" },
    ),
  forkRoleTemplate: (id: string, newId?: string, overrides?: Partial<import("@/types").RoleTemplateRecord>) =>
    request<{ template: import("@/types").RoleTemplateRecord }>(
      `/role-templates/${encodeURIComponent(id)}/fork`,
      { method: "POST", body: JSON.stringify({ newId, overrides }) },
    ),

  // Role templates (Phase 5: apply to agent)
  previewRoleTemplateApply: (templateId: string, agentId: string) =>
    request<{ preview: import("@/types").ApplyPreview }>(
      `/role-templates/${encodeURIComponent(templateId)}/preview-apply?agentId=${encodeURIComponent(agentId)}`,
    ),
  applyRoleTemplateToAgent: (
    agentId: string,
    body: {
      templateId: string
      overwriteFiles?: Array<"identity" | "soul" | "tools" | "agents">
      installSkills?: boolean
      installScripts?: boolean
      overwriteConflictingScripts?: boolean
    },
  ) =>
    request<import("@/types").ApplyResult>(
      `/agents/${encodeURIComponent(agentId)}/assign-role`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  unassignAgentRole: (agentId: string) =>
    request<{ ok: boolean; agentId: string }>(
      `/agents/${encodeURIComponent(agentId)}/unassign-role`,
      { method: "POST" },
    ),
  refreshRoleTemplatesSeed: () =>
    request<{ refreshed: number; ids: string[] }>("/role-templates/refresh-builtins", {
      method: "POST",
    }),

  // Skill Catalog (Internal Marketplace)
  listCatalogSkills: (filters?: {
    envScope?: string
    role?: string
    risk?: string
    search?: string
  }) => {
    const qs = new URLSearchParams()
    if (filters?.envScope) qs.set("envScope", filters.envScope)
    if (filters?.role)     qs.set("role", filters.role)
    if (filters?.risk)     qs.set("risk", filters.risk)
    if (filters?.search)   qs.set("search", filters.search)
    const tail = qs.toString()
    return request<{ skills: import("@/types").CatalogSkill[]; total: number }>(
      `/skills/catalog${tail ? `?${tail}` : ""}`,
    )
  },
  getCatalogSkill: (slug: string) =>
    request<{ skill: import("@/types").CatalogSkill }>(
      `/skills/catalog/${encodeURIComponent(slug)}`,
    ),
  createCatalogSkill: (data: Partial<import("@/types").CatalogSkill>) =>
    request<{ skill: import("@/types").CatalogSkill }>("/skills/catalog", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCatalogSkill: (slug: string, patch: Partial<import("@/types").CatalogSkill>) =>
    request<{ skill: import("@/types").CatalogSkill }>(
      `/skills/catalog/${encodeURIComponent(slug)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  deleteCatalogSkill: (slug: string) =>
    request<{ ok: boolean; slug: string }>(
      `/skills/catalog/${encodeURIComponent(slug)}`,
      { method: "DELETE" },
    ),
  refreshCatalogSeed: () =>
    request<{ refreshed: number }>("/skills/catalog/refresh-seed", { method: "POST" }),
  installCatalogSkill: (slug: string, force = false) =>
    request<{ ok: boolean; slug: string; action: string; version: string; path?: string }>(
      `/skills/catalog/${encodeURIComponent(slug)}/install`,
      { method: "POST", body: JSON.stringify({ force }) },
    ),
  installCatalogSkills: (slugs: string[], force = false) =>
    request<{
      results: Array<{ ok: boolean; slug: string; action: string; version?: string; error?: string }>
      summary: { total: number; installed: number; updated: number; noop: number; missing: number; errors: number }
    }>("/skills/catalog/install-many", {
      method: "POST",
      body: JSON.stringify({ slugs, force }),
    }),

  // Upload skill (zip / .skill / raw SKILL.md)
  uploadSkillPreview: (filename: string, bufferB64: string) =>
    request<import("@/types").ClawHubSkillPreview & { isSingleFile?: boolean; source?: string }>(
      "/skills/upload/preview",
      { method: "POST", body: JSON.stringify({ filename, bufferB64 }) },
    ),
  uploadSkillInstall: (
    filename: string,
    bufferB64: string,
    target: string,
    agentId?: string,
    slug?: string,
    overwrite?: boolean,
  ) =>
    request<{ ok: boolean; slug: string; path: string; target: string; source: string; updated?: boolean }>(
      "/skills/upload/install",
      { method: "POST", body: JSON.stringify({ filename, bufferB64, target, agentId, slug, overwrite }) },
    ),

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
  skillsmpInstall: (skill: import("@/types").SkillsmpSkill, target: string, agentId?: string, overwrite?: boolean) =>
    request<{ ok: boolean; slug: string; path: string; target: string; updated?: boolean }>("/skills/skillsmp/install", {
      method: "POST",
      body: JSON.stringify({ skill, target, agentId, overwrite }),
    }),

  // File versioning
  listVersions: (scope: string, limit = 30) =>
    request<{ versions: import("@/types").FileVersion[] }>(`/versions?scope=${encodeURIComponent(scope)}&limit=${limit}`),
  getVersion: (id: number) =>
    request<{ version: import("@/types").FileVersionDetail }>(`/versions/${id}`),
  restoreVersion: (id: number) =>
    request<{ ok: boolean; scopeKey: string; restoredVersionId: number }>(`/versions/${id}/restore`, { method: "POST" }),
  deleteVersion: (id: number) =>
    request<{ ok: boolean }>(`/versions/${id}`, { method: "DELETE" }),

  // Channel login (QR flow)
  channelLoginStart: (channel: string, account: string) =>
    request<{ qrDataUrl: string | null; [key: string]: unknown }>(`/channels/${channel}/${account}/login/start`, { method: "POST" }),
  channelLoginWait: (channel: string, account: string) =>
    request<{ ok: boolean; [key: string]: unknown }>(`/channels/${channel}/${account}/login/wait`, { method: "POST" }),

  // DM Pairing approval
  getAgentPairing: (agentId: string) =>
    request<import("@/types").PairingRequestsByChannel>(`/agents/${agentId}/pairing`),
  approvePairing: (channel: string, code: string, accountId?: string) =>
    request<{ ok: boolean; error?: string; warning?: string }>(`/pairing/${channel}/approve`, {
      method: "POST",
      body: JSON.stringify({ code, accountId }),
    }),
  rejectPairing: (channel: string, code: string, accountId?: string) =>
    request<{ ok: boolean; error?: string; removed?: number }>(`/pairing/${channel}/reject`, {
      method: "POST",
      body: JSON.stringify({ code, accountId }),
    }),

  // Allow-from store management
  getAgentAllowFrom: (agentId: string) =>
    request<import("@/types").AllowFromResult>(`/agents/${agentId}/allowfrom`),
  addAllowFromEntry: (agentId: string, channel: string, accountId: string, entry: string) =>
    request<{ ok: boolean; added?: number; entries?: string[]; error?: string }>(`/agents/${agentId}/allowfrom`, {
      method: "POST",
      body: JSON.stringify({ channel, accountId, entry }),
    }),
  removeAllowFromEntry: (agentId: string, channel: string, accountId: string, entry: string) =>
    request<{ ok: boolean; removed?: number; entries?: string[]; error?: string }>(`/agents/${agentId}/allowfrom`, {
      method: "DELETE",
      body: JSON.stringify({ channel, accountId, entry }),
    }),

  // Discord guild allowlist
  getAgentDiscordGuilds: (agentId: string) =>
    request<import("@/types").DiscordGuildsResult>(`/agents/${agentId}/discord/guilds`),
  upsertAgentDiscordGuild: (agentId: string, guildId: string, opts: { label?: string; requireMention?: boolean; users?: string[] }) =>
    request<{ ok: boolean; accountId: string; guildId: string; entry: { label?: string; requireMention: boolean; users: string[] }; error?: string }>(`/agents/${agentId}/discord/guilds/${guildId}`, {
      method: "PUT",
      body: JSON.stringify(opts),
    }),
  removeAgentDiscordGuild: (agentId: string, guildId: string) =>
    request<{ ok: boolean; accountId?: string; guildId?: string; error?: string }>(`/agents/${agentId}/discord/guilds/${guildId}`, {
      method: "DELETE",
    }),

  // Browser Harness — built-in CDP browser automation skill (Layer 1)
  getBrowserHarnessStatus: () =>
    request<import("@/types").BrowserHarnessStatus>("/browser-harness/status"),
  installBrowserHarness: (opts?: { commit?: string; force?: boolean }) =>
    request<{ ok: boolean; skipped?: boolean; reason?: string; commit?: string; dir?: string; error?: string }>("/browser-harness/install", {
      method: "POST",
      body: JSON.stringify(opts || {}),
    }),
  bootBrowserHarness: (slotId = 1) =>
    request<{ ok: boolean; slot?: import("@/types").BrowserHarnessSlot; error?: string }>("/browser-harness/boot", {
      method: "POST",
      body: JSON.stringify({ slotId }),
    }),
  stopBrowserHarness: (opts?: { slotId?: number; all?: boolean }) =>
    request<{ ok: boolean; slotId?: number; stopped?: string; error?: string }>("/browser-harness/stop", {
      method: "POST",
      body: JSON.stringify(opts || { slotId: 1 }),
    }),
  // Layer 2 (browser-harness-odoo)
  getBrowserHarnessOdooStatus: () =>
    request<import("@/types").BrowserHarnessOdooStatus>("/browser-harness/odoo/status"),
  installBrowserHarnessOdoo: (opts?: { force?: boolean }) =>
    request<{ ok: boolean; written?: number; kept?: number; skippedUserEdit?: number; total?: number; bundleVersion?: string; error?: string }>("/browser-harness/odoo/install", {
      method: "POST",
      body: JSON.stringify(opts || {}),
    }),

  // Gateway management
  getGatewayStatus: () =>
    request<{ running: boolean; pids: number[]; port: number; portOpen: boolean; mode: string; bind: string }>(withScope("/gateway/status")),
  restartGateway: () =>
    request<{ ok: boolean; killedPids?: number[]; port?: number; pid?: number; message?: string }>("/gateway/restart", { method: "POST" }),
  stopGateway: () =>
    request<{ ok: boolean; killedPids?: number[]; message?: string }>("/gateway/stop", { method: "POST" }),
  startGateway: () =>
    request<{ ok: boolean; port?: number; pid?: number }>("/gateway/start", { method: "POST" }),
  stopGatewaySelf: () =>
    request<{ ok: boolean; killedPids?: number[]; message?: string }>("/gateway/stop", { method: "POST" }),
  restartGatewaySelf: () =>
    request<{ ok: boolean; port?: number; pid?: number; killedPids?: number[]; message?: string }>("/gateway/restart", { method: "POST" }),
  adminRestartUserGateway: (userId: number) =>
    request<{ ok: boolean; port?: number; pid?: number }>(`/admin/users/${userId}/gateway/restart`, { method: "POST" }),
  adminStopUserGateway: (userId: number) =>
    request<{ ok: boolean }>(`/admin/users/${userId}/gateway/stop`, { method: "POST" }),

  // OpenClaw config
  getConfig: () =>
    request<{ config: Record<string, unknown>; path: string }>("/config"),
  updateConfigSection: (section: string, value: unknown) =>
    request<{ ok: boolean; section: string }>(`/config/${section}`, {
      method: "PATCH",
      body: JSON.stringify({ value }),
    }),
  syncProvidersToAllUsers: (opts: { restartGateways?: boolean } = {}) =>
    request<{
      ok: boolean
      regenerated: boolean
      reason: string
      secrets: { envVar: string; provider: string }[]
      usersUpdated: string[]
      usersRestarted: string[]
    }>("/config/providers/sync", {
      method: "POST",
      body: JSON.stringify(opts),
    }),

  // Agent capabilities (composite — used by skill template selectors)
  getAgentCapabilities: (id: string) => request<AgentCapabilities>(`/agents/${id}/capabilities`),

  // Health
  health: () => request("/health"),

  // Room Artifacts
  listArtifacts: (roomId: string, params?: { category?: string; archived?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.category) qs.set("category", params.category)
    if (params?.archived != null) qs.set("archived", String(params.archived))
    const tail = qs.toString() ? `?${qs}` : ""
    return request<{ artifacts: Artifact[] }>(`/rooms/${encodeURIComponent(roomId)}/artifacts${tail}`)
  },

  getArtifact: (roomId: string, artifactId: string) =>
    request<{ artifact: Artifact; versions: ArtifactVersion[] }>(
      `/rooms/${encodeURIComponent(roomId)}/artifacts/${encodeURIComponent(artifactId)}`
    ),

  createArtifact: (
    roomId: string,
    data: {
      category: string
      title: string
      content: string
      fileName: string
      description?: string
      tags?: string[]
      mimeType?: string
    }
  ) =>
    request<{ artifact: Artifact; version: ArtifactVersion }>(
      `/rooms/${encodeURIComponent(roomId)}/artifacts`,
      { method: "POST", body: JSON.stringify(data) }
    ),

  pinArtifact: (roomId: string, artifactId: string, pinned: boolean) =>
    request<{ artifact: Artifact }>(
      `/rooms/${encodeURIComponent(roomId)}/artifacts/${encodeURIComponent(artifactId)}/pin`,
      { method: "PATCH", body: JSON.stringify({ pinned }) }
    ),

  archiveArtifact: (roomId: string, artifactId: string, archived: boolean) =>
    request<{ artifact: Artifact }>(
      `/rooms/${encodeURIComponent(roomId)}/artifacts/${encodeURIComponent(artifactId)}/archive`,
      { method: "PATCH", body: JSON.stringify({ archived }) }
    ),

  deleteArtifact: (roomId: string, artifactId: string) =>
    request<{ ok: boolean }>(
      `/rooms/${encodeURIComponent(roomId)}/artifacts/${encodeURIComponent(artifactId)}`,
      { method: "DELETE" }
    ),

  // Room Context
  getRoomContext: (roomId: string) =>
    request<{ content: string; path: string }>(`/rooms/${encodeURIComponent(roomId)}/context`),

  appendToContext: (roomId: string, body: string, authorId?: string) =>
    request<{ content: string }>(
      `/rooms/${encodeURIComponent(roomId)}/context/append`,
      { method: "POST", body: JSON.stringify({ body, authorId }) }
    ),

  // Agent room state
  getAgentRoomState: (roomId: string, agentId: string) =>
    request<{ state: Record<string, unknown> }>(
      `/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}/state`
    ),

  // Announcements
  getActiveAnnouncements: () =>
    request<{ announcements: Announcement[] }>('/announcements/active'),
  dismissAnnouncement: (id: number) =>
    request<{ ok: boolean }>(`/announcements/${id}/dismiss`, { method: 'POST' }),
  listAllAnnouncements: () =>
    request<{ announcements: AnnouncementWithReads[] }>('/admin/announcements'),
  createAnnouncement: (input: { title: string; body?: string; severity?: 'info' | 'warn' | 'error'; expiresAt?: string | null }) =>
    request<{ ok: boolean; announcement: Announcement }>('/admin/announcements', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deactivateAnnouncement: (id: number) =>
    request<{ ok: boolean; announcement: Announcement }>(`/admin/announcements/${id}/deactivate`, { method: 'POST' }),

  // ── feedback / satisfaction (Phase 2) ──────────────────────────────────────
  recordMessageRating: (input: {
    messageId: string
    sessionId: string
    agentId: string
    rating: 'positive' | 'negative'
    reason?: string
  }) =>
    request<{ ok: true }>('/feedback/message', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getMessageRatings: (params: { sessionId?: string; agentId?: string }) => {
    const query = new URLSearchParams()
    if (params.sessionId) query.set('sessionId', params.sessionId)
    if (params.agentId) query.set('agentId', params.agentId)
    return request<{ ratings: MessageRating[] }>(`/feedback/messages?${query.toString()}`)
  },
}

// ── feedback / satisfaction (Phase 2) ────────────────────────────────────────

export interface MessageRating {
  id: number
  messageId: string
  sessionId: string
  agentId: string
  ownerId: number
  channel: 'dashboard' | 'telegram' | 'whatsapp' | 'discord' | 'reflection'
  source: 'button' | 'reaction' | 'nl_correction'
  rating: 'positive' | 'negative'
  reason: string | null
  raterExternalId: string
  createdAt: number
}

export interface Announcement {
  id: number
  title: string
  body: string
  severity: 'info' | 'warn' | 'error'
  createdBy: number
  createdAt: string
  expiresAt: string | null
  active: boolean
}
export interface AnnouncementWithReads extends Announcement { readCount: number }
