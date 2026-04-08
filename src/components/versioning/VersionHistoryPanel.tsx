import { useState, useEffect, useCallback } from "react"
import {
  History, X, RotateCcw, Trash2, ChevronDown,
  Clock, User, FileText, Loader2, CheckCircle2, AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import type { FileVersion, FileVersionDetail } from "@/types"

// ─── Simple line diff ─────────────────────────────────────────────────────────

function computeDiff(oldText: string, newText: string) {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const added   = newLines.filter(l => !oldLines.includes(l)).length
  const removed = oldLines.filter(l => !newLines.includes(l)).length
  return { added, removed, same: Math.min(oldLines.length, newLines.length) - Math.max(0, removed) }
}

function DiffBadge({ a, r }: { a: number; r: number }) {
  if (a === 0 && r === 0) return <span className="text-[10px] text-muted-foreground/50">no diff</span>
  return (
    <span className="flex items-center gap-1 text-[10px]">
      {a > 0 && <span className="text-green-400">+{a}</span>}
      {r > 0 && <span className="text-red-400">-{r}</span>}
    </span>
  )
}

// ─── Inline diff viewer ───────────────────────────────────────────────────────

function DiffViewer({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")

  // Very simple diff: mark lines unique to old (removed) vs unique to new (added)
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)

  return (
    <div className="font-mono text-[10px] leading-relaxed overflow-y-auto max-h-56 bg-muted/10 rounded-lg border border-border">
      <div className="px-3 py-2 border-b border-border flex items-center gap-3 bg-surface-high sticky top-0">
        <span className="text-[10px] text-green-400 font-medium">Selected version</span>
        <span className="text-[10px] text-muted-foreground/50">vs</span>
        <span className="text-[10px] text-muted-foreground">Current file</span>
      </div>
      <div className="divide-y divide-border/30">
        {/* Show removed lines (in old, not in new) */}
        {oldLines.filter(l => !newSet.has(l)).slice(0, 20).map((line, i) => (
          <div key={`r-${i}`} className="px-3 py-0.5 bg-red-500/8 text-red-300/80 flex gap-2">
            <span className="select-none text-red-500/60 shrink-0">-</span>
            <span className="truncate">{line || " "}</span>
          </div>
        ))}
        {/* Show added lines (in new, not in old) */}
        {newLines.filter(l => !oldSet.has(l)).slice(0, 20).map((line, i) => (
          <div key={`a-${i}`} className="px-3 py-0.5 bg-green-500/8 text-green-300/80 flex gap-2">
            <span className="select-none text-green-500/60 shrink-0">+</span>
            <span className="truncate">{line || " "}</span>
          </div>
        ))}
        {(oldLines.filter(l => !newSet.has(l)).length > 20 || newLines.filter(l => !oldSet.has(l)).length > 20) && (
          <div className="px-3 py-1 text-muted-foreground/50 text-center">… diff truncated</div>
        )}
        {oldLines.filter(l => !newSet.has(l)).length === 0 && newLines.filter(l => !oldSet.has(l)).length === 0 && (
          <div className="px-3 py-3 text-muted-foreground/50 text-center">Identical to current</div>
        )}
      </div>
    </div>
  )
}

// ─── Version row ──────────────────────────────────────────────────────────────

function VersionRow({
  version, isLatest, currentContent, isSelected, onSelect, onRestore, onDelete, restoring,
}: {
  version: FileVersionDetail
  isLatest: boolean
  currentContent: string
  isSelected: boolean
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
          <DiffViewer oldContent={version.content_size > 0 ? currentContent : ""} newContent={currentContent} />

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
      <div className="relative z-10 w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">

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
                  version={{ ...v, content: v.content ?? currentContent } as FileVersionDetail}
                  isLatest={i === 0}
                  currentContent={currentContent}
                  isSelected={selectedId === v.id}
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
