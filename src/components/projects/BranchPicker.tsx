import { useEffect, useMemo, useState } from "react"
import {
  GitBranch, RefreshCw, Loader2, Search, AlertTriangle,
  Cloud, ChevronUp, ChevronDown, Check,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { BranchInfo, FetchBranchesResult, UncommittedFile } from "@/types"

export interface BranchPickerProps {
  /** Source of branches: either a path (pre-bind / wizard) or a bound projectId. */
  path?: string
  projectId?: string
  /** Currently selected branch. */
  value: string | null
  onChange: (branch: string) => void
  /** Auto-fetch on mount (one-shot) instead of waiting for manual click. */
  autoFetch?: boolean
  /** Hide remote-only branches by default. */
  showRemoteByDefault?: boolean
  /** Optional CSS class on outer wrapper. */
  className?: string
}

function relTime(ms: number | null | undefined): string {
  if (!ms) return ""
  const sec = Math.floor((Date.now() - ms) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`
  const hr  = Math.floor(min / 60); if (hr  < 24) return `${hr}h ago`
  const d   = Math.floor(hr  / 24); if (d   < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

export function BranchPicker({
  path, projectId, value, onChange,
  autoFetch = false, showRemoteByDefault = false, className,
}: BranchPickerProps) {
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [data, setData]         = useState<FetchBranchesResult | null>(null)
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null)
  const [search, setSearch]     = useState("")
  const [showRemote, setShowRemote] = useState(showRemoteByDefault)
  const [didAutoFetch, setDidAutoFetch] = useState(false)

  async function doFetch() {
    if (!path && !projectId) return
    setLoading(true); setError(null)
    try {
      const res = projectId
        ? await api.refetchProjectBranches(projectId)
        : await api.fetchProjectBranches({ path: path! })
      setData(res)
      setLastFetchAt(Date.now())
      // Default-select current branch if nothing chosen yet
      if (!value && res.currentBranch) onChange(res.currentBranch)
    } catch (e) {
      setError((e as Error).message || 'Failed to fetch branches')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoFetch && !didAutoFetch && (path || projectId)) {
      setDidAutoFetch(true)
      doFetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, path, projectId])

  const branches = useMemo<BranchInfo[]>(() => {
    if (!data?.branches) return []
    let list = data.branches
    if (!showRemote) list = list.filter((b) => b.type === 'local')
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((b) => b.name.toLowerCase().includes(q))
    }
    return list
  }, [data, search, showRemote])

  const isDirty = !!data?.isDirty
  const dirtyFiles: UncommittedFile[] = data?.uncommittedFiles || []

  if (!path && !projectId) {
    return <p className="text-xs text-muted-foreground italic">No path provided.</p>
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Toolbar: search + refresh + remote toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter branches..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <button
          onClick={() => setShowRemote((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 h-8 px-2 rounded-md border text-[11px] transition-colors shrink-0",
            showRemote
              ? "bg-primary/10 border-primary/30 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
          title="Toggle remote branches"
        >
          <Cloud className="h-3 w-3" /> Remote
        </button>
        <Button
          size="sm" variant="ghost"
          onClick={doFetch}
          disabled={loading}
          className="h-8 text-xs"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          {data ? "Refetch" : "Load branches"}
        </Button>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
        <span>
          {data ? (
            <>
              {branches.length} branch{branches.length === 1 ? '' : 'es'}
              {data.fetchSucceeded === false && data.fetchError && (
                <span className="text-amber-500"> · fetch failed: {data.fetchError}</span>
              )}
            </>
          ) : autoFetch ? "Loading…" : "No data — click Load."}
        </span>
        {lastFetchAt && <span>fetched {relTime(lastFetchAt)}</span>}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {/* Dirty tree warning */}
      {isDirty && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-500 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Working tree has uncommitted changes — switching branch is blocked.</p>
            <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-amber-400">
              {dirtyFiles.slice(0, 6).map((f, i) => (
                <li key={i}>{f.status || '??'} {f.path}</li>
              ))}
              {dirtyFiles.length > 6 && <li>… and {dirtyFiles.length - 6} more</li>}
            </ul>
            <p className="mt-1 text-amber-400">Commit or stash, then click Refetch.</p>
          </div>
        </div>
      )}

      {/* Branch list */}
      {data && (
        <div className="rounded-md border border-border/50 max-h-[260px] overflow-y-auto">
          {branches.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground italic">
              {search ? `No branches match "${search}"` : "No branches."}
            </p>
          ) : (
            <ul className="divide-y divide-border/30">
              {branches.map((b) => {
                const isCurrent = data.currentBranch === b.name
                const isSelected = value === b.name
                return (
                  <li key={b.type + ':' + b.name}>
                    <button
                      type="button"
                      onClick={() => onChange(b.name)}
                      className={cn(
                        "w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-accent/50 transition-colors",
                        isSelected && "bg-accent"
                      )}
                    >
                      <GitBranch className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        b.type === 'remote' ? "text-blue-500" : "text-emerald-500"
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs truncate">{b.name}</span>
                          {isCurrent && (
                            <span className="px-1 py-0 rounded bg-primary/15 text-primary text-[9px] font-medium uppercase tracking-wide shrink-0">
                              current
                            </span>
                          )}
                          {b.type === 'remote' && !isCurrent && (
                            <span className="px-1 py-0 rounded bg-muted text-muted-foreground text-[9px] font-medium shrink-0">
                              remote-only
                            </span>
                          )}
                        </div>
                        {b.lastCommit && (
                          <p className="text-[10px] text-muted-foreground/70 truncate">
                            {b.lastCommit.subject} · {relTime(b.lastCommit.date)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80 shrink-0">
                        {b.ahead > 0 && (
                          <span className="inline-flex items-center"><ChevronUp className="h-3 w-3" />{b.ahead}</span>
                        )}
                        {b.behind > 0 && (
                          <span className="inline-flex items-center"><ChevronDown className="h-3 w-3" />{b.behind}</span>
                        )}
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
