import { useCallback, useEffect, useState } from "react"
import {
  Folder, FolderOpen, FileText, FileImage, FileCode2, FileArchive, File as FileIcon,
  ChevronRight, Loader2, Eye, EyeOff, Download, Maximize2, X, AlertCircle,
} from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { MonacoCodeEditor } from "@/components/ui/MonacoCodeEditor"

type Entry = {
  name: string
  type: "dir" | "file"
  size: number
  mtime: string
  ext: string
  hidden: boolean
  previewable: "text" | "image" | "binary" | null
}

type DirCache = Map<string, Entry[]>

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`
  return d.toLocaleDateString()
}

function fileIcon(e: Entry, className: string) {
  if (e.type === "dir") return <Folder className={cn(className, "text-sky-400/70")} />
  if (e.previewable === "image") return <FileImage className={cn(className, "text-violet-400/70")} />
  if (e.previewable === "text") {
    if ([".sh", ".bash", ".py", ".js", ".ts", ".jsx", ".tsx"].includes(e.ext))
      return <FileCode2 className={cn(className, "text-emerald-400/70")} />
    return <FileText className={cn(className, "text-foreground/50")} />
  }
  if ([".zip", ".tar", ".gz"].includes(e.ext)) return <FileArchive className={cn(className, "text-amber-400/70")} />
  return <FileIcon className={cn(className, "text-muted-foreground/50")} />
}

function joinPath(parent: string, name: string) {
  if (!parent) return name
  return `${parent}/${name}`
}

// ─── Tree row ───────────────────────────────────────────────────────────────

function TreeRow({
  entry, parentPath, depth, expanded, selected, showHidden, onToggleDir, onSelectFile, dirCache,
}: {
  entry: Entry
  parentPath: string
  depth: number
  expanded: Set<string>
  selected: string | null
  showHidden: boolean
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
  dirCache: DirCache
}) {
  const fullPath = joinPath(parentPath, entry.name)
  const isExpanded = entry.type === "dir" && expanded.has(fullPath)
  const isSelected = selected === fullPath
  if (entry.hidden && !showHidden) return null

  return (
    <>
      <button
        onClick={() => entry.type === "dir" ? onToggleDir(fullPath) : onSelectFile(fullPath)}
        className={cn(
          "w-full flex items-center gap-1 px-2 py-1 text-left transition-colors group",
          isSelected ? "bg-primary/10 text-foreground" : "text-foreground/70 hover:bg-foreground/4 hover:text-foreground",
          entry.hidden && "opacity-50"
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {entry.type === "dir" ? (
          <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform text-muted-foreground/60", isExpanded && "rotate-90")} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {entry.type === "dir" && isExpanded ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-sky-400/70" /> : fileIcon(entry, "w-3.5 h-3.5 shrink-0")}
        <span className="text-[12px] font-mono truncate flex-1">{entry.name}</span>
        {entry.type === "file" && (
          <span className="text-[9px] text-muted-foreground/40 font-mono shrink-0 hidden group-hover:inline">
            {formatSize(entry.size)}
          </span>
        )}
      </button>
      {isExpanded && (
        <DirChildren
          dirPath={fullPath}
          depth={depth + 1}
          expanded={expanded}
          selected={selected}
          showHidden={showHidden}
          onToggleDir={onToggleDir}
          onSelectFile={onSelectFile}
          dirCache={dirCache}
        />
      )}
    </>
  )
}

function DirChildren({
  dirPath, depth, expanded, selected, showHidden, onToggleDir, onSelectFile, dirCache,
}: {
  dirPath: string
  depth: number
  expanded: Set<string>
  selected: string | null
  showHidden: boolean
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
  dirCache: DirCache
}) {
  const entries = dirCache.get(dirPath)
  if (entries === undefined) {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 text-muted-foreground/40 text-[10px]" style={{ paddingLeft: `${depth * 12 + 6}px` }}>
        <Loader2 className="w-3 h-3 animate-spin" /> loading…
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className="px-2 py-0.5 text-muted-foreground/30 text-[10px] italic" style={{ paddingLeft: `${depth * 12 + 14}px` }}>
        empty
      </div>
    )
  }
  return (
    <>
      {entries.map(e => (
        <TreeRow
          key={dirPath + "/" + e.name}
          entry={e}
          parentPath={dirPath}
          depth={depth}
          expanded={expanded}
          selected={selected}
          showHidden={showHidden}
          onToggleDir={onToggleDir}
          onSelectFile={onSelectFile}
          dirCache={dirCache}
        />
      ))}
    </>
  )
}

// ─── Preview pane ───────────────────────────────────────────────────────────

function FilePreview({ agentId, filePath }: { agentId: string; filePath: string }) {
  const [textData, setTextData] = useState<{ content: string | null; size: number; mtime: string; ext: string; oversize: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomImage, setZoomImage] = useState(false)

  const ext = (filePath.match(/\.[^.]+$/)?.[0] || "").toLowerCase()
  const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"].includes(ext)
  const isText = !isImage && [".md", ".markdown", ".txt", ".log", ".csv", ".json", ".jsonl", ".yml", ".yaml", ".sh", ".bash", ".py", ".js", ".ts", ".tsx", ".jsx", ".rb", ".lua", ".html", ".css", ".env", ".xml", ".toml"].includes(ext)

  const imageUrl = isImage ? api.getWorkspaceFileUrl(agentId, filePath) : null
  const downloadUrl = api.getWorkspaceFileUrl(agentId, filePath, { download: true })

  useEffect(() => {
    if (!isText) { setTextData(null); return }
    setLoading(true)
    setError(null)
    api.getWorkspaceFile(agentId, filePath)
      .then(d => setTextData({ content: d.content, size: d.size, mtime: d.mtime, ext: d.ext, oversize: d.oversize }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [agentId, filePath, isText])

  const filename = filePath.split("/").pop() || filePath

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
      {/* Path / size header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-foreground/2 text-[11px]">
        <FileText className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
        <span className="font-mono text-foreground/80 truncate flex-1" title={filePath}>{filePath}</span>
        {textData && <span className="text-muted-foreground/50 shrink-0 hidden md:inline">{formatSize(textData.size)} · {formatTime(textData.mtime)}</span>}
        <a
          href={downloadUrl}
          download={filename}
          title="Download"
          className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Preview body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isImage && imageUrl && (
          <div className="h-full w-full flex items-center justify-center bg-foreground/2 p-4">
            <button
              onClick={() => setZoomImage(true)}
              title="Click to zoom"
              className="max-w-full max-h-full"
            >
              <img
                src={imageUrl}
                alt={filename}
                className="max-w-full max-h-[calc(100vh-280px)] object-contain rounded shadow-lg"
              />
            </button>
          </div>
        )}
        {zoomImage && imageUrl && (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 cursor-zoom-out"
            onClick={() => setZoomImage(false)}
          >
            <button onClick={() => setZoomImage(false)} className="absolute top-4 right-4 text-white/80 hover:text-white"><X className="w-6 h-6" /></button>
            <img src={imageUrl} alt={filename} className="max-w-full max-h-full object-contain" />
          </div>
        )}

        {isText && loading && (
          <div className="h-full flex items-center justify-center text-muted-foreground/60 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> loading…
          </div>
        )}
        {isText && error && (
          <div className="h-full flex items-center justify-center text-destructive text-xs gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
        {isText && textData?.oversize && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <FileText className="w-10 h-10 text-foreground/15" />
            <p className="text-sm text-muted-foreground">File too large to preview ({formatSize(textData.size)})</p>
            <a href={downloadUrl} download={filename} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary hover:bg-primary/20 transition-colors">
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          </div>
        )}
        {isText && textData && !textData.oversize && textData.content !== null && (
          <MonacoCodeEditor value={textData.content} filename={filename} readOnly minimap={false} />
        )}

        {!isImage && !isText && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <FileIcon className="w-10 h-10 text-foreground/15" />
            <div className="space-y-1">
              <p className="text-sm text-foreground/70 font-mono">{filename}</p>
              <p className="text-[11px] text-muted-foreground/60">No inline preview for this file type</p>
            </div>
            <a href={downloadUrl} download={filename} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary hover:bg-primary/20 transition-colors">
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main browser ───────────────────────────────────────────────────────────

export function WorkspaceBrowser({ agentId }: { agentId: string }) {
  const [dirCache, setDirCache] = useState<DirCache>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]))
  const [selected, setSelected] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [rootError, setRootError] = useState<string | null>(null)

  const loadDir = useCallback(async (dirPath: string) => {
    try {
      const r = await api.getWorkspaceTree(agentId, dirPath)
      setDirCache(prev => {
        const next = new Map(prev)
        next.set(dirPath, r.entries)
        return next
      })
    } catch (e) {
      const msg = (e as Error).message
      if (dirPath === "") setRootError(msg)
      else console.warn(`[workspace-browser] load ${dirPath}:`, msg)
    }
  }, [agentId])

  // Initial root load
  useEffect(() => {
    setDirCache(new Map())
    setExpanded(new Set([""]))
    setSelected(null)
    setRootError(null)
    loadDir("")
  }, [agentId, loadDir])

  function toggleDir(p: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(p)) {
        next.delete(p)
      } else {
        next.add(p)
        if (!dirCache.has(p)) loadDir(p)
      }
      return next
    })
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Tree */}
      <div className={cn(
        "shrink-0 border-r border-border flex flex-col overflow-hidden",
        "w-full md:w-64",
        selected ? "hidden md:flex" : "flex",
      )}>
        <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-border bg-foreground/2">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1.5">Workspace</span>
          <button
            onClick={() => setShowHidden(s => !s)}
            title={showHidden ? "Hide hidden files" : "Show hidden files"}
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            {showHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span className="hidden sm:inline">.dotfiles</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {rootError && (
            <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-destructive">
              <AlertCircle className="w-3 h-3" /> {rootError}
            </div>
          )}
          {!rootError && (
            <DirChildren
              dirPath=""
              depth={0}
              expanded={expanded}
              selected={selected}
              showHidden={showHidden}
              onToggleDir={toggleDir}
              onSelectFile={setSelected}
              dirCache={dirCache}
            />
          )}
        </div>
      </div>

      {/* Preview */}
      <div className={cn(
        "flex-1 min-w-0 min-h-0 flex flex-col",
        selected ? "flex" : "hidden md:flex",
      )}>
        {/* Mobile back button */}
        {selected && (
          <button
            onClick={() => setSelected(null)}
            className="md:hidden flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border-b border-border shrink-0 bg-foreground/2"
          >
            <ChevronRight className="w-3 h-3 rotate-180" /> Back to tree
          </button>
        )}
        {selected ? (
          <FilePreview agentId={agentId} filePath={selected} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground/40">
            <Maximize2 className="w-8 h-8 text-foreground/8" />
            <p className="text-sm">Select a file to preview</p>
            <p className="text-[10px] opacity-60">Read-only · workspace files</p>
          </div>
        )}
      </div>
    </div>
  )
}
