// Mission Canvas — the hero view for a single mission.
//
// Layout: header + 3-phase progress strip + tabs (Overview / per-phase /
// Activity). Overview is default — shows brief, current action, artifacts,
// agent roster. Per-phase tabs drill into that phase's steps + approvals.
// Activity is chronological event log.

import { useEffect, useState, useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ArrowLeft, Target, Loader2, AlertCircle, CheckCircle2, XCircle, Clock,
  Hand, Ban, RefreshCw, FileText, Users, ListTree, Activity, GitBranch,
  Github, Copy,
} from "lucide-react"
import {
  PHASES,
  groupStepsByPhase,
  computePhaseProgress,
  currentPhase,
  type PhaseId,
} from "@/lib/pipelines/phases"
import type { PipelineRunDetail, PipelineStep } from "@/types"

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtRelative(ts?: string | null): string {
  if (!ts) return "—"
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function fmtDuration(startIso?: string | null, endIso?: string | null): string | null {
  if (!startIso) return null
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const diff = end - new Date(startIso).getTime()
  if (diff < 1000) return "<1s"
  if (diff < 60000) return `${Math.round(diff / 1000)}s`
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`
  return `${(diff / 3600000).toFixed(1)}h`
}

function StatusIcon({ status }: { status: PipelineStep["status"] }) {
  const map: Record<PipelineStep["status"], { icon: React.ElementType; cls: string }> = {
    pending:   { icon: Clock,        cls: "text-muted-foreground" },
    queued:    { icon: Clock,        cls: "text-muted-foreground" },
    running:   { icon: Loader2,      cls: "text-blue-400 animate-spin" },
    done:      { icon: CheckCircle2, cls: "text-emerald-400" },
    failed:    { icon: XCircle,      cls: "text-red-400" },
    skipped:   { icon: Clock,        cls: "text-yellow-400" },
    cancelled: { icon: Ban,          cls: "text-muted-foreground" },
  }
  const { icon: Icon, cls } = map[status]
  return <Icon className={cn("h-4 w-4 shrink-0", cls)} />
}

// ─── Phase progress strip ───────────────────────────────────────────────────
function PhaseStrip({ mission }: { mission: PipelineRunDetail }) {
  const progress = computePhaseProgress(mission)
  const current = currentPhase(progress)
  return (
    <div className="grid grid-cols-3 gap-4">
      {progress.map((p) => {
        const phase = PHASES.find((ph) => ph.id === p.phase)!
        const isCurrent = p.phase === current && mission.status !== "completed"
        const pct = p.total > 0 ? (p.done / p.total) * 100 : 0
        return (
          <div key={p.phase}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-base">{phase.emoji}</span>
              <span className={cn("text-sm font-semibold", phase.color)}>{phase.label}</span>
              {isCurrent && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary uppercase tracking-wide">
                  current
                </span>
              )}
              <span className="flex-1" />
              <span className="text-[10px] text-muted-foreground font-mono">
                {p.done}/{p.total}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all",
                  p.failed ? "bg-red-500" : isCurrent ? "bg-primary" : "bg-primary/80",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Step row ───────────────────────────────────────────────────────────────
function StepRow({
  step, mission, onApprove, onReject, onComplete, loading, comment, setComment,
}: {
  step: PipelineStep
  mission: PipelineRunDetail
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onComplete: (id: string) => void
  loading: string | null
  comment: string
  setComment: (s: string) => void
}) {
  const display = mission.stepDisplay.find((d) => d.stepId === step.id)
  const isApproval = step.nodeType === "human_approval"
  const isRunning = step.status === "running"
  const isDone = step.status === "done"
  const isPending = step.status === "pending"
  const isAwaiting = isRunning && isApproval

  return (
    <div
      className={cn(
        "border rounded-md transition-colors",
        isAwaiting
          ? "border-orange-500/40 bg-orange-500/5"
          : isRunning
          ? "border-blue-500/40 bg-blue-500/5"
          : step.status === "failed"
          ? "border-red-500/30 bg-red-500/5"
          : "border-border bg-card",
        isPending && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <StatusIcon status={step.status} />
        {display?.emoji && <span className="text-base">{display.emoji}</span>}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{display?.label || step.nodeId}</div>
          {display?.agentName && (
            <div className="text-[10px] text-muted-foreground">{display.agentName}</div>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {isDone && step.startedAt && step.endedAt
            ? fmtDuration(step.startedAt, step.endedAt)
            : isRunning && step.startedAt
            ? `${fmtDuration(step.startedAt)} elapsed`
            : step.status}
        </div>
      </div>

      {isAwaiting && (
        <div className="px-3 pb-3 pt-1 border-t border-orange-500/20 space-y-2">
          {display?.approvalMessage && (
            <div className="text-xs italic text-muted-foreground">"{display.approvalMessage}"</div>
          )}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Optional comment..."
            className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs resize-none"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => onApprove(step.id)}
              disabled={loading === step.id}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {loading === step.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
              Approve & Continue
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReject(step.id)}
              disabled={loading === step.id}
              className="text-red-400 border-red-500/30 hover:bg-red-500/10"
            >
              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
            </Button>
          </div>
        </div>
      )}

      {isRunning && !isApproval && (
        <div className="px-3 pb-3 pt-1 border-t border-blue-500/20">
          <div className="flex items-center gap-2">
            <Hand className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground italic">
              Agent executing. Real executor pending (Phase R6).
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onComplete(step.id)}
              disabled={loading === step.id}
              className="ml-auto text-[11px]"
            >
              {loading === step.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Mark done (demo)
            </Button>
          </div>
        </div>
      )}

      {step.status === "failed" && step.error && (
        <div className="px-3 pb-2 pt-1 border-t border-red-500/20">
          <div className="text-xs text-red-400">{step.error}</div>
        </div>
      )}
    </div>
  )
}

// ─── Artifact list (by phase) ───────────────────────────────────────────────
function ArtifactsList({ mission }: { mission: PipelineRunDetail }) {
  const buckets = groupStepsByPhase(mission)
  const hasAny = (["discover", "develop", "deliver"] as PhaseId[]).some(
    (pid) => buckets[pid].steps.some((s) => s.status === "done" && s.nodeType === "agent"),
  )
  if (!hasAny) {
    return <div className="text-xs text-muted-foreground italic">No artifacts produced yet.</div>
  }
  return (
    <div className="space-y-3">
      {(["discover", "develop", "deliver"] as PhaseId[]).map((pid) => {
        const phase = PHASES.find((p) => p.id === pid)!
        const done = buckets[pid].steps.filter(
          (s) => s.nodeType === "agent" && s.status === "done",
        )
        if (done.length === 0) return null
        return (
          <div key={pid}>
            <div className={cn("text-[11px] font-semibold uppercase tracking-wide mb-1", phase.color)}>
              {phase.emoji} {phase.label}
            </div>
            <div className="space-y-0.5">
              {done.map((s) => {
                const display = mission.stepDisplay.find((d) => d.stepId === s.id)
                return (
                  <div key={s.id} className="flex items-center gap-2 text-xs py-0.5">
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-mono text-muted-foreground">{display?.label || s.nodeId}</span>
                    <span className="flex-1" />
                    <span className="text-[10px] text-muted-foreground">
                      {display?.agentName || "—"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {fmtRelative(s.endedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Worktree card ──────────────────────────────────────────────────────────
function WorktreeCard({ worktree }: { worktree: NonNullable<PipelineRunDetail["worktree"]> }) {
  const copy = (v: string) => {
    try { navigator.clipboard.writeText(v) } catch {}
  }
  return (
    <div className="border border-border rounded-md bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Branch</span>
        <span className="font-mono text-foreground truncate">{worktree.branch}</span>
        <span className="text-[10px] text-muted-foreground">
          (from <span className="font-mono">{worktree.baseBranch}</span>)
        </span>
        <button
          onClick={() => copy(worktree.branch)}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Copy branch name"
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Worktree</span>
        <span className="font-mono text-foreground truncate">{worktree.path}</span>
        <button
          onClick={() => copy(worktree.path)}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Copy path"
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Github className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Repo</span>
        {worktree.repoUrl ? (
          <a
            href={worktree.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline truncate"
          >
            {worktree.repoUrl}
          </a>
        ) : (
          <span className="font-mono text-foreground truncate">{worktree.repoPath}</span>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/60">
        Each agent step runs with this worktree as its working directory. Changes are
        committed to the mission branch and can be reviewed from here.
      </div>
    </div>
  )
}

// ─── Agent roster ───────────────────────────────────────────────────────────
function AgentRoster({ mission }: { mission: PipelineRunDetail }) {
  const agentSteps = mission.steps.filter((s) => s.nodeType === "agent")
  if (agentSteps.length === 0) return (
    <div className="text-xs text-muted-foreground italic">No agents assigned.</div>
  )
  return (
    <div className="space-y-1">
      {agentSteps.map((s) => {
        const display = mission.stepDisplay.find((d) => d.stepId === s.id)
        const statusLabel =
          s.status === "done"    ? "✓ delivered"
          : s.status === "running" ? "⏳ active"
          : s.status === "failed"  ? "✗ failed"
          : s.status === "pending" ? "⏸ queued"
          : s.status
        const statusCls =
          s.status === "done"    ? "text-emerald-400"
          : s.status === "running" ? "text-blue-400"
          : s.status === "failed"  ? "text-red-400"
          : "text-muted-foreground"
        return (
          <div key={s.id} className="flex items-center gap-2 text-xs py-1">
            <span className="text-base">{display?.emoji}</span>
            <span className="font-medium">{display?.agentName || "unassigned"}</span>
            <span className="text-muted-foreground">· {display?.label}</span>
            <span className="flex-1" />
            <span className={statusCls}>{statusLabel}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Activity feed ──────────────────────────────────────────────────────────
function ActivityFeed({ mission }: { mission: PipelineRunDetail }) {
  type Event = { ts: string; detail: string; cls?: string }
  const events: Event[] = []
  events.push({
    ts: mission.startedAt,
    detail: `Mission created${mission.triggeredByName ? ` by @${mission.triggeredByName}` : ""}`,
  })
  for (const step of mission.steps) {
    const display = mission.stepDisplay.find((d) => d.stepId === step.id)
    const label = display?.label || step.nodeId
    if (step.startedAt) {
      events.push({
        ts: step.startedAt,
        detail: step.nodeType === "human_approval"
          ? `Approval gate opened: ${label}`
          : `${display?.agentName || label} started`,
        cls: "text-blue-400",
      })
    }
    if (step.status === "done" && step.endedAt) {
      events.push({
        ts: step.endedAt,
        detail: step.nodeType === "human_approval"
          ? `Approved: ${label}`
          : `${display?.agentName || label} finished`,
        cls: "text-emerald-400",
      })
    }
    if (step.status === "failed" && step.endedAt) {
      events.push({
        ts: step.endedAt,
        detail: `${label} failed${step.error ? ` — ${step.error}` : ""}`,
        cls: "text-red-400",
      })
    }
  }
  if (mission.endedAt) {
    events.push({
      ts: mission.endedAt,
      detail: `Mission ${mission.status}`,
      cls: mission.status === "completed" ? "text-emerald-400" : "text-red-400",
    })
  }
  events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  if (events.length === 0) return (
    <div className="text-xs text-muted-foreground italic">No activity yet.</div>
  )
  return (
    <div className="space-y-1">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/40 last:border-0">
          <span className="text-[10px] text-muted-foreground shrink-0 font-mono w-20">
            {fmtRelative(e.ts)}
          </span>
          <span className={cn("flex-1", e.cls || "text-foreground")}>
            {e.detail}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Per-phase tab ──────────────────────────────────────────────────────────
function PhaseTab({
  mission, phase, onApprove, onReject, onComplete, loading, comment, setComment,
}: {
  mission: PipelineRunDetail
  phase: PhaseId
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onComplete: (id: string) => void
  loading: string | null
  comment: string
  setComment: (s: string) => void
}) {
  const buckets = groupStepsByPhase(mission)
  const bucket = buckets[phase]
  const phaseMeta = PHASES.find((p) => p.id === phase)!

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{phaseMeta.emoji}</span>
        <div>
          <div className={cn("text-base font-semibold", phaseMeta.color)}>
            {phaseMeta.label} phase
          </div>
          <div className="text-xs text-muted-foreground">{phaseMeta.description}</div>
        </div>
      </div>
      {bucket.steps.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-8 text-center">
          No steps in this phase.
        </div>
      ) : (
        <div className="space-y-2">
          {bucket.steps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              mission={mission}
              onApprove={onApprove}
              onReject={onReject}
              onComplete={onComplete}
              loading={loading}
              comment={comment}
              setComment={setComment}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Overview tab ───────────────────────────────────────────────────────────
function OverviewTab({
  mission, onApprove, onReject, onComplete, loading, comment, setComment,
}: {
  mission: PipelineRunDetail
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onComplete: (id: string) => void
  loading: string | null
  comment: string
  setComment: (s: string) => void
}) {
  const activeStep = mission.steps.find((s) => s.status === "running")

  return (
    <div className="space-y-5">
      {mission.description && (
        <div className="border border-border rounded-md bg-card p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Brief
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{mission.description}</pre>
        </div>
      )}

      {activeStep && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
            <Hand className="h-4 w-4 text-orange-400" />
            {activeStep.nodeType === "human_approval" ? "Needs your attention" : "In progress"}
          </div>
          <StepRow
            step={activeStep}
            mission={mission}
            onApprove={onApprove}
            onReject={onReject}
            onComplete={onComplete}
            loading={loading}
            comment={comment}
            setComment={setComment}
          />
        </div>
      )}

      {mission.worktree && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
            <GitBranch className="h-4 w-4 text-muted-foreground" /> Worktree
          </div>
          <WorktreeCard worktree={mission.worktree} />
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-muted-foreground" /> Artifacts
        </div>
        <div className="border border-border rounded-md bg-card p-3">
          <ArtifactsList mission={mission} />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-muted-foreground" /> Agents on this mission
        </div>
        <div className="border border-border rounded-md bg-card p-3">
          <AgentRoster mission={mission} />
        </div>
      </div>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────
type TabKey = "overview" | PhaseId | "activity"

export function MissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [mission, setMission] = useState<PipelineRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [comment, setComment] = useState("")
  const [tab, setTab] = useState<TabKey>("overview")

  const load = useCallback(async (silent = false) => {
    if (!id) return
    try {
      const r = await api.getMission(id)
      setMission(r)
      setError(null)
    } catch (err) {
      if (!silent) setError((err as Error).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load(false)
    const i = setInterval(() => load(true), 4000)
    return () => clearInterval(i)
  }, [load])

  const approve = async (stepId: string) => {
    if (!id) return
    setActionLoading(stepId)
    try {
      const d = await api.approveMissionStep(id, stepId, comment.trim() || undefined)
      setMission(d); setComment("")
    } catch (err) { setError((err as Error).message) } finally { setActionLoading(null) }
  }
  const reject = async (stepId: string) => {
    if (!id) return
    setActionLoading(stepId)
    try {
      const d = await api.rejectMissionStep(id, stepId, comment.trim() || undefined)
      setMission(d); setComment("")
    } catch (err) { setError((err as Error).message) } finally { setActionLoading(null) }
  }
  const completeStep = async (stepId: string) => {
    if (!id) return
    setActionLoading(stepId)
    try {
      const d = await api.completeMissionStep(id, stepId)
      setMission(d)
    } catch (err) { setError((err as Error).message) } finally { setActionLoading(null) }
  }
  const cancel = async () => {
    if (!id) return
    if (!confirm("Cancel this mission? Running steps will be aborted and pending steps skipped.")) return
    try {
      const d = await api.cancelMission(id)
      setMission(d)
    } catch (err) { setError((err as Error).message) }
  }

  if (loading && !mission) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading mission…
      </div>
    )
  }
  if (!mission) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => nav("/missions")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="mt-4 p-3 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 inline mr-1" /> {error || "Mission not found"}
        </div>
      </div>
    )
  }

  const isActive = ["queued", "running", "waiting_approval"].includes(mission.status)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" onClick={() => nav("/missions")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Target className="h-5 w-5 text-primary" />
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {mission.displayId || mission.id.slice(0, 8)}
          </span>
          <span className="text-base font-semibold truncate">{mission.title || "Untitled mission"}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {mission.pipelineName} · Started {fmtRelative(mission.startedAt)}
        </div>
        {isActive && (
          <Button variant="outline" size="sm" onClick={cancel}>
            <Ban className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
        )}
      </div>

      <div className="px-6 py-4 border-b border-border shrink-0">
        <PhaseStrip mission={mission} />
      </div>

      <div className="flex items-center gap-1 px-6 border-b border-border shrink-0 overflow-x-auto">
        {([
          { key: "overview", label: "Overview", icon: ListTree },
          { key: "discover", label: "🔍 Discover" },
          { key: "develop",  label: "⚒ Develop" },
          { key: "deliver",  label: "🚀 Deliver" },
          { key: "activity", label: "Activity", icon: Activity },
        ] as const).map((t) => {
          const Icon = "icon" in t ? t.icon : null
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-[1px]",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          {error && (
            <div className="flex items-center gap-2 p-2 mb-4 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 text-xs">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
          {tab === "overview" && (
            <OverviewTab mission={mission} onApprove={approve} onReject={reject} onComplete={completeStep} loading={actionLoading} comment={comment} setComment={setComment} />
          )}
          {(tab === "discover" || tab === "develop" || tab === "deliver") && (
            <PhaseTab mission={mission} phase={tab} onApprove={approve} onReject={reject} onComplete={completeStep} loading={actionLoading} comment={comment} setComment={setComment} />
          )}
          {tab === "activity" && (
            <div>
              <div className="text-sm font-semibold mb-3">📜 Activity</div>
              <div className="border border-border rounded-md bg-card p-3">
                <ActivityFeed mission={mission} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
