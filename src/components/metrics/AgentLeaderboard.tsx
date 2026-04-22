import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Users, ArrowUp, ArrowDown, Bot } from "lucide-react"
import type { AgentMetric, Agent } from "@/types"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { cn } from "@/lib/utils"

type SortKey = 'completed' | 'avgCost' | 'avgDurationMs' | 'changeRequestRate' | 'successRate'
type SortDir = 'asc' | 'desc'

interface Props {
  agents: AgentMetric[]
  knownAgents?: Agent[]
  loading?: boolean
}

function formatCost(n: number | null): string {
  if (n == null) return "–"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "–"
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  const d = Math.floor(hr / 24)
  return `${d}d ${hr % 24}h`
}

function formatPct(n: number | null): string {
  if (n == null) return "–"
  return `${(n * 100).toFixed(0)}%`
}

function SortHeader({
  label, active, dir, onClick, align = 'right',
}: { label: string; active: boolean; dir: SortDir; onClick: () => void; align?: 'left' | 'right' }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
        active ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground",
        align === 'right' ? "justify-end w-full" : ""
      )}
    >
      {label}
      {active && (dir === 'desc' ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
    </button>
  )
}

export function AgentLeaderboard({ agents, knownAgents, loading }: Props) {
  const navigate = useNavigate()
  const [sortKey, setSortKey] = useState<SortKey>('completed')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    const rows = [...agents]
    rows.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // Nulls sort last regardless of direction
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return rows
  }, [agents, sortKey, sortDir])

  function agentMeta(agentId: string) {
    return knownAgents?.find(a => a.id === agentId)
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10">
        <Users className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-xs font-semibold text-foreground/80 tracking-wide">Agent leaderboard</span>
        <span className="text-[10px] text-muted-foreground/50">{agents.length} active</span>
      </div>

      {loading && agents.length === 0 ? (
        <div className="p-6 space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-8 rounded bg-muted/20 animate-pulse" />)}
        </div>
      ) : agents.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic px-4 py-6 text-center">
          No agent activity in this window.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30 bg-muted/5">
                <th className="text-left font-semibold uppercase tracking-wider text-[10px] text-muted-foreground/60 px-4 py-2">Agent</th>
                <th className="px-3 py-2"><SortHeader label="Completed"    active={sortKey==='completed'}          dir={sortDir} onClick={() => toggleSort('completed')} /></th>
                <th className="px-3 py-2"><SortHeader label="Avg cost"     active={sortKey==='avgCost'}            dir={sortDir} onClick={() => toggleSort('avgCost')} /></th>
                <th className="px-3 py-2"><SortHeader label="Avg duration" active={sortKey==='avgDurationMs'}      dir={sortDir} onClick={() => toggleSort('avgDurationMs')} /></th>
                <th className="px-3 py-2"><SortHeader label="Change req"   active={sortKey==='changeRequestRate'}  dir={sortDir} onClick={() => toggleSort('changeRequestRate')} /></th>
                <th className="px-3 py-2"><SortHeader label="Success"      active={sortKey==='successRate'}        dir={sortDir} onClick={() => toggleSort('successRate')} /></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => {
                const meta = agentMeta(row.agentId)
                // Color hints: high change-req = warn, high success = good
                const crrTone = row.changeRequestRate == null ? 'text-muted-foreground'
                  : row.changeRequestRate > 0.3 ? 'text-amber-400'
                  : row.changeRequestRate > 0 ? 'text-foreground/80' : 'text-emerald-400'
                const srTone = row.successRate == null ? 'text-muted-foreground'
                  : row.successRate >= 0.9 ? 'text-emerald-400'
                  : row.successRate >= 0.7 ? 'text-foreground/80' : 'text-amber-400'
                return (
                  <tr
                    key={row.agentId}
                    onClick={() => navigate(`/board?agentId=${row.agentId}`)}
                    className="border-b border-border/20 last:border-0 hover:bg-muted/20 cursor-pointer transition-colors"
                    title="Click to filter the task board to this agent"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {meta ? (
                          <AgentAvatar avatarPresetId={meta.avatarPresetId} emoji={meta.emoji} size="w-5 h-5" className="rounded-sm shrink-0" />
                        ) : row.agentEmoji ? (
                          <span className="w-5 h-5 rounded-sm bg-muted/30 flex items-center justify-center text-xs shrink-0">{row.agentEmoji}</span>
                        ) : (
                          <div className="w-5 h-5 rounded-sm bg-muted/30 flex items-center justify-center shrink-0">
                            <Bot className="h-3 w-3 text-muted-foreground/60" />
                          </div>
                        )}
                        <span className="font-medium text-foreground/90 truncate" title={row.agentName}>
                          {row.agentName}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground/90">{row.completed}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground/80">{formatCost(row.avgCost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground/80">{formatDuration(row.avgDurationMs)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", crrTone)}>{formatPct(row.changeRequestRate)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums font-medium", srTone)}>{formatPct(row.successRate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
