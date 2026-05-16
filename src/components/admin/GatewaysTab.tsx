import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Loader2, RefreshCw, Play, Square, FileText, AlertTriangle, ArrowUp, ArrowDown,
} from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type {
  GatewayStatus, GatewaySortKey, GatewayBulkAction,
} from "@/types"
import { GatewayLogModal } from "./GatewayLogModal"
import { BulkActionDialog } from "./BulkActionDialog"

/* ─────────────────────────────────────────────────────────────────── */
/*  CONSTANTS + HELPERS                                                */
/* ─────────────────────────────────────────────────────────────────── */

const POLL_MS = 5000

const STATE_ORDER: Record<GatewayStatus["state"], number> = {
  running: 0,
  stale: 1,
  stopped: 2,
}

function formatUptime(sec: number | null) {
  if (sec == null) return "—"
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  return `${Math.floor(sec / 86400)}d`
}
function formatRss(mb: number | null) { return mb == null ? "—" : `${mb} MB` }
function formatCpu(p: number | null) { return p == null ? "—" : `${p.toFixed(1)}%` }
function formatRelative(iso: string | null) {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function compareNullable<T extends number | string>(
  a: T | null,
  b: T | null,
  direction: "asc" | "desc",
): number {
  // Nulls always at the bottom regardless of direction
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (a < b) return direction === "asc" ? -1 : 1
  if (a > b) return direction === "asc" ? 1 : -1
  return 0
}

function getSortValue(g: GatewayStatus, key: GatewaySortKey): number | string | null {
  switch (key) {
    case "username":        return g.username.toLowerCase()
    case "state":           return STATE_ORDER[g.state]
    case "uptimeSeconds":   return g.uptimeSeconds
    case "rssMb":           return g.rssMb
    case "cpuPercent":      return g.cpuPercent
    case "messagesLast1h":  return g.activity?.messagesLast1h ?? null
    case "messagesLast24h": return g.activity?.messagesLast24h ?? null
    case "lastActivityAt":  return g.activity?.lastActivityAt ?? null
  }
}

/** Default sort: rssMb desc, but grouped by state (running < stale < stopped). */
function defaultCompare(a: GatewayStatus, b: GatewayStatus): number {
  const sa = STATE_ORDER[a.state]
  const sb = STATE_ORDER[b.state]
  if (sa !== sb) return sa - sb
  return compareNullable(a.rssMb, b.rssMb, "desc")
}

const SORT_LABELS: Record<GatewaySortKey, string> = {
  username:        "User",
  state:           "Status",
  uptimeSeconds:   "Uptime",
  rssMb:           "RSS",
  cpuPercent:      "CPU",
  messagesLast1h:  "Msg/1h",
  messagesLast24h: "Msg/24h",
  lastActivityAt:  "Last activity",
}

/** First-click direction per key. */
const FIRST_DIRECTION: Record<GatewaySortKey, "asc" | "desc"> = {
  username:        "asc",
  state:           "asc",
  uptimeSeconds:   "desc",
  rssMb:           "desc",
  cpuPercent:      "desc",
  messagesLast1h:  "desc",
  messagesLast24h: "desc",
  lastActivityAt:  "desc",
}

/* ─────────────────────────────────────────────────────────────────── */
/*  COMPONENT                                                          */
/* ─────────────────────────────────────────────────────────────────── */

export function GatewaysTab() {
  const [gateways, setGateways] = useState<GatewayStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingRows, setPendingRows] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkAction, setBulkAction] = useState<GatewayBulkAction | null>(null)
  const [logModal, setLogModal] = useState<{ userId: number; username: string } | null>(null)
  const [sort, setSort] = useState<{ key: GatewaySortKey; direction: "asc" | "desc" } | null>(null)

  // "now" tick — kept solely to make `formatRelative` / "last Xs ago" re-render.
  const [, setNowTick] = useState(0)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchOnce = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await api.listGateways()
      setGateways(res.gateways)
      setLastUpdatedAt(Date.now())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchOnce()
  }, [fetchOnce])

  // Polling — driven by autoRefresh + document visibility.
  useEffect(() => {
    function clearTimer() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    function startTimer() {
      clearTimer()
      if (!autoRefresh) return
      if (typeof document !== "undefined" && document.hidden) return
      intervalRef.current = setInterval(() => { fetchOnce() }, POLL_MS)
    }

    function handleVisibility() {
      if (document.hidden) {
        clearTimer()
      } else {
        // Resume + immediate refresh
        fetchOnce()
        startTimer()
      }
    }

    startTimer()
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      clearTimer()
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [autoRefresh, fetchOnce])

  // Re-tick once per second so "Xs ago" stays fresh between polls.
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  /* ─── Sorting ────────────────────────────────────────────────────── */

  const sortedGateways = useMemo<GatewayStatus[]>(() => {
    if (!gateways) return []
    const copy = [...gateways]
    if (!sort) {
      copy.sort(defaultCompare)
      return copy
    }
    copy.sort((a, b) => {
      const va = getSortValue(a, sort.key)
      const vb = getSortValue(b, sort.key)
      const cmp = compareNullable(va, vb, sort.direction)
      if (cmp !== 0) return cmp
      // Stable tiebreaker by username (asc) so order is deterministic across polls.
      return a.username.localeCompare(b.username)
    })
    return copy
  }, [gateways, sort])

  function handleSort(key: GatewaySortKey) {
    setSort(prev => {
      if (prev && prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" }
      }
      return { key, direction: FIRST_DIRECTION[key] }
    })
  }

  /* ─── Row actions ─────────────────────────────────────────────────── */

  async function runRowAction(userId: number, action: GatewayBulkAction) {
    if (pendingRows.has(userId)) return
    setPendingRows(s => {
      const next = new Set(s)
      next.add(userId)
      return next
    })
    try {
      if (action === "start") await api.adminStartGateway(userId)
      else if (action === "stop") await api.adminStopGateway(userId)
      else await api.adminRestartGateway(userId)
    } catch (err) {
      // Surface error briefly via banner — keep going.
      setError((err as Error).message)
    } finally {
      setPendingRows(s => {
        const next = new Set(s)
        next.delete(userId)
        return next
      })
      // Always refresh after the action resolves.
      fetchOnce()
    }
  }

  /* ─── Selection ───────────────────────────────────────────────────── */

  const allSelected = useMemo(() => {
    if (!sortedGateways.length) return false
    return sortedGateways.every(g => selected.has(g.userId))
  }, [sortedGateways, selected])

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sortedGateways.map(g => g.userId)))
    }
  }
  function toggleOne(userId: number) {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  /* ─── Bulk ────────────────────────────────────────────────────────── */

  function openBulk(action: GatewayBulkAction) {
    if (selected.size === 0) return
    setBulkAction(action)
  }

  const usernameLookup = useCallback((uid: number) => {
    return gateways?.find(g => g.userId === uid)?.username
  }, [gateways])

  /* ─── Derived for last-updated label ──────────────────────────────── */

  const lastUpdatedLabel = lastUpdatedAt
    ? formatRelative(new Date(lastUpdatedAt).toISOString())
    : "never"

  /* ─── Loading / empty states ──────────────────────────────────────── */

  if (gateways == null && !error) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading gateways…
      </div>
    )
  }

  /* ─── Render ──────────────────────────────────────────────────────── */

  const selectedIds = Array.from(selected)

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            className="accent-primary"
          />
          Auto-refresh (5s)
        </label>
        <button
          onClick={() => fetchOnce()}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          title="Refresh now"
        >
          {refreshing
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />
          }
          Refresh now
        </button>
        <span className="text-[11px] text-muted-foreground">
          · last {lastUpdatedLabel}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Selected: {selected.size}{gateways ? ` / ${gateways.length}` : ""}
          </span>
          <button
            onClick={() => openBulk("start")}
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-primary/25 bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-40"
          >
            <Play className="w-3 h-3" /> Start selected
          </button>
          <button
            onClick={() => openBulk("stop")}
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-red-500/25 bg-red-500/10 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-40"
          >
            <Square className="w-3 h-3" /> Stop selected
          </button>
          <button
            onClick={() => openBulk("restart")}
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors disabled:opacity-40"
          >
            <RefreshCw className="w-3 h-3" /> Restart selected
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-[10px] uppercase font-semibold tracking-wider hover:text-red-300"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Mobile sort selector */}
      <div className="md:hidden rounded-lg border border-border bg-card p-2 flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Sort by:</label>
        <select
          value={sort?.key ?? "rssMb"}
          onChange={e => {
            const key = e.target.value as GatewaySortKey
            setSort({ key, direction: "desc" })
          }}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs flex-1"
        >
          {(Object.keys(SORT_LABELS) as GatewaySortKey[]).map(k => (
            <option key={k} value={k}>{SORT_LABELS[k]}</option>
          ))}
        </select>
        {sort && (
          <button
            onClick={() => setSort(prev => prev
              ? { ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }
              : prev,
            )}
            className="px-2 py-1 rounded-md border border-border text-xs text-foreground hover:bg-muted transition-colors flex items-center gap-1"
          >
            {sort.direction === "asc"
              ? <ArrowUp className="w-3 h-3" />
              : <ArrowDown className="w-3 h-3" />
            }
            {sort.direction}
          </button>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-primary"
                    aria-label="Select all"
                  />
                </th>
                <SortHeader sortKey="username"        sort={sort} onSort={handleSort} />
                <SortHeader sortKey="state"           sort={sort} onSort={handleSort} />
                <SortHeader sortKey="uptimeSeconds"   sort={sort} onSort={handleSort} />
                <SortHeader sortKey="rssMb"           sort={sort} onSort={handleSort} align="right" />
                <SortHeader sortKey="cpuPercent"      sort={sort} onSort={handleSort} align="right" />
                <SortHeader sortKey="messagesLast1h"  sort={sort} onSort={handleSort} align="right" />
                <SortHeader sortKey="messagesLast24h" sort={sort} onSort={handleSort} align="right" />
                <SortHeader sortKey="lastActivityAt"  sort={sort} onSort={handleSort} />
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedGateways.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No gateways found.
                  </td>
                </tr>
              ) : sortedGateways.map(g => (
                <GatewayRow
                  key={g.userId}
                  g={g}
                  selected={selected.has(g.userId)}
                  pending={pendingRows.has(g.userId)}
                  onToggle={() => toggleOne(g.userId)}
                  onAction={(act) => runRowAction(g.userId, act)}
                  onOpenLog={() => setLogModal({ userId: g.userId, username: g.username })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {sortedGateways.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-3 py-8 text-center text-muted-foreground text-sm">
            No gateways found.
          </div>
        ) : sortedGateways.map(g => (
          <GatewayCard
            key={g.userId}
            g={g}
            selected={selected.has(g.userId)}
            pending={pendingRows.has(g.userId)}
            onToggle={() => toggleOne(g.userId)}
            onAction={(act) => runRowAction(g.userId, act)}
            onOpenLog={() => setLogModal({ userId: g.userId, username: g.username })}
          />
        ))}
      </div>

      {/* Modals */}
      {logModal && (
        <GatewayLogModal
          userId={logModal.userId}
          username={logModal.username}
          onClose={() => setLogModal(null)}
        />
      )}
      {bulkAction && (
        <BulkActionDialog
          action={bulkAction}
          userIds={selectedIds}
          usernameLookup={usernameLookup}
          onClose={() => setBulkAction(null)}
          onCompleted={() => {
            setSelected(new Set())
            fetchOnce()
          }}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  SUB-COMPONENTS                                                     */
/* ─────────────────────────────────────────────────────────────────── */

function SortHeader({
  sortKey, sort, onSort, align,
}: {
  sortKey: GatewaySortKey
  sort: { key: GatewaySortKey; direction: "asc" | "desc" } | null
  onSort: (k: GatewaySortKey) => void
  align?: "left" | "right"
}) {
  const isActive = sort?.key === sortKey
  return (
    <th className={cn(
      "px-3 py-2 text-xs font-semibold uppercase tracking-wider",
      align === "right" && "text-right",
    )}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          isActive && "text-foreground",
        )}
      >
        {SORT_LABELS[sortKey]}
        {isActive && (
          sort!.direction === "asc"
            ? <ArrowUp className="w-3 h-3" />
            : <ArrowDown className="w-3 h-3" />
        )}
      </button>
    </th>
  )
}

function StateBadge({ state }: { state: GatewayStatus["state"] }) {
  if (state === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
        running
      </span>
    )
  }
  if (state === "stale") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
        stale
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
      stopped
    </span>
  )
}

function lastActivityCell(g: GatewayStatus) {
  if (g.activity?.idleHeartbeatOnly) {
    return <span className="text-muted-foreground">💤 idle</span>
  }
  return <span>{formatRelative(g.activity?.lastActivityAt ?? null)}</span>
}

function RowActions({
  g, pending, onAction, onOpenLog,
}: {
  g: GatewayStatus
  pending: boolean
  onAction: (a: GatewayBulkAction) => void
  onOpenLog: () => void
}) {
  if (pending) {
    return (
      <span className="inline-flex items-center text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
      </span>
    )
  }

  const btn = "px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors"
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {g.state === "running" && (
        <>
          <button
            onClick={() => onAction("stop")}
            className={cn(btn, "border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/20")}
          >
            Stop
          </button>
          <button
            onClick={() => onAction("restart")}
            className={cn(btn, "border-amber-500/25 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20")}
          >
            Restart
          </button>
          <button
            onClick={onOpenLog}
            className={cn(btn, "border-border text-foreground hover:bg-muted")}
          >
            <FileText className="w-3 h-3 inline -mt-0.5 mr-0.5" /> Log
          </button>
        </>
      )}
      {g.state === "stale" && (
        <>
          <button
            onClick={() => onAction("restart")}
            className={cn(btn, "border-amber-500/25 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20")}
          >
            Restart
          </button>
          <button
            onClick={onOpenLog}
            className={cn(btn, "border-border text-foreground hover:bg-muted")}
          >
            <FileText className="w-3 h-3 inline -mt-0.5 mr-0.5" /> Log
          </button>
        </>
      )}
      {g.state === "stopped" && (
        <button
          onClick={() => onAction("start")}
          className={cn(btn, "border-primary/25 bg-primary/10 text-primary hover:bg-primary/20")}
        >
          <Play className="w-3 h-3 inline -mt-0.5 mr-0.5" /> Start
        </button>
      )}
    </div>
  )
}

