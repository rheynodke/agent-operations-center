// ─── Core Agent Types ───────────────────────────────────────────────────────

export type AgentStatus = "active" | "idle" | "paused" | "error" | "terminated"
export type AgentType = "gateway" | "code"
export type SessionType = "telegram" | "cron" | "hook"
export type RouteMode = "direct" | "pipeline"

export interface Agent {
  id: string
  name: string
  emoji: string
  description?: string
  status: AgentStatus
  type: AgentType
  model?: string
  skillTemplate?: string
  workspaceDir?: string
  totalCost?: number
  totalTokens?: number
  sessionCount?: number
  lastActive?: string | null
  createdAt?: string
  route?: GatewayRoute | null
  // SQLite profile fields
  color?: string | null
  hasAvatar?: boolean
  avatarPresetId?: string | null
}

// ─── Agent Channel Management Types ─────────────────────────────────────────

export interface AgentChannelTelegram {
  type: "telegram"
  accountId: string
  botToken: string
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled"
  streaming: "off" | "partial" | "full"
}

export interface AgentChannelWhatsApp {
  type: "whatsapp"
  accountId: string
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled"
  allowFrom: string[]
  pairingRequired?: boolean
}

export type AgentChannelInfo = AgentChannelTelegram | AgentChannelWhatsApp

export interface AgentChannelsResult {
  telegram: AgentChannelTelegram[]
  whatsapp: AgentChannelWhatsApp[]
}

// ─── Agent Provisioning Types ────────────────────────────────────────────────

export interface ChannelBinding {
  type: "telegram" | "whatsapp"
  botToken?: string        // Telegram only
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled"
  streaming?: "off" | "partial" | "full"  // Telegram only
  allowFrom?: string[]     // WhatsApp: list of phone numbers
}

export interface ProvisionAgentOpts {
  id: string
  name: string
  emoji: string
  model?: string
  theme?: string
  description?: string
  color?: string
  avatarPresetId?: string
  soulContent?: string
  channels: ChannelBinding[]
  tags?: string[]
}

export interface ProvisionResult {
  ok: boolean
  agentId: string
  agentName: string
  workspacePath: string
  agentStatePath: string
  bindings: { channel: string; accountId: string }[]
  whatsappPairingRequired: boolean
  filesCreated: string[]
  profileSaved: boolean
}

export interface AgentProfile {
  agent_id: string
  display_name?: string
  emoji?: string
  avatar_data?: string   // base64
  avatar_mime?: string
  avatar_preset_id?: string
  avatarPresetId?: string  // camelCase alias used in frontend
  color?: string
  description?: string
  tags?: string[]
  notes?: string
  provisioned_at?: string
  updated_at?: string
}

export interface Session {
  id: string
  agentId: string
  agentName: string
  agentEmoji: string
  type: SessionType
  status: "active" | "completed" | "failed" | "stopped"
  startTime: string
  endTime?: string | null
  duration?: number
  totalCost: number
  totalTokens: number
  model: string
  messageCount: number
  toolUseCount: number
  trigger?: string
  taskSummary?: string
  lastActivity?: string
  avatarPresetId?: string | null
}

export interface Message {
  role: "human" | "assistant" | "tool_use" | "tool_result" | "system"
  content: string
  timestamp?: string
  toolName?: string
  toolId?: string
  inputTokens?: number
  outputTokens?: number
  cost?: number
  model?: string
}

// ─── Task Board Types ────────────────────────────────────────────────────────

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done"
export type TaskPriority = "low" | "medium" | "high" | "urgent"

export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority?: TaskPriority
  agentId?: string
  agentName?: string
  agentEmoji?: string
  sessionId?: string
  createdAt: string
  updatedAt?: string
  completedAt?: string
  tags?: string[]
  cost?: number
}

// ─── Cron Types ──────────────────────────────────────────────────────────────

export interface CronJob {
  id: string
  name: string
  agentId: string
  agentName: string
  agentEmoji: string
  schedule: string
  lastRun?: string | null
  nextRun?: string | null
  status: "active" | "paused" | "error"
  runCount?: number
  lastDuration?: number
  lastCost?: number
}

// ─── Routing Types ───────────────────────────────────────────────────────────

export interface GatewayRoute {
  id: string
  agentId: string
  agentName: string
  agentEmoji: string
  channelType: "telegram"
  channelId: string
  channelUsername?: string
  mode: RouteMode
  status: "live" | "idle" | "error" | "none"
  connectedAt?: string
}

