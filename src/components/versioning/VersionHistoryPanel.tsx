import { useState, useEffect, useCallback } from "react"
import {
  History, X, RotateCcw, Trash2, ChevronDown,
  Clock, User, FileText, Loader2, CheckCircle2, AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import type { FileVersion, FileVersionDetail } from "@/types"

// ─── LCS-based unified diff ───────────────────────────────────────────────────

type DiffLine =
  | { type: "same";    line: string; oldNum: number; newNum: number }
  | { type: "remove";  line: string; oldNum: number; newNum: 0 }
  | { type: "add";     line: string; oldNum: 0;      newNum: number }

function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length, n = newLines.length
  // For very large files fall back to a simple list
  if (m > 400 || n > 400) {
    return [
      ...oldLines.slice(0, 60).map((line, i) => ({ type: "remove" as const, line, oldNum: i + 1, newNum: 0 as const })),
      ...newLines.slice(0, 60).map((line, i) => ({ type: "add"    as const, line, oldNum: 0 as const, newNum: i + 1 })),
    ]
  }
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "same", line: oldLines[i - 1], oldNum: i, newNum: j }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", line: newLines[j - 1], oldNum: 0, newNum: j }); j--
    } else {
      result.unshift({ type: "remove", line: oldLines[i - 1], oldNum: i, newNum: 0 }); i--
    }
  }
  return result
}

type DisplayEntry = DiffLine | { type: "ellipsis"; count: number }

function collapseContext(diffs: DiffLine[], ctx = 2): DisplayEntry[] {
  const out: DisplayEntry[] = []
  let run: DiffLine[] = []
  const flush = () => {
    if (run.length <= ctx * 2 + 1) { out.push(...run) }
    else { out.push(...run.slice(0, ctx), { type: "ellipsis", count: run.length - ctx * 2 }, ...run.slice(-ctx)) }
    run = []
  }
  for (const d of diffs) { if (d.type === "same") run.push(d); else { flush(); out.push(d) } }
  flush()
  return out
}

function countChanges(diffs: DiffLine[]) {
  let added = 0, removed = 0
  for (const d of diffs) { if (d.type === "add") added++; else if (d.type === "remove") removed++ }
  return { added, removed }
}

// ─── Inline diff viewer ───────────────────────────────────────────────────────

