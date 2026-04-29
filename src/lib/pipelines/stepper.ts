// Stepper state <-> PipelineGraph conversion.
//
// The stepper is the primary authoring surface: a linear list of agent steps
// with optional approval gates between them. The backend executor still works
// on PipelineGraph; this module is the bridge.
//
// A graph is "stepper-compatible" iff it's a linear chain of agent+approval
// nodes between one trigger and one output. Non-linear graphs (multi-branch
// DAG, fan-in/fan-out) can't round-trip via stepper — user must keep editing
// in Graph mode.

import type {
  PipelineGraph,
  PipelineNode,
  PipelineEdge,
  PipelineNodeData,
  PipelineTriggerType,
  PipelineFailurePolicy,
} from "@/types"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import { ROLE_CONTRACTS, nodeDataFromContract } from "./role-contracts"

export interface StepperStep {
  /** Stable id, kept across edits so graph reconciliation is lossless. */
  id: string
  /** If set, step is an ADLC role with a known contract. */
  roleId?: AdlcRoleId
  /** Display name (falls back to role label, else "Agent Step"). */
  label: string
  /** Selected agent to dispatch to. Empty = unresolved. */
  agentId: string
  /** User-editable prompt (seeded from role contract). */
  promptTemplate: string
  failurePolicy: PipelineFailurePolicy
  maxRetries?: number
  /** If true, inject a Human Approval gate AFTER this step's output. */
  requireApprovalAfter: boolean
  approvalMessage?: string
}

export interface StepperState {
  trigger: {
    kind: PipelineTriggerType
    label?: string
  }
  steps: StepperStep[]
}

export const EMPTY_STEPPER: StepperState = {
  trigger: { kind: "manual", label: "Manual Start" },
  steps: [],
}

// ─── ID helpers ─────────────────────────────────────────────────────────────
function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export function newStep(roleId?: AdlcRoleId): StepperStep {
  if (roleId && ROLE_CONTRACTS[roleId]) {
    const c = ROLE_CONTRACTS[roleId]
    return {
      id: uid("step"),
      roleId,
      label: c.label,
      agentId: "",
      promptTemplate: c.promptScaffold,
      failurePolicy: c.failurePolicy,
      maxRetries: c.maxRetries,
      requireApprovalAfter: true, // per user decision: approval default ON
      approvalMessage: `Please review the output of ${c.label} before continuing.`,
    }
  }
  return {
    id: uid("step"),
    label: "Agent Step",
    agentId: "",
    promptTemplate: "",
    failurePolicy: "halt",
    requireApprovalAfter: true,
    approvalMessage: "Please review the output before continuing.",
  }
}

// ─── Stepper → Graph ────────────────────────────────────────────────────────
/**
 * Build a PipelineGraph from stepper state. Nodes get stable ids so repeated
 * serialization doesn't churn. Approval gates sit between an agent and its
 * downstream consumer when `requireApprovalAfter` is true.
 */
