// StepperEditor — zero-friction workflow authoring.
//
// Primary surface: role emoji + editable label + agent picker + approval toggle.
// Everything else (prompt template, failure policy, retries, approval message)
// is tucked into a collapsed "Advanced" accordion — defaults from role contract
// cover 90% of cases so most users never open it.

import { useState } from "react"
import {
  Zap, Bot, Hand, FileOutput, Plus,
  ArrowDown,
} from "lucide-react"
import { CapabilityStepCard } from "./CapabilityStepCard"
import { cn } from "@/lib/utils"
import type {
  Agent,
  PipelineTriggerType,
} from "@/types"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import { ROLE_CONTRACTS } from "@/lib/pipelines/role-contracts"
import type { StepperState, StepperStep } from "@/lib/pipelines/stepper"
import { newStep } from "@/lib/pipelines/stepper"

interface StepperEditorProps {
  state: StepperState
  onChange: (next: StepperState) => void
  agents: Agent[]
  readOnly?: boolean
}

const TRIGGER_KINDS: Array<{ value: PipelineTriggerType; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "webhook", label: "Webhook" },
  { value: "cron", label: "Schedule (cron)" },
  { value: "task_created", label: "Task created" },
]

const FAILURE_POLICIES: PipelineFailurePolicy[] = ["halt", "continue", "retry"]

const ROLE_PICKER_ORDER: AdlcRoleId[] = [
  "biz-analyst",
  "pm-discovery",
  "ux-designer",
  "em-architect",
  "swe",
  "qa-engineer",
  "doc-writer",
  "data-analyst",
]

// ─── Shared UI bits ──────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm",
        props.className,
      )}
    />
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm",
        props.className,
      )}
    />
  )
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm resize-y font-mono",
        props.className,
      )}
    />
  )
}

function MiniToggle({ checked, onChange, disabled, label }: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
        checked
          ? "bg-orange-500/15 text-orange-400 hover:bg-orange-500/25"
          : "bg-muted text-muted-foreground hover:bg-muted/80",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      title={checked ? "Approval required after this step" : "No approval — auto-advance"}
    >
      <Hand className="h-3 w-3" />
      {checked ? "Approval" : "No approval"}
    </button>
  )
}

function Connector({ variant = "normal" }: { variant?: "normal" | "approval" }) {
  return (
    <div className="flex flex-col items-center my-1">
      <div
        className={cn(
          "w-0.5 h-4",
          variant === "approval" ? "bg-orange-500/50" : "bg-border",
        )}
      />
      <ArrowDown className={cn("h-3 w-3", variant === "approval" ? "text-orange-500" : "text-muted-foreground")} />
      <div
        className={cn(
          "w-0.5 h-4",
          variant === "approval" ? "bg-orange-500/50" : "bg-border",
        )}
      />
    </div>
  )
}

