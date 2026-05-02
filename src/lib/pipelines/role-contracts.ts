// ADLC role contracts for the pipeline editor.
//
// Each role declares what artifacts it consumes (inputs) and produces (outputs)
// plus a default prompt scaffold. When a user drags a role from the palette,
// we instantiate an agent node with these defaults filled in — so they don't
// need to manually wire handle keys or write a prompt from scratch.
//
// Kept in sync with ADLC agent numbering (see src/types/agentRoleTemplate.ts).

import type { PipelineHandle, PipelineNodeData, PipelineFailurePolicy } from "@/types"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"

export interface RoleContract {
  roleId: AdlcRoleId
  label: string
  emoji: string
  description: string
  inputs: PipelineHandle[]
  outputs: PipelineHandle[]
  /** Prompt scaffold — references upstream artifacts via {{artifact.*}}. User can still edit. */
  promptScaffold: string
  failurePolicy: PipelineFailurePolicy
  maxRetries?: number
}

// Convention: artifact keys stay stable across the pipeline so different roles
// can line up input ↔ upstream-output by name matching. e.g. PM outputs `prd`
// and any downstream role that needs it declares `prd` as an input.
export const ROLE_CONTRACTS: Record<AdlcRoleId, RoleContract> = {
  "pm-discovery": {
    roleId: "pm-discovery",
    label: "PM Analyst",
    emoji: "📊",
    description: "Turns a brief into a PRD",
    inputs: [{ key: "request", type: "text" }],
    outputs: [{ key: "prd", type: "text" }],
    promptScaffold:
      "Analyze the product request and produce a PRD document.\n\n" +
      "Input request:\n{{artifact.trigger.payload}}\n\n" +
      "Produce: problem statement, user stories, acceptance criteria, success metrics.",
    failurePolicy: "halt",
  },
  "ux-designer": {
    roleId: "ux-designer",
    label: "UX Designer",
    emoji: "🎨",
    description: "Turns a PRD into wireframes & flows",
    inputs: [{ key: "prd", type: "text" }],
    outputs: [{ key: "wireframes", type: "text" }],
    promptScaffold:
      "Design the UX for this PRD.\n\n" +
      "PRD:\n{{artifact.pm-discovery.prd}}\n\n" +
      "Produce: user flow diagrams (ASCII or mermaid), wireframe notes per screen.",
    failurePolicy: "halt",
  },
  "em-architect": {
    roleId: "em-architect",
    label: "EM Architect",
    emoji: "🏗",
    description: "Technical design from PRD + wireframes",
    inputs: [
      { key: "prd", type: "text" },
      { key: "wireframes", type: "text" },
    ],
    outputs: [{ key: "spec", type: "text" }],
    promptScaffold:
      "Produce a technical design document from the inputs below.\n\n" +
      "PRD:\n{{artifact.pm-discovery.prd}}\n\n" +
      "Wireframes:\n{{artifact.ux-designer.wireframes}}\n\n" +
      "Include: data model, API surface, component breakdown, rollout plan, risks.",
    failurePolicy: "halt",
  },
  "swe": {
    roleId: "swe",
    label: "SWE",
    emoji: "💻",
    description: "Implements the spec",
    inputs: [{ key: "spec", type: "text" }],
    outputs: [{ key: "pr_link", type: "text" }],
    promptScaffold:
      "Implement the following technical spec and open a pull request.\n\n" +
      "Spec:\n{{artifact.em-architect.spec}}\n\n" +
      "Return the PR URL as the `pr_link` artifact.",
    failurePolicy: "retry",
    maxRetries: 2,
  },
  "qa-engineer": {
    roleId: "qa-engineer",
    label: "QA Engineer",
    emoji: "🧪",
    description: "Tests the implementation",
    inputs: [{ key: "pr_link", type: "text" }],
    outputs: [{ key: "qa_report", type: "text" }],
    promptScaffold:
      "Run the test suite and manual checks against this PR and produce a QA report.\n\n" +
      "PR:\n{{artifact.swe.pr_link}}\n\n" +
      "Report: passed/failed tests, coverage, edge cases, regressions.",
    failurePolicy: "retry",
    maxRetries: 2,
  },
  "doc-writer": {
    roleId: "doc-writer",
    label: "Doc Writer",
    emoji: "📝",
    description: "Release notes + documentation",
    inputs: [
      { key: "prd", type: "text" },
      { key: "spec", type: "text" },
      { key: "pr_link", type: "text" },
      { key: "qa_report", type: "text" },
    ],
    outputs: [{ key: "release_md", type: "text" }],
    promptScaffold:
      "Write release notes for the feature based on the artifacts below.\n\n" +
      "PRD:\n{{artifact.pm-discovery.prd}}\n\n" +
      "Tech spec:\n{{artifact.em-architect.spec}}\n\n" +
      "PR:\n{{artifact.swe.pr_link}}\n\n" +
      "QA:\n{{artifact.qa-engineer.qa_report}}\n\n" +
      "Output a release note in markdown as `release_md`.",
    failurePolicy: "halt",
  },
  "biz-analyst": {
    roleId: "biz-analyst",
    label: "Biz Analyst",
    emoji: "📈",
    description: "Business analysis & requirements intake",
    inputs: [{ key: "request", type: "text" }],
    outputs: [{ key: "requirements", type: "text" }],
    promptScaffold:
      "Analyze the business request and produce structured requirements.\n\n" +
      "Request:\n{{artifact.trigger.payload}}\n\n" +
      "Output: stakeholders, business goals, constraints, success criteria.",
    failurePolicy: "halt",
  },
  "data-analyst": {
    roleId: "data-analyst",
    label: "Data Analyst",
    emoji: "📊",
    description: "Data-driven analysis & insights",
    inputs: [{ key: "question", type: "text" }],
    outputs: [{ key: "insights", type: "text" }],
    promptScaffold:
      "Answer the analysis question using available data sources.\n\n" +
      "Question:\n{{artifact.trigger.payload}}\n\n" +
      "Produce: findings, methodology, caveats, next steps.",
    failurePolicy: "halt",
  },
}

/**
 * Build a PipelineNodeData snapshot for an agent node from a role contract.
 * Caller supplies the resolved agentId (if known) — empty string if user still
 * needs to pick from multiple agents with the same role.
 */
export function nodeDataFromContract(
  contract: RoleContract,
  agentId: string = "",
): PipelineNodeData {
  return {
    label: contract.label,
    description: contract.description,
    agentId,
    promptTemplate: contract.promptScaffold,
    inputs: contract.inputs,
    outputs: contract.outputs,
    failurePolicy: contract.failurePolicy,
    maxRetries: contract.maxRetries,
    // Stash role id so UI can badge the node later.
    adlcRole: contract.roleId,
  }
}
