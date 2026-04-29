// Right side panel — shown when a node is selected in edit mode.
// Progressive disclosure: Basic fields always visible; Advanced (handle
// editing, failure policy, retries) collapsed by default. For role-aware
// agent nodes, the ADLC role badge replaces the generic header so users see
// immediately what this step is.

import { useState, useEffect } from "react"
import { Trash2, X, Plus, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  PipelineNode,
  PipelineNodeData,
  PipelineHandle,
  PipelineHandleType,
  PipelineTriggerType,
  PipelineFailurePolicy,
  Agent,
} from "@/types"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import { ROLE_CONTRACTS } from "@/lib/pipelines/role-contracts"

interface NodeConfigPanelProps {
  node: PipelineNode
  agents: Agent[]
  onChange: (patch: Partial<PipelineNodeData>) => void
  onDelete: () => void
  onClose: () => void
}

const HANDLE_TYPES: PipelineHandleType[] = ["text", "json", "file", "approval"]
const TRIGGER_KINDS: PipelineTriggerType[] = ["manual", "webhook", "cron", "task_created"]
const FAILURE_POLICIES: PipelineFailurePolicy[] = ["halt", "continue", "retry"]

const NODE_TYPE_LABEL: Record<string, string> = {
  trigger: "Trigger",
  agent: "Agent",
  condition: "Condition",
  human_approval: "Approval Gate",
  output: "Output",
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
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

function Select({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Section({ title, defaultOpen = true, children }: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  )
}

function HandleListEditor({
  title,
  handles,
  onChange,
}: {
  title: string
  handles: PipelineHandle[]
  onChange: (next: PipelineHandle[]) => void
}) {
  const updateAt = (idx: number, patch: Partial<PipelineHandle>) => {
    const next = [...handles]
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  const removeAt = (idx: number) => onChange(handles.filter((_, i) => i !== idx))
  const add = () =>
    onChange([
      ...handles,
      { key: `handle_${handles.length + 1}`, type: "text" },
    ])

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-medium text-muted-foreground">{title}</label>
        <button
          onClick={add}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="space-y-1.5">
        {handles.length === 0 && (
          <div className="text-[10px] text-muted-foreground italic">No handles</div>
        )}
        {handles.map((h, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <TextInput
              value={h.key}
              onChange={(e) => updateAt(idx, { key: e.target.value.replace(/\s+/g, "_") })}
              placeholder="key"
              className="flex-1 text-xs font-mono"
            />
            <select
              value={h.type}
              onChange={(e) => updateAt(idx, { type: e.target.value as PipelineHandleType })}
              className="px-1.5 py-1.5 rounded-md border border-border bg-background text-xs"
            >
              {HANDLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              onClick={() => removeAt(idx)}
              className="p-1 text-muted-foreground hover:text-red-400"
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function NodeConfigPanel({ node, agents, onChange, onDelete, onClose }: NodeConfigPanelProps) {
  const t = node.type
  const data = node.data || {}
  const [localData, setLocalData] = useState<PipelineNodeData>(data)
  useEffect(() => setLocalData(data), [node.id])

  const commit = (patch: Partial<PipelineNodeData>) => {
    setLocalData((s) => ({ ...s, ...patch }))
    onChange(patch)
  }

  // Header context
  const adlcRole = (localData.adlcRole as AdlcRoleId | undefined)
  const roleContract = adlcRole ? ROLE_CONTRACTS[adlcRole] : null
  const headerEmoji = roleContract?.emoji
  const headerLabel = NODE_TYPE_LABEL[t] || t
  // For agent nodes filtered by role: suggest only matching agents.
  const agentOptions = t === "agent"
    ? (() => {
        const filtered = adlcRole
          ? agents.filter((a) => (a as Agent & { role?: string }).role === adlcRole)
          : agents
        return [
          { value: "", label: "— select agent —" },
          ...filtered.map((a) => ({ value: a.id, label: a.name || a.id })),
        ]
      })()
    : []

  return (
    <div className="flex flex-col h-full border-l border-border bg-card/60 w-80 shrink-0 overflow-hidden">
      {/* Header — role badge if applicable, else node type label */}
      <div className="flex items-start justify-between gap-2 px-3 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {headerEmoji && <span className="text-base">{headerEmoji}</span>}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {roleContract?.label || headerLabel}
            </span>
          </div>
          {/* Editable label doubles as title — no separate "Label" field needed */}
          <input
            value={(localData.label as string) || ""}
            onChange={(e) => commit({ label: e.target.value })}
            placeholder={roleContract?.label || headerLabel}
            className="w-full px-1 py-0.5 text-sm font-semibold bg-transparent border border-transparent hover:border-border focus:border-border focus:outline-none rounded"
          />
        </div>
        <button
          onClick={onClose}
          className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted shrink-0 mt-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Agent nodes ───────────────────────────────────────────── */}
        {t === "agent" && (
          <>
            <Section title="Basic">
              <Field
                label="Agent"
                hint={adlcRole ? `Filtered to agents with role ${adlcRole}` : "Pick an agent to dispatch to"}
              >
                <Select
                  value={(localData.agentId as string) || ""}
                  onChange={(v) => commit({ agentId: v })}
                  options={agentOptions}
                />
              </Field>
              <Field
                label="Prompt Template"
                hint="Use {{artifact.nodeId.outputKey}} to inject upstream outputs"
              >
                <TextArea
                  rows={5}
                  value={(localData.promptTemplate as string) || ""}
                  onChange={(e) => commit({ promptTemplate: e.target.value })}
                  placeholder="Analyze the input and produce…"
                />
              </Field>
            </Section>

            <Section title="Handles" defaultOpen={false}>
              <HandleListEditor
                title="Inputs"
                handles={(localData.inputs as PipelineHandle[]) || []}
                onChange={(next) => commit({ inputs: next })}
              />
              <HandleListEditor
                title="Outputs"
                handles={(localData.outputs as PipelineHandle[]) || []}
                onChange={(next) => commit({ outputs: next })}
              />
            </Section>

            <Section title="Execution" defaultOpen={false}>
              <Field label="Description">
                <TextInput
                  value={(localData.description as string) || ""}
                  onChange={(e) => commit({ description: e.target.value })}
                  placeholder="Optional notes about this step"
                />
              </Field>
              <Field label="Failure Policy">
                <Select
                  value={(localData.failurePolicy as string) || "halt"}
                  onChange={(v) => commit({ failurePolicy: v as PipelineFailurePolicy })}
                  options={FAILURE_POLICIES.map((p) => ({ value: p, label: p }))}
                />
              </Field>
              {localData.failurePolicy === "retry" && (
                <Field label="Max Retries">
                  <TextInput
                    type="number"
                    min={1}
                    max={10}
                    value={(localData.maxRetries as number) ?? 3}
                    onChange={(e) => commit({ maxRetries: Number(e.target.value) })}
                  />
                </Field>
              )}
            </Section>
          </>
        )}

        {/* ── Trigger ───────────────────────────────────────────────── */}
        {t === "trigger" && (
          <Section title="Basic">
            <Field label="Trigger Kind">
              <Select
                value={(localData.triggerKind as string) || "manual"}
                onChange={(v) => commit({ triggerKind: v as PipelineTriggerType })}
                options={TRIGGER_KINDS.map((k) => ({ value: k, label: k }))}
              />
            </Field>
            <Field label="Description">
              <TextInput
                value={(localData.description as string) || ""}
                onChange={(e) => commit({ description: e.target.value })}
                placeholder="Optional description"
              />
            </Field>
          </Section>
        )}

        {/* ── Condition ─────────────────────────────────────────────── */}
        {t === "condition" && (
          <>
            <Section title="Basic">
              <Field label="Expression" hint="JSONLogic — Phase 4 will evaluate this">
                <TextArea
                  rows={4}
                  value={
                    typeof localData.conditionExpression === "string"
                      ? localData.conditionExpression
                      : JSON.stringify(localData.conditionExpression ?? {}, null, 2)
                  }
                  onChange={(e) => commit({ conditionExpression: e.target.value })}
                  placeholder='{"==": [{"var": "artifact.pm.status"}, "approved"]}'
                />
              </Field>
            </Section>
            <Section title="Branches" defaultOpen={false}>
              <HandleListEditor
                title="Outputs"
                handles={(localData.outputs as PipelineHandle[]) || []}
                onChange={(next) => commit({ outputs: next })}
              />
            </Section>
          </>
        )}

        {/* ── Human Approval ────────────────────────────────────────── */}
        {t === "human_approval" && (
          <>
            <Section title="Basic">
              <Field label="Message to Approvers">
                <TextArea
                  rows={3}
                  value={(localData.approvalMessage as string) || ""}
                  onChange={(e) => commit({ approvalMessage: e.target.value })}
                  placeholder="Please review the spec before implementation."
                />
              </Field>
              <Field label="Timeout (ms)" hint="0 = no timeout">
                <TextInput
                  type="number"
                  min={0}
                  value={(localData.approvalTimeoutMs as number) ?? 0}
                  onChange={(e) => commit({ approvalTimeoutMs: Number(e.target.value) })}
                />
              </Field>
            </Section>
            <Section title="Branches" defaultOpen={false}>
              <HandleListEditor
                title="Outputs"
                handles={(localData.outputs as PipelineHandle[]) || []}
                onChange={(next) => commit({ outputs: next })}
              />
            </Section>
          </>
        )}

        {/* ── Output ────────────────────────────────────────────────── */}
        {t === "output" && (
          <Section title="Basic">
            <Field label="Description">
              <TextInput
                value={(localData.description as string) || ""}
                onChange={(e) => commit({ description: e.target.value })}
                placeholder="What does this output bundle?"
              />
            </Field>
            <HandleListEditor
              title="Inputs"
              handles={(localData.inputs as PipelineHandle[]) || []}
              onChange={(next) => commit({ inputs: next })}
            />
          </Section>
        )}
      </div>

      <div className="p-2 border-t border-border">
        <Button variant="ghost" size="sm" className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-2" /> Delete node
        </Button>
      </div>
    </div>
  )
}
