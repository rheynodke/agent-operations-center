import type { AgentRoleTemplate } from '@/types'

import { PM_ANALYST_TEMPLATE } from './role-templates/pm-analyst'
import { UX_DESIGNER_TEMPLATE } from './role-templates/ux-designer'
import { EM_ARCHITECT_TEMPLATE } from './role-templates/em-architect'
import { SWE_TEMPLATE } from './role-templates/swe'
import { QA_ENGINEER_TEMPLATE } from './role-templates/qa-engineer'
import { DOC_WRITER_TEMPLATE } from './role-templates/doc-writer'
import { BIZ_ANALYST_TEMPLATE } from './role-templates/biz-analyst'

export const ADLC_ROLE_TEMPLATES: AgentRoleTemplate[] = [
  PM_ANALYST_TEMPLATE,
  UX_DESIGNER_TEMPLATE,
  EM_ARCHITECT_TEMPLATE,
  SWE_TEMPLATE,
  QA_ENGINEER_TEMPLATE,
  DOC_WRITER_TEMPLATE,
  BIZ_ANALYST_TEMPLATE,
]

export function getTemplateById(id: string): AgentRoleTemplate | undefined {
  return ADLC_ROLE_TEMPLATES.find(t => t.id === id)
}

export function getTemplateColor(adlcRole: string): string | undefined {
  return ADLC_ROLE_TEMPLATES.find(t => t.id === adlcRole)?.color
}

export function getTemplateLabel(adlcRole: string): string | undefined {
  return ADLC_ROLE_TEMPLATES.find(t => t.id === adlcRole)?.role
}
