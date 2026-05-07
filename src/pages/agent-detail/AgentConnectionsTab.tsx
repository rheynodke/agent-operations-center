/**
 * AgentConnectionsTab — extracted from AgentDetailPage.tsx (Sprint 3 split).
 *
 * Renders the per-agent Connections tab: search + filter + collapsible groups
 * + bulk select. Backed by `api.getAgentConnections` / `api.setAgentConnections`.
 *
 * Self-contained: owns the fetched list, assignment Set, search/filter state,
 * and persists the user's collapsed-groups preference in localStorage. The
 * parent only passes `agentId`.
 *
 * Future tab extractions (Skills, Tools, Files, Channels, Modals) follow the
 * same shape — see CLAUDE.md "incremental split" note.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import {
  Loader2, Plus, Plug, Hash, Check, X, ChevronDown, ChevronRight,
  Database, Terminal, Globe, Code2, Package, ArrowRight, Share2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { Connection } from "@/types"

const CONN_TYPE_META: Record<string, { label: string; color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  bigquery: { label: 'BigQuery',   color: 'text-blue-400',     bg: 'bg-blue-500/10',     icon: Database },
  postgres: { label: 'PostgreSQL', color: 'text-indigo-400',   bg: 'bg-indigo-500/10',   icon: Database },
  ssh:      { label: 'SSH/VPS',    color: 'text-emerald-400',  bg: 'bg-emerald-500/10',  icon: Terminal },
  website:  { label: 'Website',    color: 'text-orange-400',   bg: 'bg-orange-500/10',   icon: Globe },
  github:   { label: 'GitHub',     color: 'text-purple-400',   bg: 'bg-purple-500/10',   icon: Code2 },
  odoocli:  { label: 'Odoo',       color: 'text-violet-400',   bg: 'bg-violet-500/10',   icon: Package },
}

function connectionDetail(conn: Connection): string {
  const meta = conn.metadata || {}
  switch (conn.type) {
    case 'bigquery': return (meta as { projectId?: string }).projectId || ''
    case 'postgres': return `${(meta as { host?: string }).host || 'localhost'}:${(meta as { port?: number }).port || 5432}/${(meta as { database?: string }).database || '?'}`
    case 'ssh':      return `${(meta as { sshUser?: string }).sshUser || 'root'}@${(meta as { sshHost?: string }).sshHost || '?'}`
    case 'website':  return (meta as { url?: string }).url || ''
    case 'github':   return `${(meta as { repoOwner?: string }).repoOwner || ''}/${(meta as { repoName?: string }).repoName || ''} · ${(meta as { branch?: string }).branch || 'main'}`
    case 'odoocli':  return `${(meta as { odooUrl?: string }).odooUrl || '?'} · ${(meta as { odooDb?: string }).odooDb || '?'}`
    default:         return ''
  }
}

const COLLAPSED_KEY = "aoc.agent-detail.connectionsCollapsed"

function highlightMatch(text: string, tokens: string[]): React.ReactNode {
  if (!tokens.length || !text) return text
  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean)
  if (!escaped.length) return text
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(re)
  return parts.map((p, i) =>
    re.test(p)
      ? <mark key={i} className="bg-primary/25 text-primary-foreground/95 rounded px-0.5">{p}</mark>
      : <React.Fragment key={i}>{p}</React.Fragment>
  )
}

function flattenSearchable(conn: Connection): string {
  const meta = conn.metadata || {}
  const metaVals = Object.values(meta as Record<string, unknown>).filter(v => typeof v === 'string' || typeof v === 'number').join(' ')
  return `${conn.name} ${conn.type} ${connectionDetail(conn)} ${metaVals}`.toLowerCase()
}

export function AgentConnectionsTab({ agentId }: { agentId: string }) {
  const navigate = useNavigate()
  const [allConns, setAllConns] = useState<Connection[]>([])
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [showOnlyAssigned, setShowOnlyAssigned] = useState(false)
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY)
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedTypes])) } catch {}
  }, [collapsedTypes])

  const toggleCollapsed = (type: string) => {
    setCollapsedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      return next
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [connRes, assignRes] = await Promise.all([
        api.getConnections(),
        api.getAgentConnections(agentId),
      ])
      setAllConns(connRes.connections)
      setAssignedIds(new Set(assignRes.connectionIds))
    } catch { /* ignore */ }
    setLoading(false)
  }, [agentId])

  useEffect(() => { load() }, [load])

  const persist = useCallback(async (next: Set<string>) => {
    const prev = assignedIds
    setAssignedIds(next)
    setSaving(true)
    try { await api.setAgentConnections(agentId, [...next]) }
    catch { setAssignedIds(prev) }
    setSaving(false)
  }, [agentId, assignedIds])

  const toggle = (connId: string) => {
    const next = new Set(assignedIds)
    if (next.has(connId)) next.delete(connId); else next.add(connId)
    persist(next)
  }

  const setManyAssigned = (ids: string[], assign: boolean) => {
    const next = new Set(assignedIds)
    for (const id of ids) { if (assign) next.add(id); else next.delete(id) }
    persist(next)
  }

  const groups = useMemo(() => {
    const byType = new Map<string, Connection[]>()
    for (const c of allConns) {
      if (!byType.has(c.type)) byType.set(c.type, [])
      byType.get(c.type)!.push(c)
    }
    return Array.from(byType.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [allConns])

  const typeCounts = useMemo(() => groups.map(([t, list]) => ({
    type: t,
    total: list.length,
    assigned: list.filter(c => assignedIds.has(c.id)).length,
  })), [groups, assignedIds])

  const tokens = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  )
  const isSearching = tokens.length > 0
  const matches = (c: Connection) => {
    if (typeFilter && c.type !== typeFilter) return false
    if (showOnlyAssigned && !assignedIds.has(c.id)) return false
    if (!tokens.length) return true
    const hay = flattenSearchable(c)
    return tokens.every(t => hay.includes(t))
  }

  const filteredGroups = groups
    .map(([t, list]) => [t, list.filter(matches)] as const)
    .filter(([, list]) => list.length > 0)

  const totalMatches = filteredGroups.reduce((acc, [, list]) => acc + list.length, 0)

  if (loading) return <div className="flex-1 flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>

  if (allConns.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 text-center gap-3">
      <div className="w-14 h-14 rounded-full bg-muted/30 flex items-center justify-center">
        <Plug className="w-7 h-7 text-muted-foreground/40" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No connections configured</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">Add data sources, repos, or services to assign them to this agent.</p>
      </div>
      <button
        onClick={() => navigate('/connections')}
        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
      >
        <Plus className="w-3.5 h-3.5" /> Manage Connections
      </button>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border/40 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, host, project, branch, repo… (space = AND)"
              className="h-8 text-xs pl-7 pr-14"
            />
            <Hash className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            {search && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground/60 font-mono">{totalMatches}</span>
                <button
                  onClick={() => setSearch('')}
                  className="w-5 h-5 rounded hover:bg-muted/40 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowOnlyAssigned(v => !v)}
            className={cn(
              "h-8 px-2.5 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1.5",
              showOnlyAssigned
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/40 bg-card/30 text-muted-foreground hover:text-foreground"
            )}
          >
            <Check className="w-3 h-3" /> Assigned only
          </button>
          <button
            onClick={() => navigate('/connections')}
            className="h-8 px-2.5 rounded-md text-[11px] font-medium border border-border/40 bg-card/30 text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            title="Open Connections page"
          >
            <Plug className="w-3 h-3" /> Manage
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setTypeFilter(null)}
            className={cn(
              "h-6 px-2 rounded-full text-[10px] font-medium border transition-colors",
              !typeFilter
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/40 bg-card/30 text-muted-foreground hover:text-foreground"
            )}
          >
            All · {allConns.length}
          </button>
          {typeCounts.map(({ type, total, assigned }) => {
            const meta = CONN_TYPE_META[type] || { label: type, color: 'text-muted-foreground' }
            const active = typeFilter === type
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(active ? null : type)}
                className={cn(
                  "h-6 px-2 rounded-full text-[10px] font-medium border transition-colors inline-flex items-center gap-1",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/40 bg-card/30 hover:text-foreground"
                )}
              >
                <span className={cn(active ? "text-primary" : meta.color)}>{meta.label}</span>
                <span className="text-muted-foreground/50">{assigned}/{total}</span>
              </button>
            )
          })}
          <button
            onClick={() => {
              const allTypes = groups.map(([t]) => t)
              const allCollapsed = allTypes.every(t => collapsedTypes.has(t))
              setCollapsedTypes(allCollapsed ? new Set() : new Set(allTypes))
            }}
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
            title="Collapse / expand all groups"
          >
            <ChevronDown className={cn("w-3 h-3 transition-transform", groups.every(([t]) => collapsedTypes.has(t)) && "-rotate-90")} />
            {groups.every(([t]) => collapsedTypes.has(t)) ? 'Expand all' : 'Collapse all'}
          </button>
          <span className="text-[10px] text-muted-foreground/50">
            {assignedIds.size}/{allConns.length} assigned
            {saving && <span className="text-primary ml-1.5">Saving…</span>}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-4">
        {filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <Hash className="w-6 h-6 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No connections match your filter.</p>
            <button
              onClick={() => { setSearch(''); setTypeFilter(null); setShowOnlyAssigned(false) }}
              className="text-[10px] text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : filteredGroups.map(([type, list]) => {
          const meta = CONN_TYPE_META[type] || { label: type, color: 'text-muted-foreground', bg: 'bg-muted/20', icon: Plug }
          const Icon = meta.icon
          const ids = list.map(c => c.id)
          const assignedHere = ids.filter(id => assignedIds.has(id)).length
          const allAssigned = assignedHere === ids.length
          const collapsed = !isSearching && collapsedTypes.has(type)
          return (
            <div key={type} className="rounded-lg border border-border/30 bg-card/20 overflow-hidden">
              <div className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-card/40 transition-colors">
                <button
                  onClick={() => toggleCollapsed(type)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  disabled={isSearching}
                  title={isSearching ? "Auto-expanded while searching" : (collapsed ? "Expand" : "Collapse")}
                >
                  <ChevronRight className={cn(
                    "w-3.5 h-3.5 text-muted-foreground/60 transition-transform shrink-0",
                    !collapsed && "rotate-90",
                  )} />
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center shrink-0", meta.bg)}>
                    <Icon className={cn("w-3 h-3", meta.color)} />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80 shrink-0">{meta.label}</span>
                  <span className={cn(
                    "text-[10px] shrink-0",
                    assignedHere > 0 ? "text-primary/80" : "text-muted-foreground/50",
                  )}>
                    {assignedHere}/{list.length}
                  </span>
                  {collapsed && assignedHere > 0 && (
                    <span className="text-[10px] text-muted-foreground/40 truncate">
                      · {list.filter(c => assignedIds.has(c.id)).map(c => c.name).join(', ')}
                    </span>
                  )}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setManyAssigned(ids, !allAssigned) }}
                  className="text-[10px] text-muted-foreground hover:text-primary transition-colors shrink-0"
                >
                  {allAssigned ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              {!collapsed && (
                <div className="space-y-1 p-1.5 pt-0">
                  {list.map(conn => {
                    const assigned = assignedIds.has(conn.id)
                    const detail = connectionDetail(conn)
                    return (
                      <button
                        key={conn.id}
                        onClick={() => toggle(conn.id)}
                        className={cn(
                          "group w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-all",
                          assigned
                            ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                            : "border-border/40 bg-card/30 hover:border-border hover:bg-card/60",
                          !conn.enabled && "opacity-60"
                        )}
                      >
                        <div className={cn("w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                          assigned ? "border-primary bg-primary" : "border-muted-foreground/30 group-hover:border-muted-foreground/60"
                        )}>
                          {assigned && <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{highlightMatch(conn.name, tokens)}</span>
                            {conn.sharedWithMe && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-cyan-500/15 text-cyan-300 shrink-0"
                                title="Shared with you by the connection owner"
                              >
                                <Share2 className="h-2 w-2" /> Shared
                              </span>
                            )}
                            {!conn.enabled && (
                              <span className="text-[9px] uppercase px-1 py-px rounded bg-amber-500/10 text-amber-400 shrink-0">Disabled</span>
                            )}
                          </div>
                          {detail && (
                            <p className="text-[11px] text-muted-foreground/60 font-mono truncate">
                              {highlightMatch(detail, tokens)}
                            </p>
                          )}
                        </div>
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/connections?focus=${conn.id}`) }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded hover:bg-muted/40 text-muted-foreground/60 hover:text-foreground"
                          title="Open in Connections page"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
