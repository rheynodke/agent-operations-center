import { useState, useEffect, useCallback } from "react"
import { useAuthStore } from "@/stores"
import { api } from "@/lib/api"
import {
  Shield, Info, Wifi, BrainCircuit, Wrench, KeyRound,
  Code2, Save, RefreshCw, Eye, EyeOff, Plus, Trash2,
  CheckCircle2, AlertCircle, ChevronRight,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "account" | "gateway" | "models" | "tools" | "env" | "raw"

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
  return (
    <div className="flex items-center gap-3 pt-3 mt-1">
      <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">
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

  const [primary, setPrimary] = useState(modelCfg.primary ?? "")
  const [fallbacks, setFallbacks] = useState((modelCfg.fallbacks ?? []).join("\n"))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

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

  // sync text when config reloads from outside
  useEffect(() => {
    setText(JSON.stringify(config, null, 2))
  }, [config])

  function handleChange(val: string) {
    setText(val)
    try { JSON.parse(val); setParseError(null) } catch (e) { setParseError(String(e)) }
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

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2 font-mono">{configPath}</p>
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        rows={28}
        spellCheck={false}
        className={cn(
          "w-full rounded-md border bg-background px-3 py-2 text-xs font-mono text-foreground resize-y focus:outline-none focus:ring-1",
          parseError ? "border-destructive focus:ring-destructive" : "border-border focus:ring-primary"
        )}
      />
      {parseError && (
        <p className="text-xs text-destructive mt-1 font-mono">{parseError}</p>
      )}
      <SaveBar saving={saving} status={status} onSave={save} />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "account", label: "Account",  icon: <Shield className="h-4 w-4" /> },
  { key: "gateway", label: "Gateway",  icon: <Wifi className="h-4 w-4" /> },
  { key: "models",  label: "Models",   icon: <BrainCircuit className="h-4 w-4" /> },
  { key: "tools",   label: "Tools",    icon: <Wrench className="h-4 w-4" /> },
  { key: "env",     label: "Env Vars", icon: <KeyRound className="h-4 w-4" /> },
  { key: "raw",     label: "Raw JSON", icon: <Code2 className="h-4 w-4" /> },
]

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
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left",
              tab === t.key
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            )}
          >
            {t.icon}
            {t.label}
            {tab === t.key && <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
          </button>
        ))}
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

        {tab !== "account" && (
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
