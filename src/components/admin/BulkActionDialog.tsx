import { useState } from "react"
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, Play, Square, RefreshCw, X,
} from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { GatewayBulkAction, BulkGatewayResult } from "@/types"

interface Props {
  action: GatewayBulkAction
  userIds: number[]
  /** Optional lookup so the results screen can show usernames instead of bare ids. */
  usernameLookup?: (userId: number) => string | undefined
  onClose: () => void
  /** Called after a successful run, regardless of per-user errors. */
  onCompleted: () => void
}

type Phase = "confirm" | "running" | "done"

const ACTION_META: Record<GatewayBulkAction, {
  label: string
  verb: string
  icon: typeof Play
  tone: "primary" | "danger" | "amber"
}> = {
  start:   { label: "Start",   verb: "start",   icon: Play,      tone: "primary" },
  stop:    { label: "Stop",    verb: "stop",    icon: Square,    tone: "danger"  },
  restart: { label: "Restart", verb: "restart", icon: RefreshCw, tone: "amber"   },
}

export function BulkActionDialog({
  action, userIds, usernameLookup, onClose, onCompleted,
}: Props) {
  const [phase, setPhase] = useState<Phase>("confirm")
  const [results, setResults] = useState<BulkGatewayResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const meta = ACTION_META[action]
  const Icon = meta.icon
  const count = userIds.length

  async function handleConfirm() {
    setPhase("running")
    setError(null)
    try {
      const res = await api.bulkGatewayAction(action, userIds)
      setResults(res.results)
      setPhase("done")
      onCompleted()
    } catch (err) {
      setError((err as Error).message)
      setPhase("confirm")
    }
  }

  const okCount = results?.filter(r => r.ok).length ?? 0
  const failCount = results ? results.length - okCount : 0

  const toneClasses =
    meta.tone === "danger"
      ? "bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25"
      : meta.tone === "amber"
      ? "bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25"
      : "bg-primary/15 border-primary/25 text-primary hover:bg-primary/25"

  const iconBgClasses =
    meta.tone === "danger"
      ? "bg-red-500/10 text-red-400"
      : meta.tone === "amber"
      ? "bg-amber-500/10 text-amber-400"
      : "bg-primary/10 text-primary"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={phase !== "running" ? onClose : undefined}
      />
      <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className={cn(
            "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5",
            iconBgClasses,
          )}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground leading-snug">
              {phase === "done"
                ? `${meta.label} complete`
                : `${meta.label} ${count} gateway${count === 1 ? "" : "s"}?`}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
              {phase === "confirm" && (
                <>This will {meta.verb} the gateway process for {count} selected user{count === 1 ? "" : "s"}.</>
              )}
              {phase === "running" && (
                <>Running {meta.verb} on {count} gateway{count === 1 ? "" : "s"}…</>
              )}
              {phase === "done" && (
                <>
                  <span className="text-emerald-400 font-medium">{okCount} succeeded</span>
                  {failCount > 0 && (
                    <>
                      {" · "}
                      <span className="text-red-400 font-medium">{failCount} failed</span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          {phase === "done" && (
            <button
              onClick={onClose}
              className="shrink-0 w-7 h-7 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Result list */}
        {phase === "done" && results && (
          <div className="px-5 pb-3 max-h-72 overflow-auto">
            <ul className="space-y-1">
              {results.map(r => {
                const name = usernameLookup?.(r.userId) ?? `user #${r.userId}`
                return (
                  <li
                    key={r.userId}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs"
                  >
                    {r.ok
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    }
                    <span className="font-medium text-foreground">{name}</span>
                    <span className="text-muted-foreground truncate ml-auto">
                      {r.ok
                        ? r.port != null
                          ? `port ${r.port}${r.pid != null ? ` · pid ${r.pid}` : ""}`
                          : "ok"
                        : r.error}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Error banner (confirm phase) */}
        {error && phase === "confirm" && (
          <div className="mx-5 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          {phase === "confirm" && (
            <>
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={count === 0}
                className={cn(
                  "flex-1 py-2 rounded-xl text-sm font-semibold border flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40",
                  toneClasses,
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {meta.label} {count}
              </button>
            </>
          )}

          {phase === "running" && (
            <button
              disabled
              className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground flex items-center justify-center gap-2 opacity-70"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Working…
            </button>
          )}

          {phase === "done" && (
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-muted transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
