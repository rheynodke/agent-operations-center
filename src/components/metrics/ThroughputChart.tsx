import { useMemo } from "react"
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from "recharts"
import { useThemeStore } from "@/stores/useThemeStore"
import type { MetricsThroughput } from "@/types"

interface Props {
  data: MetricsThroughput | null
  loading?: boolean
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00Z")
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function ThroughputChart({ data, loading }: Props) {
  const theme = useThemeStore(s => s.theme)
  const isDark = theme === "dark"

  // Flatten { date, byProject: {p1:x, p2:y} } → { date, p1: x, p2: y, total: x+y }
  // recharts wants a flat record per row; each project_id becomes a series key.
  const { rows, projectMeta, totalCompletions } = useMemo(() => {
    if (!data) return { rows: [], projectMeta: [], totalCompletions: 0 }

    // Only include projects that actually appeared in the window so the legend stays clean.
    const presentIds = new Set<string>()
    for (const b of data.buckets) {
      for (const pid of Object.keys(b.byProject)) presentIds.add(pid)
    }
    const knownById = new Map(data.projects.map(p => [p.id, p]))
    const meta = Array.from(presentIds).map(id => {
      const p = knownById.get(id)
      return { id, name: p?.name || id, color: p?.color || "#6366f1" }
    })
    // Stable sort by name for legend determinism
    meta.sort((a, b) => a.name.localeCompare(b.name))

    const rows = data.buckets.map(b => {
      const row: Record<string, number | string> = { date: b.date }
      for (const m of meta) row[m.id] = b.byProject[m.id] || 0
      row.__total = b.count
      return row
    })

    const total = data.buckets.reduce((s, b) => s + b.count, 0)
    return { rows, projectMeta: meta, totalCompletions: total }
  }, [data])

  const gridColor = isDark ? "#ffffff10" : "#00000010"
  const axisColor = isDark ? "#ffffff60" : "#00000080"
  const tooltipBg = isDark ? "#1a1a1a" : "#ffffff"
  const tooltipBorder = isDark ? "#ffffff20" : "#00000015"

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-xs font-semibold text-foreground/80 tracking-wide">Throughput</h3>
          <p className="text-[10px] text-muted-foreground/50">Tasks completed per day</p>
        </div>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {totalCompletions} in window
        </span>
      </div>

      {loading && !data ? (
        <div className="h-[220px] rounded-md bg-muted/20 animate-pulse" />
      ) : !data || totalCompletions === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground/60 italic">
          No completions in this window.
        </div>
      ) : (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
              <defs>
                {projectMeta.map(p => (
                  <linearGradient key={p.id} id={`grad-${p.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={p.color} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke={gridColor} vertical={false} />
              <XAxis
                dataKey="date"
                stroke={axisColor}
                tick={{ fill: axisColor, fontSize: 10 }}
                tickFormatter={formatDateShort}
                minTickGap={24}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke={axisColor}
                tick={{ fill: axisColor, fontSize: 10 }}
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                width={24}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: tooltipBg,
                  border: `1px solid ${tooltipBorder}`,
                  borderRadius: 8,
                  fontSize: 11,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                }}
                labelFormatter={(label: string) => formatDateShort(label)}
                formatter={(value: number, _name, item) => {
                  const pid = (item as { dataKey?: string }).dataKey as string | undefined
                  const p = projectMeta.find(x => x.id === pid)
                  return [value, p?.name || pid]
                }}
              />
              {projectMeta.length > 1 && (
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                  formatter={(val) => {
                    const p = projectMeta.find(x => x.id === val)
                    return <span style={{ color: axisColor }}>{p?.name || val}</span>
                  }}
                />
              )}
              {projectMeta.map(p => (
                <Area
                  key={p.id}
                  type="monotone"
                  dataKey={p.id}
                  name={p.id}
                  stackId="1"
                  stroke={p.color}
                  strokeWidth={1.5}
                  fill={`url(#grad-${p.id})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
