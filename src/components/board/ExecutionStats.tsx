import React from "react"
import { cn } from "@/lib/utils"
import { Task, TaskActivity } from "@/types"
import { Clock, Cpu, ArrowDownUp, DollarSign, Zap, Hash } from "lucide-react"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, highlight, na,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  highlight?: string
  na?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-border/30 bg-muted/10">
      <div className="flex items-center gap-1.5 text-muted-foreground/60">
        <span className="shrink-0">{icon}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn(
          "text-base font-semibold tabular-nums leading-none",
          na ? "text-muted-foreground/30" : highlight ?? "text-foreground"
        )}>
          {na ? "—" : value}
        </span>
        {!na && sub && (
          <span className="text-[10px] text-muted-foreground/50">{sub}</span>
        )}
      </div>
    </div>
  )
}

// ── Token bar ─────────────────────────────────────────────────────────────────

function TokenBar({ input, output }: { input: number; output: number }) {
  const total = input + output
  const inputPct = total > 0 ? (input / total) * 100 : 50
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 p-3 col-span-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-muted-foreground/60">
          <ArrowDownUp className="h-3 w-3 shrink-0" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Token Distribution</span>
        </div>
        <span className="text-[10px] font-semibold tabular-nums text-muted-foreground/60">
          {formatTokens(total)} total
        </span>
      </div>
      <div className="flex rounded-full overflow-hidden h-2 gap-px">
        <div
          className="bg-blue-500/70 rounded-l-full transition-all"
          style={{ width: `${inputPct}%` }}
        />
        <div
          className="bg-emerald-500/70 rounded-r-full flex-1 transition-all"
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px]">
        <span className="flex items-center gap-1 text-blue-400/70">
          <span className="w-2 h-2 rounded-full bg-blue-500/70 inline-block" />
          Input · {formatTokens(input)}
        </span>
        <span className="flex items-center gap-1 text-emerald-400/70">
          <span className="w-2 h-2 rounded-full bg-emerald-500/70 inline-block" />
          Output · {formatTokens(output)}
        </span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface ExecutionStatsProps {
  task: Task
  activity: TaskActivity[]
}

export function ExecutionStats({ task, activity }: ExecutionStatsProps) {
  // Duration: from first in_progress activity to in_review/done activity
  const startActivity = [...activity]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .find(a => a.type === "status_change" && a.toValue === "in_progress")

  const endActivity = [...activity]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find(a => a.type === "status_change" && (a.toValue === "in_review" || a.toValue === "done"))

  const durationMs = startActivity && endActivity
    ? new Date(endActivity.createdAt).getTime() - new Date(startActivity.createdAt).getTime()
    : null

  const hasTokens = task.inputTokens != null || task.outputTokens != null
  const totalTokens = (task.inputTokens ?? 0) + (task.outputTokens ?? 0)

  // Cost per 1k output tokens estimate (if we have tokens but no cost)
  const estimatedCost = !task.cost && hasTokens && task.outputTokens
    ? (task.outputTokens / 1000) * 0.015  // rough Claude Sonnet estimate
    : null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">

        {/* Duration */}
        <StatCard
          icon={<Clock className="h-3 w-3" />}
          label="Duration"
          value={durationMs != null ? formatDuration(durationMs) : "—"}
          na={durationMs == null}
        />

        {/* Total tokens */}
        <StatCard
          icon={<Hash className="h-3 w-3" />}
          label="Total Tokens"
          value={hasTokens ? formatTokens(totalTokens) : "—"}
          na={!hasTokens}
          highlight="text-foreground"
        />

        {/* Input tokens */}
        <StatCard
          icon={<Cpu className="h-3 w-3" />}
          label="Input Tokens"
          value={task.inputTokens != null ? formatTokens(task.inputTokens) : "—"}
          na={task.inputTokens == null}
          highlight="text-blue-400"
        />

        {/* Output tokens */}
        <StatCard
          icon={<Zap className="h-3 w-3" />}
          label="Output Tokens"
          value={task.outputTokens != null ? formatTokens(task.outputTokens) : "—"}
          na={task.outputTokens == null}
          highlight="text-emerald-400"
        />

      </div>

      {/* Token distribution bar — only if both values present */}
      {task.inputTokens != null && task.outputTokens != null && (
        <div className="grid grid-cols-2 gap-2">
          <TokenBar input={task.inputTokens} output={task.outputTokens} />
          <StatCard
            icon={<DollarSign className="h-3 w-3" />}
            label="Cost"
            value={
              task.cost != null
                ? `$${task.cost.toFixed(4)}`
                : estimatedCost != null
                  ? `~$${estimatedCost.toFixed(4)}`
                  : "—"
            }
            sub={!task.cost && estimatedCost ? "estimated" : undefined}
            na={task.cost == null && estimatedCost == null}
            highlight="text-amber-400"
          />
        </div>
      )}

      {/* Cost only (no tokens) */}
      {(!hasTokens || task.inputTokens == null || task.outputTokens == null) && task.cost != null && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border/30 bg-muted/10 text-xs">
          <DollarSign className="h-3 w-3 text-amber-400/70" />
          <span className="text-muted-foreground/60">Cost</span>
          <span className="font-semibold tabular-nums text-amber-400 ml-1">${task.cost.toFixed(4)}</span>
        </div>
      )}

      {/* Hint when no token data */}
      {!hasTokens && (
        <p className="text-[10px] text-muted-foreground/40 text-center">
          Token data is reported by the agent via <code className="font-mono">update_task.sh</code> params 5 &amp; 6
        </p>
      )}
    </div>
  )
}
