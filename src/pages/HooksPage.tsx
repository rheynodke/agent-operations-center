import { useState, useEffect, useCallback } from "react"
import {
  Webhook, Copy, Check, RefreshCw, Plus, Trash2, Edit3, Save, X,
  ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Terminal,
  AlertTriangle, ExternalLink, Shield, Zap, Clock, Bot,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useAgentStore } from "@/stores"
import { AgentLogo } from "@/components/AgentLogo"
import { AgentAvatar } from "@/components/agents/AgentAvatar"

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent",
        "transition-colors duration-200 ease-in-out focus-visible:outline-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        enabled ? "bg-primary" : "bg-foreground/20"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md",
          "transition duration-200 ease-in-out",
          enabled ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface HookMapping {
  id: string
  name?: string
  match: { path: string }
  action: "agent" | "wake"
  agentId?: string
  sessionKey?: string
  message?: string
  deliver?: boolean
  channel?: string
  to?: string
  wakeMode?: "now" | "next-heartbeat"
}

interface HooksConfig {
  enabled: boolean
  hasToken: boolean
  tokenPreview: string | null
  path: string
  gatewayPort: number
  defaultSessionKey: string
  allowRequestSessionKey: boolean
  allowedAgentIds: string[]
  mappings: HookMapping[]
  internal: {
    enabled: boolean
    sessionMemory: boolean
    commandLogger: boolean
    bootstrapExtraFiles: boolean
  }
}

