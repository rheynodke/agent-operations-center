/**
 * PairingRequestsPanel — extracted from AgentDetailPage.tsx (Sprint 3 split).
 *
 * Renders pending DM pairing approval requests across Telegram / WhatsApp /
 * Discord for a single agent. Self-contained: takes only `agentId`, owns its
 * fetch + approve/reject state.
 */

import { useState, useEffect, useCallback } from "react"
import {
  Loader2, RefreshCw, AlertCircle, Check, X, ShieldCheck, UserCheck,
} from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/stores"
import { useCanEditAgent } from "@/lib/permissions"
import type { PairingRequest, PairingRequestsByChannel } from "@/types"
import { confirmDialog } from "@/lib/dialogs"

export function PairingRequestsPanel({ agentId }: { agentId: string }) {
  const [pairing, setPairing] = useState<PairingRequestsByChannel | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const agentFromList = useAgentStore((s) => s.agents.find((a) => a.id === agentId))
  const canEdit = useCanEditAgent(agentFromList)

  const load = useCallback(async () => {
    try {
      const data = await api.getAgentPairing(agentId)
      setPairing(data)
    } catch { setPairing(null) }
    finally { setLoading(false) }
  }, [agentId])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 10s
  useEffect(() => {
    const iv = setInterval(() => load(), 10000)
    return () => clearInterval(iv)
  }, [load])

  const allRequests: (PairingRequest & { channel: string })[] = pairing
    ? [
        ...pairing.telegram.map(r => ({ ...r, channel: "telegram" as const })),
        ...pairing.whatsapp.map(r => ({ ...r, channel: "whatsapp" as const })),
        ...pairing.discord.map(r => ({ ...r, channel: "discord" as const })),
      ]
    : []

  if (loading || allRequests.length === 0) return null

  async function handleApprove(channel: string, code: string) {
    setApproving(code)
    try {
      const result = await api.approvePairing(channel, code, agentId)
      if (result.ok) {
        const msg = result.warning
          ? `Approved ${channel} pairing: ${code} (${result.warning})`
          : `Approved ${channel} pairing: ${code}`
        setToast({ msg, ok: true })
        await load()
        // Notify any mounted ChannelAllowFromSection for this agent to refresh —
        // approve writes the requester ID into the channel's allowFrom file.
        window.dispatchEvent(new CustomEvent("aoc:allowfrom-refresh", {
          detail: { agentId, channel },
        }))
      } else {
        setToast({ msg: result.error || "Approval failed", ok: false })
        await load()
      }
    } catch (e) {
      setToast({ msg: (e as Error).message, ok: false })
    } finally {
      setApproving(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  async function handleReject(channel: string, code: string) {
    if (!await confirmDialog({
      title: `Reject ${channel} pairing request?`,
      description: `Code ${code} will be deleted from pending requests.`,
      confirmLabel: "Reject",
      destructive: true,
    })) return
    setRejecting(code)
    try {
      const result = await api.rejectPairing(channel, code, agentId)
      if (result.ok) {
        setToast({ msg: `Rejected ${channel} pairing: ${code}`, ok: true })
        await load()
      } else {
        setToast({ msg: result.error || "Reject failed", ok: false })
        await load()
      }
    } catch (e) {
      setToast({ msg: (e as Error).message, ok: false })
    } finally {
      setRejecting(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  function timeAgo(isoDate: string) {
    const diff = Date.now() - new Date(isoDate).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    return `${Math.floor(mins / 60)}h ago`
  }

  const channelIcon = (ch: string) => {
    if (ch === "telegram") return <img src="/telegram.webp" className="w-3.5 h-3.5 rounded-full" alt="" />
    if (ch === "whatsapp") return <img src="/wa.png" className="w-3.5 h-3.5 rounded-full" alt="" />
    return <img src="/discord.png" className="w-3.5 h-3.5 rounded-full" alt="" />
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <UserCheck className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-bold text-amber-300">Pending Pairing Requests</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50">{allRequests.length} pending</span>
        <button onClick={load} className="text-muted-foreground/40 hover:text-foreground/60 transition-colors">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {toast && (
        <div className={cn(
          "flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[10px] font-medium",
          toast.ok
            ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-400"
            : "bg-red-500/8 border-red-500/20 text-red-400"
        )}>
          {toast.ok ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
          {toast.msg}
        </div>
      )}

      <div className="space-y-1.5">
        {allRequests.map(req => (
          <div key={`${req.channel}-${req.code}`} className="flex items-center gap-2 bg-foreground/4 rounded-lg px-3 py-2">
            {channelIcon(req.channel)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-foreground/80">{req.code}</span>
                <span className="text-[10px] text-muted-foreground/40 capitalize">{req.channel}</span>
              </div>
              <div className="text-[10px] text-muted-foreground/40 truncate">
                ID: {req.id} · {timeAgo(req.createdAt)}
              </div>
            </div>
            {canEdit ? (
              <>
                <button
                  onClick={() => handleApprove(req.channel, req.code)}
                  disabled={approving === req.code || rejecting === req.code}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                    approving === req.code || rejecting === req.code
                      ? "bg-foreground/4 text-muted-foreground cursor-not-allowed"
                      : "bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/25"
                  )}
                >
                  {approving === req.code ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3 h-3" />
                  )}
                  Approve
                </button>
                <button
                  onClick={() => handleReject(req.channel, req.code)}
                  disabled={approving === req.code || rejecting === req.code}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                    approving === req.code || rejecting === req.code
                      ? "bg-foreground/4 text-muted-foreground cursor-not-allowed"
                      : "bg-red-500/12 border border-red-500/25 text-red-400 hover:bg-red-500/22"
                  )}
                >
                  {rejecting === req.code ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  Reject
                </button>
              </>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-muted-foreground/50">
                <LockIcon className="w-3 h-3" />
                Owner only
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/40">
        Users who message this agent for the first time need approval when DM policy is set to "pairing".
      </p>
    </div>
  )
}
