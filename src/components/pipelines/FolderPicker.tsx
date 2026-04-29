// FolderPicker — browses host filesystem via /api/fs/browse.
// Shows directories with a 🟢 marker when they're a git repo. User can:
//   • Navigate up / into subdirs
//   • Select the current directory (Use this folder)
//   • Init a new repo at current directory if it isn't one yet
//   • Create a new subfolder + init repo in one step
//
// Designed to minimize friction for the common case: "point at my project".

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { Folder, FolderGit, ChevronRight, ChevronLeft, Home, Plus, Loader2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface FolderPickerProps {
  initialPath?: string
  onClose: () => void
  /** Called with absolute path when user picks a folder (existing or just-init'd repo). */
  onPick: (path: string, isGitRepo: boolean) => void
}

interface BrowseData {
  path: string
  parent: string | null
  home: string
  currentIsGitRepo: boolean
  entries: Array<{ name: string; isDir: boolean; isGitRepo: boolean; isSymlink: boolean }>
}

export function FolderPicker({ initialPath, onClose, onPick }: FolderPickerProps) {
  const [data, setData] = useState<BrowseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [initing, setIniting] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")

  const load = useCallback(async (path?: string) => {
    setLoading(true)
    setError(null)
    try {
      const d = await api.browseFs(path)
      setData(d)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(initialPath || undefined)
  }, [initialPath, load])

  const pickCurrent = () => {
    if (!data) return
    onPick(data.path, data.currentIsGitRepo)
  }

  const initRepoHere = async () => {
    if (!data) return
    setIniting(true)
    setError(null)
    try {
      await api.initRepo(data.path)
      // Refresh then pick.
      const d = await api.browseFs(data.path)
      setData(d)
      onPick(d.path, true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIniting(false)
    }
  }

  const createAndInit = async () => {
    if (!data || !newFolderName.trim()) return
    setIniting(true)
    setError(null)
    try {
      const newPath = `${data.path.replace(/\/+$/, "")}/${newFolderName.trim()}`
      await api.initRepo(newPath)
      onPick(newPath, true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIniting(false)
    }
  }

  // Split path into clickable breadcrumb segments.
  const breadcrumb = data
    ? data.path.split("/").filter(Boolean).map((seg, i, arr) => ({
        name: seg,
        path: "/" + arr.slice(0, i + 1).join("/"),
      }))
    : []

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Pick repository folder</DialogTitle>
          <DialogDescription>
            Browse the host filesystem. Select an existing git repo, or init a new one.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumb + actions */}
        <div className="flex items-center gap-1.5 p-2 border border-border rounded-md bg-muted/30 overflow-x-auto">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => data?.home && load(data.home)}
            title="Go to home"
            className="shrink-0"
          >
            <Home className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => data?.parent && load(data.parent)}
            disabled={!data?.parent}
            title="Parent directory"
            className="shrink-0"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-center gap-0.5 text-xs font-mono overflow-x-auto">
            <button
              onClick={() => load("/")}
              className="text-muted-foreground hover:text-foreground px-1"
            >
              /
            </button>
            {breadcrumb.map((b) => (
              <div key={b.path} className="flex items-center gap-0.5 shrink-0">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  onClick={() => load(b.path)}
                  className="text-muted-foreground hover:text-foreground px-1 truncate max-w-[180px]"
                >
                  {b.name}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Current folder banner */}
        {data && (
          <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-card text-xs">
            {data.currentIsGitRepo ? (
              <>
                <FolderGit className="h-4 w-4 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">Git repository</span>
                <span className="font-mono text-muted-foreground truncate">{data.path}</span>
                <span className="flex-1" />
                <Button size="sm" onClick={pickCurrent}>
                  Use this folder
                </Button>
              </>
            ) : (
              <>
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Not a git repo</span>
                <span className="font-mono text-muted-foreground truncate">{data.path}</span>
                <span className="flex-1" />
                <Button size="sm" variant="outline" onClick={initRepoHere} disabled={initing}>
                  {initing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                  Init repo here
                </Button>
              </>
            )}
          </div>
        )}

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto border border-border rounded-md bg-background min-h-[280px]">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-3 text-red-400 text-xs">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </div>
          ) : data && data.entries.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-3">No subdirectories.</div>
          ) : (
            <div className="divide-y divide-border">
              {data?.entries.map((e) => (
                <button
                  key={e.name}
                  onClick={() => load(`${data.path.replace(/\/+$/, "")}/${e.name}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                >
                  {e.isGitRepo ? (
                    <FolderGit className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Folder className={cn("h-4 w-4 shrink-0", e.isSymlink ? "text-cyan-400" : "text-muted-foreground")} />
                  )}
                  <span className="text-sm flex-1 truncate">{e.name}</span>
                  {e.isGitRepo && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                      git
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Create new subfolder + init */}
        {data && (
          <div className="border border-dashed border-border rounded-md p-2">
            {!newFolderOpen ? (
              <button
                onClick={() => setNewFolderOpen(true)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> New folder here + init repo
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="my-project"
                  className="flex-1 px-2 py-1.5 rounded-md border border-border bg-background text-sm font-mono"
                />
                <Button size="sm" onClick={createAndInit} disabled={!newFolderName.trim() || initing}>
                  {initing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Create & init
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setNewFolderOpen(false); setNewFolderName("") }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
