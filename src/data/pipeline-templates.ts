// Workflow templates — defined as stepper states, converted to PipelineGraph
// at point of use. This guarantees every template round-trips cleanly through
// the Stepper editor (the primary authoring UX).
//
// For custom non-linear DAGs, users can fork a template and switch to Graph
// mode in the editor.

import type { PipelineGraph } from "@/types"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import type { StepperState } from "@/lib/pipelines/stepper"
import { newStep, stepperToGraph } from "@/lib/pipelines/stepper"

export interface PipelineTemplate {
  id: string
  name: string
  description: string
  emoji: string
  /** Stepper state — canonical representation. */
  stepper: StepperState
  /** Cached graph derived from stepper (built lazily). */
  graph: PipelineGraph
}

function buildStepper(roles: AdlcRoleId[], approvalsOn: boolean[] = []): StepperState {
  return {
    trigger: { kind: "manual", label: "Manual Start" },
    steps: roles.map((r, i) => {
      const step = newStep(r)
      // Per-step approval override: if array provided and value false, turn off
      if (approvalsOn.length > 0) step.requireApprovalAfter = approvalsOn[i] ?? true
      return step
    }),
  }
}

function makeTemplate(
  id: string,
  name: string,
  description: string,
  emoji: string,
  stepper: StepperState,
): PipelineTemplate {
  return { id, name, description, emoji, stepper, graph: stepperToGraph(stepper) }
}

// ─── Templates ───────────────────────────────────────────────────────────────

const blankPipeline: PipelineTemplate = makeTemplate(
  "blank",
  "Blank",
  "Empty canvas — add steps as you go.",
  "⚪",
  { trigger: { kind: "manual", label: "Manual Start" }, steps: [] },
)

// ADLC Full — full 6-role chain with phase-level approval gates.
// Approvals fire at end of Discover (after UX) and end of Develop (after QA).
const adlcFull = makeTemplate(
  "adlc-full",
  "Full ADLC",
  "Complete Discover → Develop → Deliver. Approval between phases, not between every step.",
  "➡️",
  buildStepper(
    ["pm-discovery", "ux-designer", "em-architect", "swe", "qa-engineer", "doc-writer"],
    //  PM     UX(end disc)   EM     SWE   QA(end dev)  Doc
    [  false, true,           false, false, true,       false],
  ),
)

// ADLC Lean — same agents, no approvals. Autonomous.
const adlcLean = makeTemplate(
  "adlc-lean",
  "ADLC Lean",
  "Same chain but fully autonomous — no approval gates. Use when you trust the flow.",
  "⚡",
  buildStepper(
    ["pm-discovery", "ux-designer", "em-architect", "swe", "qa-engineer", "doc-writer"],
    [false, false, false, false, false, false],
  ),
)

// Build & Ship — for enhancement work where PRD + design already exist.
const buildShip = makeTemplate(
  "build-ship",
  "Build & Ship",
  "Skip Discover (you already have PRD). EM spec → SWE → QA → Doc.",
  "⚒",
  buildStepper(
    ["em-architect", "swe", "qa-engineer", "doc-writer"],
    //  EM    SWE   QA(end dev)  Doc
    [  false, false, true,       false],
  ),
)

// Bug Triage — quick fix path.
const bugTriage = makeTemplate(
  "bug-triage",
  "Bug Triage",
  "Fast path for bug reports: intake → PM → SWE → QA.",
  "🐛",
  buildStepper(
    ["biz-analyst", "pm-discovery", "swe", "qa-engineer"],
    [false, true, false, false],
  ),
)

// Research Only — end in Discover, no build.
const researchOnly = makeTemplate(
  "research-only",
  "Research Only",
  "Stop after Discover — output is a validated PRD + designs. No implementation.",
  "🧪",
  buildStepper(
    ["pm-discovery", "ux-designer"],
    [false, false],
  ),
)

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  blankPipeline,
  adlcFull,
  adlcLean,
  buildShip,
  bugTriage,
  researchOnly,
]

export function getPipelineTemplate(id: string): PipelineTemplate | undefined {
  return PIPELINE_TEMPLATES.find((t) => t.id === id)
}