export function stepperToGraph(state: StepperState): PipelineGraph {
  const nodes: PipelineNode[] = []
  const edges: PipelineEdge[] = []

  // Role-id → node-id map. Prompt scaffolds reference upstream artifacts by
  // role-id (e.g. {{artifact.pm-analyst.prd}}), but each step has a random
  // node id. Rewrite those refs to the actual node id so server-side validation
  // (template_bad_ref) passes.
  const roleToNodeId = new Map<string, string>()
  for (const s of state.steps) {
    if (s.roleId && !roleToNodeId.has(s.roleId)) roleToNodeId.set(s.roleId, s.id)
  }
  const rewritePromptRefs = (tpl: string): string => {
    if (!tpl) return tpl
    return tpl.replace(
      /\{\{\s*artifact\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\s*\}\}/g,
      (m, ref: string, key: string) => {
        const mapped = roleToNodeId.get(ref)
        return mapped ? `{{artifact.${mapped}.${key}}}` : m
      },
    )
  }

  // Trigger node
  const triggerId = "trigger"
  nodes.push({
    id: triggerId,
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {
      label: state.trigger.label || "Trigger",
      triggerKind: state.trigger.kind,
      outputs: [{ key: "payload", type: "text" }],
    },
  })

  let prevOutputNodeId = triggerId
  let prevOutputHandle = "payload"

  // Track all agent outputs so we can fan-in to Output node at the end.
  const finalInputs: Array<{ nodeId: string; outputKey: string; inputKey: string }> = []

  for (let i = 0; i < state.steps.length; i++) {
    const step = state.steps[i]
    const agentNodeId = step.id
    const contract = step.roleId ? ROLE_CONTRACTS[step.roleId] : null

    // Agent node — derive from contract if role-backed, otherwise ad-hoc.
    const data: PipelineNodeData = contract
      ? {
          ...nodeDataFromContract(contract, step.agentId),
          label: step.label,
          promptTemplate: rewritePromptRefs(step.promptTemplate),
          failurePolicy: step.failurePolicy,
          maxRetries: step.maxRetries,
        }
      : {
          label: step.label,
          agentId: step.agentId,
          promptTemplate: rewritePromptRefs(step.promptTemplate),
          // Generic fallback: one input named "input", one output named "output".
          inputs: [{ key: "input", type: "text" }],
          outputs: [{ key: "output", type: "text" }],
          failurePolicy: step.failurePolicy,
          maxRetries: step.maxRetries,
        }

    nodes.push({
      id: agentNodeId,
      type: "agent",
      position: { x: 0, y: 0 },
      data,
    })

    // Wire previous output → this step's first input.
    const firstInputKey = (data.inputs as Array<{ key: string }>)?.[0]?.key || "input"
    edges.push({
      id: uid("edge"),
      source: prevOutputNodeId,
      target: agentNodeId,
      sourceHandle: prevOutputHandle,
      targetHandle: firstInputKey,
    })

    // First output key of this agent — used as "current output" bus.
    const firstOutputKey = (data.outputs as Array<{ key: string }>)?.[0]?.key || "output"

    // Optional approval gate AFTER this step.
    if (step.requireApprovalAfter && i < state.steps.length - 1) {
      const approvalId = `approval_${step.id}`
      // Approval is a passthrough gate — approved/rejected outputs inherit the
      // artifact type of the incoming step's first output so downstream handle
      // type checks pass.
      const approvalOutType =
        (data.outputs as Array<{ key: string; type: "text" | "json" | "file" | "approval" }>)?.[0]?.type || "text"
      nodes.push({
        id: approvalId,
        type: "human_approval",
        position: { x: 0, y: 0 },
        data: {
          label: `Review ${step.label} output`,
          approvalMessage: step.approvalMessage || `Please review the output of ${step.label} before continuing.`,
          outputs: [
            { key: "approved", type: approvalOutType },
            { key: "rejected", type: approvalOutType },
          ],
        },
      })
      edges.push({
        id: uid("edge"),
        source: agentNodeId,
        target: approvalId,
        sourceHandle: firstOutputKey,
        targetHandle: "artifact",
      })
      // Carry approval.approved as the new "previous output" bus.
      prevOutputNodeId = approvalId
      prevOutputHandle = "approved"
    } else {
      prevOutputNodeId = agentNodeId
      prevOutputHandle = firstOutputKey
    }

    // Collect all step outputs into Output node inputs at the end.
    for (const out of (data.outputs as Array<{ key: string }>) || []) {
      finalInputs.push({
        nodeId: agentNodeId,
        outputKey: out.key,
        // Input key to Output node — prefix with step label for readability.
        inputKey: out.key,
      })
    }
  }

  // Output node collecting the final step's outputs.
  if (state.steps.length > 0) {
    const outputId = "output"
    const lastStep = state.steps[state.steps.length - 1]
    // Output node only wires the last step's outputs (not every step's).
    const lastStepOutputs = finalInputs.filter((fi) => fi.nodeId === lastStep.id)
    const outputInputs = lastStepOutputs.length > 0
      ? lastStepOutputs.map((fi) => ({ key: fi.outputKey, type: "text" as const }))
      : [{ key: "result", type: "text" as const }]

    nodes.push({
      id: outputId,
      type: "output",
      position: { x: 0, y: 0 },
      data: {
        label: "Output",
        inputs: outputInputs,
      },
    })
    for (const fi of lastStepOutputs) {
      edges.push({
        id: uid("edge"),
        source: fi.nodeId,
        target: outputId,
        sourceHandle: fi.outputKey,
        targetHandle: fi.inputKey,
      })
    }
  }

  return { nodes, edges }
}

// ─── Graph → Stepper (lossy; only linear-compatible graphs) ─────────────────
export interface GraphToStepperResult {
  ok: boolean
  state?: StepperState
  reason?: string
}

