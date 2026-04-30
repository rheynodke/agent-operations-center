import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, Plus, ExternalLink, X, CheckCircle2, XCircle, Clock } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Connection, ComposioConnectedAccount } from "@/types"

// Same curated list as ConnectionsPage. Keeping it local so this component can
// be lifted out independently if Composio integration grows.
const POPULAR_TOOLKITS = [
  'gmail', 'github', 'slack', 'linear', 'notion', 'asana', 'jira', 'trello',
  'hubspot', 'googledrive', 'googlecalendar', 'googlesheets', 'googledocs',
  'discord', 'telegram', 'twitter', 'youtube', 'dropbox', 'salesforce',
  'stripe', 'shopify', 'twilio', 'intercom', 'airtable', 'zoom',
]

function statusStyle(status: string) {
  switch (status) {
    case 'ACTIVE':       return { cls: 'bg-emerald-500/15 text-emerald-400', Icon: CheckCircle2 }
    case 'INITIATED':
    case 'INITIALIZING': return { cls: 'bg-yellow-500/15 text-yellow-400', Icon: Clock }
    case 'EXPIRED':
    case 'INACTIVE':     return { cls: 'bg-orange-500/15 text-orange-400', Icon: XCircle }
    case 'FAILED':       return { cls: 'bg-red-500/15 text-red-400', Icon: XCircle }
    default:             return { cls: 'bg-muted text-muted-foreground', Icon: Clock }
  }
}

export function ComposioPanel({ open, onClose, conn }: {
  open: boolean
  onClose: () => void
  conn: Connection | null
}) {
  const [accounts, setAccounts] = useState<ComposioConnectedAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [linking, setLinking] = useState<string | null>(null)
  const [customSlug, setCustomSlug] = useState('')

  const refresh = useCallback(async () => {
    if (!conn) return
    setLoading(true); setError('')
    try {
      const { accounts } = await api.composioListConnected(conn.id)
      setAccounts(accounts)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [conn])

  useEffect(() => {
    if (open && conn) refresh()
  }, [open, conn, refresh])

  if (!conn) return null
  const co = (conn.metadata?.composio) || { toolkits: [], userId: '' } as { toolkits?: string[]; userId?: string }
  const allowed = co.toolkits || []
  // Toolkits to expose in the picker: union of (allowlist if set, else popular).
  const pickable = allowed.length > 0 ? allowed : POPULAR_TOOLKITS
  const connectedSlugs = new Set(accounts.map(a => a.toolkit).filter(Boolean) as string[])

  async function handleConnect(toolkit: string) {
    if (!conn) return
    setLinking(toolkit); setError('')
    try {
      const link = await api.composioCreateLink(conn.id, toolkit)
      window.open(link.redirectUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLinking(null)
    }
  }

  async function handleDisconnectAccount(accountId: string, toolkit?: string) {
    if (!conn) return
    if (!window.confirm(`Disconnect ${toolkit || accountId}? Composio revokes the OAuth token.`)) return
    try {
      await api.composioDisconnectAccount(conn.id, accountId)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleRefreshSession() {
    if (!conn) return
    if (!window.confirm('Recreate the Composio tool router session? This invalidates the previous session URL but keeps connected accounts.')) return
    setLoading(true); setError('')
    try {
      await api.composioRefreshSession(conn.id)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            Composio · {conn.name}
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-fuchsia-500/15 text-fuchsia-400 font-medium">
              user: {co.userId || '?'}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 py-1">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded px-2.5 py-1.5">
              <XCircle className="h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}

          {/* Connected accounts */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Connected accounts</Label>
              <button
                onClick={refresh}
                disabled={loading}
                className="text-[10px] text-primary hover:underline flex items-center gap-1"
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Refresh
              </button>
            </div>
            {loading && accounts.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/60 py-4 text-center">Loading…</div>
            ) : accounts.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/60 py-4 text-center">
                No accounts connected yet. Pick a toolkit below to start the OAuth flow.
              </div>
            ) : (
              <div className="space-y-1.5">
                {accounts.map(acc => {
                  const { cls, Icon } = statusStyle(acc.status)
                  return (
                    <div key={acc.id} className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/10 px-2.5 py-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground/90 truncate">
                          {acc.toolkitName || acc.toolkit || acc.id}
                        </div>
                        <div className="text-[10px] text-muted-foreground/60 font-mono truncate">{acc.id}</div>
                      </div>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md font-medium", cls)}>
                        {acc.status}
                      </span>
                      <button
                        onClick={() => handleDisconnectAccount(acc.id, acc.toolkit)}
                        className="h-6 w-6 rounded-md text-muted-foreground/50 hover:text-red-400 transition-colors"
                        title="Disconnect"
                      >
                        <X className="h-3 w-3 mx-auto" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Toolkit picker — initiate Connect Link */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Connect a toolkit</Label>
            <p className="text-[10px] text-muted-foreground/50">
              Opens Composio's hosted OAuth page in a new tab. After authorizing, click Refresh above to confirm.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pickable.map(slug => {
                const already = connectedSlugs.has(slug)
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => handleConnect(slug)}
                    disabled={linking === slug || already}
                    className={cn(
                      "px-2 py-1 rounded-md text-[10px] border transition-colors flex items-center gap-1",
                      already
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 cursor-default"
                        : "border-border/50 bg-input text-muted-foreground hover:text-foreground hover:border-primary/50",
                      linking === slug && "opacity-50",
                    )}
                  >
                    {linking === slug ? <Loader2 className="h-3 w-3 animate-spin" /> :
                     already ? <CheckCircle2 className="h-3 w-3" /> :
                     <ExternalLink className="h-3 w-3" />}
                    {slug}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-1.5 pt-1.5">
              <input
                value={customSlug}
                onChange={e => setCustomSlug(e.target.value)}
                placeholder="other slug (e.g. clickup)"
                className="flex h-8 flex-1 rounded-md px-3 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 font-mono"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[10px]"
                disabled={!customSlug.trim() || !!linking}
                onClick={() => {
                  const slug = customSlug.trim().toLowerCase()
                  if (slug) handleConnect(slug)
                  setCustomSlug('')
                }}
              >
                <Plus className="h-3 w-3 mr-1" /> Connect
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t border-border/40 shrink-0">
          <Button size="sm" variant="ghost" className="h-7 text-xs mr-auto" onClick={handleRefreshSession} disabled={loading}>
            Re-create session
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
