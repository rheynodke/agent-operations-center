import React, { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { Task, TaskOutput } from "@/types"
import { Package, Download, FileText, Image as ImageIcon, FileArchive, ExternalLink, RefreshCw, Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

const IMAGE_MIME = /^image\//i
const ARCHIVE_MIME = /(zip|tar|gzip|rar|7z)/i

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function OutputIcon({ out }: { out: TaskOutput }) {
  if (IMAGE_MIME.test(out.mimeType)) return <ImageIcon className="h-4 w-4 text-blue-400" />
  if (ARCHIVE_MIME.test(out.mimeType)) return <FileArchive className="h-4 w-4 text-amber-400" />
  return <FileText className="h-4 w-4 text-muted-foreground" />
}

interface Props {
  task: Task
  /** When true, highlight the section (e.g. during in_review to draw reviewer's eye). */
  highlight?: boolean
}

export function OutputsSection({ task, highlight }: Props) {
  const [outputs, setOutputs] = useState<TaskOutput[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flashFilename, setFlashFilename] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getTaskOutputs(task.id)
      setOutputs(res.outputs.filter(o => o.filename !== 'MANIFEST.json'))
    } catch (e) {
      setError((e as Error).message || "Failed to load outputs")
    } finally {
      setLoading(false)
    }
  }, [task.id])

  // Initial fetch + refetch when task changes
  useEffect(() => { load() }, [load])

  // Listen for WS-broadcast output events. Re-fetch when the event targets our task.
  useEffect(() => {
    function onOutputEvent(e: Event) {
      const detail = (e as CustomEvent<{ type: string; taskId?: string; filename?: string }>).detail
      if (!detail || detail.taskId !== task.id) return
      if (detail.filename) {
        setFlashFilename(detail.filename)
        setTimeout(() => setFlashFilename(null), 1500)
      }
      load()
    }
    window.addEventListener('aoc:task-output', onOutputEvent)
    return () => window.removeEventListener('aoc:task-output', onOutputEvent)
  }, [task.id, load])

  const hasOutputs = outputs.length > 0
  const newestMtime = hasOutputs ? outputs[0].mtime : null

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-colors",
      highlight
        ? "border-amber-500/40 bg-amber-500/5 shadow-sm shadow-amber-500/10"
        : "border-border/40 bg-card/40"
    )}>
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10">
        <Package className={cn("h-3.5 w-3.5 shrink-0", highlight ? "text-amber-400" : "text-muted-foreground/60")} />
        <span className="text-xs font-semibold text-foreground/80 tracking-wide">Agent Outputs</span>
        <span className="text-[10px] text-muted-foreground/50">{outputs.length}</span>
        {highlight && hasOutputs && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/90 font-medium">
            <Sparkles className="h-2.5 w-2.5" />
            Ready for review
          </span>
        )}
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-border/40 hover:bg-muted/30 disabled:opacity-50"
          title="Refresh"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>

      <div className="p-3 space-y-2">
        {!hasOutputs && !loading && !error && (
          <p className="text-xs text-muted-foreground/60 italic px-1 py-2">
            No outputs yet. Agent should save deliverables to <code className="font-mono text-[10px] bg-muted/50 px-1 py-0.5 rounded">outputs/{task.id}/</code>.
          </p>
        )}
        {error && <p className="text-[11px] text-destructive px-1">{error}</p>}
        {outputs.map(out => {
          const isImage = IMAGE_MIME.test(out.mimeType)
          const href = api.outputUrl(task.id, out.filename)
          const isNewest = out.mtime === newestMtime
          const isFlashing = flashFilename === out.filename
          return (
            <div
              key={out.filename}
              className={cn(
                "flex items-start gap-3 rounded-md border px-3 py-2 transition-colors",
                isFlashing
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-border/40 bg-background/40"
              )}
            >
              {/* Thumb */}
              <div className="shrink-0 w-10 h-10 rounded bg-muted/40 flex items-center justify-center overflow-hidden">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={href} alt={out.filename} className="w-full h-full object-cover" />
                ) : (
                  <OutputIcon out={out} />
                )}
              </div>

              {/* Meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs font-medium text-foreground/90 hover:text-primary hover:underline"
                    title={out.filename}
                  >
                    {out.filename}
                  </a>
                  <ExternalLink className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  {isNewest && outputs.length > 1 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Latest
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/60">
                  <span>{out.mimeType}</span>
                  <span>·</span>
                  <span>{formatSize(out.size)}</span>
                  <span>·</span>
                  <span>{relativeTime(out.mtime)}</span>
                </div>
              </div>

              <a
                href={href}
                download={out.filename}
                className="shrink-0 p-1 rounded hover:bg-muted/40 text-muted-foreground/60 hover:text-foreground"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}
