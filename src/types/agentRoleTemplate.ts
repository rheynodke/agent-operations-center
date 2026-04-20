export type AdlcRoleId =
  | 'pm-analyst'
  | 'ux-designer'
  | 'em-architect'
  | 'swe'
  | 'qa-engineer'
  | 'doc-writer'
  | 'biz-analyst'
  | 'data-analyst'

export interface AgentRoleTemplate {
  id: AdlcRoleId
  adlcAgentNumber: number
  role: string
  emoji: string
  color: string
  description: string
  modelRecommendation: string
  tags: string[]

  agentFiles: {
    identity: string
    soul: string
    tools: string
    agents?: string
  }

  skillSlugs: string[]
  skillContents: Record<string, string>
  scriptTemplates: Array<{
    filename: string
    content: string
  }>

  fsWorkspaceOnly: false
}

// ─── DB-backed variants (Phase 1+) ────────────────────────────────────────────
// Server-sourced record — `id` is widened to string (users may fork/create
// with arbitrary ids). `builtIn`/`origin`/timestamps carry DB state.

export type RoleTemplateOrigin = 'builtin' | 'user' | string

export interface RoleTemplateSummary {
  id: string
  adlcAgentNumber: number | null
  role: string
  emoji: string | null
  color: string | null
  description: string
  modelRecommendation: string | null
  tags: string[]
  origin: RoleTemplateOrigin
  builtIn: boolean
  skillCount: number
  scriptCount: number
  updatedAt: string | null
}

export type AgentFileAction = 'noop' | 'keep' | 'create' | 'same' | 'overwrite'

export interface ApplyPreviewFile {
  filename: string
  exists: boolean
  currentSize: number
  currentLines: number
  templateSize: number
  templateLines: number
  action: AgentFileAction
  current: string | null
  template: string | null
}

export interface ApplyPreview {
  agent: { id: string; name: string; workspace: string }
  template: { id: string; role: string; emoji: string | null; color: string | null }
  files: Record<'identity' | 'soul' | 'tools' | 'agents', ApplyPreviewFile>
  skills: {
    existing:   string[]   // already in allowlist
    toAdd:      string[]   // installed on disk, will be added to allowlist
    toInstall:  string[]   // bundled, will be written to ~/.openclaw/skills/{slug}/
    missing:    string[]   // neither bundled nor installed
  }
  scripts: {
    same:        string[]
    toInstall:   string[]
    conflicting: string[]
  }
}

export interface ApplyResult {
  ok: true
  agentId: string
  templateId: string
  applied: {
    files: string[]
    skillsInstalledGlobal: string[]
    skillsAddedToAllowlist: string[]
    scriptsWritten: string[]
    scriptsSkipped: string[]
  }
}

export type SkillRefStatus = 'bundled' | 'installed' | 'missing'

export interface SkillRefResolution {
  status: SkillRefStatus
  /** SKILL.md content; null when status is "missing". */
  content: string | null
  /** Filesystem path when status is "installed"; null otherwise. */
  path: string | null
}

export interface RoleTemplateRecord {
  id: string
  adlcAgentNumber: number | null
  role: string
  emoji: string | null
  color: string | null
  description: string
  modelRecommendation: string | null
  tags: string[]
  agentFiles: {
    identity?: string
    soul?: string
    tools?: string
    agents?: string
  }
  skillSlugs: string[]
  skillContents: Record<string, string>
  /**
   * Per-slug resolution: bundled content takes priority; otherwise the
   * backend looks up an installed skill at ~/.openclaw/skills/{slug}/
   * (or the agent skill search path) and returns that instead.
   * Populated by GET /api/role-templates/:id.
   */
  skillResolution?: Record<string, SkillRefResolution>
  scriptTemplates: Array<{ filename: string; content: string }>
  fsWorkspaceOnly: boolean
  origin: RoleTemplateOrigin
  builtIn: boolean
  createdAt: string | null
  updatedAt: string | null
}
