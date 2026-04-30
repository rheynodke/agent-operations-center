export type {
  AgentRoleTemplate, AdlcRoleId,
  RoleTemplateSummary, RoleTemplateRecord, RoleTemplateOrigin,
  SkillRefStatus, SkillRefResolution,
  AgentFileAction, ApplyPreview, ApplyPreviewFile, ApplyResult,
} from './agentRoleTemplate'

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
  // Security / sandbox settings (from openclaw.json agent entry)
  fsWorkspaceOnly?: boolean
  // ADLC role (from openclaw.json adlcRole field + SQLite profile)
  role?: string | null
  // Vibe/theme from IDENTITY.md
  vibe?: string | null
  // Active channel bindings (populated by /api/agents list)
  channels?: string[]
  // Ownership: user id that provisioned this agent (for role-based access)
  provisionedBy?: number | null
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

export interface AgentChannelDiscord {
  type: "discord"
  accountId: string
  hasToken: boolean
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled"
  groupPolicy: "open" | "allowlist" | "disabled"
}

export type AgentChannelInfo = AgentChannelTelegram | AgentChannelWhatsApp | AgentChannelDiscord

export interface AgentChannelsResult {
  telegram: AgentChannelTelegram[]
  whatsapp: AgentChannelWhatsApp[]
  discord: AgentChannelDiscord[]
}

export interface AllowFromBinding {
  channel: "telegram" | "whatsapp" | "discord"
  accountId: string
  entries: string[]
}

export interface AllowFromResult {
  bindings: AllowFromBinding[]
}

// ─── Discord Guild Allowlist ─────────────────────────────────────────────────

export interface DiscordGuildEntry {
  guildId: string
  label: string
  requireMention: boolean
  users: string[]
}

export interface DiscordGuildsResult {
  accountId: string
  groupPolicy: "allowlist" | "open" | "disabled"
  guilds: DiscordGuildEntry[]
}

// ─── DM Pairing Types ──────────────────────────────────────────────────────

export interface PairingRequest {
  id: string
  code: string
  createdAt: string
  lastSeenAt: string
  accountId: string
  meta: Record<string, string>
}

export interface PairingRequestsByChannel {
  telegram: PairingRequest[]
  whatsapp: PairingRequest[]
  discord: PairingRequest[]
}

// ─── Agent Provisioning Types ────────────────────────────────────────────────

export interface ChannelBinding {
  type: "telegram" | "whatsapp" | "discord"
  botToken?: string        // Telegram and Discord
  envVarName?: string      // Telegram env var fallback
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled"
  groupPolicy?: "open" | "allowlist" | "disabled"  // Discord only
  streaming?: "off" | "partial" | "full"  // Telegram only
  allowFrom?: string[]     // Telegram: user/chat IDs; WhatsApp: phone numbers (used when dmPolicy = "allowlist")
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
  fsWorkspaceOnly?: boolean
  // ADLC role template fields
  adlcRole?: string
  agentFiles?: { identity?: string; soul?: string; tools?: string; agents?: string }
  skillSlugs?: string[]
  skillContents?: Record<string, string>
  scriptTemplates?: Array<{ filename: string; content: string }>
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
  role?: string | null
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

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked"
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
  inputTokens?: number
  outputTokens?: number
  projectId?: string
  externalId?: string
  externalSource?: string
  requestFrom?: string
  analysis?: TaskAnalysis | null
  attachments?: TaskAttachment[]
}

// ─── Metrics Dashboard ───────────────────────────────────────────────────────

export type MetricsRange = '7d' | '30d' | '90d'

export interface MetricsKpi {
  current: number
  previous: number
  /** Percentage change vs previous window. null when previous is 0 (no baseline). */
  deltaPct: number | null
}

export interface MetricsStatusDistribution {
  backlog: number
  todo: number
  in_progress: number
  in_review: number
  blocked: number
  done: number
}

export interface MetricsSummary {
  range: MetricsRange
  since: string
  until: string
  projectId: string | null
  kpis: {
    completed: MetricsKpi
    cost: MetricsKpi
    activeAgents: MetricsKpi
    blocked: MetricsKpi
  }
  statusDistribution: MetricsStatusDistribution
}

export interface MetricsThroughputBucket {
  /** ISO date (UTC), YYYY-MM-DD. */
  date: string
  count: number
  /** Per-project counts. Keys are project ids present on that day. */
  byProject: Record<string, number>
}

export interface MetricsThroughput {
  range: MetricsRange
  since: string
  until: string
  projectId: string | null
  buckets: MetricsThroughputBucket[]
  projects: Array<{ id: string; name: string; color: string }>
}

