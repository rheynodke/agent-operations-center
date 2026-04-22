import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Workflow, AlertTriangle } from "lucide-react"
import type { LifecycleTransition } from "@/types"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
}

const STATUS_DOT: Record<string, string> = {
  backlog: "bg-zinc-500",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  in_review: "bg-violet-500",
  done: "bg-emerald-500",
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "no data"
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const d = Math.floor(hr / 24)
  return `${d}d ${hr % 24}h`
}

interface Props {
  transitions: LifecycleTransition[]
  loading?: boolean
}

export function LifecycleFunnel({ transitions, loading }: Props) {
  const navigate = useNavigate()

  const { maxMs, bottleneckKey, totalCount } = useMemo(() => {
    const withData = transitions.filter(t => t.avgMs != null && t.count > 0)
    if (withData.length === 0) return { maxMs: 0, bottleneckKey: null, totalCount: 0 }
    const max = Math.max(...withData.map(t => t.avgMs as number))
    const bottleneck = withData.find(t => t.avgMs === max)
    const total = transitions.reduce((s, t) => s + t.count, 0)
    return {
      maxMs: max,
      bottleneckKey: bottleneck ? `${bottleneck.from}|${bottleneck.to}` : null,
      totalCount: total,
    }
  }, [transitions])

  const hasAnyData = transitions.some(t => t.count > 0)

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-xs font-semibold text-foreground/80 tracking-wide">Lifecycle funnel</h3>
          <p className="text-[10px] text-muted-foreground/50">Average time spent before each forward transition</p>
        </div>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {totalCount} transitions
        </span>
      </div>

      {loading && !hasAnyData ? (
        <div className="space-y-2 py-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-6 rounded bg-muted/20 animate-pulse" />)}
        </div>
      ) : !hasAnyData ? (
        <p className="text-xs text-muted-foreground/60 italic py-6 text-center">
          No lifecycle data in this window — tasks need to transition through statuses first.
        </p>
      ) : (
        <div className="space-y-2">
          {transitions.map(t => {
            const key = `${t.from}|${t.to}`
            const isBottleneck = key === bottleneckKey && (t.avgMs ?? 0) > 0
            const pct = maxMs === 0 || t.avgMs == null ? 0 : Math.max(4, (t.avgMs / maxMs) * 100)
            return (
              <button
                key={key}
                onClick={() => t.count > 0 && navigate(`/board?status=${t.to}`)}
                disabled={t.count === 0}
                className={cn(
                  "w-full group flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors",
                  t.count > 0 ? "hover:bg-muted/20 cursor-pointer" : "cursor-default opacity-60"
                )}
                title={t.count > 0 ? `${t.count} transitions in window — click to filter board to ${STATUS_LABEL[t.to]}` : 'No data'}
              >
                {/* Label column */}
                <div className="flex items-center gap-1.5 w-[170px] shrink-0 text-[11px]">
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_DOT[t.from])} />
                  <span className="text-muted-foreground/80">{STATUS_LABEL[t.from]}</span>
                  <span className="text-muted-foreground/40">→</span>
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_DOT[t.to])} />
                  <span className="text-foreground/90 font-medium">{STATUS_LABEL[t.to]}</span>
                </div>

                {/* Bar column */}
                <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isBottleneck ? "bg-red-500/70" : "bg-primary/60 group-hover:bg-primary/80"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* Value column */}
                <div className="flex items-center gap-1.5 w-[120px] shrink-0 justify-end">
                  {isBottleneck && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Slowest
                    </span>
                  )}
                  <span className="text-[11px] tabular-nums text-foreground/80 font-medium">{formatDuration(t.avgMs)}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