// ─── Alert Types ─────────────────────────────────────────────────────────────

export type AlertLevel = "info" | "warning" | "critical"

export interface Alert {
  id: string
  level: AlertLevel
  title: string
  message: string
  agentId?: string
  agentName?: string
  sessionId?: string
  createdAt: string
  acknowledged: boolean
}

// ─── Dashboard Overview Types ─────────────────────────────────────────────────

export interface DashboardOverview {
  totalAgents: number
  activeAgents: number
  idleAgents: number
  errorAgents: number
  activeSessions: number
  totalSessions: number
  totalCost: number
  totalTokens: number
  recentActivity: ActivityEvent[]
}

export interface ActivityEvent {
  id: string
  type: "session_start" | "session_end" | "task_update" | "agent_status" | "cron_trigger" | "error"
  agentId?: string
  agentName?: string
  agentEmoji?: string
  message: string
  timestamp: string
  severity?: "info" | "warning" | "error"
}

// ─── Live Feed Types ─────────────────────────────────────────────────────────

export interface LiveFeedEntry {
  id: string
  timestamp: string
  agentId: string
  agentName: string
  agentEmoji: string
  type: "message" | "tool_call" | "tool_result" | "system" | "error"
  content: string
  model?: string
  tokens?: number
  cost?: number
}

// ─── WebSocket Types ─────────────────────────────────────────────────────────

export type WsEventType =
  | "init"
  | "connected"
  | "agents:updated"
  | "sessions:updated"
  | "session:update"
  | "session:live-event"
  | "tasks:updated"
  | "cron:updated"
  | "cron:update"
  | "activity:event"
  | "live:entry"
  | "alert:new"
  | "alert:acknowledged"
  | "agent:status"
  | "agent:deployed"
  | "agent:decommissioned"
  | "opencode:event"
  | "subagent:update"
  | "progress:update"
  | "progress:step"
  | "gateway:connected"
  | "gateway:disconnected"
  | "chat:message"
  | "chat:tool"
  | "chat:event"
  | "chat:sessions-changed"
  | "chat:done"

export interface WsMessage {
  type: WsEventType
  payload: unknown
  timestamp?: string
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

// ─── Auth Types ───────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number
  username: string
  displayName: string
  role: string
}

export interface AuthStatus {
  needsSetup: boolean
  version: string
}

export interface AuthResponse {
  token: string
  user: AuthUser
}

// ─── Skill Types ──────────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string
  slug: string
  description: string
  source: string
  sourceLabel: string
  path: string
  enabled: boolean
  allowed: boolean
  emoji: string | null
  hasApiKey: boolean
  hasEnv: boolean
  editable: boolean
}

export type ToolGroup = 'runtime' | 'fs' | 'web' | 'memory' | 'messaging' | 'sessions' | 'ui' | 'automation'

export interface AgentTool {
  name: string
  group: ToolGroup
  label: string
  description: string
  enabled: boolean
  deniedLocally: boolean
  deniedGlobally: boolean
  profile: string
}

// ─── Global Skills Library Types ─────────────────────────────────────────────

export interface GlobalSkillAgentAssignment {
  agentId: string
  agentName: string
  agentEmoji: string
  avatarPresetId?: string | null
  enabled: boolean
  inAllowlist: boolean
  hasAllowlist: boolean
}

export interface GlobalSkillInfo {
  name: string
  slug: string
  description: string
  source: string
  sourceLabel: string
  path: string
  emoji: string | null
  hasApiKey: boolean
  hasEnv: boolean
  editable: boolean
  globallyEnabled: boolean
  agentAssignments: GlobalSkillAgentAssignment[]
}

export interface GlobalToolAgentAssignment {
  agentId: string
  agentName: string
  agentEmoji: string
  avatarPresetId?: string | null
  enabled: boolean
  deniedLocally: boolean
}

export interface GlobalToolInfo {
  name: string
  group: ToolGroup
  label: string
  description: string
  enabledCount: number
  totalAgents: number
  agentAssignments: GlobalToolAgentAssignment[]
}

// ─── Skill Script Types ──────────────────────────────────────────────────────

export interface SkillScript {
  name: string
  ext: string
  emoji: string
  size: number
  mtime: string
  executable: boolean
  allowed?: boolean
  content?: string
  execHint?: string
}