export interface AgentMetric {
  agentId: string
  agentName: string
  agentEmoji?: string | null
  completed: number
  blocked: number
  avgCost: number | null
  avgDurationMs: number | null
  /** 0..1 or null when no task reached in_review */
  changeRequestRate: number | null
  /** 0..1 or null when no done/blocked signal */
  successRate: number | null
  reviewReached: number
  reviewReturns: number
}

export interface MetricsAgents {
  range: MetricsRange
  since: string
  until: string
  projectId: string | null
  agents: AgentMetric[]
}

export interface LifecycleTransition {
  from: 'backlog' | 'todo' | 'in_progress' | 'in_review'
  to:   'todo' | 'in_progress' | 'in_review' | 'done'
  avgMs: number | null
  count: number
}

export interface MetricsLifecycle {
  range: MetricsRange
  since: string
  until: string
  projectId: string | null
  agentId?: string | null
  transitions: LifecycleTransition[]
}

/** Slim task shape returned by /api/metrics/agents/:id/tasks — not the full Task row. */
export interface AgentRecentTask {
  id: string
  title: string
  status: string
  priority: string | null
  cost: number | null
  tags: string[]
  projectId: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
  durationMs: number | null
}

export interface MetricsAgentTasks {
  agent: { id: string; name?: string; emoji?: string | null; workspace?: string } | null
  tasks: AgentRecentTask[]
}

/** Free-form comment on a task (user ↔ agent discussion thread). */
export interface TaskComment {
  id: string
  taskId: string
  authorType: 'user' | 'agent'
  authorId: string
  authorName?: string
  body: string
  createdAt: string
  editedAt?: string
  deletedAt?: string
}

/** Agent-produced output file living under {agentWorkspace}/outputs/{taskId}/. */
export interface TaskOutput {
  filename: string
  size: number
  mtime: string
  ctime?: string
  mimeType: string
  ext: string
  isText?: boolean
}

export interface TaskAttachment {
  /** Stable per-attachment id (uuid for uploads; hash/url-based for sheet links). */
  id: string
  /** Remote URL (for source=sheet) OR server-served URL (for source=upload). */
  url: string
  filename: string
  mimeType?: string
  size?: number
  source: 'sheet' | 'upload'
  /** Local storage path under data/attachments (only for source=upload). */
  storagePath?: string
  createdAt?: string
}

export interface TaskAnalysis {
  intent: string
  dataSources: string[]
  executionPlan: string[]
  estimatedOutput: string
  potentialIssues: string[]
  readiness: {
    ready: boolean
    missingSkills: string[]
    missingTools: string[]
    availableSkills: string[]
  }
  analyzedAt: string
}

export interface TaskActivity {
  id: string
  taskId: string
  type: 'created' | 'status_change' | 'assignment' | 'comment' | 'cost_update'
  fromValue?: string
  toValue?: string
  actor: string   // "user" | agentId
  note?: string
  createdAt: string
}

// ─── Cron Types ──────────────────────────────────────────────────────────────

export type CronJobKind = "cron" | "at" | "every"
export type CronSessionType = "main" | "isolated" | "current" | "custom"
export type CronDeliveryMode = "announce" | "webhook" | "none"
export type CronThinking = "off" | "standard" | "high"

export interface CronJob {
  id: string
  name: string
  agentId?: string
  agentName?: string
  agentEmoji?: string
  // schedule
  kind?: CronJobKind
  schedule: string
  tz?: string
  // execution
  session?: CronSessionType
  customSessionId?: string
  message?: string
  model?: string
  thinking?: CronThinking
  lightContext?: boolean
  systemEvent?: string
  wakeMode?: "now" | "next-heartbeat"
  deleteAfterRun?: boolean
  timeoutSeconds?: number
  // delivery
  deliveryMode?: CronDeliveryMode
  deliveryChannel?: string
  deliveryTo?: string
  deliveryWebhook?: string
  // runtime
  status: "active" | "paused" | "error"
  enabled?: boolean
  runCount?: number
  lastRun?: string | null
  nextRun?: string | null
  lastDuration?: number
  lastCost?: number
  lastDeliveryStatus?: string
  errorMessage?: string
  createdAt?: string
}

export interface CronRun {
  runId: string
  jobId: string
  status: "running" | "succeeded" | "failed" | "cancelled"
  startedAt: string
  endedAt?: string
  duration?: number
  cost?: number
  error?: string
  summary?: string
}

// ─── Routing Types ───────────────────────────────────────────────────────────

