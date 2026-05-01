import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useIsAdmin } from "@/lib/permissions"
import type { BrowserHarnessStatus, BrowserHarnessSlot, BrowserHarnessOdooStatus } from "@/types"
import {
  Globe2, RefreshCw, Power, PowerOff, Download,
  Loader2, Check, AlertCircle, Info,
  FolderTree, Sparkles,
} from "lucide-react"

function StateBadge({ state }: { state: BrowserHarnessSlot["state"] }) {
  const styles: Record<BrowserHarnessSlot["state"], string> = {
    down:    "bg-foreground/4 border-foreground/10 text-muted-foreground/60",
    booting: "bg-amber-500/10 border-amber-500/25 text-amber-400",
    idle:    "bg-emerald-500/8 border-emerald-500/20 text-emerald-400",
    busy:    "bg-indigo-500/10 border-indigo-500/25 text-indigo-300",
  }
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border tabular-nums uppercase tracking-wider",
      styles[state],
    )}>
      {state === "booting" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {state === "idle" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />}
      {state === "busy" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block animate-pulse" />}
      {state}
    </span>
  )
}

function fmtIdle(ms: number | null) {
  if (ms == null || ms < 0) return "—"
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

export function BrowserHarnessCard() {
  const [data, setData] = useState<BrowserHarnessStatus | null>(null)
  const [odoo, setOdoo] = useState<BrowserHarnessOdooStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const isAdmin = useIsAdmin()

  const load = useCallback(async () => {
    try {
      const [core, odooStatus] = await Promise.all([
        api.getBrowserHarnessStatus(),
        api.getBrowserHarnessOdooStatus().catch(() => null),
      ])
      setData(core)
      setOdoo(odooStatus)
    } catch (e) {
      setToast({ msg: (e as Error).message, ok: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll while any slot is booting/busy so the UI tracks state changes.
  useEffect(() => {
    if (!data) return
    const active = data.slots.some(s => s.state === "booting" || s.state === "busy")
    if (!active) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [data, load])

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function withBusy<T>(key: string, fn: () => Promise<T>) {
    setBusy(key)
    try { return await fn() }
    finally { setBusy(null) }
  }

  async function handleInstall(force = false) {
    await withBusy("install", async () => {
      try {
        const res = await api.installBrowserHarness({ force })
        if (res.ok) {
          showToast(res.skipped ? "Already at pinned commit" : `Installed ${res.commit?.slice(0, 8)}`, true)
          await load()
        } else {
          showToast(res.error || "Install failed", false)
        }
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  async function handleBoot(slotId: number) {
    await withBusy(`boot:${slotId}`, async () => {
      try {
        const res = await api.bootBrowserHarness(slotId)
        if (res.ok) { showToast(`Slot ${slotId} ready (${res.slot?.version ?? "Chrome"})`, true); await load() }
        else { showToast(res.error || "Boot failed", false) }
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  async function handleStop(slotId: number) {
    await withBusy(`stop:${slotId}`, async () => {
      try {
        const res = await api.stopBrowserHarness({ slotId })
        if (res.ok) { showToast(`Slot ${slotId} stopped`, true); await load() }
        else { showToast(res.error || "Stop failed", false) }
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  async function handleOdooInstall(force = false) {
    await withBusy("odoo-install", async () => {
      try {
        const res = await api.installBrowserHarnessOdoo({ force })
        if (res.ok) {
          const parts = [
            res.written ? `${res.written} written` : null,
            res.kept ? `${res.kept} unchanged` : null,
            res.skippedUserEdit ? `${res.skippedUserEdit} user-edited preserved` : null,
          ].filter(Boolean).join(", ")
          showToast(`Layer 2 v${res.bundleVersion}: ${parts}`, true)
          await load()
        } else { showToast(res.error || "Install failed", false) }
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }
  if (!data) return null

  const { install, chromePath, slots } = data

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="h-4 w-4 text-primary" />
              Browser Harness
              <Badge variant="secondary" className="text-[10px] font-mono">built-in skill</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Real Chrome over CDP for high-fidelity automation. Layer 1 base — inherit for site-specific skills (Odoo, etc.).
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={load} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {toast && (
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md border text-xs",
            toast.ok ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-400" : "bg-red-500/8 border-red-500/20 text-red-400",
          )}>
            {toast.ok ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {toast.msg}
          </div>
        )}

        {/* Install + Chrome status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/50 bg-foreground/2 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Upstream Install</span>
              {install.installed && install.upToDate
                ? <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">up to date</Badge>
                : install.installed
                  ? <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">drift</Badge>
                  : <Badge variant="outline" className="text-[10px] text-muted-foreground/60">not installed</Badge>
              }
            </div>
            <div className="text-[11px] space-y-0.5">
              <div className="flex justify-between gap-2 text-muted-foreground">
                <span>Pinned</span>
                <span className="font-mono text-foreground/70">{install.pinnedCommit.slice(0, 12)}</span>
              </div>
              <div className="flex justify-between gap-2 text-muted-foreground">
                <span>Current</span>
                <span className="font-mono text-foreground/70">{install.currentCommit ? install.currentCommit.slice(0, 12) : "—"}</span>
              </div>
              {install.installedAt && (
                <div className="flex justify-between gap-2 text-muted-foreground">
                  <span>Installed</span>
                  <span className="text-foreground/70">{new Date(install.installedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
            {isAdmin && (
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => handleInstall(false)}
                  disabled={busy === "install"}
                >
                  {busy === "install" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                  {install.installed ? "Re-check" : "Install"}
                </Button>
                {install.installed && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => handleInstall(true)}
                    disabled={busy === "install"}
                    title="Force re-checkout (uses pinned commit)"
                  >
                    Force re-install
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border/50 bg-foreground/2 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Chrome Detection</span>
              {chromePath
                ? <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">found</Badge>
                : <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30">missing</Badge>
              }
            </div>
            {chromePath ? (
              <p className="text-[11px] font-mono text-muted-foreground/70 break-all">{chromePath}</p>
            ) : (
              <p className="text-[11px] text-amber-400/80 leading-relaxed">
                Install Google Chrome from <span className="font-mono">google.com/chrome</span>, or set <span className="font-mono">AOC_CHROME_PATH</span> env var.
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/50">
              Chrome runs visibly so you can watch the agent operate.
            </p>
          </div>
        </div>

        {/* Layer 2 — browser-harness-odoo */}
        {odoo && (
          <div className="rounded-lg border border-border/50 bg-foreground/2 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
              <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                Layer 2 · browser-harness-odoo
              </span>
              <Badge variant="secondary" className="text-[10px] font-mono">v{odoo.bundleVersion}</Badge>
              {odoo.installed
                ? <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">installed</Badge>
                : <Badge variant="outline" className="text-[10px] text-muted-foreground/60">not installed</Badge>
              }
              <span className="ml-auto text-[10px] text-muted-foreground/50">
                {odoo.files.filter(f => f.exists).length}/{odoo.files.length} files · {odoo.moduleCount} module{odoo.moduleCount === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              Built-in skill: Odoo login via assigned connection, module navigation, UAT-grade screenshot capture,
              Markdown UAT/User-Manual formatters. Inherits Layer 1 CDP. Built on Playwright (run <span className="font-mono">pip3 install playwright</span> once).
            </p>
            {/* File status grid */}
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground/70 hover:text-foreground/80 inline-flex items-center gap-1">
                <FolderTree className="h-3 w-3" /> Bundle contents
              </summary>
              <div className="mt-1.5 space-y-0.5 pl-4 border-l border-border/40">
                {odoo.files.map(f => {
                  const flags = []
                  if (f.userEdited) flags.push("user-edited")
                  if (!f.upToDate && f.exists) flags.push("drift")
                  if (!f.protect) flags.push("extendable")
                  return (
                    <div key={f.relPath} className="flex items-center gap-2">
                      {f.exists
                        ? <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                        : <AlertCircle className="h-3 w-3 text-amber-400 shrink-0" />}
                      <span className="font-mono text-foreground/70">{f.relPath}</span>
                      {flags.length > 0 && (
                        <span className="text-[9px] text-muted-foreground/50">({flags.join(", ")})</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </details>
            {isAdmin && (
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={() => handleOdooInstall(false)}
                  disabled={busy === "odoo-install"}
                >
                  {busy === "odoo-install" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                  Sync bundle
                </Button>
                <Button
                  variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={() => handleOdooInstall(true)}
                  disabled={busy === "odoo-install"}
                  title="Force overwrite — including user-edited files"
                >
                  Force re-install
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Slot pool */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Browser Pool ({slots.filter(s => s.state !== "down").length}/{slots.length} active)
            </span>
            <span className="text-[10px] text-muted-foreground/50 inline-flex items-center gap-1">
              <Info className="h-3 w-3" /> idle slots auto-quit after 5 min
            </span>
          </div>
          <div className="space-y-1.5">
            {slots.map(s => (
              <div key={s.id} className="rounded-md border border-border/50 bg-foreground/2 p-2.5 flex items-center gap-3">
                <div className="text-[11px] font-mono text-muted-foreground/70 w-14">slot {s.id}</div>
                <div className="text-[11px] font-mono text-foreground/80 w-16">:{s.port}</div>
                <StateBadge state={s.state} />
                <div className="flex-1 text-[10px] text-muted-foreground/60 truncate">
                  {s.agentId && <span>agent: <span className="font-mono text-foreground/70">{s.agentId}</span> · </span>}
                  {s.pid && <span>pid {s.pid} · </span>}
                  {s.version && <span className="font-mono">{s.version}</span>}
                  {s.state === "idle" && s.idleMs != null && <span> · idle {fmtIdle(s.idleMs)}</span>}
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    {s.state === "down" || s.state === "booting" ? (
                      <Button
                        variant="outline" size="sm" className="h-7 text-[11px]"
                        onClick={() => handleBoot(s.id)}
                        disabled={busy === `boot:${s.id}` || s.state === "booting" || !chromePath}
                        title={!chromePath ? "Install Chrome first" : "Boot this slot"}
                      >
                        {busy === `boot:${s.id}` || s.state === "booting"
                          ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          : <Power className="h-3 w-3 mr-1" />}
                        Boot
                      </Button>
                    ) : (
                      <Button
                        variant="outline" size="sm" className="h-7 text-[11px] text-red-400 hover:text-red-300"
                        onClick={() => handleStop(s.id)}
                        disabled={busy === `stop:${s.id}` || s.state === "busy"}
                        title={s.state === "busy" ? `Cannot stop while agent ${s.agentId} is using it` : "Stop this slot"}
                      >
                        {busy === `stop:${s.id}` ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <PowerOff className="h-3 w-3 mr-1" />}
                        Stop
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
          Skill bundle at <span className="font-mono">{install.skillRoot}</span>.
          Profiles isolated per slot at <span className="font-mono">{install.profilesRoot}</span>.
          {!isAdmin && <> Admin role required to install / boot / stop.</>}
        </p>
      </CardContent>
    </Card>
  )
}
