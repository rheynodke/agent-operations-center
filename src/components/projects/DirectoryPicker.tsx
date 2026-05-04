import { useEffect, useMemo, useState } from "react"
import {
  Folder, ChevronRight, ChevronUp, Home, Loader2, Search,
  AlertTriangle, FolderGit2, FolderClosed, EyeOff, Eye, Check,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { FsBrowseResult } from "@/types"

export interface DirectoryPickerProps {
  open: boolean
  onClose: () => void
  /** Called with the absolute path the user picked. */
  onPick: (absPath: string, displayPath: string) => void
  /** Initial directory (defaults to ~). */
  initialPath?: string
  title?: string
  /** Allow picking the current cwd (true) or only explicitly clicked dir (false). */
  allowPickCwd?: boolean
}

export function DirectoryPicker({
  open, onClose, onPick,
  initialPath = '~',
  title = "Pick a folder",
  allowPickCwd = true,
}: DirectoryPickerProps) {
  const [data, setData] = useState<FsBrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [showHidden, setShowHidden] = useState(false)
  const [selectedSubdir, setSelectedSubdir] = useState<string | null>(null)

  async function loadPath(p: string) {
    setLoading(true); setError(null); setSelectedSubdir(null); setSearch("")
    try {
      const res = await api.browseProjectDir(p, showHidden)
      setData(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Open → start at initialPath
  useEffect(() => {
    if (open) loadPath(initialPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Reload when toggling hidden visibility
  useEffect(() => {
    if (open && data) loadPath(data.cwd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden])

  const filteredEntries = useMemo(() => {
    if (!data) return []
    if (!search.trim()) return data.entries
    const q = search.trim().toLowerCase()
    return data.entries.filter((e) => e.name.toLowerCase().includes(q))
  }, [data, search])

  const breadcrumbSegments = useMemo(() => {
    if (!data) return []
    const isHome = data.isUnderHome
    const stripped = isHome ? data.display.replace(/^~\/?/, '') : data.display.replace(/^\/+/, '')
    const parts = stripped ? stripped.split('/') : []
    return [
      { label: isHome ? '~' : '/', path: isHome ? '~' : '/' },
      ...parts.map((p, i) => ({
        label: p,
        path: (isHome ? '~/' : '/') + parts.slice(0, i + 1).join('/'),
      })),
    ]
  }, [data])

  function pickCurrent() {
    if (!data) return
    const target = selectedSubdir
      ? `${data.cwd.replace(/\/+$/,'')}/${selectedSubdir}`
      : data.cwd
    const display = selectedSubdir
      ? `${data.display.replace(/\/+$/,'')}/${selectedSubdir}`
      : data.display
    onPick(target, display)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mt-1 shrink-0">
          <Button
            size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => loadPath('~')}
            title="Home"
          >
            <Home className="h-3.5 w-3.5 mr-1" /> Home
          </Button>
          <Button
            size="sm" variant="outline" className="h-8 text-xs"
            disabled={!data?.parent || loading}
            onClick={() => data?.parent && loadPath(data.parent)}
            title="Parent directory"
          >
            <ChevronUp className="h-3.5 w-3.5 mr-1" /> Up
          </Button>
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter folders..."
              className="pl-8 h-8 text-xs"
            />
          </div>
          <button
            onClick={() => setShowHidden((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 h-8 px-2 rounded-md border text-[11px] transition-colors shrink-0",
              showHidden
                ? "bg-primary/10 border-primary/30 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
            title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
          >
            {showHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            Hidden
          </button>
        </div>

        {/* Breadcrumb */}
        {data && (
          <nav className="flex items-center flex-wrap gap-0.5 mt-2 text-[11px] shrink-0 min-w-0">
            {breadcrumbSegments.map((seg, i) => (
              <span key={seg.path} className="inline-flex items-center min-w-0">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
                <button
                  type="button"
                  onClick={() => loadPath(seg.path)}
                  className={cn(
                    "px-1 py-0.5 rounded hover:bg-accent transition-colors truncate font-mono",
                    i === breadcrumbSegments.length - 1
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title={seg.path}
                >
                  {seg.label}
                </button>
              </span>
            ))}
          </nav>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive flex items-start gap-2 mt-2 shrink-0">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Folder list */}
        <div className="flex-1 min-h-[200px] mt-2 rounded-md border border-border/50 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : !data ? null : filteredEntries.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground italic text-center">
              {search ? `No folders match "${search}"` : "No subfolders here. Pick this folder to use it."}
            </p>
          ) : (
            <ul className="divide-y divide-border/30">
              {filteredEntries.map((entry) => {
                const isSelected = selectedSubdir === entry.name
                return (
                  <li key={entry.name}>
                    <button
                      type="button"
                      onClick={() => setSelectedSubdir(entry.name)}
                      onDoubleClick={() => loadPath(`${data.cwd}/${entry.name}`)}
                      className={cn(
                        "w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-accent/50 transition-colors",
                        isSelected && "bg-accent"
                      )}
                    >
                      {entry.isGitRepo ? (
                        <FolderGit2 className="h-4 w-4 text-blue-500 shrink-0" />
                      ) : entry.hasAocBinding ? (
                        <FolderClosed className="h-4 w-4 text-violet-500 shrink-0" />
                      ) : (
                        <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-xs truncate flex-1">{entry.name}</span>
                      {entry.hasAocBinding && (
                        <span className="text-[9px] uppercase tracking-wide text-violet-500/80 shrink-0">aoc</span>
                      )}
                      {entry.isGitRepo && (
                        <span className="text-[9px] uppercase tracking-wide text-blue-500/80 shrink-0">git</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); loadPath(`${data.cwd}/${entry.name}`) }}
                        className="text-muted-foreground/60 hover:text-foreground shrink-0"
                        title="Open folder"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Selection footer */}
        <div className="mt-2 px-2 py-1.5 rounded-md bg-muted/40 text-[11px] font-mono shrink-0 truncate" title={data?.cwd}>
          {selectedSubdir
            ? `${data?.display}/${selectedSubdir}`
            : data?.display || ""}
        </div>

        <DialogFooter className="gap-2 shrink-0">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={pickCurrent}
            disabled={!data || (!allowPickCwd && !selectedSubdir)}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            {selectedSubdir ? `Pick "${selectedSubdir}"` : "Pick this folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