export interface GatewayRoute {
  id: string
  agentId: string
  agentName: string
  agentEmoji: string
  avatarPresetId?: string | null
  color?: string | null
  channelType: "telegram" | "discord" | "whatsapp" | string
  accountId: string | null
  accountLabel: string | null
  dmPolicy: string | null
  groupPolicy: string | null
  streaming?: string | null
}

export interface ChannelsConfig {
  telegram: {
    enabled: boolean
    accounts: { accountId: string; hasToken: boolean; dmPolicy: string | null; streaming: string | null; groupPolicy: string | null }[]
  } | null
  discord: {
    enabled: boolean
    accounts: { accountId: string; hasToken: boolean; dmPolicy: string | null; groupPolicy: string | null }[]
  } | null
  whatsapp: {
    accounts: { accountId: string; dmPolicy: string | null }[]
  } | null
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
  | "gateway:event"
  | "gateway:log"
  | "chat:message"
  | "chat:tool"
  | "chat:event"
  | "chat:sessions-changed"
  | "chat:done"
  | "skills:updated"

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
  canUseClaudeTerminal?: boolean
}

export interface AuthStatus {
  needsSetup: boolean
  version: string
}

export interface AuthResponse {
  token: string
  user: AuthUser
}

export interface Invitation {
  id: number
  token: string
  createdBy: number
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  defaultRole: string
  note: string | null
  useCount: number
  expired: boolean
  active: boolean
}

