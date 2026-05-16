import { useMemo } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts"
import { useThemeStore } from "@/stores/useThemeStore"
import { chartTheme, colorForUser, formatTsAxis } from "./chartTheme"
import type { GatewayTimeseries } from "@/types"

interface Props {
  data: GatewayTimeseries | null
  loading?: boolean
}

export function ActivityThroughputChart({ data, loading }: Props) {
  const isDark = useThemeStore((s) => s.theme) === 'dark'
  const tokens = chartTheme(isDark)

  const { rows, series, hasAnyValue } = useMemo(() => {
    if (!data) return { rows: [] as Array<Record<string, number | null>>, series: [] as Array<{ key: string; userId: number; color: string; label: string }>, hasAnyValue: false }

    const userMeta = data.users.map((u) => ({
      key: `u_${u.userId}`,
      userId: u.userId,
      color: colorForUser(u.userId),
      label: u.username ?? `user${u.userId}`,
    }))

    const tsSet = new Set<number>()
    for (const u of data.users) for (const p of u.points) tsSet.add(p.ts)
    const tsList = Array.from(tsSet).sort((a, b) => a - b)

    let anyValue = false
    const rowsBuilt = tsList.map((ts) => {
      const row: Record<string, number | null> = { ts }
      for (const u of data.users) {
        const point = u.points.find((p) => p.ts === ts)
        const v = point ? point.messages1h : null
        if (v != null && v > 0) anyValue = true
        row[`u_${u.userId}`] = v
      }
      return row
    })
    return { rows: rowsBuilt, series: userMeta, hasAnyValue: anyValue }
  }, [data])

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground/80 tracking-wide">Activity Throughput</h3>
          <p className="text-[10px] text-muted-foreground/50">Messages in trailing hour, per user</p>
        </div>
      </div>

      {loading && !data ? (
        <div className="h-[200px] rounded-md bg-muted/20 animate-pulse" />
      ) : !hasAnyValue ? (
        <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground/60 italic">
          No message activity in this window.
        </div>
      ) : (
        <div className="h-[200px]">
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
                width={28}
                allowDecimals={false}
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
                  return [value == null ? '—' : value, meta?.label || key]
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
