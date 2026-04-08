import { useState, useEffect } from "react"
import { useCronStore, useAgentStore } from "@/stores"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { CronJob, CronRun } from "@/types"
import { api } from "@/lib/api"
import { CronJobFormDialog } from "@/components/cron/CronJobFormDialog"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import {
  Timer, Clock, Hash, CheckCircle2, XCircle, Plus, MoreVertical,
  Play, Pencil, Trash2, History, PauseCircle, PlayCircle, Loader2,
  AlertCircle, ChevronDown, ChevronUp, Send, Zap, Activity,
  CheckCheck, Ban, RefreshCw, Users,
} from "lucide-react"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms?: number) {
  if (!ms) return "—"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60000)}m`
}

function fmtRelative(ts?: string | null): string {
  if (!ts) return "—"
  const diff = Date.now() - new Date(ts).getTime()
  if (Math.abs(diff) < 30000) return "Just now"
  if (diff < 0) {
    const abs = Math.abs(diff)
    if (abs < 60000) return `in ${Math.round(abs / 1000)}s`
    if (abs < 3600000) return `in ${Math.round(abs / 60000)}m`
    return `in ${Math.round(abs / 3600000)}h`
  }
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function fmtAbsolute(ts?: string | null): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

// ─── Status configs ───────────────────────────────────────────────────────────

const RUN_STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  succeeded: { label: "succeeded", cls: "bg-[var(--status-active-bg)] text-[var(--status-active-text)]", icon: CheckCheck },
  error:     { label: "error",     cls: "bg-[var(--status-error-bg)] text-[var(--status-error-text)]",   icon: XCircle },
  cancelled: { label: "skipped",   cls: "bg-[var(--status-paused-bg)] text-[var(--status-paused-text)]", icon: Ban },
  running:   { label: "running",   cls: "bg-blue-500/15 text-blue-400",                                   icon: RefreshCw },
  failed:    { label: "failed",    cls: "bg-[var(--status-error-bg)] text-[var(--status-error-text)]",   icon: XCircle },
}

function RunStatusBadge({ status }: { status: string }) {
  const cfg = RUN_STATUS_CONFIG[status] || RUN_STATUS_CONFIG.cancelled
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0", cfg.cls)}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  )
}

// ─── Runs Dialog ──────────────────────────────────────────────────────────────

type ExtendedRun = CronRun & { delivered?: boolean; model?: string }

const STATUS_DOT: Record<string, string> = {
  succeeded: "bg-[var(--status-active-text)]",
  error:     "bg-[var(--status-error-text)]",
  failed:    "bg-[var(--status-error-text)]",
  cancelled: "bg-[var(--status-paused-text)]",
  running:   "bg-blue-400",
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  succeeded: { text: "Succeeded",  cls: "text-[var(--status-active-text)]" },
  error:     { text: "Error",      cls: "text-[var(--status-error-text)]" },
  failed:    { text: "Failed",     cls: "text-[var(--status-error-text)]" },
  cancelled: { text: "Skipped",    cls: "text-[var(--status-paused-text)]" },
  running:   { text: "Running",    cls: "text-blue-400" },
}

function RunRow({ run, isLast }: { run: ExtendedRun; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const dot = STATUS_DOT[run.status] || STATUS_DOT.cancelled
  const lbl = STATUS_LABEL[run.status] || STATUS_LABEL.cancelled
  const isError = run.status === "failed"
  const hasExpand = !!(run.summary || run.error)

  return (
    <div className="flex gap-0">
      {/* Timeline column */}
      <div className="flex flex-col items-center w-8 shrink-0 pt-1">
        <div className={cn("w-2.5 h-2.5 rounded-full shrink-0 mt-1 ring-2 ring-background", dot)} />
        {!isLast && <div className="w-px flex-1 bg-border/40 mt-1.5 mb-0" />}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0 pb-5", isLast && "pb-2")}>
        {/* Top row: status label + time + meta */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-xs font-semibold", lbl.cls)}>{lbl.text}</span>
          <span className="text-xs text-muted-foreground">{fmtAbsolute(run.startedAt)}</span>
          <span className="text-xs text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground/60">{fmtRelative(run.startedAt)}</span>

          {/* Right-side meta */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {run.duration !== undefined && run.duration > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground bg-secondary rounded-md px-2 py-0.5">
                <Clock className="h-2.5 w-2.5" />
                {fmtDuration(run.duration)}
              </span>
            )}
            {run.delivered && (
              <span className="flex items-center gap-1 text-[11px] text-[var(--status-active-text)] bg-[var(--status-active-bg)] rounded-md px-2 py-0.5">
                <Send className="h-2.5 w-2.5" />
                sent
              </span>
            )}
            {run.model && (
              <span className="hidden md:block text-[10px] font-mono text-muted-foreground/40 truncate max-w-[120px]">
                {run.model}
              </span>
            )}
          </div>
        </div>

        {/* Summary message */}
        {run.summary && (
          <div
            className={cn(
              "mt-2 rounded-xl px-3 py-2.5 text-sm leading-relaxed",
              isError
                ? "bg-secondary text-foreground/70"
                : "bg-[var(--status-active-bg)]/30 text-foreground/80 border border-[var(--status-active-text)]/10"
            )}
          >
            <span className="text-muted-foreground/40 text-xs font-medium mr-1.5">message</span>
            {run.summary}
          </div>
        )}

        {/* Error detail */}
        {run.error && (
          <div
            className={cn(
              "mt-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed flex items-start gap-2",
              "bg-[var(--status-error-bg)] text-[var(--status-error-text)] border border-[var(--status-error-text)]/20"
            )}
          >
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{run.error}</span>
          </div>
        )}

        {/* No detail placeholder for skipped with no info */}
        {!run.summary && !run.error && (
          <p className="mt-1 text-xs text-muted-foreground/40 italic">No output</p>
        )}
      </div>
    </div>
  )
}

function RunsDialog({ job, onClose }: { job: CronJob; onClose: () => void }) {
  const [runs, setRuns] = useState<ExtendedRun[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getCronJobRuns(job.id, 50)
      .then((r) => setRuns((r as { runs: ExtendedRun[] }).runs ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [job.id])

  const total     = runs?.length ?? 0
  const succeeded = runs?.filter((r) => r.status === "succeeded").length ?? 0
  const errored   = runs?.filter((r) => r.status === "failed").length ?? 0
  const skipped   = runs?.filter((r) => r.status === "cancelled").length ?? 0
  const rate      = total > 0 ? Math.round((succeeded / total) * 100) : 0

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl flex flex-col gap-0 p-0 overflow-hidden" style={{ maxHeight: "88vh" }}>

        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
              <History className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold leading-tight">{job.name}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground/60 mt-0.5">
                Execution history
              </DialogDescription>
            </div>
          </div>

          {/* Stats pills */}
          {!loading && total > 0 && (
            <div className="flex items-center gap-2 pb-4 flex-wrap">
              <div className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs">
                <Activity className="h-3 w-3 text-muted-foreground" />
                <span className="font-semibold text-foreground">{total}</span>
                <span className="text-muted-foreground">runs</span>
              </div>
              {succeeded > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg bg-[var(--status-active-bg)] px-3 py-1.5 text-xs text-[var(--status-active-text)]">
                  <CheckCheck className="h-3 w-3" />
                  <span className="font-semibold">{succeeded}</span>
                  <span className="opacity-70">ok</span>
                </div>
              )}
              {errored > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg bg-[var(--status-error-bg)] px-3 py-1.5 text-xs text-[var(--status-error-text)]">
                  <XCircle className="h-3 w-3" />
                  <span className="font-semibold">{errored}</span>
                  <span className="opacity-70">failed</span>
                </div>
              )}
              {skipped > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg bg-[var(--status-paused-bg)] px-3 py-1.5 text-xs text-[var(--status-paused-text)]">
                  <Ban className="h-3 w-3" />
                  <span className="font-semibold">{skipped}</span>
                  <span className="opacity-70">skipped</span>
                </div>
              )}
              <div className="ml-auto text-xs text-muted-foreground font-medium">
                {rate}% success
              </div>
            </div>
          )}

          <div className="border-t border-border/40" />
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1 min-h-0">
          <div className="px-5 pt-5 pb-4">

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Loading run history…</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive justify-center py-12">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            {!loading && !error && total === 0 && (
              <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
                <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center">
                  <History className="h-6 w-6 opacity-40" />
                </div>
                <p className="text-sm">No runs recorded yet</p>
                <p className="text-xs opacity-50">Runs will appear here after the first execution</p>
              </div>
            )}

            {!loading && !error && runs && runs.length > 0 && (
              <div>
                {runs.map((run, i) => (
                  <RunRow key={run.runId || i} run={run} isLast={i === runs.length - 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeleteConfirmDialog({ job, onConfirm, onClose, loading }: {
  job: CronJob; onConfirm: () => void; onClose: () => void; loading: boolean
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete schedule?</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{job.name}</strong> will be permanently removed from jobs.json. Active runs won't be cancelled.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={onConfirm} disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Action menu ──────────────────────────────────────────────────────────────

function ActionMenu({ job, onEdit, onRun, onViewRuns, onToggle, onDelete }: {
  job: CronJob; onEdit: () => void; onRun: () => void
  onViewRuns: () => void; onToggle: () => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const isPaused = job.status === "paused" || job.enabled === false

  const items = [
    { icon: Pencil,                         label: "Edit",                    action: onEdit },
    { icon: Play,                           label: "Run now",                 action: onRun },
    { icon: History,                        label: "View runs",               action: onViewRuns },
    { icon: isPaused ? PlayCircle : PauseCircle, label: isPaused ? "Resume" : "Pause", action: onToggle },
    { icon: Trash2,                         label: "Delete",                  action: onDelete, destructive: true },
  ]

  return (
    <div className="relative">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 min-w-[150px] rounded-xl bg-popover ghost-border shadow-[var(--shadow-elevated)] py-1 overflow-hidden">
            {items.map((item) => (
              <button key={item.label} type="button"
                onClick={() => { setOpen(false); item.action() }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left",
                  item.destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-secondary"
                )}>
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Cron Card ────────────────────────────────────────────────────────────────

function CronCard({ job, agentAvatarPresetId, onEdit, onRun, onViewRuns, onToggle, onDelete }: {
  job: CronJob; agentAvatarPresetId?: string | null
  onEdit: () => void; onRun: () => void
  onViewRuns: () => void; onToggle: () => void; onDelete: () => void
}) {
  const statusStyle = { active: "status-active", paused: "status-paused", error: "status-error" }[job.status] || "status-paused"
  const deliveryIcon = job.deliveryChannel === "telegram" ? "✈️"
    : job.deliveryChannel === "discord" ? "🎮"
    : job.deliveryChannel === "slack" ? "💬"
    : job.deliveryChannel === "whatsapp" ? "📱" : null

  return (
    <div className="flex flex-col rounded-xl bg-card ghost-border hover:bg-surface-high transition-colors overflow-hidden">
      {/* Top: name + status + menu */}
      <div className="flex items-start justify-between p-4 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <AgentAvatar
            avatarPresetId={agentAvatarPresetId}
            emoji={job.agentEmoji || "⏰"}
            size="w-9 h-9"
          />
          <div className="min-w-0">
            <p className="font-display font-semibold text-foreground text-sm leading-tight truncate">{job.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{job.agentName || job.agentId || "Default agent"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", statusStyle)}>
            {job.status === "active" && <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-active-text)] pulse-dot" />}
            {job.status}
          </span>
          <ActionMenu job={job} onEdit={onEdit} onRun={onRun} onViewRuns={onViewRuns} onToggle={onToggle} onDelete={onDelete} />
        </div>
      </div>

      {/* Schedule pill */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">{job.kind || "cron"}</span>
        <code className="text-xs font-mono px-2.5 py-1 bg-surface-highest rounded-lg text-primary font-semibold">
          {job.schedule}
        </code>
        {job.tz && job.tz !== "UTC" && (
          <span className="text-[10px] text-muted-foreground/50">{job.tz}</span>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-border/30" />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-px bg-border/20 mx-0">
        <div className="flex flex-col items-center gap-0.5 py-3 bg-card">
          <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            {job.runCount ?? 0}
          </div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">runs</p>
        </div>
        <div className="flex flex-col items-center gap-0.5 py-3 bg-card">
          <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {fmtDuration(job.lastDuration)}
          </div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">last dur</p>
        </div>
        <div className="flex flex-col items-center gap-0.5 py-3 bg-card">
          {job.lastDeliveryStatus === "delivered" ? (
            <>
              <div className="flex items-center gap-1 text-sm font-semibold text-[var(--status-active-text)]">
                <Send className="h-3.5 w-3.5" />
                {deliveryIcon || job.deliveryChannel || "sent"}
              </div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">delivered</p>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold text-muted-foreground">—</span>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">delivery</p>
            </>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-border/30" />

      {/* Last / Next timeline */}
      <div className="flex items-center justify-between px-4 py-3 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground/50 uppercase tracking-wide text-[9px]">Last run</span>
          <span className={cn("font-medium", job.lastRun ? "text-foreground" : "text-muted-foreground")}>
            {fmtRelative(job.lastRun)}
          </span>
          {job.lastRun && <span className="text-[10px] text-muted-foreground/40">{fmtAbsolute(job.lastRun)}</span>}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-muted-foreground/50 uppercase tracking-wide text-[9px]">Next run</span>
          <span className={cn("font-medium", job.nextRun ? "text-primary" : "text-muted-foreground")}>
            {fmtRelative(job.nextRun)}
          </span>
          {job.nextRun && <span className="text-[10px] text-muted-foreground/40">{fmtAbsolute(job.nextRun)}</span>}
        </div>
      </div>

      {/* Error banner */}
      {job.status === "error" && job.errorMessage && (
        <div className="mx-4 mb-3 flex items-start gap-1.5 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="line-clamp-2">{job.errorMessage}</span>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CronPage({ filterAgentId: externalFilterAgentId }: { filterAgentId?: string } = {}) {
  const { jobs, addJob, updateJob, removeJob, setJobs } = useCronStore()
  const storeAgents = useAgentStore((s) => s.agents)

  // Agent filter
  const [filterAgentId, setFilterAgentId] = useState<string | null>(externalFilterAgentId ?? null)

  // Enrich jobs with avatarPresetId from store
  function getAgentPreset(agentId?: string) {
    if (!agentId) return null
    return storeAgents.find((a) => a.id === agentId)?.avatarPresetId ?? null
  }

  // Unique agents across all jobs
  const agentGroups = (() => {
    const map = new Map<string, { id: string; name: string; emoji: string; avatarPresetId: string | null | undefined; count: number }>()
    for (const j of jobs) {
      const id = j.agentId || "__default__"
      const existing = map.get(id)
      if (existing) {
        existing.count++
      } else {
        const storeAgent = storeAgents.find((a) => a.id === j.agentId)
        map.set(id, {
          id,
          name: j.agentName || j.agentId || "Default",
          emoji: j.agentEmoji || storeAgent?.emoji || "🤖",
          avatarPresetId: storeAgent?.avatarPresetId,
          count: 1,
        })
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  })()

  const filteredJobs = filterAgentId
    ? jobs.filter((j) => (j.agentId || "__default__") === filterAgentId)
    : jobs

  const active  = filteredJobs.filter((j) => j.status === "active").length
  const errored = filteredJobs.filter((j) => j.status === "error").length
  const totalRuns = filteredJobs.reduce((sum, j) => sum + (j.runCount ?? 0), 0)

  const [createOpen, setCreateOpen] = useState(false)
  const [editJob, setEditJob]       = useState<CronJob | null>(null)
  const [deleteJob, setDeleteJob]   = useState<CronJob | null>(null)
  const [runsJob, setRunsJob]       = useState<CronJob | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [runLoading, setRunLoading]       = useState<string | null>(null)
  const [toggleLoading, setToggleLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null)
  const [restartNotice, setRestartNotice] = useState(false)

  function showToast(msg: string, err = false) {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleSaved(_saved: CronJob) {
    const wasCreate = !editJob
    // Re-fetch from API so parseCronJobs normalizes schedule/fields before rendering
    try {
      const data = await api.getCronJobs() as { jobs: CronJob[] }
      setJobs(data.jobs ?? [])
    } catch {
      // fallback: use raw saved (may crash if schedule is object)
    }
    showToast(editJob ? "Schedule updated" : "Schedule created")
    if (wasCreate) setRestartNotice(true)
  }

  async function handleDelete() {
    if (!deleteJob) return
    setDeleteLoading(true)
    removeJob(deleteJob.id)
    try {
      await api.deleteCronJob(deleteJob.id)
      showToast("Schedule deleted")
    } catch (e: unknown) {
      addJob(deleteJob)
      showToast(e instanceof Error ? e.message : "Failed to delete", true)
    } finally {
      setDeleteLoading(false)
      setDeleteJob(null)
    }
  }

  async function handleRun(job: CronJob) {
    setRunLoading(job.id)
    try {
      await api.runCronJob(job.id)
      showToast(`Triggered "${job.name}"`)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Failed to trigger", true)
    } finally {
      setRunLoading(null)
    }
  }

  async function handleToggle(job: CronJob) {
    const newEnabled = job.status === "paused" || job.enabled === false
    setToggleLoading(job.id)
    updateJob(job.id, { status: newEnabled ? "active" : "paused", enabled: newEnabled })
    try {
      await api.toggleCronJob(job.id, newEnabled)
    } catch (e: unknown) {
      updateJob(job.id, { status: job.status, enabled: job.enabled })
      showToast(e instanceof Error ? e.message : "Failed to toggle", true)
    } finally {
      setToggleLoading(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Timer className="h-4 w-4 text-primary" />
            <span><span className="font-semibold text-foreground">{jobs.length}</span> schedules</span>
          </div>
          {active > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--status-active-text)]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {active} active
            </div>
          )}
          {errored > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--status-error-text)]">
              <XCircle className="h-3.5 w-3.5" />
              {errored} errored
            </div>
          )}
          {totalRuns > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              {totalRuns} total runs
            </div>
          )}
        </div>
        <Button size="sm" onClick={() => { setEditJob(null); setCreateOpen(true) }}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Schedule
        </Button>
      </div>

      {/* Agent filter pills — only on standalone page */}
      {!externalFilterAgentId && agentGroups.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Users className="h-3.5 w-3.5" />
          </div>
          <button
            onClick={() => setFilterAgentId(null)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors",
              !filterAgentId
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary text-muted-foreground border-border hover:text-foreground"
            )}
          >
            All agents
            <span className="text-[10px] opacity-70">{jobs.length}</span>
          </button>
          {agentGroups.map((ag) => (
            <button
              key={ag.id}
              onClick={() => setFilterAgentId(filterAgentId === ag.id ? null : ag.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors",
                filterAgentId === ag.id
                  ? "bg-primary/10 border-primary/30 text-foreground"
                  : "bg-secondary text-muted-foreground border-border hover:text-foreground"
              )}
            >
              <AgentAvatar avatarPresetId={ag.avatarPresetId} emoji={ag.emoji} size="w-4 h-4" />
              <span>{ag.name}</span>
              <span className="text-[10px] opacity-60">{ag.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Gateway restart notice */}
      {restartNotice && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">Restart gateway to activate</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              New schedules are written to <code className="font-mono text-[11px]">jobs.json</code> but only take effect after the gateway restarts.
              Run <code className="font-mono text-[11px]">openclaw gateway restart</code> in your terminal.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRestartNotice(false)}
            className="text-amber-400/50 hover:text-amber-300 transition-colors shrink-0 text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* Empty state */}
      {filteredJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-72 gap-4">
          <div className="p-5 rounded-2xl bg-secondary">
            <Timer className="h-9 w-9 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">No scheduled jobs</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Create your first automated schedule</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create first schedule
          </Button>
        </div>
      ) : (
        /* Responsive grid: 1 col → 2 col → 3 col → 4 col for many jobs */
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filteredJobs.map((job) => (
            <div key={job.id} className="relative">
              {(runLoading === job.id || toggleLoading === job.id) && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/60">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              )}
              <CronCard
                job={job}
                agentAvatarPresetId={getAgentPreset(job.agentId)}
                onEdit={() => setEditJob(job)}
                onRun={() => handleRun(job)}
                onViewRuns={() => setRunsJob(job)}
                onToggle={() => handleToggle(job)}
                onDelete={() => setDeleteJob(job)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-[var(--shadow-elevated)] ghost-border animate-fade-in",
          toast.err ? "bg-destructive text-destructive-foreground" : "bg-card text-foreground"
        )}>
          {toast.msg}
        </div>
      )}

      {/* Dialogs */}
      <CronJobFormDialog
        open={createOpen || !!editJob}
        onOpenChange={(v) => { if (!v) { setCreateOpen(false); setEditJob(null) } }}
        job={editJob ?? undefined}
        onSaved={handleSaved}
        defaultAgentId={externalFilterAgentId}
      />
      {deleteJob && (
        <DeleteConfirmDialog job={deleteJob} onConfirm={handleDelete} onClose={() => setDeleteJob(null)} loading={deleteLoading} />
      )}
      {runsJob && (
        <RunsDialog job={runsJob} onClose={() => setRunsJob(null)} />
      )}
    </div>
  )
}
