import { useCronStore } from "@/stores"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { CronJob } from "@/types"
import { Timer, Clock, Hash, CheckCircle2, XCircle } from "lucide-react"

function fmtDuration(ms?: number) {
  if (!ms) return "—"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60000)}m`
}

function fmtRelative(ts?: string | null): string {
  if (!ts) return "Never"
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function CronCard({ job }: { job: CronJob }) {
  const statusStyle = {
    active: "status-active",
    paused: "status-paused",
    error: "status-error",
  }[job.status]

  return (
    <div className="p-4 rounded-xl bg-card ghost-border hover:bg-surface-high transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{job.agentEmoji}</span>
          <div>
            <p className="font-display font-semibold text-foreground text-sm leading-tight">{job.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{job.agentName}</p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
            statusStyle
          )}
        >
          {job.status === "active" && <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-active-text)] pulse-dot" />}
          {job.status}
        </span>
      </div>

      {/* Schedule badge */}
      <div className="flex items-center gap-1.5 mb-4">
        <code className="text-xs font-mono px-2 py-1 bg-surface-highest rounded text-primary/70">
          {job.schedule}
        </code>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="flex flex-col gap-0.5 p-2 rounded-lg bg-secondary">
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <Hash className="h-3 w-3" />
            <span>{job.runCount ?? 0}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60">runs</p>
        </div>
        <div className="flex flex-col gap-0.5 p-2 rounded-lg bg-secondary">
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{fmtDuration(job.lastDuration)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60">last dur</p>
        </div>
        <div className="flex flex-col gap-0.5 p-2 rounded-lg bg-secondary">
          <p className="text-xs text-muted-foreground tabular-nums">
            {job.lastCost !== undefined ? `$${job.lastCost.toFixed(3)}` : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground/60">last cost</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground">
        <span>Last: <span className="text-foreground">{fmtRelative(job.lastRun)}</span></span>
        <span>Next: <span className="text-foreground">{fmtRelative(job.nextRun)}</span></span>
      </div>
    </div>
  )
}

export function CronPage() {
  const jobs = useCronStore((s) => s.jobs)
  const active = jobs.filter((j) => j.status === "active").length
  const errored = jobs.filter((j) => j.status === "error").length

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Timer className="h-4 w-4 text-primary" />
          <span><span className="font-semibold text-foreground">{jobs.length}</span> schedules</span>
        </div>
        {active > 0 && (
          <div className="flex items-center gap-1.5 text-[var(--status-active-text)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-xs">{active} active</span>
          </div>
        )}
        {errored > 0 && (
          <div className="flex items-center gap-1.5 text-[var(--status-error-text)]">
            <XCircle className="h-3.5 w-3.5" />
            <span className="text-xs">{errored} errored</span>
          </div>
        )}
      </div>

      {/* Grid */}
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="p-4 rounded-2xl bg-secondary">
            <Timer className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No scheduled jobs</p>
          <p className="text-xs text-muted-foreground/60">
            Configure cron jobs in your agent workspace
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {jobs.map((job) => (
            <CronCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