export interface ManagedUser {
  id: number
  username: string
  display_name: string
  role: string
  can_use_claude_terminal?: number
  created_at: string
  last_login: string | null
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

// ─── Workspace Script Types ──────────────────────────────────────────────────

export interface WorkspaceScript {
  name: string
  displayName?: string
  description?: string
  ext: string
  emoji: string
  lang: string
  size: number
  mtime: string
  executable: boolean
  path: string
  relPath: string
  execHint: string
  content?: string
  isNew?: boolean
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

// ─── ClawHub Skill Install ────────────────────────────────────────────────────

export interface ClawHubSecurityIssue {
  level: "danger" | "warn" | "info"
  label: string
  file: string
  count?: number
}

export interface ClawHubSecurityResult {
  rating: "clean" | "info" | "warn" | "danger"
  summary: string
  issues: ClawHubSecurityIssue[]
  scannedFiles: string[]
}

export interface ClawHubSkillPreview {
  slug: string
  name: string
  description: string
  version: string | null
  author: string | null
  license: string | null
  emoji: string | null
  skillMdContent: string
  security: ClawHubSecurityResult
  fileList: string[]
  _bufferB64: string
}

export interface ClawHubInstallTarget {
  value: "global" | "personal" | "project" | "workspace" | "agent"
  label: string
  path: string | null
}

// ─── SkillsMP ─────────────────────────────────────────────────────────────────

export interface SkillsmpSkill {
  id: string
  slug: string
  name: string
  description: string
  author: string | null
  license: string | null
  stars: number
  version: string | null
  githubUrl: string | null
  repoPath: string | null
  skillMdUrl: string | null
  tags: string[]
}

export interface SkillsmpKeyStatus {
  configured: boolean
  preview: string | null
}

// ─── File Versioning ──────────────────────────────────────────────────────────

export interface FileVersion {
  id: number
  scope_key: string
  content_size: number
  checksum: string
  op: "create" | "edit" | "delete"
  saved_by: string | null
  saved_at: string
  label: string | null
}

export interface FileVersionDetail extends FileVersion {
  content: string
}

// ── Projects ──────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  color: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface IntegrationColumnMapping {
  external_id: string
  title: string
  description?: string
  priority?: string
  status?: string
  tags?: string
  request_from?: string
  /** Column containing a single attachment URL per cell. URL → TaskAttachment with source='sheet'. */
  attachments?: string
}

export interface IntegrationConfig {
  spreadsheetId: string
  sheetName: string
  mapping: IntegrationColumnMapping
  /** Sheet data row to start syncing from (1-based, excludes header row 1). Default: 2 (all rows). */
  syncFromRow?: number
  /** Max number of rows to sync per run. Default: 500. */
  syncLimit?: number
}

// ─── Connections (Third-party Data Sources) ──────────────────────────────────

export type ConnectionType = 'bigquery' | 'postgres' | 'ssh' | 'website' | 'github' | 'odoocli' | 'google_workspace' | 'mcp' | 'composio'

export interface ComposioConnectedAccount {
  id: string
  toolkit: string
  toolkitName?: string
  status: 'INITIALIZING' | 'INITIATED' | 'ACTIVE' | 'FAILED' | 'EXPIRED' | 'INACTIVE'
  userId?: string
  createdAt?: string
  authConfigId?: string
}

export interface ComposioMetadata {
  userId: string
  toolkits: string[]            // allowlist set at create time
  sessionId?: string
  mcpUrl?: string
  mcpType?: 'http'
  sessionCreatedAt?: string
}

export type McpTransport = 'stdio' | 'http' | 'sse'

export type McpPreset =
  | 'filesystem' | 'github' | 'slack' | 'postgres' | 'brave-search' | 'puppeteer' | 'memory' | 'mixpanel'  // stdio
  | 'context7-http' | 'composio-mcp' | 'http-custom' | 'sse-custom'                                          // remote
  | 'custom'

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpOAuthState = 'pending' | 'connected' | 'expired' | 'disconnected'

export interface McpOAuthMetadata {
  enabled: true
  authState: McpOAuthState
  serverUrl?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  registrationEndpoint?: string
  revocationEndpoint?: string
  clientId?: string
  scopes?: string[]
  requestedScopes?: string[]
  scopesSupported?: string[]
  connectedAt?: number
  lastRefreshAt?: number
}

export interface McpMetadata {
  transport: McpTransport
  preset: McpPreset
  // stdio fields
  command?: string
  args?: string[]
  env?: Record<string, string>      // non-sensitive env vars
  envKeys?: string[]                // names of secret env keys stored in credentials JSON
  // http/sse fields
  url?: string
  headers?: Record<string, string>   // non-sensitive headers
  headerKeys?: string[]              // names of secret headers stored in credentials JSON
  // OAuth (for http/sse servers that require authorization)
  oauth?: McpOAuthMetadata
  // shared
  tools?: McpTool[]                  // populated by test/discovery
  toolsDiscoveredAt?: string
  description?: string
}

export type GoogleWorkspaceAuthState = 'pending' | 'connected' | 'expired' | 'disconnected'

export interface GoogleWorkspaceMetadata {
  linkedEmail: string | null
  scopes: string[]
  preset: 'prd-writer' | 'sheets-analyst' | 'full-workspace' | 'custom'
  customScopes?: string[]
  authState: GoogleWorkspaceAuthState
  connectedAt?: number
  lastRefreshAt?: number
  lastHealthCheckAt?: number
}

export interface ConnectionFeatureFlags {
  googleWorkspace: boolean
}

export interface ConnectionMetadata {
  // BigQuery
  projectId?: string
  datasets?: string[]
  // PostgreSQL
  host?: string
  port?: number
  database?: string
  username?: string
  sslMode?: string
  // SSH/VPS
  sshHost?: string
  sshPort?: number
  sshUser?: string
  // Website
  url?: string
  loginUrl?: string
  authType?: 'basic' | 'api_key' | 'token' | 'cookie' | 'none'
  authUsername?: string
  description?: string
  // GitHub
  githubMode?: 'remote' | 'local'
  repoOwner?: string
  repoName?: string
  branch?: string
  localPath?: string
  // OdooCLI
  odooUrl?: string
  odooDb?: string
  odooUsername?: string
  odooAuthType?: 'password' | 'api_key'
  // MCP (also carries fields from McpMetadata when type === 'mcp')
  transport?: McpTransport
  preset?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  envKeys?: string[]
  url?: string
  headers?: Record<string, string>
  headerKeys?: string[]
  oauth?: McpOAuthMetadata
  tools?: McpTool[]
  toolsDiscoveredAt?: string
  // Composio
  composio?: ComposioMetadata
}

export interface Connection {
  id: string
  name: string
  type: ConnectionType
  hasCredentials: boolean
  metadata: ConnectionMetadata
  enabled: boolean
  createdBy?: number | null
  lastTestedAt?: string | null
  lastTestOk?: boolean | null
  createdAt: string
  updatedAt: string
}

export interface ProjectIntegration {
  id: string
  projectId: string
  type: 'google_sheets'
  hasCredentials: boolean
  config: IntegrationConfig
  syncIntervalMs?: number
  enabled: boolean
  lastSyncedAt?: string
  lastSyncError?: string
  createdAt: string
}

// ─── Agent Capabilities (composite view for workflow editor) ────────────────

export interface AgentCapabilities {
  agentId: string
  displayName: string
  role?: string | null
  emoji?: string | null
  skills: Array<{
    name: string
    description?: string | null
    enabled: boolean
    source: string
  }>
  tools: Array<{
    name: string
    description?: string | null
    category: string
  }>
  customTools: {
    agent: Array<{ name: string; description?: string | null; enabled: boolean }>
    shared: Array<{ name: string; description?: string | null; enabled: boolean }>
  }
  connections: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
  }>
}

