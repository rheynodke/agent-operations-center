// Right-side artifact trail for chat sessions. Lists files the agent has
// produced into `<workspace>/outputs/` during this session, with inline preview
// for text + image MIME types and download/open-in-new-tab for everything else.
//
// Mirrors the UX of AgentWorldView's outputs side-panel so DM 1:1 chat and the
// world floating chat feel consistent.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FileText, FileCode, FileImage, FileSpreadsheet, File as FileIcon, Download,
  ExternalLink, RefreshCw, Loader2, AlertCircle, X, ChevronRight, Maximize2,
} from "lucide-react"
import { chatApi, type ChatOutputFile } from "@/lib/chat-api"
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer"
import { cn } from "@/lib/utils"

interface Props {
  sessionKey: string
  /** Optional: agent running flag — triggers auto-refresh shortly after the run finishes. */
  agentRunning?: boolean
  /** Width controlled externally so the parent can persist + drag-resize. */
  widthPx?: number
  className?: string
}

// Decide whether we render an inline preview, fall back to download.
type PreviewKind = "text" | "image" | "markdown" | "html" | "csv" | null

function previewKindFor(file: ChatOutputFile): PreviewKind {
  if (file.mimeType === "text/html" || file.ext === "html") return "html"
  if (file.mimeType === "text/markdown" || file.ext === "md" || file.ext === "markdown") return "markdown"
  if (file.mimeType === "text/csv" || file.ext === "csv" || file.ext === "tsv") return "csv"
  if (file.mimeType.startsWith("image/")) return "image"
  if (file.isText) return "text"
  return null
}

/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted cells with escaped quotes
 * ("a""b" → a"b) and embedded commas / newlines inside quotes. Not a full
 * dialect detector — good enough for the agent-output preview surface.
 *
 * @param tabSeparated  Pass true for .tsv files (delimiter = tab).
 */
function parseCSV(text: string, tabSeparated = false): string[][] {
  const delim = tabSeparated ? "\t" : ","
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else { inQuotes = false }
      } else { cell += ch }
    } else {
      if (ch === '"' && cell === "") { inQuotes = true }
      else if (ch === delim) { row.push(cell); cell = "" }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = "" }
      else if (ch === "\r") { /* skip — handled by \n */ }
      else { cell += ch }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

