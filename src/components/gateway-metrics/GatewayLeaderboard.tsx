import { ArrowUp, ArrowDown, Minus, HardDrive, Cpu, MessageSquare } from "lucide-react"
import { useGatewayMetricsStore } from "@/stores"
import { colorForUser } from "./chartTheme"
import { cn } from "@/lib/utils"
import type { GatewayLeaderboardEntry, GatewayMetricsMetric } from "@/types"

interface Props {
  entries: GatewayLeaderboardEntry[] | null
  loading?: boolean
}

const METRIC_OPTIONS: { value: GatewayMetricsMetric; label: string; icon: typeof HardDrive; unit: string }[] = [
  { value: 'rss',         label: 'RSS',      icon: HardDrive,      unit: 'MB' },
  { value: 'cpu',         label: 'CPU',      icon: Cpu,            unit: '%'  },
  { value: 'messages_1h', label: 'Msg 1h',   icon: MessageSquare,  unit: ''   },
]

function formatValue(metric: GatewayMetricsMetric, value: number): string {
  const rounded = Math.round(value * 10) / 10
  if (metric === 'cpu') return `${rounded}%`
  if (metric === 'rss') return `${rounded.toLocaleString()} MB`
  return rounded.toLocaleString()
}

function DeltaCell({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="inline-flex items-center gap-0.5 text-muted-foreground/40 text-[11px]"><Minus className="h-3 w-3" />—</span>
  }
  if (Math.abs(pct) < 0.5) {
    return <span className="inline-flex items-center gap-0.5 text-muted-foreground/60 text-[11px] tabular-nums"><Minus className="h-3 w-3" />0%</span>
  }
  const positive = pct > 0
  const Icon = positive ? ArrowUp : ArrowDown
  // For resource leaderboard, up is bad; for messages, up is neutral/informational. Keep neutral coloring.
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] tabular-nums', positive ? 'text-red-400' : 'text-emerald-400')}>
      <Icon className="h-3 w-3" />
      {Math.abs(Math.round(pct * 10) / 10)}%
    </span>
  )
}

export function GatewayLeaderboard({ entries, loading }: Props) {
  const metric = useGatewayMetricsStore((s) => s.leaderboardMetric)
  const setMetric = useGatewayMetricsStore((s) => s.setLeaderboardMetric)

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3 h-full">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground/80 tracking-wide">Leaderboard</h3>
          <p className="text-[10px] text-muted-foreground/50">Top 10 with delta vs previous window</p>
        </div>
        <div className="inline-flex rounded-md border border-border/40 overflow-hidden text-[11px]">
          {METRIC_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const active = metric === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMetric(opt.value)}
                className={cn(
                  'px-2 py-1 flex items-center gap-1 transition-colors',
                  active ? 'bg-violet-500/15 text-violet-300' : 'text-muted-foreground/70 hover:bg-card/60',
                )}
              >
                <Icon className="h-3 w-3" />
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading && !entries ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : !entries || entries.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground/60 italic">
          No data in this window.
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((e, idx) => (
            <div key={e.userId} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-card/60 transition-colors">
              <span className="text-[10px] font-semibold text-muted-foreground/50 tabular-nums w-5">{idx + 1}</span>
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: colorForUser(e.userId) }} />
              <span className="flex-1 text-xs truncate">{e.username ?? `user${e.userId}`}</span>
              <span className="text-xs tabular-nums text-foreground/90">{formatValue(metric, e.value)}</span>
              <span className="w-14 text-right">
                <DeltaCell pct={e.deltaPercent} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
