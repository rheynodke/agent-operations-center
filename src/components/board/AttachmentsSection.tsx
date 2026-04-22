import React, { useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { Task, TaskAttachment } from "@/types"
import { Paperclip, Upload, X, FileText, Image as ImageIcon, FileArchive, ExternalLink, Loader2, ClipboardPaste } from "lucide-react"
import { cn } from "@/lib/utils"

const IMAGE_MIME = /^image\//i
const ARCHIVE_MIME = /(zip|tar|gzip|rar|7z)/i

function formatSize(n?: number) {
  if (!n) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function FileIcon({ att }: { att: TaskAttachment }) {
  const mime = att.mimeType || ""
  if (IMAGE_MIME.test(mime)) return <ImageIcon className="h-4 w-4 text-blue-400" />
  if (ARCHIVE_MIME.test(mime)) return <FileArchive className="h-4 w-4 text-amber-400" />
  return <FileText className="h-4 w-4 text-muted-foreground" />
}

interface Props {
  task: Task
  onUpdated?: (task: Task) => void
  /** When true, rendered as a compact read-only list (no upload/delete). */
  readOnly?: boolean
}

export function AttachmentsSection({ task, onUpdated, readOnly }: Props) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pasteFlash, setPasteFlash] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachments = task.attachments || []

  // Clipboard paste: when detail modal is open, Cmd/Ctrl+V on an image copies it here.
  // Skip when focus is inside a text field to avoid hijacking normal paste.
  useEffect(() => {
    if (readOnly) return
    function onPaste(e: ClipboardEvent) {
      const active = document.activeElement as HTMLElement | null
      if (active) {
        const tag = active.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return
      }
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f) {
            // Clipboard images often have filename "image.png" or empty — normalize
            const named = f.name && f.name.length > 0
              ? f
              : new File([f], `clipboard_${Date.now()}.${(f.type.split('/')[1] || 'png')}`, { type: f.type })
            files.push(named)
          }
        }
      }
      if (files.length) {
        e.preventDefault()
        setPasteFlash(true)
        setTimeout(() => setPasteFlash(false), 600)
        handleUpload(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, readOnly])

  async function handleUpload(files: FileList | File[] | null) {
    if (!files || !files.length) return
    setBusy(true)
    setProgress(0)
    setError(null)
    try {
      const arr = Array.from(files)
      const res = await api.uploadTaskAttachments(task.id, arr, (pct) => setProgress(pct))
      onUpdated?.(res.task)
    } catch (e) {
      setError((e as Error).message || "Upload failed")
    } finally {
      setBusy(false)
      setProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleDelete(att: TaskAttachment) {
    if (!confirm(`Remove attachment "${att.filename}"?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.deleteTaskAttachment(task.id, att.id)
      onUpdated?.(res.task)
    } catch (e) {
      setError((e as Error).message || "Delete failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-colors",
      pasteFlash ? "border-emerald-500/60 bg-emerald-500/5" : "border-border/40 bg-card/40"
    )}>
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10">
        <Paperclip className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-xs font-semibold text-foreground/80 tracking-wide">Attachments</span>
        <span className="text-[10px] text-muted-foreground/50">{attachments.length}</span>
        {!readOnly && (
          <>
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 ml-2">
              <ClipboardPaste className="h-2.5 w-2.5" />
              Paste image with ⌘V
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/70 hover:text-foreground px-2 py-1 rounded-md border border-border/40 hover:bg-muted/30 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Upload
            </button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {busy && progress !== null && (
        <div className="h-1 bg-muted/30">
          <div
            className="h-full bg-emerald-500/70 transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="p-3 space-y-2">
        {attachments.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic px-1 py-2">No attachments yet.</p>
        )}
        {attachments.map(att => {
          const isImage = IMAGE_MIME.test(att.mimeType || "")
          const href = api.attachmentUrl(att)
          return (
            <div key={att.id} className="flex items-start gap-3 rounded-md border border-border/40 bg-background/40 px-3 py-2">
              {/* Thumb */}
              <div className="shrink-0 w-10 h-10 rounded bg-muted/40 flex items-center justify-center overflow-hidden">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={href} alt={att.filename} className="w-full h-full object-cover" />
                ) : (
                  <FileIcon att={att} />
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
                    title={att.filename}
                  >
                    {att.filename}
                  </a>
                  <ExternalLink className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
                      att.source === 'sheet'
                        ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    )}
                  >
                    {att.source === 'sheet' ? 'Sheet' : 'Upload'}
                  </span>
                  {att.mimeType && <span className="text-[10px] text-muted-foreground/50">{att.mimeType}</span>}
                  {att.size != null && <span className="text-[10px] text-muted-foreground/40">{formatSize(att.size)}</span>}
                </div>
              </div>

              {!readOnly && att.source === 'upload' && (
                <button
                  onClick={() => handleDelete(att)}
                  disabled={busy}
                  className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground/60 hover:text-destructive disabled:opacity-40"
                  title="Remove attachment"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )
        })}
        {error && <p className="text-[11px] text-destructive px-1">{error}</p>}
      </div>
    </div>
  )
}