interface HookSession {
  id: string
  key: string
  agentId: string
  hookName: string
  messageCount: number
  totalCost: number
  lastMessage: string
  startTime: string | null
  lastActivity: string | null
  status: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function copyToClipboard(text: string, onCopied: () => void) {
  navigator.clipboard.writeText(text).then(onCopied).catch(() => {})
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return "just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

// ─── Mapping Form ─────────────────────────────────────────────────────────────

const EMPTY_MAPPING: HookMapping = {
  id: "", name: "", match: { path: "" }, action: "agent",
  agentId: "", sessionKey: "", message: "", deliver: false,
  channel: "telegram", to: "", wakeMode: "now",
}

function MappingForm({
  initial,
  agents,
  onSave,
  onCancel,
}: {
  initial: HookMapping
  agents: { id: string; name: string; emoji: string; avatarPresetId?: string | null }[]
  onSave: (m: HookMapping) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<HookMapping>({ ...initial })
  const set = <K extends keyof HookMapping>(k: K, v: HookMapping[K]) =>
    setForm(p => ({ ...p, [k]: v }))

  const isValid = form.match.path.trim() !== "" && (form.action === "wake" || form.agentId !== "")

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* Path */}
        <div className="col-span-2 space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Path <span className="text-red-400">*</span>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground/60 font-mono shrink-0">/hooks/</span>
            <input
              value={form.match.path}
              onChange={e => setForm(p => ({ ...p, match: { path: e.target.value.replace(/^\/+/, "") } }))}
              placeholder="github"
              className="flex-1 bg-foreground/5 border border-border rounded px-2.5 py-1.5 text-[13px] font-mono text-foreground outline-none focus:border-primary/50"
            />
          </div>
        </div>

        {/* Name */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Display name</label>
          <input
            value={form.name || ""}
            onChange={e => set("name", e.target.value)}
            placeholder="GitHub Push"
            className="w-full bg-foreground/5 border border-border rounded px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50"
          />
        </div>

        {/* Action */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Action</label>
          <div className="flex gap-1.5">
            {(["agent", "wake"] as const).map(a => (
              <button
                key={a}
                onClick={() => set("action", a)}
                className={cn(
                  "flex-1 py-1.5 rounded text-[12px] font-medium border transition-colors",
                  form.action === a
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "bg-foreground/3 border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {a === "agent" ? "⚡ Isolated run" : "💬 Wake session"}
              </button>
            ))}
          </div>
        </div>

        {/* Agent */}
        {form.action === "agent" && (
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Agent <span className="text-red-400">*</span>
            </label>
            <select
              value={form.agentId || ""}
              onChange={e => set("agentId", e.target.value)}
              className="w-full bg-foreground/5 border border-border rounded px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50"
            >
              <option value="">— select agent —</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Message */}
        <div className={cn("space-y-1", form.action === "agent" ? "col-span-1" : "col-span-2")}>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Message / prompt
          </label>
          <input
            value={form.message || ""}
            onChange={e => set("message", e.target.value)}
            placeholder={form.action === "agent" ? "Process this webhook payload: {{payload}}" : "Check incoming events"}
            className="w-full bg-foreground/5 border border-border rounded px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50"
          />
        </div>

        {/* Deliver toggle */}
        {form.action === "agent" && (
          <div className="col-span-2 flex items-center gap-2.5">
            <Toggle enabled={!!form.deliver} onChange={() => set("deliver", !form.deliver)} />
            <span className="text-[12px] text-muted-foreground">
              Deliver result to messaging channel
            </span>
          </div>
        )}

        {/* Deliver channel / to */}
        {form.action === "agent" && form.deliver && (
          <>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Channel</label>
              <select
                value={form.channel || "telegram"}
                onChange={e => set("channel", e.target.value)}
                className="w-full bg-foreground/5 border border-border rounded px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50"
              >
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="last">Last active</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recipient ID</label>
              <input
                value={form.to || ""}
                onChange={e => set("to", e.target.value)}
                placeholder="Chat ID / user ID"
                className="w-full bg-foreground/5 border border-border rounded px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-primary/50"
              />
            </div>
          </>
        )}

        {/* Wake mode */}
        {form.action === "wake" && (
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Wake mode</label>
            <div className="flex gap-1.5">
              {(["now", "next-heartbeat"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => set("wakeMode", m)}
                  className={cn(
                    "flex-1 py-1.5 rounded text-[12px] border transition-colors",
                    form.wakeMode === m
                      ? "bg-primary/15 border-primary/30 text-primary"
                      : "bg-foreground/3 border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m === "now" ? "Immediate" : "Next heartbeat"}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-[12px] rounded border border-border text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
        <button
          onClick={() => onSave({ ...form, id: form.id || `mapping-${Date.now()}` })}
          disabled={!isValid}
          className="px-3 py-1.5 text-[12px] rounded bg-primary/20 border border-primary/30 text-primary font-bold hover:bg-primary/30 transition-colors disabled:opacity-40"
        >
          <Save className="w-3 h-3 inline mr-1" />Save mapping
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function HooksPage() {
  const agents = useAgentStore(s => s.agents)

  const [config, setConfig]     = useState<HooksConfig | null>(null)
  const [sessions, setSessions] = useState<HookSession[]>([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState("")

  const [showToken, setShowToken]         = useState(false)
  const [rawToken, setRawToken]           = useState<string | null>(null)
  const [tokenCopied, setTokenCopied]     = useState(false)
  const [urlCopied, setUrlCopied]         = useState<string | null>(null)

  const [editMapping, setEditMapping]       = useState<HookMapping | null>(null)
  const [addingMapping, setAddingMapping]   = useState(false)

  const [sessionsExpanded, setSessionsExpanded] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [cfg, sess] = await Promise.all([
        api.getHooksConfig() as Promise<HooksConfig>,
        api.getHookSessions() as Promise<{ sessions: HookSession[] }>,
      ])
      setConfig(cfg)
      setSessions(sess.sessions || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save(updates: Partial<HooksConfig>) {
    if (!config) return
    setSaving(true)
    try {
      const updated = await api.saveHooksConfig(updates) as HooksConfig
      setConfig(updated)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function generateToken() {
    setSaving(true)
    try {
      const res = await api.generateHookToken() as { token: string }
      setRawToken(res.token)
      setShowToken(true)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function handleCopyUrl(url: string, key: string) {
    copyToClipboard(url, () => {
      setUrlCopied(key)
      setTimeout(() => setUrlCopied(null), 2000)
    })
  }

  function handleCopyToken() {
    const t = rawToken || ""
    copyToClipboard(t, () => {
      setTokenCopied(true)
      setTimeout(() => setTokenCopied(false), 2000)
    })
  }

  function handleSaveMapping(m: HookMapping) {
    if (!config) return
    const existing = config.mappings.findIndex(x => x.id === m.id)
    const next = existing >= 0
      ? config.mappings.map(x => x.id === m.id ? m : x)
      : [...config.mappings, m]
    save({ mappings: next } as Partial<HooksConfig>)
    setEditMapping(null)
    setAddingMapping(false)
  }

  function handleDeleteMapping(id: string) {
    if (!config) return
    save({ mappings: config.mappings.filter(m => m.id !== id) } as Partial<HooksConfig>)
  }

  const agentList = agents.map(a => ({
    id: a.id, name: a.name, emoji: a.emoji, avatarPresetId: a.avatarPresetId,
  }))

  const gatewayBase = config ? `http://localhost:${config.gatewayPort}${config.path || "/hooks"}` : ""

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  )

  if (!config) return (
    <div className="flex items-center justify-center h-64 text-muted-foreground">
      <AlertTriangle className="w-5 h-5 mr-2" /> Failed to load hooks config
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Webhook className="w-5 h-5 text-primary" /> Webhooks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Inbound HTTP triggers — let external systems wake or run your agents
          </p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* ── Enable / Gateway URL ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-2 h-2 rounded-full",
              config.enabled ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-foreground/20"
            )} />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Inbound Webhooks {config.enabled ? "Enabled" : "Disabled"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {config.enabled
                  ? `Listening at ${gatewayBase}/*`
                  : "Enable to start accepting external HTTP triggers"}
              </p>
            </div>
          </div>
          <Toggle enabled={config.enabled} onChange={() => save({ enabled: !config.enabled })} disabled={saving} />
        </div>

        {config.enabled && (
          <>
            <div className="h-px bg-border" />
            {/* Base URL */}
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Gateway base URL</p>
              <div className="flex items-center gap-2 bg-foreground/5 border border-border rounded-lg px-3 py-2">
                <code className="text-[12px] font-mono text-foreground/80 flex-1">{gatewayBase}</code>
                <button
                  onClick={() => handleCopyUrl(gatewayBase, "base")}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {urlCopied === "base" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Auth token */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Auth token</p>
              {config.hasToken ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-foreground/5 border border-border rounded-lg px-3 py-2">
                    <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <code className="text-[12px] font-mono text-foreground/70 flex-1">
                      {showToken && rawToken ? rawToken : (config.tokenPreview || "••••••••••••")}
                    </code>
                    {rawToken && (
                      <button onClick={() => setShowToken(s => !s)} className="text-muted-foreground hover:text-foreground transition-colors">
                        {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {rawToken && showToken && (
                      <button onClick={handleCopyToken} className="text-muted-foreground hover:text-foreground transition-colors">
                        {tokenCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={generateToken}
                    disabled={saving}
                    className="px-3 py-2 text-[11px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                  >
                    Regenerate
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[12px] text-amber-400">No token set — webhook endpoint is unprotected</span>
                  </div>
                  <button
                    onClick={generateToken}
                    disabled={saving}
                    className="px-3 py-2 text-[11px] font-medium rounded-lg bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-colors"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Generate token"}
                  </button>
                </div>
              )}
              {rawToken && showToken && (
                <p className="text-[11px] text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Copy and save this token — it won't be shown again in full
                </p>
              )}
              <p className="text-[11px] text-muted-foreground/60">
                Send as <code className="bg-foreground/5 px-1 rounded">Authorization: Bearer &lt;token&gt;</code> header
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Mappings ─────────────────────────────────────────────────────── */}
      {config.enabled && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Webhook mappings</h2>
              <p className="text-[11px] text-muted-foreground">Custom routes — each path maps to an agent action</p>
            </div>
            <button
              onClick={() => { setAddingMapping(true); setEditMapping(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add mapping
            </button>
          </div>

          {addingMapping && (
            <MappingForm
              initial={{ ...EMPTY_MAPPING }}
              agents={agentList}
              onSave={handleSaveMapping}
              onCancel={() => setAddingMapping(false)}
            />
          )}

          {config.mappings.length === 0 && !addingMapping ? (
            <div className="rounded-xl border border-dashed border-border bg-foreground/1 p-8 text-center">
              <Webhook className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground/50">No mappings yet</p>
              <p className="text-[11px] text-muted-foreground/30 mt-0.5">Add a mapping to route an external webhook to an agent</p>
            </div>
          ) : (
            <div className="space-y-2">
              {config.mappings.map(m => (
                editMapping?.id === m.id ? (
                  <MappingForm
                    key={m.id}
                    initial={editMapping}
                    agents={agentList}
                    onSave={handleSaveMapping}
                    onCancel={() => setEditMapping(null)}
                  />
                ) : (
                  <MappingCard
                    key={m.id}
                    mapping={m}
                    gatewayBase={gatewayBase}
                    agents={agentList}
                    urlCopied={urlCopied}
                    onCopyUrl={handleCopyUrl}
                    onEdit={() => { setEditMapping(m); setAddingMapping(false) }}
                    onDelete={() => handleDeleteMapping(m.id)}
                  />
                )
              ))}
            </div>
          )}

          {/* Built-in endpoints */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Built-in endpoints</p>
            {[
              { path: "/agent", label: "Isolated agent run", desc: "Spawn a full isolated agent turn", icon: "⚡" },
              { path: "/wake",  label: "Wake main session",  desc: "Enqueue a message into the main session", icon: "💬" },
            ].map(ep => {
              const url = `${gatewayBase.replace(/\/hooks$/, "")}${config.path || "/hooks"}${ep.path}`
              const key = `builtin-${ep.path}`
              return (
                <div key={ep.path} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-foreground/2">
                  <span className="text-base">{ep.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] font-semibold text-foreground">{ep.label}</span>
                    <p className="text-[10px] text-muted-foreground/60">{ep.desc}</p>
                  </div>
                  <code className="text-[11px] font-mono text-foreground/50 truncate max-w-[220px] hidden sm:block">{url}</code>
                  <button onClick={() => handleCopyUrl(url, key)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                    {urlCopied === key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Internal Hooks ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Internal hooks</h2>
        <p className="text-[11px] text-muted-foreground -mt-1">Built-in plugins that run on agent lifecycle events</p>
        {[
          { key: "sessionMemory",       label: "Session Memory",        desc: "Auto-save session summaries to memory/ after each turn" },
          { key: "commandLogger",       label: "Command Logger",         desc: "Log all commands executed by agents" },
          { key: "bootstrapExtraFiles", label: "Bootstrap Extra Files",  desc: "Load additional files into context at agent startup" },
        ].map(hook => {
          const enabled = config.internal[hook.key as keyof typeof config.internal] as boolean
          return (
            <div key={hook.key} className="flex items-center justify-between gap-3 py-1">
              <div>
                <p className="text-[13px] font-medium text-foreground">{hook.label}</p>
                <p className="text-[11px] text-muted-foreground/60">{hook.desc}</p>
              </div>
              <Toggle
                enabled={enabled}
                onChange={() => save({ internal: { ...config.internal, [hook.key]: !enabled } } as Partial<HooksConfig>)}
                disabled={saving}
              />
            </div>
          )
        })}
      </div>

      {/* ── Recent Hook Sessions ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setSessionsExpanded(s => !s)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-foreground/2 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Recent hook sessions</span>
            <span className="text-[11px] text-muted-foreground bg-foreground/8 px-1.5 py-0.5 rounded-full">
              {sessions.length}
            </span>
          </div>
          {sessionsExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>

        {sessionsExpanded && (
          sessions.length === 0 ? (
            <div className="px-5 py-8 text-center border-t border-border">
              <Clock className="w-6 h-6 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground/50">No hook sessions yet</p>
              <p className="text-[11px] text-muted-foreground/30 mt-0.5">Sessions will appear here when webhooks trigger agent runs</p>
            </div>
          ) : (
            <div className="border-t border-border divide-y divide-border">
              {sessions.map(s => {
                const agent = agents.find(a => a.id === s.agentId)
                return (
                  <div key={s.id} className="flex items-center gap-3 px-5 py-3 hover:bg-foreground/2 transition-colors">
                    {agent ? (
                      <AgentAvatar avatarPresetId={agent?.avatarPresetId} emoji={agent?.emoji} size="w-7 h-7" className="rounded-full" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-foreground/10 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-foreground truncate">{s.hookName}</span>
                        <span className={cn(
                          "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                          s.status === "active"
                            ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
                            : "bg-foreground/8 text-muted-foreground"
                        )}>
                          {s.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/60 truncate">{s.lastMessage || "No messages"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-muted-foreground">{relativeTime(s.lastActivity)}</p>
                      <p className="text-[10px] text-muted-foreground/40">
                        {s.messageCount} msg · {s.totalCost > 0 ? `$${s.totalCost.toFixed(4)}` : "free"}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* Usage example */}
      {config.enabled && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-foreground">Quick start</h2>
          </div>
          <pre className="bg-foreground/5 rounded-lg p-3 text-[11px] font-mono text-foreground/70 overflow-x-auto leading-relaxed">{`curl -X POST ${gatewayBase}/agent \\
  -H 'Authorization: Bearer <your-token>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "message": "Process this event",
    "agentId": "main",
    "deliver": true,
    "channel": "telegram"
  }'`}</pre>
          <p className="text-[11px] text-muted-foreground/60">
            Response: <code className="bg-foreground/5 px-1 rounded">{"{ \"ok\": true, \"runId\": \"...\" }"}</code> — agent runs async
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Mapping Card ─────────────────────────────────────────────────────────────

function MappingCard({
  mapping, gatewayBase, agents, urlCopied, onCopyUrl, onEdit, onDelete,
}: {
  mapping: HookMapping
  gatewayBase: string
  agents: { id: string; name: string; emoji: string; avatarPresetId?: string | null }[]
  urlCopied: string | null
  onCopyUrl: (url: string, key: string) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const url = `${gatewayBase}/${mapping.match.path}`
  const agent = agents.find(a => a.id === mapping.agentId)
  const key = `mapping-${mapping.id}`

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:border-border/80 transition-colors">
      <span className="text-lg">{mapping.action === "agent" ? "⚡" : "💬"}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-[12px] font-mono font-bold text-foreground">/hooks/{mapping.match.path}</code>
          {mapping.name && <span className="text-[11px] text-muted-foreground">· {mapping.name}</span>}
          <span className={cn(
            "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border",
            mapping.action === "agent"
              ? "bg-violet-400/10 text-violet-400 border-violet-400/20"
              : "bg-sky-400/10 text-sky-400 border-sky-400/20"
          )}>
            {mapping.action === "agent" ? "isolated run" : "wake"}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {agent && <span className="text-[11px] text-muted-foreground">{agent.emoji} {agent.name}</span>}
          {mapping.message && <span className="text-[11px] text-muted-foreground/50 truncate max-w-[200px]">"{mapping.message}"</span>}
        </div>
      </div>
      <button onClick={() => onCopyUrl(url, key)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors" title="Copy URL">
        {urlCopied === key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <button onClick={onEdit} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors" title="Edit">
        <Edit3 className="w-3.5 h-3.5" />
      </button>
      <button onClick={onDelete} className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors" title="Delete">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
