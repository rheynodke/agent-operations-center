export interface SkillTemplate {
  id: string
  name: string
  slug: string
  description: string
  agent: string         // which ADLC agent this belongs to
  agentEmoji: string
  category: string
  tags: string[]
  content: string       // full SKILL.md content
}

export interface ScriptTemplate {
  id: string
  name: string
  filename: string      // suggested filename with ext
  description: string
  category: string
  categoryEmoji: string
  tags: string[]
  content: string
}
