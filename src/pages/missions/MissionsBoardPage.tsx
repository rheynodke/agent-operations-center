// Missions Board — primary landing.
//
// Inbox-first layout: pending approvals at top (highlighted + CTA), then
// active missions, then recently delivered (collapsed). Each card shows a
// 3-phase progress strip so users see "what phase are we in" at a glance
// without opening the canvas.

import { useEffect, useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Target,
  Plus,
  Loader2,
  Hand,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { NewMissionModal } from "@/components/pipelines/NewMissionModal"
import { PHASES } from "@/lib/pipelines/phases"
import type { PipelineRun } from "@/types"

function fmtRelative(ts?: string | null): string {
  if (!ts) return "—"
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function statusConfig(status: PipelineRun["status"]) {
  switch (status) {
    case "queued":           return { icon: Clock,        label: "Queued",          cls: "text-muted-foreground" }
    case "running":          return { icon: Loader2,      label: "Running",         cls: "text-blue-400 animate-spin" }
    case "waiting_approval": return { icon: Hand,         label: "Needs approval",  cls: "text-orange-400" }
    case "completed":        return { icon: CheckCircle2, label: "Delivered",       cls: "text-emerald-400" }
    case "failed":           return { icon: XCircle,      label: "Failed",          cls: "text-red-400" }
    case "cancelled":        return { icon: XCircle,      label: "Cancelled",       cls: "text-muted-foreground" }
  }
}

// Approximate per-phase progress using the flat `progress.total/done` counts.
// Without calling getMission() per card we can't know exactly how each step
// maps to a phase, so we split proportionally by phase count (3 phases).
function PhaseStrip({ run }: { run: PipelineRun }) {
  // We don't have per-phase breakdown in list endpoint. Approximate: divide
  // total steps evenly across 3 phases and fill done linearly.
  const total = run.progress?.total || 0
  const done = run.progress?.done || 0
  const failed = run.progress?.failed || 0
  const perPhase = total > 0 ? total / 3 : 0
  return (
    <div className="flex items-center gap-1.5">
      {PHASES.map((p, i) => {
        const phaseStart = perPhase * i
        const phaseEnd = perPhase * (i + 1)
        let fillPct = 0
        if (done >= phaseEnd) fillPct = 100
        else if (done > phaseStart) fillPct = ((done - phaseStart) / perPhase) * 100
        else fillPct = 0
        const active = done >= phaseStart && done < phaseEnd && run.status !== "completed" && run.status !== "failed"
        const isFailed = failed > 0 && fillPct > 0
        return (
          <div key={p.id} className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden relative">
              <div
                className={cn(
                  "h-full transition-all",
                  isFailed ? "bg-red-500" : active ? "bg-primary" : "bg-primary/80",
                )}
                style={{ width: `${fillPct}%` }}
              />
              {active && (
                <div className="absolute inset-0 animate-pulse bg-primary/20" />
              )}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground truncate text-center">
              {p.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MissionCard({ run }: { run: PipelineRun }) {
  const nav = useNavigate()
  const cfg = statusConfig(run.status)
  const Icon = cfg.icon
  const needsApproval = run.status === "waiting_approval"
  return (
    <div
      onClick={() => nav(`/missions/${run.id}`)}
      className={cn(
        "group cursor-pointer border rounded-md p-3 transition-colors",
        needsApproval
          ? "border-orange-500/30 bg-orange-500/5 hover:border-orange-500/60"
          : "border-border bg-card hover:border-primary/60",
      )}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              {run.displayId || run.id.slice(0, 8)}
            </span>
            <div className="text-sm font-semibold truncate">
              {run.title || "Untitled mission"}
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>{run.pipelineName || "—"}</span>
            <span className={cn("flex items-center gap-1", cfg.cls)}>
              <Icon className="h-3 w-3" />
              {cfg.label}
            </span>
            <span>Updated {fmtRelative(run.endedAt || run.startedAt)}</span>
          </div>
        </div>
        {needsApproval && (
          <Button
            size="sm"
            onClick={(e) => { e.stopPropagation(); nav(`/missions/${run.id}`) }}
            className="bg-orange-600 hover:bg-orange-700 shrink-0"
          >
            Review →
          </Button>
        )}
      </div>
      <PhaseStrip run={run} />
    </div>
  )
}

function Section({
  title, subtitle, runs, defaultOpen = true, accentClass,
}: {
  title: string
  subtitle?: string
  runs: PipelineRun[]
  defaultOpen?: boolean
  accentClass?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (runs.length === 0) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 py-2 text-sm font-semibold transition-colors hover:opacity-80"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className={accentClass || "text-foreground"}>{title}</span>
        <span className="text-xs font-normal text-muted-foreground">({runs.length})</span>
        {subtitle && <span className="text-xs font-normal text-muted-foreground ml-2">— {subtitle}</span>}
      </button>
      {open && (
        <div className="space-y-2">
          {runs.map((r) => <MissionCard key={r.id} run={r} />)}
        </div>
      )}
    </div>
  )
}

export function MissionsBoardPage() {
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.listMissions()
      setRuns(data)
      setError(null)
    } catch (err) {
      if (!silent) setError((err as Error).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
    const i = setInterval(() => load(true), 5000)
    return () => clearInterval(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { needApproval, active, delivered } = useMemo(() => {
    const needApproval: PipelineRun[] = []
    const active: PipelineRun[] = []
    const delivered: PipelineRun[] = []
    for (const r of runs) {
      if (r.status === "waiting_approval") needApproval.push(r)
      else if (["queued", "running"].includes(r.status)) active.push(r)
      else delivered.push(r)
    }
    return { needApproval, active, delivered }
  }, [runs])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Target className="h-6 w-6 text-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Missions</h1>
            <p className="text-xs text-muted-foreground">
              Multi-agent work items moving through Discover → Develop → Deliver
            </p>
          </div>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Mission
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading && runs.length === 0 && (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading missions…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 text-sm mb-4">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {!loading && runs.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-16">
            <Target className="h-16 w-16 opacity-30 mb-3" />
            <div className="text-lg font-medium text-foreground mb-1">No missions yet</div>
            <div className="text-sm mb-6 max-w-md">
              Start your first mission to see agents collaborate through the ADLC.
            </div>
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> New Mission
            </Button>
          </div>
        )}
        {runs.length > 0 && (
          <div className="space-y-6 max-w-4xl">
            {needApproval.length > 0 && (
              <Section
                title="🛎 Needs your attention"
                subtitle="waiting for approval"
                runs={needApproval}
                accentClass="text-orange-400"
              />
            )}
            <Section
              title="⏳ In progress"
              runs={active}
              accentClass="text-blue-400"
            />
            <Section
              title="✓ Delivered"
              runs={delivered}
              defaultOpen={false}
              accentClass="text-emerald-400"
            />
          </div>
        )}
      </div>

      {newOpen && (
        <NewMissionModal
          onClose={() => setNewOpen(false)}
          onCreated={(mission) => {
            setNewOpen(false)
            setRuns((r) => [mission, ...r])
          }}
        />
      )}
    </div>
  )
}
