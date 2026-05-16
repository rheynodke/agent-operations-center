import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw, Download, X, AlertTriangle, FileText } from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Props {
  userId: number
  username: string
  onClose: () => void
}

const LINE_OPTIONS = [200, 500, 1000, 2000] as const

export function GatewayLogModal({ userId, username, onClose }: Props) {
  const [lines, setLines] = useState<number>(200)
  const [content, setContent] = useState<string[] | null>(null)
  const [logFile, setLogFile] = useState<string>("")
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auto-scroll bookkeeping: if user scrolls up, freeze auto-scroll on subsequent reloads.
  const preRef = useRef<HTMLPreElement | null>(null)
  const stickToBottomRef = useRef<boolean>(true)
  const firstLoadRef = useRef<boolean>(true)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getGatewayLogs(userId, lines)
      setContent(res.lines)
      setLogFile(res.logFile)
      setNotFound(res.notFound)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [userId, lines])

  // Initial + on lines change
  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // After content updates: scroll to bottom on first load OR while sticky.
  useEffect(() => {
    if (!content || !preRef.current) return
    if (firstLoadRef.current || stickToBottomRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
      firstLoadRef.current = false
    }
  }, [content])

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  function handleScroll(e: React.UIEvent<HTMLPreElement>) {
    const el = e.currentTarget
    // ~8px threshold to forgive sub-pixel rounding
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    stickToBottomRef.current = atBottom
  }

  function handleDownload() {
    if (!content) return
    const blob = new Blob([content.join("\n")], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    a.download = `gateway-${username}-${stamp}.log`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-4xl h-[80vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground leading-snug">
                Gateway log — {username}
              </h2>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {logFile || "—"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-2.5 border-b border-border flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground">Lines:</label>
          <select
            value={lines}
            onChange={e => setLines(Number(e.target.value))}
            disabled={loading}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {LINE_OPTIONS.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            title="Reload"
          >
            {loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />
            }
            Reload
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || !content || content.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {content ? `${content.length} line${content.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 relative bg-background">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertTriangle className="w-4 h-4" /> {error}
              </div>
            </div>
          ) : notFound ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
              <FileText className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No log file found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                The gateway has not produced a log file yet.
              </p>
            </div>
          ) : loading && !content ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <pre
              ref={preRef}
              onScroll={handleScroll}
              className={cn(
                "absolute inset-0 overflow-auto px-4 py-3 text-[11px] leading-relaxed font-mono whitespace-pre",
                "text-foreground/85",
              )}
            >
              {content && content.length > 0
                ? content.join("\n")
                : <span className="text-muted-foreground italic">(empty)</span>
              }
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
