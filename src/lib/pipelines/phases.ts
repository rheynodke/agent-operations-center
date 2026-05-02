// ADLC phase classification.
//
// Missions move through three phases: Discover → Develop → Deliver. Each ADLC
// role belongs to one phase so we can group step cards in the Mission Canvas
// and render phase-level progress bars on the Missions Board without needing
// explicit phase metadata in the graph.

import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import type { PipelineRun, PipelineStep } from "@/types"
import type { PipelineRunDetail } from "@/types"

export type PhaseId = "discover" | "develop" | "deliver"

export const PHASES: Array<{
  id: PhaseId
  label: string
  emoji: string
  description: string
  color: string
}> = [
  {
    id: "discover",
    label: "Discover",
    emoji: "🔍",
    description: "Research, frame the problem, produce PRD + designs",
    color: "text-blue-400",
  },
  {
    id: "develop",
    label: "Develop",
    emoji: "⚒",
    description: "Design the solution, implement, test",
    color: "text-purple-400",
  },
  {
    id: "deliver",
    label: "Deliver",
    emoji: "🚀",
    description: "Write docs, release notes, ship",
    color: "text-emerald-400",
  },
]

const ROLE_TO_PHASE: Record<AdlcRoleId, PhaseId> = {
  "biz-analyst":  "discover",
  "pm-discovery": "discover",
  "pa-monitor":   "discover",
  "ux-designer":  "discover",
  "data-analyst": "discover",
  "em-architect": "develop",
  "swe":          "develop",
  "qa-engineer":  "develop",
  "doc-writer":   "deliver",
}

export function phaseForRole(roleId: string | null | undefined): PhaseId {
  if (roleId && roleId in ROLE_TO_PHASE) return ROLE_TO_PHASE[roleId as AdlcRoleId]
  // Generic agent → default to Develop (most flexible)
  return "develop"
}

/**
 * Group mission steps by phase. Trigger is pinned to Discover, Output pinned to
 * Deliver, Approval gates live with the step they gate.
 */
export interface PhaseBucket {
  phase: PhaseId
  steps: PipelineStep[]
  /** Role ids involved in this phase (for quick UI badges). */
  roleIds: string[]
}

export function groupStepsByPhase(detail: PipelineRunDetail): Record<PhaseId, PhaseBucket> {
  const buckets: Record<PhaseId, PhaseBucket> = {
    discover: { phase: "discover", steps: [], roleIds: [] },
    develop:  { phase: "develop",  steps: [], roleIds: [] },
    deliver:  { phase: "deliver",  steps: [], roleIds: [] },
  }
  for (const step of detail.steps) {
    if (step.nodeType === "human_approval") {
      // Place approval gate in the phase of the step it reviews. That step is
      // the previous agent step by graph order.
      const prevIdx = detail.steps.findIndex((s) => s.id === step.id) - 1
      const prev = prevIdx >= 0 ? detail.steps[prevIdx] : null
      const phase = phaseForRole(
        detail.stepDisplay.find((d) => d.stepId === prev?.id)?.roleId,
      )
      buckets[phase].steps.push(step)
      continue
    }
    if (step.nodeType === "agent") {
      const roleId = detail.stepDisplay.find((d) => d.stepId === step.id)?.roleId
      const phase = phaseForRole(roleId)
      buckets[phase].steps.push(step)
      if (roleId && !buckets[phase].roleIds.includes(roleId)) {
        buckets[phase].roleIds.push(roleId)
      }
    }
  }
  return buckets
}

/** What's the overall phase progress for one mission? Used by board cards. */
export interface PhaseProgress {
  phase: PhaseId
  total: number
  done: number
  active: boolean
  failed: boolean
}

export function computePhaseProgress(detail: PipelineRunDetail): PhaseProgress[] {
  const buckets = groupStepsByPhase(detail)
  return PHASES.map(({ id }) => {
    const bucket = buckets[id]
    const total = bucket.steps.length
    const done = bucket.steps.filter((s) => s.status === "done").length
    const active = bucket.steps.some((s) => ["queued", "running"].includes(s.status))
    const failed = bucket.steps.some((s) => s.status === "failed")
    return { phase: id, total, done, active, failed }
  })
}

/**
 * Lightweight board-card progress from a PipelineRun summary (no step detail
 * fetched). Uses the flat `progress` numbers — good enough for Missions Board
 * where we don't want an extra call per card.
 */
export function approxBoardProgress(run: PipelineRun): { done: number; total: number } {
  const total = run.progress?.total || 0
  const done = run.progress?.done || 0
  return { done, total }
}

/** Which phase is the mission currently "in"? First incomplete phase wins. */
export function currentPhase(progress: PhaseProgress[]): PhaseId {
  for (const p of progress) {
    if (p.done < p.total) return p.phase
  }
  return progress[progress.length - 1]?.phase || "deliver"
}
