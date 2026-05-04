import { useState, useEffect, useCallback, useRef } from "react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useCanWrite } from "@/lib/permissions"
import {
  Wifi, WifiOff, RefreshCw, Square, Loader2, Play,
  Server, Radio, Hash, AlertTriangle, CheckCircle2,
} from "lucide-react"

/* ─────────────────────────────────────────────────────────────────── */
/*  TYPE                                                               */
/* ─────────────────────────────────────────────────────────────────── */

interface GatewayStatus {
  running: boolean
  pids: number[]
  port: number
  portOpen: boolean
  mode: string
  bind: string
}

type ActionState = "idle" | "restarting" | "stopping" | "starting"

/* ─────────────────────────────────────────────────────────────────── */
/*  COMPONENT                                                          */
/* ─────────────────────────────────────────────────────────────────── */

export function GatewayControlCard() {
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<ActionState>("idle")
  const canWrite = useCanWrite()
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const data = await api.getGatewayStatus()
      setStatus(data)
    } catch {
      setStatus(null)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  // Poll every 8 s
  useEffect(() => {
    fetchStatus()
    pollRef.current = setInterval(() => fetchStatus(true), 8000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchStatus])

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleStart() {
    if (action !== "idle") return
    setAction("starting")
    try {
      await api.startGateway()
      showToast("Gateway starting…", true)
      let tries = 0
      const rapid = setInterval(async () => {
        await fetchStatus(true)
        if (++tries >= 10) clearInterval(rapid)
      }, 1200)
    } catch (err) {
      showToast((err as Error).message, false)
    } finally {
      setTimeout(() => setAction("idle"), 4000)
    }
  }

  async function handleRestart() {
    if (action !== "idle") return
    setAction("restarting")
    try {
      const res = await api.restartGatewaySelf()
      showToast(res.message ?? "Gateway restarting…", true)
      // Poll more aggressively for 10 s to show it coming back up
      let tries = 0
      const rapid = setInterval(async () => {
        await fetchStatus(true)
        if (++tries >= 10) clearInterval(rapid)
      }, 1200)
    } catch (err) {
      showToast((err as Error).message, false)
    } finally {
      setTimeout(() => setAction("idle"), 4000)
    }
  }

  async function handleStop() {
    if (action !== "idle") return
    if (!confirm("This will stop your workspace. Active sessions will disconnect. Continue?")) return
    setAction("stopping")
    try {
      const res = await api.stopGatewaySelf()
      showToast(res.message ?? "Gateway stopped", true)
      await fetchStatus(true)
    } catch (err) {
      showToast((err as Error).message, false)
    } finally {
      setAction("idle")
    }
  }

  const isRunning = status?.running ?? false
  const isRestarting = action === "restarting"
  const isStopping = action === "stopping"
  const isStarting = action === "starting"
  const busy = action !== "idle"

  return (
    <div className="relative bg-surface-low border border-white/5 rounded-2xl overflow-hidden">
      {/* Top glow when running */}
      {isRunning && (
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(34,197,94,0.5), transparent)" }}
        />
      )}

      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center border shrink-0",
              isRunning
                ? "bg-emerald-500/10 border-emerald-500/20"
                : "bg-white/5 border-white/10"
            )}>
              {isRunning
                ? <Wifi className="w-4 h-4 text-emerald-400" />
                : <WifiOff className="w-4 h-4 text-muted-foreground" />
              }
            </div>
            <div>
              <p className="text-sm font-display font-bold text-foreground">OpenClaw Gateway</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {/* Live pulse */}
                {isRunning && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                )}
                <p className={cn(
                  "text-[11px] font-semibold",
                  isRunning ? "text-emerald-400" : "text-muted-foreground"
                )}>
                  {loading ? "Checking…" : isRunning ? "RUNNING" : "OFFLINE"}
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Refresh */}
            <button
              onClick={() => fetchStatus()}
              disabled={loading || busy}
              className="flex items-center justify-center w-7 h-7 rounded-lg border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-40"
              title="Refresh status"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </button>

            {!canWrite ? (
              <span className="text-xs text-muted-foreground italic">Read-only</span>
            ) : (
              <>
                {/* Start (when not running) */}
                {!isRunning && (
                  <button
                    onClick={handleStart}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/15 text-primary text-xs font-bold hover:bg-primary/25 transition-colors disabled:opacity-40"
                    title="Start gateway"
                  >
                    {isStarting
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Play className="w-3.5 h-3.5" />
                    }
                    {isStarting ? "Starting…" : "Start"}
                  </button>
                )}

                {/* Stop */}
                {isRunning && (
                  <button
                    onClick={handleStop}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-colors disabled:opacity-40"
                    title="Stop gateway"
                  >
                    {isStopping
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Square className="w-3 h-3" />
                    }
                    {isStopping ? "Stopping…" : "Stop"}
                  </button>
                )}

                {/* Restart */}
                {isRunning && (
                  <button
                    onClick={handleRestart}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                    title="Restart gateway"
                  >
                    {isRestarting
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RefreshCw className="w-3.5 h-3.5" />
                    }
                    {isRestarting ? "Restarting…" : "Restart"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Info grid */}
        {status ? (
          <div className="grid grid-cols-3 gap-3">
            <InfoPill
              icon={Hash}
              label="Port"
              value={String(status.port)}
              ok={status.portOpen}
            />
            <InfoPill
              icon={Server}
              label="Mode"
              value={status.mode}
              ok={status.running}
            />
            <InfoPill
              icon={Radio}
              label="Bind"
              value={status.bind}
              ok={status.running}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-white/3 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500/60 shrink-0" />
            Unable to fetch gateway status
          </div>
        )}

        {/* PIDs */}
        {status && status.pids.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">PID</span>
            {status.pids.map(pid => (
              <span key={pid} className="text-[11px] font-mono text-foreground/60 bg-white/5 px-2 py-0.5 rounded">
                {pid}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={cn(
          "flex items-center gap-2 px-5 py-2.5 border-t text-xs font-medium",
          toast.ok
            ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
            : "bg-red-500/5 border-red-500/20 text-red-400"
        )}>
          {toast.ok
            ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          }
          {toast.msg}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  SUB-COMPONENTS                                                     */
/* ─────────────────────────────────────────────────────────────────── */

function InfoPill({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: React.ElementType
  label: string
  value: string
  ok?: boolean
}) {
  return (
    <div className="flex items-center gap-2 bg-white/3 rounded-lg px-3 py-2 border border-white/5">
      <Icon className={cn("w-3.5 h-3.5 shrink-0", ok ? "text-emerald-400/60" : "text-muted-foreground/50")} />
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xs font-mono font-semibold text-foreground/80 truncate">{value}</p>
      </div>
    </div>
  )
}
