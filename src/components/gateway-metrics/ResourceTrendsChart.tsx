import { useMemo } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts"
import { HardDrive, Cpu } from "lucide-react"
import { useThemeStore } from "@/stores/useThemeStore"
import { useGatewayMetricsStore } from "@/stores"
import { chartTheme, colorForUser, formatTsAxis } from "./chartTheme"
import { cn } from "@/lib/utils"
import type { GatewayTimeseries } from "@/types"

interface Props {
  data: GatewayTimeseries | null
  loading?: boolean
}

export function ResourceTrendsChart({ data, loading }: Props) {
  const isDark = useThemeStore((s) => s.theme) === 'dark'
  const tokens = chartTheme(isDark)
  const metric = useGatewayMetricsStore((s) => s.resourceMetric)
  const setMetric = useGatewayMetricsStore((s) => s.setResourceMetric)

  // Build a single row per bucket ts, with one column per user series.
  const { rows, series } = useMemo(() => {
    if (!data) return { rows: [] as Array<Record<string, number | null>>, series: [] as Array<{ key: string; userId: number; color: string; label: string }> }

    const valueKey = metric === 'rss' ? 'rssMb' : 'cpuPercent'
    const userMeta = data.users.map((u) => ({
      key: `u_${u.userId}`,
      userId: u.userId,
      color: colorForUser(u.userId),
      label: u.username ?? `user${u.userId}`,
    }))

    const tsSet = new Set<number>()
    for (const u of data.users) for (const p of u.points) tsSet.add(p.ts)
    const tsList = Array.from(tsSet).sort((a, b) => a - b)

    const rowsBuilt = tsList.map((ts) => {
      const row: Record<string, number | null> = { ts }
      for (const u of data.users) {
        const point = u.points.find((p) => p.ts === ts)
        row[`u_${u.userId}`] = point ? (point[valueKey] as number | null) : null
      }
      return row
    })

    return { rows: rowsBuilt, series: userMeta }
  }, [data, metric])

  const yLabel = metric === 'rss' ? 'MB' : '%'
  const hasData = data && data.users.length > 0 && rows.length > 0

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground/80 tracking-wide">Resource Trends</h3>
          <p className="text-[10px] text-muted-foreground/50">
            {metric === 'rss' ? 'Per-user memory (RSS, MB)' : 'Per-user CPU utilisation (%)'}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border/40 overflow-hidden text-[11px]">
          <button
            type="button"
            onClick={() => setMetric('rss')}
            className={cn(
              'px-2.5 py-1 flex items-center gap-1 transition-colors',
              metric === 'rss' ? 'bg-violet-500/15 text-violet-300' : 'text-muted-foreground/70 hover:bg-card/60',
            )}
          >
            <HardDrive className="h-3 w-3" />
            RSS
          </button>
          <button
            type="button"
            onClick={() => setMetric('cpu')}
            className={cn(
              'px-2.5 py-1 flex items-center gap-1 transition-colors',
              metric === 'cpu' ? 'bg-amber-500/15 text-amber-300' : 'text-muted-foreground/70 hover:bg-card/60',
            )}
          >
            <Cpu className="h-3 w-3" />
            CPU
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="h-[240px] rounded-md bg-muted/20 animate-pulse" />
      ) : !hasData ? (
        <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground/60 italic">
          No samples in this window.
        </div>
      ) : (
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={tokens.gridColor} vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                stroke={tokens.axisColor}
                tick={{ fill: tokens.axisColor, fontSize: 10 }}
                tickFormatter={(ts: number) => formatTsAxis(ts, data!.bucketMs)}
                minTickGap={32}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke={tokens.axisColor}
                tick={{ fill: tokens.axisColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                unit={yLabel}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: tokens.tooltipBg,
                  border: `1px solid ${tokens.tooltipBorder}`,
                  borderRadius: 8,
                  fontSize: 11,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                }}
                labelFormatter={(ts: number) => new Date(ts).toLocaleString()}
                formatter={(value: number, _name, item) => {
                  const key = (item as { dataKey?: string }).dataKey as string | undefined
                  const meta = series.find((s) => s.key === key)
                  return [value == null ? '—' : `${Math.round(value * 10) / 10} ${yLabel}`, meta?.label || key]
                }}
              />
              {series.length > 1 && (
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                  formatter={(val) => {
                    const meta = series.find((s) => s.key === val)
                    return <span style={{ color: tokens.axisColor }}>{meta?.label || val}</span>
                  }}
                />
              )}
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.key}
                  stroke={s.color}
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