function GatewayRow({
  g, selected, pending, onToggle, onAction, onOpenLog,
}: {
  g: GatewayStatus
  selected: boolean
  pending: boolean
  onToggle: () => void
  onAction: (a: GatewayBulkAction) => void
  onOpenLog: () => void
}) {
  return (
    <tr className={cn(
      "border-t border-border hover:bg-muted/40 transition-colors",
      selected && "bg-primary/5",
    )}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="accent-primary"
          aria-label={`Select ${g.username}`}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{g.username}</span>
          {g.displayName && (
            <span className="text-[11px] text-muted-foreground truncate">{g.displayName}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2"><StateBadge state={g.state} /></td>
      <td className="px-3 py-2 tabular-nums">{formatUptime(g.uptimeSeconds)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatRss(g.rssMb)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCpu(g.cpuPercent)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {g.activity ? g.activity.messagesLast1h : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {g.activity ? g.activity.messagesLast24h : "—"}
      </td>
      <td className="px-3 py-2 text-xs">{lastActivityCell(g)}</td>
      <td className="px-3 py-2">
        <RowActions g={g} pending={pending} onAction={onAction} onOpenLog={onOpenLog} />
      </td>
    </tr>
  )
}

function GatewayCard({
  g, selected, pending, onToggle, onAction, onOpenLog,
}: {
  g: GatewayStatus
  selected: boolean
  pending: boolean
  onToggle: () => void
  onAction: (a: GatewayBulkAction) => void
  onOpenLog: () => void
}) {
  return (
    <div className={cn(
      "rounded-lg border border-border bg-card p-3 space-y-2",
      selected && "ring-1 ring-primary/40",
    )}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="accent-primary mt-1"
          aria-label={`Select ${g.username}`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{g.username}</div>
          {g.displayName && (
            <div className="text-[11px] text-muted-foreground truncate">{g.displayName}</div>
          )}
        </div>
        <StateBadge state={g.state} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Field label="Uptime"     value={formatUptime(g.uptimeSeconds)} />
        <Field label="RSS"        value={formatRss(g.rssMb)} />
        <Field label="CPU"        value={formatCpu(g.cpuPercent)} />
        <Field label="Msg/1h"     value={g.activity ? String(g.activity.messagesLast1h) : "—"} />
        <Field label="Msg/24h"    value={g.activity ? String(g.activity.messagesLast24h) : "—"} />
        <Field label="Last act."  value={
          g.activity?.idleHeartbeatOnly
            ? "💤 idle"
            : formatRelative(g.activity?.lastActivityAt ?? null)
        } />
      </div>

      <div className="pt-1">
        <RowActions g={g} pending={pending} onAction={onAction} onOpenLog={onOpenLog} />
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground tabular-nums truncate">{value}</span>
    </div>
  )
}