function iconFor(file: ChatOutputFile) {
  if (file.mimeType.startsWith("image/")) return FileImage
  if (file.mimeType === "text/markdown" || file.ext === "md") return FileText
  if (file.mimeType === "text/csv" || file.ext === "csv" || file.ext === "tsv") return FileSpreadsheet
  if (file.isText) return FileCode
  return FileIcon
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return "just now"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

export function OutputsTrail({ sessionKey, agentRunning = false, widthPx, className }: Props) {
  const [files, setFiles] = useState<ChatOutputFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [preview, setPreview] = useState<null | {
    file: ChatOutputFile
    kind: PreviewKind
    content: string
    truncated: boolean
  }>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(async () => {
    if (!sessionKey) { setFiles([]); return }
    setLoading(true)
    setError(null)
    try {
      const res = await chatApi.getOutputs(sessionKey)
      setFiles(res.files || [])
      setTruncated(!!res.truncated)
    } catch (e) {
      setError((e as Error).message || "Failed to load outputs")
    } finally {
      setLoading(false)
    }
  }, [sessionKey])

  // Initial load + session change
  useEffect(() => { void refresh() }, [refresh])

  // Auto-refresh shortly after agent finishes a run (lots of artifacts land then)
  const prevRunning = useRef(agentRunning)
  useEffect(() => {
    if (prevRunning.current && !agentRunning) {
      const t = setTimeout(() => { void refresh() }, 1200)
      return () => clearTimeout(t)
    }
    prevRunning.current = agentRunning
  }, [agentRunning, refresh])

  // ── File actions ─────────────────────────────────────────────────────────

  const downloadFile = useCallback(async (file: ChatOutputFile) => {
    setError(null)
    try {
      const blob = await chatApi.fetchOutputBlob(sessionKey, file.relPath)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message || "Failed to download file")
    }
  }, [sessionKey])

  const previewFile = useCallback(async (file: ChatOutputFile) => {
    setError(null)
    const kind = previewKindFor(file)
    if (!kind) { void downloadFile(file); return }
    setPreviewLoading(true)
    try {
      if (kind === "image") {
        const blob = await chatApi.fetchOutputBlob(sessionKey, file.relPath)
        const url = URL.createObjectURL(blob)
        setPreview({ file, kind, content: url, truncated: false })
      } else if (kind === "html") {
        // For HTML: open in a new sandboxed tab. We don't inline render arbitrary HTML
        // inside the dashboard — agent-produced HTML could include scripts.
        const blob = await chatApi.fetchOutputBlob(sessionKey, file.relPath)
        const url = URL.createObjectURL(blob)
        window.open(url, "_blank", "noopener,noreferrer")
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else {
        // text / markdown / csv: read as text, cap at 200KB (CSV cap is higher)
        const blob = await chatApi.fetchOutputBlob(sessionKey, file.relPath)
        const text = await blob.text()
        const MAX = kind === "csv" ? 500_000 : 200_000
        if (text.length > MAX) {
          setPreview({ file, kind, content: text.slice(0, MAX), truncated: true })
        } else {
          setPreview({ file, kind, content: text, truncated: false })
        }
      }
    } catch (e) {
      setError((e as Error).message || "Failed to open preview")
    } finally {
      setPreviewLoading(false)
    }
  }, [sessionKey, downloadFile])

  function closePreview() {
    if (preview?.kind === "image" && preview.content.startsWith("blob:")) {
      URL.revokeObjectURL(preview.content)
    }
    setPreview(null)
    setExpanded(false)
  }

  // ── Sort newest-first ────────────────────────────────────────────────────
  const sorted = useMemo(() => [...files].sort((a, b) => b.mtimeMs - a.mtimeMs), [files])

  return (
    <div
      className={cn("h-full flex flex-col bg-background/60 border-l border-border min-w-0", className)}
      style={widthPx ? { width: widthPx } : undefined}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Outputs
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          {files.length > 0 && `${files.length}${truncated ? "+" : ""}`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors"
          title="Refresh"
        >
          {loading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-3 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && sorted.length === 0 && (
          <div className="px-4 py-12 text-center">
            <div className="text-3xl mb-2 opacity-50">📂</div>
            <p className="text-sm font-medium text-foreground/70">No outputs yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1 leading-relaxed">
              Files the agent writes under <code className="px-1 rounded bg-muted text-[10px]">workspace/outputs/</code> during this session will appear here.
            </p>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="p-1.5 space-y-0.5">
            {sorted.map((f) => (
              <FileRow
                key={f.relPath}
                file={f}
                onPreview={() => void previewFile(f)}
                onDownload={() => void downloadFile(f)}
              />
            ))}
            {truncated && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground/60 italic">
                More files exist — list truncated for performance.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Preview overlay (covers the trail body, not the whole viewport) */}
      {preview && (
        <PreviewOverlay
          file={preview.file}
          kind={preview.kind}
          content={preview.content}
          truncated={preview.truncated}
          loading={previewLoading}
          onClose={closePreview}
          onDownload={() => void downloadFile(preview.file)}
          onExpand={() => setExpanded(true)}
        />
      )}

      {/* Expanded preview — large modal across the viewport */}
      {preview && expanded && (
        <ExpandedPreview
          file={preview.file}
          kind={preview.kind}
          content={preview.content}
          truncated={preview.truncated}
          onClose={() => setExpanded(false)}
          onDownload={() => void downloadFile(preview.file)}
        />
      )}
    </div>
  )
}

// ─── File row ─────────────────────────────────────────────────────────────────

function FileRow({
  file, onPreview, onDownload,
}: { file: ChatOutputFile; onPreview: () => void; onDownload: () => void }) {
  const Icon = iconFor(file)
  const previewable = previewKindFor(file) !== null
  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors">
      <Icon className="w-4 h-4 text-muted-foreground/70 shrink-0" />
      <button
        onClick={onPreview}
        className="flex-1 min-w-0 text-left"
        title={file.relPath}
      >
        <div className="text-xs font-medium text-foreground truncate">{file.name}</div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
          <span>{formatBytes(file.size)}</span>
          <span>·</span>
          <span>{relativeTime(file.mtimeMs)}</span>
          {file.outOfConvention && (
            <>
              <span>·</span>
              <span className="text-amber-500/80" title="Written outside workspace/outputs/">⚠ legacy path</span>
            </>
          )}
        </div>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {previewable && (
          <button
            onClick={onPreview}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
            title="Preview"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDownload() }}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
          title="Download"
        >
          <Download className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ─── Preview overlay ──────────────────────────────────────────────────────────

function PreviewOverlay({
  file, kind, content, truncated, loading, onClose, onDownload, onExpand,
}: {
  file: ChatOutputFile
  kind: PreviewKind
  content: string
  truncated: boolean
  loading: boolean
  onClose: () => void
  onDownload: () => void
  onExpand: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const canExpand = kind === "markdown" || kind === "text" || kind === "image" || kind === "csv"

  return (
    <div className="absolute inset-0 bg-background z-10 flex flex-col border-l border-border">
      {/* Header */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
          title="Back to list (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 min-w-0 ml-1">
          <div className="text-xs font-medium text-foreground truncate">{file.name}</div>
          <div className="text-[10px] text-muted-foreground/60 truncate">{file.relPath}</div>
        </div>
        {canExpand && (
          <button
            onClick={onExpand}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Expand preview to full screen"
          >
            <Maximize2 className="w-3 h-3" />
            <span className="hidden sm:inline">Expand</span>
          </button>
        )}
        <button
          onClick={onDownload}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
          title="Download"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground/50">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && kind === "image" && (
          <div className="p-3 flex items-center justify-center">
            <img
              src={content}
              alt={file.name}
              className="max-w-full max-h-full object-contain rounded border border-border cursor-zoom-in"
              onClick={onExpand}
            />
          </div>
        )}
        {!loading && kind === "markdown" && (
          <div className="p-3">
            <MarkdownRenderer content={content} className="prose-sm" />
            {truncated && (
              <div className="mt-3 text-[11px] text-amber-500/80 italic border-t border-border pt-2">
                ⚠ Preview truncated at 200 KB — expand or download to see full file.
              </div>
            )}
          </div>
        )}
        {!loading && kind === "text" && (
          <pre className="text-xs font-mono p-3 whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">
            {content}
            {truncated && (
              <span className="block mt-3 text-amber-500/70 italic">
                ⚠ Preview truncated at 200 KB — expand or download to see full file.
              </span>
            )}
          </pre>
        )}
        {!loading && kind === "csv" && (
          <CSVTable
            text={content}
            tabSeparated={file.ext === "tsv"}
            compact
            maxRows={50}
            truncated={truncated}
          />
        )}
      </div>
    </div>
  )
}

// ─── CSV / TSV table ───────────────────────────────────────────────────────

function CSVTable({
  text, tabSeparated, compact, maxRows, truncated,
}: { text: string; tabSeparated: boolean; compact: boolean; maxRows?: number; truncated: boolean }) {
  const rows = useMemo(() => parseCSV(text, tabSeparated), [text, tabSeparated])
  if (rows.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground italic">Empty file.</p>
  }
  const [header, ...body] = rows
  const displayBody = maxRows ? body.slice(0, maxRows) : body
  const rowsTruncated = maxRows ? body.length > maxRows : false
  const fontClass = compact ? "text-[11px]" : "text-xs"

  return (
    <div className="overflow-auto">
      <table className={cn("w-full border-collapse font-mono", fontClass)}>
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-[1]">
          <tr>
            <th className="px-2 py-1 text-right text-muted-foreground/60 font-normal border-b border-border w-10">#</th>
            {header.map((h, i) => (
              <th
                key={i}
                className="px-2 py-1 text-left text-foreground font-semibold border-b border-border whitespace-nowrap"
                title={h}
              >
                {h || <span className="text-muted-foreground/50">(blank)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayBody.map((r, ri) => (
            <tr key={ri} className="hover:bg-muted/40 transition-colors">
              <td className="px-2 py-1 text-right text-muted-foreground/50 border-b border-border/60 select-none">{ri + 1}</td>
              {header.map((_, ci) => (
                <td
                  key={ci}
                  className="px-2 py-1 text-foreground/90 border-b border-border/60 align-top max-w-[28ch] truncate"
                  title={r[ci] ?? ""}
                >
                  {r[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(rowsTruncated || truncated) && (
        <div className="px-3 py-2 text-[11px] text-amber-500/80 italic border-t border-border">
          ⚠ Showing first {displayBody.length.toLocaleString()} of {body.length.toLocaleString()} rows
          {truncated && " · file also truncated at 500 KB"}
          {" — expand or download to see more."}
        </div>
      )}
    </div>
  )
}

// ─── Expanded preview (full-screen modal) ──────────────────────────────────

function ExpandedPreview({
  file, kind, content, truncated, onClose, onDownload,
}: {
  file: ChatOutputFile
  kind: PreviewKind
  content: string
  truncated: boolean
  onClose: () => void
  onDownload: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl h-full max-h-[90vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{file.name}</div>
            <div className="text-[11px] text-muted-foreground/70 truncate font-mono">{file.relPath}</div>
          </div>
          <button
            onClick={onDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background text-xs font-medium text-foreground hover:bg-muted/40 transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {kind === "markdown" && (
            <div className="px-6 sm:px-10 py-6 max-w-4xl mx-auto">
              <MarkdownRenderer content={content} />
            </div>
          )}
          {kind === "text" && (
            <pre className="text-sm font-mono p-6 whitespace-pre-wrap break-words text-foreground/85 leading-relaxed">
              {content}
            </pre>
          )}
          {kind === "image" && (
            <div className="p-6 flex items-center justify-center min-h-full bg-black/30">
              <img
                src={content}
                alt={file.name}
                className="max-w-full max-h-full object-contain rounded"
              />
            </div>
          )}
          {kind === "csv" && (
            <CSVTable
              text={content}
              tabSeparated={file.ext === "tsv"}
              compact={false}
              truncated={truncated}
            />
          )}
        </div>

        {/* Footer banner — truncation warning */}
        {truncated && (
          <div className="px-4 py-2 border-t border-border bg-amber-500/10 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-2 shrink-0">
            <AlertCircle className="w-3.5 h-3.5" />
            Preview truncated at 200 KB — download to see the full file.
          </div>
        )}
      </div>
    </div>
  )
}