// ─── Trigger card ───────────────────────────────────────────────────────────
function TriggerCard({
  state, onChange, readOnly,
}: { state: StepperState; onChange: (next: StepperState) => void; readOnly?: boolean }) {
  return (
    <div className="border border-border bg-card rounded-md border-l-4 border-l-amber-500 w-full max-w-2xl">
      <div className="flex items-center gap-2 px-3 py-2">
        <Zap className="h-4 w-4 text-amber-500 shrink-0" />
        <div className="text-sm font-semibold flex-1">Trigger</div>
        <Select
          value={state.trigger.kind}
          onChange={(e) =>
            onChange({ ...state, trigger: { ...state.trigger, kind: e.target.value as PipelineTriggerType } })
          }
          disabled={readOnly}
          className="w-40"
        >
          {TRIGGER_KINDS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>
      </div>
    </div>
  )
}

// ─── Step card ──────────────────────────────────────────────────────────────
function StepCard({
  step,
  index,
  agents,
  onChange,
  onRemove,
  readOnly,
  isLast,
}: {
  step: StepperStep
  index: number
  agents: Agent[]
  onChange: (patch: Partial<StepperStep>) => void
  onRemove: () => void
  readOnly?: boolean
  isLast: boolean
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const contract = step.roleId ? ROLE_CONTRACTS[step.roleId] : null
  const emoji = contract?.emoji
  const accent = contract ? "border-l-purple-500" : "border-l-purple-500/40"

  const filteredAgents = step.roleId
    ? agents.filter((a) => (a as Agent & { role?: string }).role === step.roleId)
    : agents
  const agentOptions = [
    { value: "", label: filteredAgents.length === 0 ? "— no matching agents —" : "— select agent —" },
    ...filteredAgents.map((a) => ({ value: a.id, label: a.name || a.id })),
  ]
  const noAgentPicked = step.agentId === ""

  const showApprovalToggle = !isLast && !readOnly
  const approvalActive = step.requireApprovalAfter && !isLast

  return (
    <div className="w-full max-w-2xl">
      <div className={cn("border border-border bg-card rounded-md border-l-4", accent)}>
        {/* Primary row — label + agent picker + approval toggle + remove */}
        <div className="flex items-center gap-2 px-3 py-2">
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
            placeholder="Step label"
            disabled={readOnly}
            className="min-w-0 flex-1 text-sm font-semibold bg-transparent px-1 py-0.5 border border-transparent hover:border-border focus:border-border focus:outline-none rounded"
          />
          {/* Agent picker inline */}
          <Select
            value={step.agentId}
            onChange={(e) => onChange({ agentId: e.target.value })}
            disabled={readOnly}
            className="w-44 shrink-0"
          >
            {agentOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
          {noAgentPicked && (
            <span
              className="flex items-center gap-1 text-[10px] text-amber-400 shrink-0"
              title="No agent assigned"
            >
              <AlertCircle className="h-3 w-3" />
            </span>
          )}
          {showApprovalToggle && (
            <MiniToggle
              checked={approvalActive}
              onChange={(v) => onChange({ requireApprovalAfter: v })}
              label="Approval"
            />
          )}
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            title="Advanced settings"
            className={cn(
              "p-1 rounded hover:bg-muted transition-colors shrink-0",
              advancedOpen ? "text-foreground bg-muted" : "text-muted-foreground",
            )}
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

        {/* Advanced — collapsed by default */}
        {advancedOpen && (
          <div className="border-t border-border/60 px-3 py-2 space-y-2 bg-muted/20">
            <Field
              label="Prompt template"
              hint="Reference any upstream artifact with {{artifact.stepId.outputKey}}"
            >
              <TextArea
                rows={5}
                value={step.promptTemplate}
                onChange={(e) => onChange({ promptTemplate: e.target.value })}
                disabled={readOnly}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Failure policy">
                <Select
                  value={step.failurePolicy}
                  onChange={(e) => onChange({ failurePolicy: e.target.value as PipelineFailurePolicy })}
                  disabled={readOnly}
                >
                  {FAILURE_POLICIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              {step.failurePolicy === "retry" && (
                <Field label="Max retries">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={step.maxRetries ?? 3}
                    onChange={(e) => onChange({ maxRetries: Number(e.target.value) })}
                    disabled={readOnly}
                  />
                </Field>
              )}
            </div>
            {approvalActive && (
              <Field label="Approval message">
                <Input
                  value={step.approvalMessage || ""}
                  onChange={(e) => onChange({ approvalMessage: e.target.value })}
                  placeholder="Please review the output before continuing."
                  disabled={readOnly}
                />
              </Field>
            )}
          </div>
        )}
      </div>

      {/* Approval gate visualization inline */}
      {approvalActive && (
        <>
          <Connector variant="approval" />
          <div className="w-full max-w-2xl">
            <div className="border border-orange-500/30 bg-orange-500/5 rounded-md border-l-4 border-l-orange-500 px-3 py-2">
              <div className="flex items-center gap-2">
                <Hand className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                <span className="text-xs font-semibold">Approval Gate</span>
                <span className="text-[10px] text-muted-foreground italic truncate">
                  "{step.approvalMessage || `Please review ${step.label} output before continuing.`}"
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Output card ────────────────────────────────────────────────────────────
function OutputCard() {
  return (
    <div className="border border-border bg-card rounded-md border-l-4 border-l-emerald-500 px-3 py-2 w-full max-w-2xl">
      <div className="flex items-center gap-2">
        <FileOutput className="h-4 w-4 text-emerald-500" />
        <div className="text-sm font-semibold">Output</div>
        <span className="text-[11px] text-muted-foreground ml-1">· Bundle and finalize</span>
      </div>
    </div>
  )
}

// ─── Add-step picker ────────────────────────────────────────────────────────
function AddStepPicker({
  agents,
  onPick,
}: {
  agents: Agent[]
  onPick: (step: StepperStep) => void
}) {
  const [open, setOpen] = useState(false)
  const roleCount = (roleId: AdlcRoleId) =>
    agents.filter((a) => (a as Agent & { role?: string }).role === roleId).length

  return (
    <div className="w-full max-w-2xl">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/60 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Role
        </button>
      ) : (
        <div className="border border-border bg-card rounded-md p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1 py-1">
            Pick a role
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ROLE_PICKER_ORDER.map((roleId) => {
              const c = ROLE_CONTRACTS[roleId]
              const count = roleCount(roleId)
              return (
                <button
                  key={roleId}
                  onClick={() => {
                    onPick(newStep(roleId))
                    setOpen(false)
                  }}
                  className="text-left p-2 rounded-md border border-border bg-card hover:border-primary/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{c.emoji}</span>
                    <span className="text-sm font-medium">{c.label}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {count > 0 ? `${count} agent${count > 1 ? "s" : ""} available` : "no agents assigned"}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="pt-2 border-t border-border mt-2 flex items-center justify-between">
            <button
              onClick={() => {
                onPick(newStep())
                setOpen(false)
              }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Bot className="h-3.5 w-3.5" /> Generic agent (no role)
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main editor ────────────────────────────────────────────────────────────
export function StepperEditor({ state, onChange, agents, readOnly }: StepperEditorProps) {
  const addStep = (step: StepperStep) => {
    onChange({ ...state, steps: [...state.steps, step] })
  }
  const updateStep = (idx: number, patch: Partial<StepperStep>) => {
    const next = [...state.steps]
    next[idx] = { ...next[idx], ...patch }
    onChange({ ...state, steps: next })
  }
  const removeStep = (idx: number) => {
    onChange({ ...state, steps: state.steps.filter((_, i) => i !== idx) })
  }

  return (
    <div className="flex flex-col items-center py-6 px-4 overflow-y-auto h-full">
      <TriggerCard state={state} onChange={onChange} readOnly={readOnly} />
      {state.steps.length === 0 && !readOnly && (
        <>
          <Connector />
          <AddStepPicker agents={agents} onPick={addStep} />
        </>
      )}
      {state.steps.map((step, i) => {
        const isLast = i === state.steps.length - 1
        const nextStepLabel = isLast ? undefined : state.steps[i + 1].label
        const approvalActive = step.requireApprovalAfter && !isLast
        return (
          <div key={step.id} className="w-full flex flex-col items-center">
            <Connector />
            <CapabilityStepCard
              step={step}
              index={i}
              agents={agents}
              onChange={(patch) => updateStep(i, patch)}
              onRemove={() => removeStep(i)}
              readOnly={readOnly}
              isLast={isLast}
              nextStepLabel={nextStepLabel}
            />
            {approvalActive && (
              <>
                <Connector variant="approval" />
                <div className="w-full max-w-2xl">
                  <div className="border border-orange-500/30 bg-orange-500/5 rounded-md border-l-4 border-l-orange-500 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Hand className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      <span className="text-xs font-semibold">Approval Gate</span>
                      <span className="text-[10px] text-muted-foreground italic truncate">
                        "{step.approvalMessage || `Please review ${step.label} output before continuing.`}"
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}
      {state.steps.length > 0 && !readOnly && (
        <>
          <Connector />
          <AddStepPicker agents={agents} onPick={addStep} />
        </>
      )}
      {state.steps.length > 0 && (
        <>
          <Connector />
          <OutputCard />
        </>
      )}
    </div>
  )
}