// ─── Pipelines & Workflows ────────────────────────────────────────────────────

export type PipelineNodeType = 'trigger' | 'agent' | 'condition' | 'human_approval' | 'output'
export type PipelineHandleType = 'text' | 'json' | 'file' | 'approval'
export type PipelineTriggerType = 'manual' | 'webhook' | 'cron' | 'task_created'
export type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
export type PipelineStepStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'cancelled'
export type PipelineFailurePolicy = 'halt' | 'continue' | 'retry'

export interface PipelineHandle {
  key: string
  type: PipelineHandleType
  label?: string
  schema?: unknown
}

export interface PipelineNodeData {
  label?: string
  description?: string
  nodeType?: PipelineNodeType
  agentId?: string
  promptTemplate?: string
  inputs?: PipelineHandle[]
  outputs?: PipelineHandle[]
  failurePolicy?: PipelineFailurePolicy
  maxRetries?: number
  triggerKind?: PipelineTriggerType
  triggerConfig?: Record<string, unknown>
  conditionExpression?: unknown
  approverUserIds?: number[]
  approvalMessage?: string
  approvalTimeoutMs?: number
  [key: string]: unknown
}

export interface PipelineNode {
  id: string
  type: PipelineNodeType
  position: { x: number; y: number }
  data: PipelineNodeData
}

export interface PipelineEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  data?: Record<string, unknown>
}

export interface PipelineRepoConfig {
  /** Absolute path to local git checkout. Required for worktrees. */
  path?: string
  /** Optional GitHub/GitLab URL — display only. */
  url?: string
  /** Branch to worktree from. Empty = current HEAD of repo. */
  baseBranch?: string
  /** If true, worktree gets a new branch named `mission/{MIS-XXX}` (default). */
  autoBranch?: boolean
}

export interface PipelineGraphMetadata {
  repo?: PipelineRepoConfig
}

export interface PipelineGraph {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  viewport?: { x: number; y: number; zoom: number }
  metadata?: PipelineGraphMetadata
}

export interface Pipeline {
  id: string
  name: string
  description?: string | null
  graph: PipelineGraph
  createdBy?: number | null
  createdAt: string
  updatedAt: string
}

export interface PipelineValidationIssue {
  node_id?: string
  edge_id?: string
  code: string
  message: string
}

export interface PipelineValidationResult {
  valid: boolean
  errors: PipelineValidationIssue[]
  warnings: PipelineValidationIssue[]
}

export interface PipelineRun {
  id: string
  /** Human-friendly identifier like "ADLC-123" — generated per-template sequential */
  displayId?: string
  pipelineId: string
  pipelineName?: string
  title?: string
  description?: string
  status: PipelineRunStatus
  triggerType: PipelineTriggerType
  triggeredBy?: number | null
  triggeredByName?: string
  concurrencyKey?: string | null
  startedAt: string
  endedAt?: string | null
  error?: string | null
  /** Summary counts (totalSteps, doneSteps, approvalWaiting, etc.) */
  progress?: {
    total: number
    done: number
    failed: number
    /** Step id currently awaiting approval, if any */
    awaitingApprovalStepId?: string
    /** Step id currently running, if any */
    runningStepId?: string
  }
  /** Git worktree provisioned for this mission (if playbook has repo config). */
  worktree?: {
    path: string
    branch: string
    baseBranch: string
    repoPath: string
    repoUrl?: string
  }
}

/** Run with full step + artifact detail (used by Run Detail page). */
export interface PipelineRunDetail extends PipelineRun {
  steps: PipelineStep[]
  artifacts: PipelineArtifact[]
  /** Per-step display metadata derived from the graph snapshot. */
  stepDisplay: Array<{
    stepId: string
    nodeId: string
    label: string
    roleId?: string
    emoji?: string
    agentName?: string
    approvalMessage?: string
  }>
}

export interface PipelineStep {
  id: string
  runId: string
  nodeId: string
  nodeType: PipelineNodeType
  agentId?: string | null
  sessionKey?: string | null
  status: PipelineStepStatus
  attemptCount: number
  queuedAt?: string | null
  dispatchedAt?: string | null
  startedAt?: string | null
  endedAt?: string | null
  error?: string | null
}

export interface PipelineArtifact {
  id: string
  runId: string
  stepId: string
  key: string
  contentRef: string
  mimeType: string
  sizeBytes: number
  checksum?: string
  createdAt: string
}

