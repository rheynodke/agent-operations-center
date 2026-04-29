// New Mission modal — 2-step wizard:
//
//   Step 1: What — category picker (feature / enhancement / bug / research /
//           other) suggests a default playbook, then structured intake
//           (title, goal, success criteria, context).
//   Step 2: How — review recipe, confirm agent assignment, approval
//           granularity, start.
//
// Categories map to playbook defaults so the 80% case needs zero config:
//   💡 Feature     → Full ADLC
//   ⚒ Enhancement → Build & Ship (skip Discover)
//   🐛 Bug         → Bug Triage
//   🧪 Research    → Research Only (Discover, no build)
//   🚀 Other       → user picks
//
// User can always override the suggested playbook before starting.

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useAgentStore } from "@/stores"
import { Loader2, Play, AlertCircle, CheckCircle2, ArrowLeft, ArrowRight, Lightbulb, Wrench, Bug, FlaskConical, Rocket, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import { graphToStepper } from "@/lib/pipelines/stepper"
import { ROLE_CONTRACTS } from "@/lib/pipelines/role-contracts"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import type { Pipeline, PipelineRunDetail, Agent } from "@/types"

interface NewMissionModalProps {
  onClose: () => void
  onCreated: (mission: PipelineRunDetail) => void
  initialPlaybookId?: string
}

interface StepAssignment {
  stepId: string
  label: string
  emoji: string
  roleId?: AdlcRoleId
  candidates: Agent[]
  agentId: string
}

type Category = "feature" | "enhancement" | "bug" | "research" | "other"

const CATEGORIES: Array<{
  id: Category
  label: string
  emoji: string
  icon: React.ElementType
  description: string
  defaultPlaybookId: string | null
}> = [
  {
    id: "feature",
    label: "Feature",
    emoji: "💡",
    icon: Lightbulb,
    description: "New functionality end-to-end",
    defaultPlaybookId: "adlc-full",
  },
  {
    id: "enhancement",
    label: "Enhancement",
    emoji: "⚒",
    icon: Wrench,
    description: "Improve existing — PRD already exists",
    defaultPlaybookId: "build-ship",
  },
  {
    id: "bug",
    label: "Bug",
    emoji: "🐛",
    icon: Bug,
    description: "Fast fix path",
    defaultPlaybookId: "bug-triage",
  },
  {
    id: "research",
    label: "Research",
    emoji: "🧪",
    icon: FlaskConical,
    description: "Explore, validate. No implementation.",
    defaultPlaybookId: "research-only",
  },
  {
    id: "other",
    label: "Other",
    emoji: "🚀",
    icon: Rocket,
    description: "Pick your own playbook",
    defaultPlaybookId: null,
  },
]

export function NewMissionModal({ onClose, onCreated, initialPlaybookId }: NewMissionModalProps) {
  const nav = useNavigate()
  const agents = useAgentStore((s) => s.agents)
  const setAgents = useAgentStore((s) => s.setAgents)

  const [step, setStep] = useState<1 | 2>(1)
  const [playbooks, setPlaybooks] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Step 1 fields
  const [category, setCategory] = useState<Category | null>(null)
  const [playbookId, setPlaybookId] = useState<string>(initialPlaybookId || "")
  const [title, setTitle] = useState("")
  const [goal, setGoal] = useState("")
  const [successCriteria, setSuccessCriteria] = useState("")
  const [context, setContext] = useState("")

  // Step 2 overrides
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // Fetch playbooks + agents on mount
  useEffect(() => {
    Promise.all([api.listPlaybooks(), agents.length ? Promise.resolve(agents) : api.getAgents()])
      .then(([pls, ags]) => {
        setPlaybooks(pls)
        if (agents.length === 0) setAgents(ags as Agent[])
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-suggest playbook when category changes. Only override if user hasn't
  // manually touched playbookId.
  const [playbookTouched, setPlaybookTouched] = useState(!!initialPlaybookId)
  useEffect(() => {
    if (!category || playbookTouched) return
    const cat = CATEGORIES.find((c) => c.id === category)
    if (!cat?.defaultPlaybookId) return
    const match = playbooks.find((p) => p.id === cat.defaultPlaybookId || p.id.endsWith(cat.defaultPlaybookId!))
    if (match) setPlaybookId(match.id)
  }, [category, playbooks, playbookTouched])

  const selectedPlaybook = playbooks.find((p) => p.id === playbookId)

  const assignments = useMemo<StepAssignment[]>(() => {
    if (!selectedPlaybook) return []
    const res = graphToStepper(selectedPlaybook.graph)
    if (!res.ok || !res.state) return []
    return res.state.steps.map((s) => {
      const contract = s.roleId ? ROLE_CONTRACTS[s.roleId] : null
      const candidates = s.roleId
        ? agents.filter((a) => (a as Agent & { role?: string }).role === s.roleId)
        : agents
      const defaultAgent = s.agentId || (candidates.length === 1 ? candidates[0].id : "")
      return {
        stepId: s.id,
        label: s.label,
        emoji: contract?.emoji || "🤖",
        roleId: s.roleId,
        candidates,
        agentId: defaultAgent,
      }
    })
  }, [selectedPlaybook, agents])

  useEffect(() => setOverrides({}), [playbookId])

  const finalAssignments = assignments.map((a) => ({
    ...a,
    agentId: overrides[a.stepId] ?? a.agentId,
  }))
  const ambiguous = finalAssignments.filter((a) => a.agentId === "" && a.candidates.length > 1)
  const missing = finalAssignments.filter((a) => a.agentId === "" && a.candidates.length === 0)

  const canNext =
    step === 1
      ? !!category && !!playbookId && !!title.trim() && !!goal.trim()
      : missing.length === 0 && ambiguous.length === 0

  const buildDescription = (): string => {
    const parts: string[] = []
    if (goal.trim()) parts.push(`## Goal\n${goal.trim()}`)
    if (successCriteria.trim()) parts.push(`## Success criteria\n${successCriteria.trim()}`)
    if (context.trim()) parts.push(`## Context\n${context.trim()}`)
    return parts.join("\n\n")
  }

  const handleStart = async () => {
    if (!canNext || !selectedPlaybook) return
    setSubmitting(true)
    setError(null)
    try {
      const agentResolution: Record<string, string> = {}
      for (const a of finalAssignments) {
        if (a.agentId) agentResolution[a.stepId] = a.agentId
      }
      const detail = await api.createMission({
        playbookId,
        title: title.trim(),
        description: buildDescription(),
        agentResolution,
      })
      onCreated(detail)
      nav(`/missions/${detail.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Mission</DialogTitle>
          <DialogDescription>
            Step {step} of 2 — {step === 1 ? "describe what you're building" : "confirm how agents will work"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : playbooks.length === 0 ? (
          <div className="p-4 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-sm">
            No playbooks yet. Create one in the Playbooks tab first.
          </div>
        ) : step === 1 ? (
          <div className="space-y-4">
            {/* Category */}
            <div>
              <label className="text-xs font-medium mb-2 block">What kind of work?</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map((c) => {
                  const Icon = c.icon
                  const active = category === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCategory(c.id)
                        setPlaybookTouched(false)
                      }}
                      className={cn(
                        "text-left p-2.5 rounded-md border transition-colors",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-primary/50",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                        <span className="text-sm font-semibold">{c.emoji} {c.label}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{c.description}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Playbook (auto-suggested from category) */}
            {category && (
              <div>
                <label className="text-xs font-medium mb-1 block">Playbook</label>
                <select
                  value={playbookId}
                  onChange={(e) => { setPlaybookId(e.target.value); setPlaybookTouched(true) }}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                >
                  <option value="">— pick a playbook —</option>
                  {playbooks.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {selectedPlaybook?.description && (
                  <div className="text-[11px] text-muted-foreground mt-1">{selectedPlaybook.description}</div>
                )}
              </div>
            )}

            {/* Title */}
            <div>
              <label className="text-xs font-medium mb-1 block">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Add dark mode toggle"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                autoFocus
              />
            </div>

            {/* Goal */}
            <div>
              <label className="text-xs font-medium mb-1 block">
                Goal <span className="text-muted-foreground">— what &amp; for whom</span>
              </label>
              <textarea
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Let users switch between light/dark theme in settings. Users with sensitive eyes or night-usage prefer dark."
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-y"
              />
            </div>

            {/* Success criteria */}
            <div>
              <label className="text-xs font-medium mb-1 block">
                Success criteria <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                rows={2}
                value={successCriteria}
                onChange={(e) => setSuccessCriteria(e.target.value)}
                placeholder="95% of users who toggle once stick with their choice."
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-y"
              />
            </div>

            {/* Context */}
            <div>
              <label className="text-xs font-medium mb-1 block">
                Context & related work <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                rows={2}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Links, prior PRs, designs, related tickets, screenshots…"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-y font-mono"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-md border border-border bg-card">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Mission</div>
              <div className="text-sm font-semibold mb-1">{title}</div>
              <div className="text-[11px] text-muted-foreground">
                Playbook: {selectedPlaybook?.name || "—"}
              </div>
            </div>

            {selectedPlaybook?.graph?.metadata?.repo?.path && (
              <div className="p-3 rounded-md border border-primary/30 bg-primary/5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-primary mb-1">
                  <GitBranch className="h-3 w-3" /> Worktree on start
                </div>
                <div className="text-xs space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-14">Repo:</span>
                    <span className="font-mono truncate">{selectedPlaybook.graph.metadata.repo.path}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-14">From:</span>
                    <span className="font-mono">{selectedPlaybook.graph.metadata.repo.baseBranch || "HEAD"}</span>
                  </div>
                  {selectedPlaybook.graph.metadata.repo.autoBranch !== false && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-14">Branch:</span>
                      <span className="font-mono text-primary">mission/{"{MIS-xxx}"}</span>
                      <span className="text-[10px] text-muted-foreground">auto-created</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {finalAssignments.length > 0 && (
              <div>
                <label className="text-xs font-medium mb-2 block">Agent assignment</label>
                <div className="space-y-1.5">
                  {finalAssignments.map((a) => {
                    const isMissing = a.agentId === "" && a.candidates.length === 0
                    const isAmbiguous = a.agentId === "" && a.candidates.length > 1
                    const isAuto = a.agentId !== "" && a.candidates.length === 1
                    return (
                      <div
                        key={a.stepId}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-md border text-sm",
                          isMissing && "border-red-500/30 bg-red-500/5",
                          isAmbiguous && "border-amber-500/30 bg-amber-500/5",
                          !isMissing && !isAmbiguous && "border-border bg-card",
                        )}
                      >
                        <span className="text-base">{a.emoji}</span>
                        <span className="font-medium flex-1 truncate">{a.label}</span>
                        {isMissing ? (
                          <span className="flex items-center gap-1 text-xs text-red-400">
                            <AlertCircle className="h-3.5 w-3.5" /> No agent with role {a.roleId}
                          </span>
                        ) : (
                          <select
                            value={a.agentId}
                            onChange={(e) => setOverrides((s) => ({ ...s, [a.stepId]: e.target.value }))}
                            className="px-2 py-1 rounded-md border border-border bg-background text-xs w-48"
                          >
                            <option value="">— pick agent —</option>
                            {a.candidates.map((c) => (
                              <option key={c.id} value={c.id}>{c.name || c.id}</option>
                            ))}
                          </select>
                        )}
                        {isAuto && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                      </div>
                    )
                  })}
                </div>
                {missing.length > 0 && (
                  <div className="text-[11px] text-red-400 mt-2">
                    {missing.length} role(s) have no agent — assign the role to an existing agent,
                    or provision a new agent with that role before starting.
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-2 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 text-xs">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!canNext}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={handleStart} disabled={!canNext || submitting}>
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Start Mission
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