/**
 * Detect if a PipelineGraph can be represented as a linear stepper state,
 * and if so, build that state. Graphs with parallel branches, fan-out, or
 * complex approval patterns are rejected — user must keep editing in Graph
 * mode.
 *
 * Linear-compatible shape:
 *   trigger → (agent → [approval →] → agent → ...) → output
 * Approval nodes must have exactly 1 incoming + 1 outgoing edge (approved path only).
 */
export function graphToStepper(graph: PipelineGraph): GraphToStepperResult {
  const { nodes, edges } = graph
  if (nodes.length === 0) {
    return { ok: true, state: EMPTY_STEPPER }
  }

  const triggers = nodes.filter((n) => n.type === "trigger")
  if (triggers.length !== 1) {
    return { ok: false, reason: "Stepper mode requires exactly one trigger node." }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const outgoing = new Map<string, PipelineEdge[]>()
  const incoming = new Map<string, PipelineEdge[]>()
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e)
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    incoming.get(e.target)!.push(e)
  }

  // Walk from trigger forward. Each step: trigger → agent (→ approval)? → agent …
  const trigger = triggers[0]
  const steps: StepperStep[] = []

  let cursor = trigger.id
  const visited = new Set<string>([cursor])

  while (true) {
    const nextEdges = outgoing.get(cursor) || []
    if (nextEdges.length === 0) break
    if (nextEdges.length > 1) {
      return { ok: false, reason: `Node ${cursor} has ${nextEdges.length} outgoing edges (stepper requires linear).` }
    }
    const nextId = nextEdges[0].target
    const nextNode = byId.get(nextId)
    if (!nextNode) return { ok: false, reason: `Edge target ${nextId} not found.` }
    if (visited.has(nextId)) return { ok: false, reason: "Graph contains a cycle." }
    visited.add(nextId)

    if (nextNode.type === "output") {
      // Terminal — reached the end.
      break
    }

    if (nextNode.type === "agent") {
      // Parse this agent node into a step.
      const d = (nextNode.data || {}) as PipelineNodeData & { adlcRole?: AdlcRoleId }
      const step: StepperStep = {
        id: nextNode.id,
        roleId: d.adlcRole,
        label: (d.label as string) || "Agent Step",
        agentId: (d.agentId as string) || "",
        promptTemplate: (d.promptTemplate as string) || "",
        failurePolicy: (d.failurePolicy as PipelineFailurePolicy) || "halt",
        maxRetries: d.maxRetries as number | undefined,
        requireApprovalAfter: false,
      }

      // Peek next to see if it's an approval (which would be "after this step")
      const afterEdges = outgoing.get(nextNode.id) || []
      if (afterEdges.length === 1) {
        const peek = byId.get(afterEdges[0].target)
        if (peek?.type === "human_approval") {
          const approvalData = (peek.data || {}) as PipelineNodeData
          const approvalOut = outgoing.get(peek.id) || []
          // Require exactly one outbound on the "approved" branch — skip rejected.
          const approved = approvalOut.find((e) => e.sourceHandle === "approved")
          if (!approved) {
            return { ok: false, reason: "Approval node missing 'approved' outgoing edge." }
          }
          if (approvalOut.length > 1) {
            // rejected branch is fine if it leads to a terminal or just a dead-end;
            // for MVP stepper we treat any rejected branch handling as non-linear.
            const rejected = approvalOut.find((e) => e.sourceHandle === "rejected")
            if (rejected && byId.get(rejected.target)?.type !== "output") {
              return { ok: false, reason: "Approval 'rejected' branches to a custom node — not stepper-compatible." }
            }
          }
          step.requireApprovalAfter = true
          step.approvalMessage = (approvalData.approvalMessage as string) || undefined
          visited.add(peek.id)
          cursor = peek.id
          steps.push(step)
          continue
        }
      }

      // No approval after this step.
      steps.push(step)
      cursor = nextNode.id
      continue
    }

    if (nextNode.type === "human_approval") {
      return { ok: false, reason: "Approval node found without a preceding agent step — not stepper-compatible." }
    }
    if (nextNode.type === "condition") {
      return { ok: false, reason: "Condition nodes are not supported in stepper mode." }
    }

    return { ok: false, reason: `Unsupported node type in stepper mode: ${nextNode.type}` }
  }

  return {
    ok: true,
    state: {
      trigger: {
        kind: ((trigger.data?.triggerKind as PipelineTriggerType) || "manual"),
        label: (trigger.data?.label as string) || "Trigger",
      },
      steps,
    },
  }
}
