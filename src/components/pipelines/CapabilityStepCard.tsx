// CapabilityStepCard — agent-capability-first step rendering for the stepper.
//
// Each card shows: role badge + assigned agent + expandable capability sections
// (skills / connections / tools) so the user can see *exactly* what this agent
// can do at this step. The complexity of handle keys / artifact types is hidden;
// what matters is "which agent is running, what are they capable of, and what
// happens after they finish".

import { useState, useEffect, useRef } from "react"
import {
  Bot, Hand, Settings2, X, AlertCircle, ChevronDown, ChevronRight,
  BookOpen, Plug, Wrench, ArrowRight, Check, ChevronLeft,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Agent, PipelineFailurePolicy } from "@/types"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import { ROLE_CONTRACTS } from "@/lib/pipelines/role-contracts"
import { useAgentCapabilities, prefetchAgentCapabilities } from "@/hooks/useAgentCapabilities"
import type { StepperStep } from "@/lib/pipelines/stepper"

interface CapabilityStepCardProps {
  step: StepperStep
  index: number
  agents: Agent[]
  onChange: (patch: Partial<StepperStep>) => void
  onRemove: () => void
  readOnly?: boolean
  isLast: boolean
  nextStepLabel?: string
}

const FAILURE_POLICIES: PipelineFailurePolicy[] = ["halt", "continue", "retry"]

