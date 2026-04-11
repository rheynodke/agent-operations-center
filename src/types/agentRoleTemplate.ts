export type AdlcRoleId =
  | 'pm-analyst'
  | 'ux-designer'
  | 'em-architect'
  | 'swe'
  | 'qa-engineer'
  | 'doc-writer'
  | 'biz-analyst'

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