function DiffViewer({ oldContent, newContent, loading }: { oldContent: string; newContent: string; loading?: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 bg-muted/10 rounded-lg border border-border text-muted-foreground/60">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span className="text-[11px]">Loading version…</span>
      </div>
    )
  }

  if (oldContent === newContent) {
    return (
      <div className="bg-muted/10 rounded-lg border border-border">
        <div className="px-3 py-2 border-b border-border flex items-center gap-3 bg-surface-high rounded-t-lg">
          <span className="text-[10px] text-amber-400 font-medium">Selected version</span>
          <span className="text-[10px] text-muted-foreground/50">vs</span>
          <span className="text-[10px] text-muted-foreground">Current file</span>
        </div>
        <div className="px-3 py-4 text-[11px] text-muted-foreground/50 text-center">Identical to current</div>
      </div>
    )
  }

  const diffs   = lcsDiff(oldContent.split("\n"), newContent.split("\n"))
  const { added, removed } = countChanges(diffs)
  const entries = collapseContext(diffs)

  return (
    <div className="font-mono text-[10px] leading-[1.6] rounded-lg border border-border flex flex-col" style={{ maxHeight: "20rem" }}>
      {/* Header — pinned, never scrolls */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-3 bg-surface-high rounded-t-lg shrink-0">
        <span className="text-[10px] text-amber-400 font-medium">Selected version</span>
        <span className="text-[10px] text-muted-foreground/50">vs</span>
        <span className="text-[10px] text-muted-foreground">Current file</span>
        <span className="ml-auto flex items-center gap-1.5">
          {removed > 0 && <span className="text-red-400">-{removed}</span>}
          {added   > 0 && <span className="text-green-400">+{added}</span>}
        </span>
      </div>

      {/* Scrollable diff area — vertical + horizontal, fills remaining height */}
      <div className="overflow-auto flex-1 bg-muted/10 rounded-b-lg">
        {/* Inner min-width so short lines still allow horizontal scroll */}
        <div className="min-w-max">
          {entries.map((entry, idx) => {
            if (entry.type === "ellipsis") {
              return (
                <div key={`e-${idx}`} className="py-0.5 text-muted-foreground/40 select-none text-center bg-muted/5 sticky left-0">
                  ⋯ {entry.count} unchanged line{entry.count !== 1 ? "s" : ""}
                </div>
              )
            }
            const isAdd    = entry.type === "add"
            const isRemove = entry.type === "remove"
            return (
              <div key={`${entry.type}-${idx}`} className={cn(
                "flex gap-0",
                isAdd    && "bg-green-500/8",
                isRemove && "bg-red-500/8",
              )}>
                {/* Gutter: old line# — sticky left */}
                <span className={cn(
                  "w-9 shrink-0 text-right pr-1.5 py-px select-none border-r border-border/30 text-muted-foreground/30 sticky left-0",
                  isAdd    && "bg-green-500/8",
                  isRemove && "bg-red-500/8 text-red-400/50",
                  !isAdd && !isRemove && "bg-muted/10",
                )}>
                  {entry.type !== "add" ? entry.oldNum : ""}
                </span>
                {/* Gutter: new line# — sticky left */}
                <span className={cn(
                  "w-9 shrink-0 text-right pr-1.5 py-px select-none border-r border-border/30 text-muted-foreground/30 sticky left-9",
                  isAdd    && "bg-green-500/8 text-green-400/50",
                  isRemove && "bg-red-500/8",
                  !isAdd && !isRemove && "bg-muted/10",
                )}>
                  {entry.type !== "remove" ? entry.newNum : ""}
                </span>
                {/* Sign */}
                <span className={cn(
                  "w-5 shrink-0 text-center py-px select-none",
                  isAdd    && "text-green-400",
                  isRemove && "text-red-400",
                  !isAdd && !isRemove && "text-muted-foreground/20",
                )}>
                  {isAdd ? "+" : isRemove ? "−" : " "}
                </span>
                {/* Content — full width, no truncation */}
                <span className={cn(
                  "pl-1 pr-8 py-px whitespace-pre",
                  isAdd    && "text-green-300/90",
                  isRemove && "text-red-300/80",
                  !isAdd && !isRemove && "text-muted-foreground/60",
                )}>
                  {entry.line || " "}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Version row ──────────────────────────────────────────────────────────────

function VersionRow({
  version, isLatest, currentContent, isSelected, loadingContent, onSelect, onRestore, onDelete, restoring,
}: {
  version: FileVersionDetail
  isLatest: boolean
  currentContent: string
  isSelected: boolean
  loadingContent: boolean
  onSelect: () => void
  onRestore: () => void
  onDelete: () => void
  restoring: boolean
}) {
  const dt = new Date(version.saved_at)
  const dateStr = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const timeStr = dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  const sizeKb  = (version.content_size / 1024).toFixed(1)

  return (
    <div className={cn(
      "border-b border-border/50 last:border-0 transition-colors",
      isSelected ? "bg-primary/5" : "hover:bg-surface-high/50"
    )}>
      {/* Header row */}
      <button type="button" onClick={onSelect}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left">
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <Clock className="w-3.5 h-3.5 text-muted-foreground/60" />
          {isLatest && <span className="text-[8px] text-primary font-bold uppercase">latest</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-medium text-foreground">{dateStr} {timeStr}</span>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full",
              version.op === "create" ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"
            )}>
              {version.op}
            </span>
            <span className="text-[10px] text-muted-foreground/60">{sizeKb}KB</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {version.saved_by && (
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
                <User className="w-2.5 h-2.5" />{version.saved_by}
              </span>
            )}
            {version.label && (
              <span className="text-[10px] text-muted-foreground/60 italic truncate">{version.label}</span>
            )}
          </div>
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform", isSelected && "rotate-180")} />
      </button>

      {/* Expanded detail */}
      {isSelected && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          <DiffViewer
            oldContent={loadingContent ? "" : (version.content ?? "")}
            newContent={currentContent}
            loading={loadingContent}
          />

          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={onRestore}
              disabled={restoring}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/25 text-[12px] text-primary font-medium hover:bg-primary/20 disabled:opacity-40 transition-colors"
            >
              {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              {restoring ? "Restoring…" : "Restore this version"}
            </button>
            {!isLatest && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  scopeKey: string
  currentContent: string
  onClose: () => void
  onRestored?: (content: string) => void
}

export function VersionHistoryPanel({ scopeKey, currentContent, onClose, onRestored }: Props) {
  const [versions, setVersions]       = useState<(FileVersion & Partial<FileVersionDetail>)[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [selectedId, setSelectedId]   = useState<number | null>(null)
  const [loadingContent, setLoadingContent] = useState<number | null>(null)
  const [restoring, setRestoring]     = useState<number | null>(null)
  const [restoredId, setRestoredId]   = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { versions: vs } = await api.listVersions(scopeKey)
      setVersions(vs)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [scopeKey])

  useEffect(() => { load() }, [load])

  async function handleSelect(id: number) {
    if (selectedId === id) { setSelectedId(null); return }
    setSelectedId(id)
    // Lazy-load content if not yet loaded
    const v = versions.find(x => x.id === id)
    if (v && !v.content) {
      setLoadingContent(id)
      try {
        const { version } = await api.getVersion(id)
        setVersions(prev => prev.map(x => x.id === id ? { ...x, content: version.content } : x))
      } catch { /* ignore */ } finally {
        setLoadingContent(null)
      }
    }
  }

  async function handleRestore(id: number) {
    setRestoring(id)
    try {
      await api.restoreVersion(id)
      setRestoredId(id)
      const v = versions.find(x => x.id === id)
      if (v?.content && onRestored) onRestored(v.content)
      setTimeout(() => setRestoredId(null), 3000)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoring(null)
    }
  }

  async function doDeleteVersion(id: number) {
    setConfirmDeleteId(null)
    try {
      await api.deleteVersion(id)
      setVersions(prev => prev.filter(x => x.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  // Pretty scope label
  const scopeLabel = scopeKey
    .replace(/^agent:([^:]+):/, "Agent $1 › ")
    .replace(/^skill:global:/, "Skill › ")
    .replace(/^skill:([^:]+):/, "Skill ($1) › ")
    .replace(/^skill-script:([^:]+):([^:]+):/, "Script ($1/$2) › ")
    .replace(/^script:agent:([^:]+):/, "Script ($1) › ")
    .replace(/^script:global:/, "Script (shared) › ")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
              <History className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Version History</h2>
              <p className="text-[11px] text-muted-foreground font-mono truncate max-w-xs">{scopeLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Restored toast */}
        {restoredId !== null && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
            <p className="text-[12px] text-green-400">File restored successfully</p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading history…</span>
            </div>
          )}

          {error && (
            <div className="m-4 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/8 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!loading && !error && versions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground/50">
              <FileText className="w-8 h-8 opacity-30" />
              <p className="text-sm">No version history yet</p>
              <p className="text-[12px]">Save the file to start tracking versions</p>
            </div>
          )}

          {!loading && versions.length > 0 && (
            <div>
              {versions.map((v, i) => (
                <VersionRow
                  key={v.id}
                  version={v as FileVersionDetail}
                  isLatest={i === 0}
                  currentContent={currentContent}
                  isSelected={selectedId === v.id}
                  loadingContent={loadingContent === v.id}
                  onSelect={() => handleSelect(v.id)}
                  onRestore={() => handleRestore(v.id)}
                  onDelete={() => setConfirmDeleteId(v.id)}
                  restoring={restoring === v.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && versions.length > 0 && (
          <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {versions.length} version{versions.length !== 1 ? "s" : ""} · max 50 kept
            </span>
            <button onClick={load} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              Refresh
            </button>
          </div>
        )}
      </div>
      {confirmDeleteId !== null && (
        <ConfirmDialog
          title="Delete this version?"
          description="This version snapshot will be permanently removed. Other versions will not be affected."
          confirmLabel="Delete Version"
          destructive
          onConfirm={() => doDeleteVersion(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  )
}
