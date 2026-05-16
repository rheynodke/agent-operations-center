import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts"
import { useThemeStore } from "@/stores/useThemeStore"
import { chartTheme, formatTsAxis } from "./chartTheme"
import type { GatewayStateTimeline } from "@/types"

interface Props {
  data: GatewayStateTimeline | null
  loading?: boolean
}

const STATE_COLORS = {
  running: '#34d399', // emerald
  stale:   '#fbbf24', // amber
  stopped: '#6b7280', // gray
} as const

export function StateTimelineChart({ data, loading }: Props) {
  const isDark = useThemeStore((s) => s.theme) === 'dark'
  const tokens = chartTheme(isDark)
  const hasData = data && data.points.length > 0

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3 h-full">
      <div>
        <h3 className="text-xs font-semibold text-foreground/80 tracking-wide">State Timeline</h3>
        <p className="text-[10px] text-muted-foreground/50">Gateways by state over time</p>
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
            <AreaChart data={data!.points} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
              <defs>
                {(['running', 'stale', 'stopped'] as const).map((s) => (
                  <linearGradient key={s} id={`state-grad-${s}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={STATE_COLORS[s]} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={STATE_COLORS[s]} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
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
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                width={24}
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
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                formatter={(val) => <span style={{ color: tokens.axisColor }}>{val}</span>}
              />
              <Area type="monotone" dataKey="running" stackId="1" stroke={STATE_COLORS.running} strokeWidth={1.5} fill="url(#state-grad-running)" />
              <Area type="monotone" dataKey="stale"   stackId="1" stroke={STATE_COLORS.stale}   strokeWidth={1.5} fill="url(#state-grad-stale)" />
              <Area type="monotone" dataKey="stopped" stackId="1" stroke={STATE_COLORS.stopped} strokeWidth={1.5} fill="url(#state-grad-stopped)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