function Section({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = true,
  emptyLabel,
}: {
  title: string
  icon: React.ElementType
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
  emptyLabel: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Icon className="h-3 w-3" />
        <span>{title}</span>
        <span className="text-[10px]">({count})</span>
      </button>
      {open && (
        <div className="pl-5 pb-1 space-y-0.5">
          {count === 0 ? (
            <div className="text-[10px] italic text-muted-foreground/70">{emptyLabel}</div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}

function CapabilityLine({
  primary, secondary, extra,
}: {
  primary: string
  secondary?: string | null
  extra?: string
}) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="font-mono text-foreground/90 shrink-0">{primary}</span>
      {extra && (
        <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground shrink-0">
          {extra}
        </span>
      )}
      {secondary && (
        <span className="text-muted-foreground truncate">{secondary}</span>
      )}
    </div>
  )
}

function AgentSwitchPanel({
  currentAgentId,
  candidates,
  onPick,
  onCancel,
}: {
  currentAgentId: string
  candidates: Agent[]
  onPick: (agentId: string) => void
  onCancel: () => void
}) {
  useEffect(() => {
    // Warm cache for fast hover/open of each candidate's capability preview.
    candidates.forEach((c) => prefetchAgentCapabilities(c.id))
  }, [candidates])

  return (
    <div className="border-t border-border/60 bg-muted/20 p-2 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pick an agent for this role
        </span>
        <button
          onClick={onCancel}
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ChevronLeft className="h-3 w-3" /> Close
        </button>
      </div>
      {candidates.length === 0 && (
        <div className="text-[11px] italic text-amber-400 p-2">
          No agents with this role. Assign the role to an existing agent in the
          Agents page, or provision a new agent from the role template.
        </div>
      )}
      {candidates.map((c) => (
        <AgentCandidateRow
          key={c.id}
          agent={c}
          selected={c.id === currentAgentId}
          onPick={() => onPick(c.id)}
        />
      ))}
    </div>
  )
}

function AgentCandidateRow({
  agent, selected, onPick,
}: { agent: Agent; selected: boolean; onPick: () => void }) {
  const { data: caps } = useAgentCapabilities(agent.id)
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "w-full text-left p-2 rounded-md border transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:border-primary/60",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium truncate">{agent.name || agent.id}</span>
        {selected && <Check className="h-3.5 w-3.5 text-primary" />}
      </div>
      {caps && (
        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
          <span>{caps.skills.length} skills</span>
          <span>·</span>
          <span>{caps.connections.length} connections</span>
          <span>·</span>
          <span>{caps.tools.length + caps.customTools.agent.length + caps.customTools.shared.filter((t) => t.enabled).length} tools</span>
        </div>
      )}
    </button>
  )
}

export function CapabilityStepCard({
  step, index, agents, onChange, onRemove, readOnly, isLast, nextStepLabel,
}: CapabilityStepCardProps) {
  const [switchOpen, setSwitchOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const { data: caps, loading, error } = useAgentCapabilities(step.agentId || null)
  const cardRef = useRef<HTMLDivElement>(null)

  const contract = step.roleId ? ROLE_CONTRACTS[step.roleId] : null
  const emoji = contract?.emoji
  const accent = contract ? "border-l-purple-500" : "border-l-purple-500/40"

  const filteredAgents = step.roleId
    ? agents.filter((a) => (a as Agent & { role?: string }).role === step.roleId)
    : agents
  const selectedAgent = agents.find((a) => a.id === step.agentId)

  const noAgentPicked = step.agentId === ""
  const showApprovalToggle = !isLast && !readOnly
  const approvalActive = step.requireApprovalAfter && !isLast

  return (
    <div ref={cardRef} className="w-full max-w-2xl">
      <div className={cn("border border-border bg-card rounded-md border-l-4", accent)}>
        {/* Header: step number + role + assigned agent + actions */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
          <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground shrink-0">
            {index + 1}
          </div>
          {emoji ? (
            <span className="text-base shrink-0">{emoji}</span>
          ) : (
            <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <input
            value={step.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder={contract?.label || "Step label"}
            disabled={readOnly}
            className="min-w-0 flex-1 text-sm font-semibold bg-transparent px-1 py-0.5 border border-transparent hover:border-border focus:border-border focus:outline-none rounded"
          />
          {showApprovalToggle && (
            <button
              type="button"
              onClick={() => onChange({ requireApprovalAfter: !approvalActive })}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium shrink-0 transition-colors",
                approvalActive
                  ? "bg-orange-500/15 text-orange-400 hover:bg-orange-500/25"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
              title={approvalActive ? "Will wait for approval after this step" : "Auto-advance after this step"}
            >
              <Hand className="h-3 w-3" />
              {approvalActive ? "Approval" : "No approval"}
            </button>
          )}
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className={cn(
              "p-1 rounded hover:bg-muted transition-colors shrink-0",
              advancedOpen ? "text-foreground bg-muted" : "text-muted-foreground",
            )}
            title="Advanced: prompt & policy"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          {!readOnly && (
            <button
              onClick={onRemove}
              className="p-1 text-muted-foreground hover:text-red-400 rounded hover:bg-red-500/10 shrink-0"
              title="Remove step"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Assigned agent row */}
        <div className="px-3 py-2 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground shrink-0">Assigned:</span>
            {noAgentPicked ? (
              <span className="flex items-center gap-1 text-[11px] text-amber-400">
                <AlertCircle className="h-3 w-3" /> No agent selected
              </span>
            ) : (
              <span className="text-sm font-medium truncate">
                {selectedAgent?.name || step.agentId}
              </span>
            )}
            <span className="flex-1" />
            {!readOnly && (
              <button
                onClick={() => setSwitchOpen(!switchOpen)}
                className="text-[11px] text-primary hover:underline"
              >
                {noAgentPicked ? "Pick agent →" : switchOpen ? "Cancel" : "Switch →"}
              </button>
            )}
          </div>

          {/* Inline capability panel — shown when agent is selected */}
          {!switchOpen && caps && (
            <div className="mt-2 space-y-0.5">
              <Section title="Skills" icon={BookOpen} count={caps.skills.length} emptyLabel="No skills enabled">
                {caps.skills.slice(0, 6).map((s) => (
                  <CapabilityLine
                    key={s.name}
                    primary={s.name}
                    secondary={s.description}
                    extra={!s.enabled ? "off" : undefined}
                  />
                ))}
                {caps.skills.length > 6 && (
                  <div className="text-[10px] text-muted-foreground">+{caps.skills.length - 6} more</div>
                )}
              </Section>
              <Section
                title="Connections"
                icon={Plug}
                count={caps.connections.length}
                emptyLabel="No connections assigned"
              >
                {caps.connections.map((c) => (
                  <CapabilityLine
                    key={c.id}
                    primary={c.name}
                    secondary={c.type}
                    extra={c.enabled ? undefined : "disabled"}
                  />
                ))}
              </Section>
              <Section
                title="Tools"
                icon={Wrench}
                count={caps.tools.length + caps.customTools.agent.length + caps.customTools.shared.filter((t) => t.enabled).length}
                defaultOpen={false}
                emptyLabel="No tools"
              >
                {caps.tools.slice(0, 4).map((t) => (
                  <CapabilityLine key={`bt-${t.name}`} primary={t.name} secondary={t.description} />
                ))}
                {caps.customTools.agent.filter((t) => t.enabled).map((t) => (
                  <CapabilityLine key={`at-${t.name}`} primary={t.name} secondary={t.description} extra="agent" />
                ))}
                {caps.customTools.shared.filter((t) => t.enabled).map((t) => (
                  <CapabilityLine key={`st-${t.name}`} primary={t.name} secondary={t.description} extra="shared" />
                ))}
                {caps.tools.length > 4 && (
                  <div className="text-[10px] text-muted-foreground">+{caps.tools.length - 4} more built-in</div>
                )}
              </Section>
            </div>
          )}
          {loading && !caps && (
            <div className="mt-2 text-[11px] text-muted-foreground">Loading capabilities…</div>
          )}
          {error && (
            <div className="mt-2 flex items-center gap-1 text-[11px] text-red-400">
              <AlertCircle className="h-3 w-3" /> {error}
            </div>
          )}
        </div>

        {/* Agent switch panel */}
        {switchOpen && (
          <AgentSwitchPanel
            currentAgentId={step.agentId}
            candidates={filteredAgents}
            onPick={(id) => {
              onChange({ agentId: id })
              setSwitchOpen(false)
            }}
            onCancel={() => setSwitchOpen(false)}
          />
        )}

        {/* Output routing hint */}
        {!isLast && (
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 text-[11px] text-muted-foreground">
            <ArrowRight className="h-3 w-3" />
            <span>Output flows to:</span>
            <span className="font-medium text-foreground">
              {approvalActive ? `Approval Gate → ${nextStepLabel || "next step"}` : nextStepLabel || "Output"}
            </span>
          </div>
        )}

        {/* Advanced collapsible */}
        {advancedOpen && (
          <div className="border-t border-border/60 px-3 py-2 space-y-2 bg-muted/10">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                Prompt template
              </label>
              <textarea
                rows={4}
                value={step.promptTemplate}
                onChange={(e) => onChange({ promptTemplate: e.target.value })}
                disabled={readOnly}
                className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs resize-y font-mono"
                placeholder="Agent-facing instructions. Reference upstream artifacts with {{artifact.stepId.outputKey}}."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  Failure policy
                </label>
                <select
                  value={step.failurePolicy}
                  onChange={(e) => onChange({ failurePolicy: e.target.value as PipelineFailurePolicy })}
                  disabled={readOnly}
                  className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                >
                  {FAILURE_POLICIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              {step.failurePolicy === "retry" && (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                    Max retries
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={step.maxRetries ?? 3}
                    onChange={(e) => onChange({ maxRetries: Number(e.target.value) })}
                    disabled={readOnly}
                    className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                  />
                </div>
              )}
            </div>
            {approvalActive && (
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  Approval message
                </label>
                <input
                  value={step.approvalMessage || ""}
                  onChange={(e) => onChange({ approvalMessage: e.target.value })}
                  disabled={readOnly}
                  className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                  placeholder="Shown to reviewers"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
