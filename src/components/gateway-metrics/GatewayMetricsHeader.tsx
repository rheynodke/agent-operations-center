import { Activity, RefreshCw } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useGatewayMetricsStore } from "@/stores"
import type { GatewayMetricsRange } from "@/types"

const RANGE_OPTIONS: { value: GatewayMetricsRange; label: string }[] = [
  { value: '1h',  label: '1 hour' },
  { value: '6h',  label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d',  label: '7 days' },
  { value: '30d', label: '30 days' },
]

const ALL_USERS_SENTINEL = '__all__'

interface UserOption {
  userId: number
  username: string
}

interface GatewayMetricsHeaderProps {
  users: UserOption[]
  onRefresh: () => void
  refreshing?: boolean
  loading?: boolean
}

export function GatewayMetricsHeader({ users, onRefresh, refreshing, loading }: GatewayMetricsHeaderProps) {
  const range = useGatewayMetricsStore((s) => s.range)
  const userId = useGatewayMetricsStore((s) => s.userId)
  const setRange = useGatewayMetricsStore((s) => s.setRange)
  const setUserId = useGatewayMetricsStore((s) => s.setUserId)

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
          <Activity className="h-4 w-4 text-violet-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Gateway Metrics</h1>
          <p className="text-[11px] text-muted-foreground/60">
            {loading ? 'Loading…' : `Range: last ${RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select value={range} onValueChange={(v) => setRange(v as GatewayMetricsRange)}>
          <SelectTrigger className="w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={userId == null ? ALL_USERS_SENTINEL : String(userId)}
          onValueChange={(v) => setUserId(v === ALL_USERS_SENTINEL ? null : Number(v))}
        >
          <SelectTrigger className="w-[150px] text-xs">
            <SelectValue placeholder="All users" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_USERS_SENTINEL} className="text-xs">All users</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.userId} value={String(u.userId)} className="text-xs">{u.username}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="h-9 px-3 rounded-md border border-border/40 bg-card/40 hover:bg-card/60 text-xs flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>
    </div>
  )
}
