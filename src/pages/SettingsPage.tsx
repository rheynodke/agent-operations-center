import { useState, useEffect, useCallback } from "react"
import { useAuthStore } from "@/stores"
import { useCanWrite } from "@/lib/permissions"
import { api } from "@/lib/api"
import {
  Shield, Info, Wifi, BrainCircuit, Wrench, KeyRound,
  Code2, Save, RefreshCw, Eye, EyeOff, Plus, Trash2,
  CheckCircle2, AlertCircle, ChevronRight, Link2,
  Wand2, Maximize2, Minimize2, Cpu,
} from "lucide-react"
import { BrowserHarnessCard } from "@/components/browser-harness/BrowserHarnessCard"
import { JsonMonacoEditor } from "@/components/ui/JsonMonacoEditor"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "account" | "engine" | "gateway" | "models" | "tools" | "env" | "raw"

interface SaveStatus { ok: boolean; message: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
        checked ? "bg-primary" : "bg-foreground/20"
      )}
    >
      <span className={cn(
        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200",
        checked ? "translate-x-4" : "translate-x-0"
      )} />
    </button>
  )
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SelectField({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function SaveBar({ status, saving, onSave }: {
  status: SaveStatus | null
  saving: boolean
  onSave: () => void
}) {
  const canWrite = useCanWrite()
  return (
    <div className="flex items-center gap-3 pt-3 mt-1">
      <Button size="sm" onClick={onSave} disabled={saving || !canWrite} className="gap-1.5">
        {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {saving ? "Saving…" : "Save Changes"}
      </Button>
      {status && (
        <span className={cn("flex items-center gap-1 text-xs", status.ok ? "text-emerald-500" : "text-destructive")}>
          {status.ok
            ? <CheckCircle2 className="h-3.5 w-3.5" />
            : <AlertCircle className="h-3.5 w-3.5" />}
          {status.message}
        </span>
      )}
    </div>
  )
}

// ─── Tab: Gateway ─────────────────────────────────────────────────────────────

function GatewayTab({ config, onSaved }: { config: Record<string, unknown>; onSaved: (section: string, value: unknown) => void }) {
  const gw = (config.gateway ?? {}) as Record<string, unknown>
  const [port, setPort] = useState(String((gw.port as number) ?? 18789))
  const [mode, setMode] = useState((gw.mode as string) ?? "local")
  const [bind, setBind] = useState((gw.bind as string) ?? "loopback")
  const [tsMode, setTsMode] = useState(((gw.tailscale as Record<string, unknown>)?.mode as string) ?? "off")
  const [token, setToken] = useState(((gw.auth as Record<string, unknown>)?.token as string) ?? "")
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  async function save() {
    setSaving(true)
    setStatus(null)
    try {
      const newGw = {
        ...gw,
        port: parseInt(port, 10) || 18789,
        mode,
        bind,
        tailscale: { ...(gw.tailscale as Record<string, unknown> ?? {}), mode: tsMode },
        auth: { ...(gw.auth as Record<string, unknown> ?? {}), token },
      }
      await api.updateConfigSection("gateway", newGw)
      onSaved("gateway", newGw)
      setStatus({ ok: true, message: "Gateway config saved" })
    } catch (e) {
      setStatus({ ok: false, message: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <FieldRow label="Port" hint="Gateway WebSocket port">
        <Input
          value={port}
          onChange={e => setPort(e.target.value)}
          className="h-8 w-24 text-xs font-mono"
          type="number"
          min={1024}
          max={65535}
        />
      </FieldRow>
      <FieldRow label="Mode" hint="Deployment mode">
        <SelectField value={mode} onChange={setMode} options={[
          { value: "local", label: "Local" },
          { value: "remote", label: "Remote" },
        ]} />
      </FieldRow>
      <FieldRow label="Bind" hint="Which interfaces to listen on">
        <SelectField value={bind} onChange={setBind} options={[
          { value: "loopback", label: "Loopback (127.0.0.1)" },
          { value: "all", label: "All interfaces (0.0.0.0)" },
        ]} />
      </FieldRow>
      <FieldRow label="Tailscale" hint="Tailscale VPN integration">
        <SelectField value={tsMode} onChange={setTsMode} options={[
          { value: "off", label: "Off" },
          { value: "server", label: "Server" },
          { value: "client", label: "Client" },
        ]} />
      </FieldRow>
      <FieldRow label="Auth Token" hint="Passphrase for gateway authentication">
        <div className="flex items-center gap-1">
          <Input
            value={token}
            onChange={e => setToken(e.target.value)}
            type={showToken ? "text" : "password"}
            className="h-8 w-52 text-xs font-mono"
          />
          <Button variant="ghost" size="icon-sm" onClick={() => setShowToken(v => !v)}>
            {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </FieldRow>
      <SaveBar saving={saving} status={status} onSave={save} />
    </div>
  )
}

// ─── Tab: Models ──────────────────────────────────────────────────────────────

function ModelsTab({ config, onSaved }: { config: Record<string, unknown>; onSaved: (section: string, value: unknown) => void }) {
  const agentsCfg = (config.agents ?? {}) as Record<string, unknown>
  const defaults = (agentsCfg.defaults ?? {}) as Record<string, unknown>
  const modelCfg = (defaults.model ?? {}) as { primary?: string; fallbacks?: string[] }
  const modelsRoot = (config.models ?? {}) as { providers?: Record<string, unknown> }
  const providerCount = Object.keys(modelsRoot.providers ?? {}).length

  const isAdmin = useAuthStore(s => s.user?.role === "admin")

  const [primary, setPrimary] = useState(modelCfg.primary ?? "")
  const [fallbacks, setFallbacks] = useState((modelCfg.fallbacks ?? []).join("\n"))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [syncRestart, setSyncRestart] = useState(false)
  const [syncResult, setSyncResult] = useState<{
    ok: boolean
    message: string
    detail?: { usersUpdated: string[]; usersRestarted: string[]; secrets: { envVar: string; provider: string }[]; regenerated: boolean }
  } | null>(null)

  async function syncProviders() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const r = await api.syncProvidersToAllUsers({ restartGateways: syncRestart })
      const userCount = r.usersUpdated.length
      const restartCount = r.usersRestarted.length
      const parts = []
      if (r.regenerated) parts.push(`shared/providers.json5 ${r.regenerated ? "regenerated" : "unchanged"}`)
      if (userCount > 0) parts.push(`${userCount} user(s) patched`)
      else parts.push("no users needed patching")
      if (restartCount > 0) parts.push(`${restartCount} gateway(s) restarted`)
      setSyncResult({
        ok: true,
        message: parts.join(" · "),
        detail: { usersUpdated: r.usersUpdated, usersRestarted: r.usersRestarted, secrets: r.secrets, regenerated: r.regenerated },
      })
    } catch (e) {
      setSyncResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSyncing(false)
    }
  }

  async function save() {
    setSaving(true)
    setStatus(null)
    try {
      const fallbackList = fallbacks.split("\n").map(s => s.trim()).filter(Boolean)
      const newAgents = {
        ...agentsCfg,
        defaults: {
          ...defaults,
          model: { ...modelCfg, primary, fallbacks: fallbackList },
        },
      }
      await api.updateConfigSection("agents", newAgents)
      onSaved("agents", newAgents)
      setStatus({ ok: true, message: "Model config saved" })
    } catch (e) {
      setStatus({ ok: false, message: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <FieldRow label="Primary Model" hint="Default model used by all agents">
        <Input
          value={primary}
          onChange={e => setPrimary(e.target.value)}
          className="h-8 w-64 text-xs font-mono"
          placeholder="provider/model-id"
        />
      </FieldRow>
      <div className="py-3">
        <p className="text-sm text-foreground mb-1">Fallback Models</p>
        <p className="text-xs text-muted-foreground mb-2">One model per line. Used in order when primary is unavailable.</p>
        <textarea
          value={fallbacks}
          onChange={e => setFallbacks(e.target.value)}
          rows={8}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder={"provider/model-id\nprovider/model-id"}
          spellCheck={false}
        />
      </div>
      <SaveBar saving={saving} status={status} onSave={save} />

      {isAdmin && (
        <div className="mt-6 rounded-md border border-border bg-card/40 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Sync Providers to All Users</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Regenerates <code className="font-mono">~/.openclaw/shared/providers.json5</code> from your{" "}
                <code className="font-mono">openclaw.json</code> and overwrites <code className="font-mono">models.providers</code> in
                every per-user <code className="font-mono">openclaw.json</code>. Use after rotating API keys or adding a new provider.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {providerCount} provider{providerCount === 1 ? "" : "s"} currently configured at admin scope.
              </p>
              <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={syncRestart}
                  onChange={(e) => setSyncRestart(e.target.checked)}
                  disabled={syncing}
                  className="rounded border-border"
                />
                <span>Restart running per-user gateways after sync (drops in-flight sessions)</span>
              </label>
            </div>
            <Button onClick={syncProviders} disabled={syncing} size="sm" className="shrink-0">
              {syncing ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Sync Now
            </Button>
          </div>

          {syncResult && (
            <div className={cn(
              "mt-3 rounded border px-3 py-2 text-xs",
              syncResult.ok
                ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-400"
                : "border-red-600/30 bg-red-600/10 text-red-400"
            )}>
              <div className="flex items-center gap-2">
                {syncResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                <span>{syncResult.message}</span>
              </div>
              {syncResult.detail && syncResult.detail.usersUpdated.length > 0 && (
                <div className="mt-2 text-muted-foreground">
                  Users patched: <span className="font-mono">{syncResult.detail.usersUpdated.join(", ")}</span>
                </div>
              )}
              {syncResult.detail && syncResult.detail.secrets.length > 0 && (
                <div className="mt-2 text-amber-400">
                  ⚠ {syncResult.detail.secrets.length} apiKey{syncResult.detail.secrets.length === 1 ? "" : "s"} externalized to env var
                  {syncResult.detail.secrets.length === 1 ? "" : "s"}: define{" "}
                  <span className="font-mono">{syncResult.detail.secrets.map(s => s.envVar).join(", ")}</span> in your AOC{" "}
                  <code>.env</code>.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Tools & Security ────────────────────────────────────────────────────

function ToolsTab({ config, onSaved }: { config: Record<string, unknown>; onSaved: (section: string, value: unknown) => void }) {
  const tools = (config.tools ?? {}) as Record<string, unknown>
  const web = (tools.web ?? {}) as Record<string, unknown>
  const webSearch = (web.search ?? {}) as Record<string, unknown>
  const webFetch = (web.fetch ?? {}) as Record<string, unknown>
  const fs_ = (tools.fs ?? {}) as Record<string, unknown>
  const exec = (tools.exec ?? {}) as Record<string, unknown>
  const approvals = (config.approvals ?? {}) as Record<string, unknown>
  const approvalsExec = (approvals.exec ?? {}) as Record<string, unknown>
  const logging = (config.logging ?? {}) as Record<string, unknown>

  const [webSearchEnabled, setWebSearchEnabled] = useState((webSearch.enabled as boolean) ?? true)
  const [webFetchEnabled, setWebFetchEnabled] = useState((webFetch.enabled as boolean) ?? true)
  const [fsWorkspaceOnly, setFsWorkspaceOnly] = useState((fs_.workspaceOnly as boolean) ?? true)
  const [execSecurity, setExecSecurity] = useState((exec.security as string) ?? "full")
  const [approvalsExecEnabled, setApprovalsExecEnabled] = useState((approvalsExec.enabled as boolean) ?? false)
  const [redactSensitive, setRedactSensitive] = useState((logging.redactSensitive as string) ?? "tools")

  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  async function save() {
    setSaving(true)
    setStatus(null)
    try {
      const newTools = {
        ...tools,
        web: {
          ...web,
          search: { ...webSearch, enabled: webSearchEnabled },
          fetch: { ...webFetch, enabled: webFetchEnabled },
        },
        fs: { ...fs_, workspaceOnly: fsWorkspaceOnly },
        exec: { ...exec, security: execSecurity },
      }
      const newApprovals = { ...approvals, exec: { ...approvalsExec, enabled: approvalsExecEnabled } }
      const newLogging = { ...logging, redactSensitive }

      await Promise.all([
        api.updateConfigSection("tools", newTools),
        api.updateConfigSection("approvals", newApprovals),
        api.updateConfigSection("logging", newLogging),
      ])
      onSaved("tools", newTools)
      onSaved("approvals", newApprovals)
      onSaved("logging", newLogging)
      setStatus({ ok: true, message: "Tool settings saved" })
    } catch (e) {
      setStatus({ ok: false, message: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 mt-1">Web</p>
      <FieldRow label="Web Search" hint="Allow agents to search the web">
        <Toggle checked={webSearchEnabled} onChange={setWebSearchEnabled} />
      </FieldRow>
      <FieldRow label="Web Fetch" hint="Allow agents to fetch URLs">
        <Toggle checked={webFetchEnabled} onChange={setWebFetchEnabled} />
      </FieldRow>

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 mt-4">Filesystem</p>
      <FieldRow label="Workspace Only" hint="Restrict filesystem access to workspace directory">
        <Toggle checked={fsWorkspaceOnly} onChange={setFsWorkspaceOnly} />
      </FieldRow>

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 mt-4">Execution</p>
      <FieldRow label="Exec Security" hint="Security profile for shell execution">
        <SelectField value={execSecurity} onChange={setExecSecurity} options={[
          { value: "full", label: "Full" },
          { value: "restricted", label: "Restricted" },
          { value: "disabled", label: "Disabled" },
        ]} />
      </FieldRow>
      <FieldRow label="Require Exec Approval" hint="Prompt for approval before running commands">
        <Toggle checked={approvalsExecEnabled} onChange={setApprovalsExecEnabled} />
      </FieldRow>

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 mt-4">Logging</p>
      <FieldRow label="Redact Sensitive Data" hint="Strip secrets from logs">
        <SelectField value={redactSensitive} onChange={setRedactSensitive} options={[
          { value: "none", label: "None" },
          { value: "tools", label: "Tools output" },
          { value: "all", label: "All" },
        ]} />
      </FieldRow>

      <SaveBar saving={saving} status={status} onSave={save} />
    </div>
  )
}

// ─── Tab: Environment ─────────────────────────────────────────────────────────

function EnvTab({ config, onSaved }: { config: Record<string, unknown>; onSaved: (section: string, value: unknown) => void }) {
  const envObj = (config.env ?? {}) as Record<string, string>
  const [rows, setRows] = useState<{ key: string; value: string; showVal: boolean }[]>(
    Object.entries(envObj).map(([key, value]) => ({ key, value, showVal: false }))
  )
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  function addRow() {
    setRows(r => [...r, { key: "", value: "", showVal: false }])
  }
  function removeRow(i: number) {
    setRows(r => r.filter((_, idx) => idx !== i))
  }
  function updateRow(i: number, field: "key" | "value", val: string) {
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row))
  }
  function toggleShow(i: number) {
    setRows(r => r.map((row, idx) => idx === i ? { ...row, showVal: !row.showVal } : row))
  }

  const isSensitive = (key: string) =>
    /api[_-]?key|token|secret|password|pass|auth|bearer/i.test(key)

  async function save() {
    setSaving(true)
    setStatus(null)
    try {
      const newEnv = Object.fromEntries(
        rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
      )
      await api.updateConfigSection("env", newEnv)
      onSaved("env", newEnv)
      setStatus({ ok: true, message: "Environment saved" })
    } catch (e) {
      setStatus({ ok: false, message: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="space-y-1.5 mb-3">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={row.key}
              onChange={e => updateRow(i, "key", e.target.value)}
              placeholder="KEY"
              className="h-8 w-44 text-xs font-mono"
            />
            <div className="flex items-center flex-1 gap-1">
              <Input
                value={row.value}
                onChange={e => updateRow(i, "value", e.target.value)}
                type={isSensitive(row.key) && !row.showVal ? "password" : "text"}
                placeholder="value"
                className="h-8 flex-1 text-xs font-mono"
              />
              {isSensitive(row.key) && (
                <Button variant="ghost" size="icon-sm" onClick={() => toggleShow(i)}>
                  {row.showVal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => removeRow(i)}>
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground/60" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5 text-xs">
        <Plus className="h-3.5 w-3.5" /> Add Variable
      </Button>
      <SaveBar saving={saving} status={status} onSave={save} />
    </div>
  )
}

// ─── Tab: Raw JSON ────────────────────────────────────────────────────────────

function RawTab({ config, configPath, onReload }: {
  config: Record<string, unknown>
  configPath: string
  onReload: () => void
}) {
  const [text, setText] = useState(JSON.stringify(config, null, 2))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  // sync text when config reloads from outside
  useEffect(() => {
    setText(JSON.stringify(config, null, 2))
  }, [config])

  // Esc to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fullscreen])

  function handleChange(val: string) {
    setText(val)
    try { JSON.parse(val); setParseError(null) } catch (e) { setParseError(String(e)) }
  }

  function format() {
    try {
      const parsed = JSON.parse(text)
      setText(JSON.stringify(parsed, null, 2))
      setParseError(null)
      setStatus({ ok: true, message: "Formatted" })
      setTimeout(() => setStatus(null), 1500)
    } catch (e) {
      setStatus({ ok: false, message: `Cannot format: ${String(e)}` })
    }
  }

  async function save() {
    if (parseError) return
    setSaving(true)
    setStatus(null)
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      // Save every editable section that differs
      const SECTIONS = ['gateway', 'agents', 'tools', 'env', 'memory', 'hooks', 'approvals', 'logging', 'commands', 'session', 'messages', 'plugins', 'models'] as const
      await Promise.all(
        SECTIONS.filter(s => parsed[s] !== undefined).map(s => api.updateConfigSection(s, parsed[s]))
      )
      setStatus({ ok: true, message: "Config saved" })
      onReload()
    } catch (e) {
      setStatus({ ok: false, message: String(e) })
    } finally {
      setSaving(false)
    }
  }

  // Editor area — height follows viewport. In fullscreen the parent flex chain
  // gives it the entire viewport (minus toolbar + savebar). In normal (inline)
  // mode we use calc(100vh - <chrome>) so the editor stretches with the window
  // but always leaves room for the dashboard header, tab nav, toolbar, save bar.
  // 240px was measured against the current SettingsPage chrome; min 360px
  // protects very short viewports (small laptops, split screens).
  const editorBlock = (
    <div className={cn(
      "flex flex-col min-h-0",
      fullscreen
        ? "flex-1"
        : "h-[calc(100vh-260px)] min-h-[360px]"
    )}>
      <div className={cn(
        "flex-1 min-h-0 rounded-md border overflow-hidden",
        parseError ? "border-destructive" : "border-border"
      )}>
        <JsonMonacoEditor
          value={text}
          onChange={handleChange}
          onSave={save}
          onFormat={format}
        />
      </div>
      {parseError && (
        <p className="text-[11px] text-destructive mt-1 font-mono shrink-0 truncate" title={parseError}>
          {parseError}
        </p>
      )}
    </div>
  )

  const toolbar = (
    <div className="flex items-center gap-2 mb-2 shrink-0">
      <p className="text-xs text-muted-foreground font-mono truncate flex-1">{configPath}</p>
      <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={format} disabled={!!parseError}>
        <Wand2 className="h-3 w-3 mr-1" /> Format
      </Button>
      <Button
        variant="outline" size="sm" className="h-7 text-[11px]"
        onClick={() => setFullscreen(v => !v)}
        title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
      >
        {fullscreen ? <Minimize2 className="h-3 w-3 mr-1" /> : <Maximize2 className="h-3 w-3 mr-1" />}
        {fullscreen ? "Exit full screen" : "Full screen"}
      </Button>
    </div>
  )

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[60] bg-background flex flex-col p-4">
        {toolbar}
        {editorBlock}
        <div className="shrink-0 mt-2">
          <SaveBar saving={saving} status={status} onSave={save} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {toolbar}
      {editorBlock}
      <SaveBar saving={saving} status={status} onSave={save} />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string; icon: React.ReactNode; group?: string }[] = [
  { key: "account", label: "Account",  icon: <Shield className="h-4 w-4" />,        group: "user" },
  { key: "engine",  label: "Engine",   icon: <Cpu className="h-4 w-4" />,           group: "user" },
  { key: "gateway", label: "Gateway",  icon: <Wifi className="h-4 w-4" />,          group: "config" },
  { key: "models",  label: "Models",   icon: <BrainCircuit className="h-4 w-4" />,  group: "config" },
  { key: "tools",   label: "Tools",    icon: <Wrench className="h-4 w-4" />,        group: "config" },
  { key: "env",     label: "Env Vars", icon: <KeyRound className="h-4 w-4" />,      group: "config" },
  { key: "raw",     label: "Raw JSON", icon: <Code2 className="h-4 w-4" />,         group: "config" },
]

// ─── Agent Standards Card ─────────────────────────────────────────────────────

function SeedRefreshCard() {
  type Result = { kind: "catalog" | "templates"; count: number; ids?: string[] } | null
  const [busy, setBusy] = useState<"catalog" | "templates" | "both" | null>(null)
  const [result, setResult] = useState<Result>(null)
  const [error, setError] = useState("")

  async function refreshCatalog() {
    setBusy("catalog"); setResult(null); setError("")
    try {
      const r = await api.refreshCatalogSeed()
      setResult({ kind: "catalog", count: r.refreshed })
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(null) }
  }

  async function refreshTemplates() {
    setBusy("templates"); setResult(null); setError("")
    try {
      const r = await api.refreshRoleTemplatesSeed()
      setResult({ kind: "templates", count: r.refreshed, ids: r.ids })
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(null) }
  }

  async function refreshBoth() {
    setBusy("both"); setResult(null); setError("")
    try {
      const cat = await api.refreshCatalogSeed()
      const tpl = await api.refreshRoleTemplatesSeed()
      setResult({ kind: "templates", count: cat.refreshed + tpl.refreshed, ids: tpl.ids })
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(null) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-4 w-4 text-violet-400" />
          Seed Refresh
        </CardTitle>
        <CardDescription className="text-xs">
          Reload built-in seed data from disk JSON without restarting the server. Use this after a code update or
          after I (Claude) modify <span className="font-mono">server/data/*-seed.json</span>.
          Seed entries (origin: <span className="font-mono">seed</span>) are overwritten;
          user-authored rows are untouched.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5">
          <p>
            <span className="font-mono font-medium text-foreground/80">Skill Catalog</span> —
            reloads <span className="font-mono">skill-catalog-seed.json</span> ({" "}
            <span className="font-mono">~/.openclaw/skills/</span> on disk is NOT modified — only DB rows).
          </p>
          <p>
            <span className="font-mono font-medium text-foreground/80">Role Templates</span> —
            reloads <span className="font-mono">role-templates-seed.json</span>; user forks are preserved.
          </p>
        </div>
        {result && (
          <div className="text-xs text-violet-400/90">
            ✓ Refreshed {result.count} {result.kind === "catalog" ? "skill catalog entries" : "row(s)"}
            {result.ids && result.ids.length > 0 && (
              <span className="text-muted-foreground/70"> · {result.ids.join(", ")}</span>
            )}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={refreshCatalog}
            disabled={busy !== null}
            className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/50"
          >
            {busy === "catalog"
              ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refreshing…</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh Skill Catalog</>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={refreshTemplates}
            disabled={busy !== null}
            className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/50"
          >
            {busy === "templates"
              ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refreshing…</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh Role Templates</>}
          </Button>
          <Button
            size="sm"
            onClick={refreshBoth}
            disabled={busy !== null}
            className="bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/40"
          >
            {busy === "both"
              ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refreshing both…</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh Both</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AgentStandardsCard() {
  const [applying, setApplying] = useState(false)
  const [results, setResults] = useState<Array<{ agentId: string; status: string }> | null>(null)
  const [error, setError] = useState("")

  async function handleApplyAll() {
    setApplying(true)
    setResults(null)
    setError("")
    try {
      const res = await api.applyAllSoulStandard()
      setResults(res.results)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setApplying(false)
    }
  }

  const injected = results?.filter(r => r.status === "injected").length ?? 0
  const already = results?.filter(r => r.status === "already_applied").length ?? 0
  const errored = results?.filter(r => r.status === "error").length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4 text-blue-400" />
          Agent Output Standards
        </CardTitle>
        <CardDescription className="text-xs">
          Inject the Research Output Standard into agent SOUL.md files. Agents will be instructed
          to always include a <span className="font-mono">Sources</span> section when performing web searches or research tasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground/70">What gets injected into SOUL.md:</p>
          <p>A marker-delimited block instructing the agent to append a <span className="font-mono font-medium">**Sources:**</span> list of all URLs accessed when responding to research or web search tasks. Injection is idempotent — running it multiple times is safe.</p>
        </div>
        {results && (
          <div className="flex items-center gap-3 text-xs">
            {injected > 0 && <span className="text-blue-400 font-medium">✓ {injected} injected</span>}
            {already > 0 && <span className="text-muted-foreground">{already} already applied</span>}
            {errored > 0 && <span className="text-destructive">{errored} errors</span>}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          size="sm"
          variant="outline"
          onClick={handleApplyAll}
          disabled={applying}
          className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/50"
        >
          {applying
            ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Applying…</>
            : <><Link2 className="h-3.5 w-3.5 mr-1.5" />Apply Research Standard to All Agents</>
          }
        </Button>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const { clearAuth, user } = useAuthStore()
  const [tab, setTab] = useState<Tab>("account")
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [configPath, setConfigPath] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const res = await api.getConfig()
      setConfig(res.config)
      setConfigPath(res.path)
    } catch (e) {
      setLoadError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  function handleSaved(section: string, value: unknown) {
    setConfig(c => c ? { ...c, [section]: value } : c)
  }

  return (
    <div className="flex gap-6 animate-fade-in max-w-5xl">
      {/* Sidebar nav */}
      <nav className="shrink-0 w-44 flex flex-col gap-0.5 pt-0.5">
        {TABS.map((t, i) => {
          const showDivider = i > 0 && t.group !== TABS[i - 1].group
          return (
            <div key={t.key}>
              {showDivider && (
                <div className="my-1.5 px-3">
                  <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                    openclaw.json
                  </div>
                </div>
              )}
              <button
                onClick={() => setTab(t.key)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left",
                  tab === t.key
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                )}
              >
                {t.icon}
                {t.label}
                {tab === t.key && <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
              </button>
            </div>
          )
        })}
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {tab === "account" && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-primary" />
                  Authentication
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-foreground">Logged in as <span className="font-medium">{user?.displayName || user?.username || "Admin"}</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">Role: {user?.role || "admin"}</p>
                </div>
                <Button variant="destructive" size="sm" onClick={clearAuth}>
                  Sign Out
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="h-4 w-4 text-primary" />
                  About
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p>OpenClaw Agent Operations Center</p>
                <p className="text-xs font-mono text-muted-foreground/60">v2.0.0 — Vite + React + Tailwind v4 + shadcn/ui</p>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "engine" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 px-1">
              <Cpu className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-semibold text-foreground">AOC Engine Features</h2>
                <p className="text-xs text-muted-foreground">
                  Built-in capabilities that AOC layers on top of OpenClaw — manage installation, updates, and global behavior here.
                </p>
              </div>
            </div>
            <SeedRefreshCard />
            <AgentStandardsCard />
            <BrowserHarnessCard />
          </div>
        )}

        {tab !== "account" && tab !== "engine" && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  {TABS.find(t => t.key === tab)?.icon}
                  {TABS.find(t => t.key === tab)?.label}
                  <Badge variant="secondary" className="text-[10px] font-mono ml-1">openclaw.json</Badge>
                </CardTitle>
                <Button variant="ghost" size="icon-sm" onClick={loadConfig} title="Reload from disk">
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                </Button>
              </div>
              {tab !== "raw" && (
                <CardDescription className="text-xs">
                  Changes are written to <span className="font-mono">{configPath || "~/.openclaw/openclaw.json"}</span>
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
                  <RefreshCw className="h-4 w-4 animate-spin" /> Loading config…
                </div>
              )}
              {loadError && !loading && (
                <div className="flex items-center gap-2 text-xs text-destructive py-4">
                  <AlertCircle className="h-4 w-4" /> {loadError}
                </div>
              )}
              {!loading && !loadError && config && (
                <>
                  {tab === "gateway" && <GatewayTab config={config} onSaved={handleSaved} />}
                  {tab === "models"  && <ModelsTab  config={config} onSaved={handleSaved} />}
                  {tab === "tools"   && <ToolsTab   config={config} onSaved={handleSaved} />}
                  {tab === "env"     && <EnvTab     config={config} onSaved={handleSaved} />}
                  {tab === "raw"     && <RawTab     config={config} configPath={configPath} onReload={loadConfig} />}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
