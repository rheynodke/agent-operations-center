export type { SkillTemplate, ScriptTemplate } from './types'
export { SKILL_CATEGORIES, SCRIPT_CATEGORIES } from './categories'

import { SUPERPOWERS_TEMPLATES } from './skills/superpowers'
import { PM_ANALYST_TEMPLATES } from './skills/pm-analyst'
import { UX_DESIGNER_TEMPLATES } from './skills/ux-designer'
import { EM_ARCHITECTURE_TEMPLATES } from './skills/em-architecture'
import { QA_ENGINEER_TEMPLATES } from './skills/qa-engineer'
import { DOC_WRITER_TEMPLATES } from './skills/doc-writer'
import { AI_OPS_TEMPLATES } from './skills/ai-ops'
import { ODOO_SKILL_TEMPLATES } from './skills/odoo-skills'
import { DATA_ANALYST_TEMPLATES } from './skills/data-analyst'

import { DATA_INTEGRATION_SCRIPTS } from './scripts/data-integration'
import { NOTIFICATIONS_SCRIPTS } from './scripts/notifications'
import { COST_QUALITY_SCRIPTS } from './scripts/cost-quality'
import { TASK_MANAGEMENT_SCRIPTS } from './scripts/task-management'

export { SUPERPOWERS_TEMPLATES }

export const SKILL_TEMPLATES = [
  ...PM_ANALYST_TEMPLATES,
  ...UX_DESIGNER_TEMPLATES,
  ...EM_ARCHITECTURE_TEMPLATES,
  ...QA_ENGINEER_TEMPLATES,
  ...DOC_WRITER_TEMPLATES,
  ...AI_OPS_TEMPLATES,
  ...ODOO_SKILL_TEMPLATES,
  ...DATA_ANALYST_TEMPLATES,
]

export const SCRIPT_TEMPLATES = [
  ...DATA_INTEGRATION_SCRIPTS,
  ...NOTIFICATIONS_SCRIPTS,
  ...COST_QUALITY_SCRIPTS,
  ...TASK_MANAGEMENT_SCRIPTS,
]
