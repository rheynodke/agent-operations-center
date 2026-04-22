import React from "react"
import { useNavigate } from "react-router-dom"
import type { MetricsStatusDistribution } from "@/types"
import { cn } from "@/lib/utils"

const STATUS_CONFIG: Record<keyof MetricsStatusDistribution, { label: string; color: string; text: string }> = {
  backlog:     { label: "Backlog",     color: "bg-zinc-500",    text: "text-zinc-300" },
  todo:        { label: "Todo",        color: "bg-blue-500",    text: "text-blue-300" },
  in_progress: { label: "In Progress", color: "bg-amber-500",   text: "text-amber-300" },
  in_review:   { label: "In Review",   color: "bg-violet-500",  text: "text-violet-300" },
  blocked:     { label: "Blocked",     color: "bg-red-500",     text: "text-red-300" },
  done:        { label: "Done",        color: "bg-emerald-500", text: "text-emerald-300" },
}

const ORDER: (keyof MetricsStatusDistribution)[] = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done']

interface Props {
  distribution: MetricsStatusDistribution
  loading?: boolean
}

export function StatusDistribution({ distribution, loading }: Props) {
  const navigate = useNavigate()
  const total = ORDER.reduce((sum, k) => sum + (distribution[k] || 0), 0)

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold text-foreground/80 tracking-wide">Status distribution</h3>
        <span className="text-[10px] text-muted-foreground/50">current · {total} total</span>
      </div>

      {loading ? (
        <div className="h-3 rounded bg-muted/30 animate-pulse" />
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic py-2">No tasks in scope.</p>
      ) : (
        <>
          {/* Stacked bar */}
          <div className="flex h-3 rounded-full overflow-hidden bg-muted/30">
            {ORDER.map(status => {
              const count = distribution[status]
              if (!count) return null
              const pct = (count / total) * 100
              const cfg = STATUS_CONFIG[status]
              return (
                <button
                  key={status}
                  onClick={() => navigate(`/board?status=${status}`)}
                  style={{ width: `${pct}%` }}
                  className={cn(
                    cfg.color,
                    "transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-offset-background focus:ring-primary"
                  )}
                  title={`${cfg.label}: ${count} (${pct.toFixed(1)}%) — click to filter board`}
                />
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {ORDER.map(status => {
              const count = distribution[status]
              const cfg = STATUS_CONFIG[status]
              const dimmed = count === 0
              return (
                <button
                  key={status}
                  onClick={() => count > 0 && navigate(`/board?status=${status}`)}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[11px] font-medium",
                    dimmed ? "text-muted-foreground/40" : `${cfg.text} hover:text-foreground cursor-pointer`,
                    count === 0 && "cursor-default"
                  )}
                  disabled={count === 0}
                >
                  <span className={cn("w-2 h-2 rounded-full", cfg.color, dimmed && "opacity-30")} />
                  {cfg.label}
                  <span className="tabular-nums text-muted-foreground/70">({count})</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
