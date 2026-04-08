import { useState, useCallback, useEffect, useRef } from "react"
import { useRoutingStore, useAgentStore } from "@/stores"
import { Radio, AlertTriangle, Plus, Pencil, Trash2, X, ChevronDown, KeyRound, Check, Search, RefreshCw, CheckCircle2, Loader2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { api } from "@/lib/api"
import type { GatewayRoute, ChannelsConfig, ChannelBinding } from "@/types"

// ─── Channel Icons ────────────────────────────────────────────────────────────

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.32 14.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.496.969z" />
    </svg>
  )
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  )
}

// ─── Channel Config ───────────────────────────────────────────────────────────

const CHANNEL_CFG = {
  telegram: {
    label: "Telegram", icon: TelegramIcon,
    color: "text-sky-400", bg: "bg-sky-400/10", headerBg: "bg-sky-500/8", border: "border-sky-500/20",
  },
  discord: {
    label: "Discord", icon: DiscordIcon,
    color: "text-indigo-400", bg: "bg-indigo-400/10", headerBg: "bg-indigo-500/8", border: "border-indigo-500/20",
  },
  whatsapp: {
    label: "WhatsApp", icon: WhatsAppIcon,
    color: "text-green-400", bg: "bg-green-400/10", headerBg: "bg-green-500/8", border: "border-green-500/20",
  },
} as const
type ChannelKey = keyof typeof CHANNEL_CFG

const DM_POLICIES  = ["pairing", "allowlist", "open", "disabled"] as const
const GROUP_POLICIES = ["open", "allowlist", "disabled"] as const
const STREAMING    = ["partial", "off", "block", "progress"] as const

const POLICY_COLORS: Record<string, string> = {
  open:      "bg-green-500/10 text-green-400",
  allowlist: "bg-amber-500/10 text-amber-400",
  pairing:   "bg-blue-500/10 text-blue-400",
  disabled:  "bg-red-500/10 text-red-400",
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function PolicyBadge({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <span className="flex items-center gap-1 text-[11px] leading-none">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("px-1.5 py-1 rounded-md text-[11px] font-medium capitalize", POLICY_COLORS[value] ?? "bg-muted text-muted-foreground")}>
        {value}
      </span>
    </span>
  )
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground pr-8 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {options.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium">{label}</label>
      {children}
    </div>
  )
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ScrollArea className="flex-1 px-5 py-4">
          <div className="flex flex-col gap-4">{children}</div>
        </ScrollArea>
        {footer && (
          <div className="px-5 py-4 border-t border-border flex gap-2 justify-end shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Add Binding Modal ────────────────────────────────────────────────────────

interface AddModalProps {
  channelType: ChannelKey
  existingAgentIds: Set<string>
  channelsConfig: ChannelsConfig | null
  /** For WhatsApp: called with the new accountId so parent can open QR modal */
  onSuccessWithQr?: (agentId: string) => void
  onClose: () => void
  onSuccess: () => void
}

function AddBindingModal({ channelType, existingAgentIds, channelsConfig, onClose, onSuccess, onSuccessWithQr }: AddModalProps) {
  const cfg = CHANNEL_CFG[channelType]
  const Icon = cfg.icon
  const agents = useAgentStore(s => s.agents).filter(a => !existingAgentIds.has(a.id))

  const [agentId,    setAgentId]    = useState(agents[0]?.id ?? "")
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [dmPolicy,   setDmPolicy]   = useState<string>("pairing")
  const [groupPolicy, setGroupPolicy] = useState<string>("open")
  const [streaming,  setStreaming]  = useState<string>("partial")
  const [botToken,   setBotToken]   = useState("")
  const [useEnvVar,  setUseEnvVar]  = useState(false)
  const [envVarName, setEnvVarName] = useState("TELEGRAM_BOT_TOKEN")
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const selectedAgent = agents.find(a => a.id === agentId) ?? agents[0]

  async function handleSubmit() {
    if (!agentId) { setError("Select an agent"); return }
    if (channelType === "telegram" && !useEnvVar && !botToken.trim()) {
      setError("Bot token is required"); return
    }
    if (channelType === "discord" && !botToken.trim()) {
      setError("Bot token is required"); return
    }
    setSaving(true); setError(null)
    try {
      const opts: ChannelBinding = { type: channelType, dmPolicy: dmPolicy as ChannelBinding["dmPolicy"] }
      if (channelType === "telegram") {
        opts.streaming = streaming as ChannelBinding["streaming"]
        if (useEnvVar) opts.envVarName = envVarName
        else opts.botToken = botToken.trim()
      }
      if (channelType === "discord") {
        opts.groupPolicy = groupPolicy as ChannelBinding["groupPolicy"]
        opts.botToken = botToken.trim()
      }
      await api.addAgentChannel(agentId, opts)
      if (channelType === "whatsapp" && onSuccessWithQr) {
        onSuccessWithQr(agentId)
      } else {
        onSuccess()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <>
      <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-high transition-colors">Cancel</button>
      <button onClick={handleSubmit} disabled={saving || agents.length === 0} className={cn("px-4 py-2 text-sm rounded-lg font-medium transition-colors", cfg.bg, cfg.color, "hover:opacity-80 disabled:opacity-40")}>
        {saving ? "Adding…" : "Add Binding"}
      </button>
    </>
  )

  return (
    <Modal title={`Add ${cfg.label} Binding`} onClose={onClose} footer={footer}>
      {/* Channel badge */}
      <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium", cfg.bg, cfg.color)}>
        <Icon className="h-4 w-4" />
        {cfg.label}
      </div>

      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">All agents already have a {cfg.label} binding.</p>
      ) : (
        <>
          {/* Agent picker */}
          <Field label="Agent">
            <div className="relative">
              <button
                type="button"
                onClick={() => setAgentMenuOpen(open => !open)}
                className="w-full flex items-center gap-3 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground text-left focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {selectedAgent ? (
                  <>
                    <AgentAvatar
                      avatarPresetId={selectedAgent.avatarPresetId}
                      emoji={selectedAgent.emoji}
                      size="w-6 h-6"
                      className="rounded-md shrink-0"
                    />
                    <span className="flex-1 truncate">{selectedAgent.name}</span>
                  </>
                ) : (
                  <span className="flex-1 text-muted-foreground">Select an agent</span>
                )}
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform", agentMenuOpen && "rotate-180")} />
              </button>

              {agentMenuOpen && (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                  {agents.map(a => {
                    const isSelected = a.id === agentId
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setAgentId(a.id)
                          setAgentMenuOpen(false)
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                          isSelected ? "bg-primary/10 text-foreground" : "hover:bg-surface-high text-foreground"
                        )}
                      >
                        <AgentAvatar
                          avatarPresetId={a.avatarPresetId}
                          emoji={a.emoji}
                          size="w-6 h-6"
                          className="rounded-md shrink-0"
                        />
                        <span className="flex-1 truncate">{a.name}</span>
                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Field>

          {/* Telegram: bot token */}
          {channelType === "telegram" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setUseEnvVar(false)}
                  className={cn("flex-1 py-1.5 text-xs rounded-lg border transition-colors", !useEnvVar ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                >
                  Bot Token
                </button>
                <button
                  onClick={() => setUseEnvVar(true)}
                  className={cn("flex-1 py-1.5 text-xs rounded-lg border transition-colors", useEnvVar ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                >
                  Env Var
                </button>
              </div>
              {useEnvVar ? (
                <Field label="Environment Variable Name">
                  <div className="flex items-center gap-2 bg-input border border-border rounded-lg px-3 py-2">
                    <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      value={envVarName}
                      onChange={e => setEnvVarName(e.target.value)}
                      placeholder="TELEGRAM_BOT_TOKEN"
                      className="flex-1 bg-transparent text-sm text-foreground outline-none"
                    />
                  </div>
                </Field>
              ) : (
                <Field label="Bot Token">
                  <input
                    type="password"
                    value={botToken}
                    onChange={e => setBotToken(e.target.value)}
                    placeholder="123456789:AABBccdd..."
                    className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary w-full"
                  />
                </Field>
              )}
            </div>
          )}

          {/* Discord: direct bot token */}
          {channelType === "discord" && (
            <Field label="Bot Token">
              <input
                type="password"
                value={botToken}
                onChange={e => setBotToken(e.target.value)}
                placeholder="Paste Discord bot token"
                className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary w-full"
              />
            </Field>
          )}

          {/* WhatsApp: pairing note */}
          {channelType === "whatsapp" && (
            <div className="bg-amber-500/8 border border-amber-500/20 text-amber-400 text-xs rounded-lg px-3 py-2.5">
              QR code pairing will be required after adding the binding. Scan it via the OpenClaw gateway.
            </div>
          )}

          {/* Policies */}
          <Select label="DM Policy" value={dmPolicy} options={DM_POLICIES} onChange={setDmPolicy} />
          {channelType === "discord" && (
            <Select label="Group Policy" value={groupPolicy} options={GROUP_POLICIES} onChange={setGroupPolicy} />
          )}
          {channelType === "telegram" && (
            <Select label="Streaming Mode" value={streaming} options={STREAMING} onChange={setStreaming} />
          )}
        </>
      )}

      {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
    </Modal>
  )
}

// ─── Edit Binding Modal ───────────────────────────────────────────────────────

function EditBindingModal({ route, onClose, onSuccess }: { route: GatewayRoute; onClose: () => void; onSuccess: () => void }) {
  const cfg = CHANNEL_CFG[route.channelType as ChannelKey] ?? CHANNEL_CFG.telegram
  const Icon = cfg.icon

  const [botToken,     setBotToken]     = useState("")
  const [dmPolicy,    setDmPolicy]    = useState(route.dmPolicy    ?? "pairing")
  const [groupPolicy, setGroupPolicy] = useState(route.groupPolicy ?? "open")
  const [streaming,   setStreaming]   = useState(route.streaming   ?? "partial")
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      const updates: Partial<ChannelBinding> = { dmPolicy: dmPolicy as ChannelBinding["dmPolicy"] }
      if (route.channelType === "discord") {
        updates.groupPolicy = groupPolicy as ChannelBinding["groupPolicy"]
        if (botToken.trim()) updates.botToken = botToken.trim()
      }
      if (route.channelType === "telegram") updates.streaming = streaming as ChannelBinding["streaming"]
      const accountId = route.accountId ?? route.agentId
      await api.updateAgentChannel(route.agentId, route.channelType, accountId, updates)
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <>
      <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-high transition-colors">Cancel</button>
      <button onClick={handleSave} disabled={saving} className={cn("px-4 py-2 text-sm rounded-lg font-medium transition-colors", cfg.bg, cfg.color, "hover:opacity-80 disabled:opacity-40")}>
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </>
  )

  return (
    <Modal title="Edit Binding" onClose={onClose} footer={footer}>
      {/* Agent info */}
      <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/30 rounded-lg">
        <AgentAvatar avatarPresetId={route.avatarPresetId} emoji={route.agentEmoji} size="w-8 h-8" />
        <div>
          <p className="text-sm font-medium">{route.agentName}</p>
          <div className={cn("flex items-center gap-1.5 text-xs mt-0.5", cfg.color)}>
            <Icon className="h-3 w-3" />
            <span>{cfg.label}{route.accountLabel ? ` · @${route.accountLabel}` : ""}</span>
          </div>
        </div>
      </div>

      {route.channelType === "discord" && (
        <Field label="Replace Bot Token">
          <input
            type="password"
            value={botToken}
            onChange={e => setBotToken(e.target.value)}
            placeholder="Leave blank to keep current token"
            className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary w-full"
          />
        </Field>
      )}
      <Select label="DM Policy" value={dmPolicy} options={DM_POLICIES} onChange={setDmPolicy} />
      {route.channelType === "discord" && (
        <Select label="Group Policy" value={groupPolicy} options={GROUP_POLICIES} onChange={setGroupPolicy} />
      )}
      {route.channelType === "telegram" && (
        <Select label="Streaming Mode" value={streaming} options={STREAMING} onChange={setStreaming} />
      )}

      {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
    </Modal>
  )
}

// ─── Remove Confirm ───────────────────────────────────────────────────────────

function RemoveConfirmModal({ route, onClose, onSuccess }: { route: GatewayRoute; onClose: () => void; onSuccess: () => void }) {
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRemove() {
    setRemoving(true); setError(null)
    try {
      const accountId = route.accountId ?? route.agentId
      await api.removeAgentChannel(route.agentId, route.channelType, accountId)
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setRemoving(false)
    }
  }

  const footer = (
    <>
      <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-high transition-colors">Cancel</button>
      <button onClick={handleRemove} disabled={removing} className="px-4 py-2 text-sm rounded-lg font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors">
        {removing ? "Removing…" : "Remove Binding"}
      </button>
    </>
  )

  return (
    <Modal title="Remove Binding?" onClose={onClose} footer={footer}>
      <p className="text-sm text-muted-foreground">
        This will remove the <span className="font-medium text-foreground">{CHANNEL_CFG[route.channelType as ChannelKey]?.label ?? route.channelType}</span> binding for{" "}
        <span className="font-medium text-foreground">{route.agentName}</span>. The agent will stop receiving messages from this channel.
      </p>
      {route.channelType === "telegram" && (
        <p className="text-xs text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
          The Telegram bot account will be removed from openclaw.json.
        </p>
      )}
      {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
    </Modal>
  )
}

// ─── Route Row ────────────────────────────────────────────────────────────────

function RouteRow({ route, onEdit, onRemove }: { route: GatewayRoute; onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-0 hover:bg-surface-high/70 transition-colors group">
      <AgentAvatar avatarPresetId={route.avatarPresetId} emoji={route.agentEmoji} size="w-8 h-8" className="rounded-lg shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{route.agentName}</p>
          <span className="hidden md:inline text-[11px] text-muted-foreground font-mono truncate">{route.agentId}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
          {route.accountLabel && (
            <span className="text-[11px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-1 rounded-md">
              @{route.accountLabel}
            </span>
          )}
          <PolicyBadge label="DM" value={route.dmPolicy} />
          <PolicyBadge label="Group" value={route.groupPolicy} />
        </div>
      </div>
      <div className="flex items-center gap-1 ml-1 opacity-60 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          title="Edit binding"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-high transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onRemove}
          title="Remove binding"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── WhatsApp QR Modal ────────────────────────────────────────────────────────

function WhatsAppQrModal({ agentId, onClose, onConnected }: {
  agentId: string
  onClose: () => void
  onConnected: () => void
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "waiting" | "connected" | "error">("loading")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const waitingRef = useRef(false)

  const startQr = useCallback(async () => {
    setStatus("loading")
    setError(null)
    setQrDataUrl(null)
    setMessage(null)
    try {
      const res = await api.channelLoginStart("whatsapp", agentId)
      if (res.qrDataUrl) {
        setQrDataUrl(res.qrDataUrl)
        setMessage((res.message as string) ?? null)
        setStatus("waiting")
      } else {
        // No QR = already connected
        setMessage((res.message as string) ?? "WhatsApp is already linked.")
        setStatus("connected")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start WhatsApp login")
      setStatus("error")
    }
  }, [agentId])

  // Poll for login completion once QR is shown
  useEffect(() => {
    if (status !== "waiting" || waitingRef.current) return
    waitingRef.current = true
    api.channelLoginWait("whatsapp", agentId)
      .then(() => {
        setStatus("connected")
        onConnected()
      })
      .catch((e: unknown) => {
        // Don't show error if user manually refreshed QR
        if (waitingRef.current) {
          setError(e instanceof Error ? e.message : "Connection failed or timed out")
          setStatus("error")
        }
      })
    return () => { waitingRef.current = false }
  }, [status, agentId, onConnected])

  // Start QR on mount
  useEffect(() => { startQr() }, [startQr])

  function handleRefresh() {
    waitingRef.current = false
    startQr()
  }

  const cfg = CHANNEL_CFG.whatsapp

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <WhatsAppIcon className={cn("h-4 w-4", cfg.color)} />
            <h2 className="text-base font-semibold text-foreground">Connect WhatsApp</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex flex-col items-center gap-4">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Generating QR code…</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <button
                onClick={handleRefresh}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-surface-high transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          )}

          {status === "connected" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle2 className="h-10 w-10 text-green-400" />
              <p className="text-sm font-medium text-foreground">WhatsApp connected!</p>
              <p className="text-xs text-muted-foreground text-center">{message ?? "The agent is now reachable via WhatsApp."}</p>
              <button
                onClick={onClose}
                className="mt-1 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/10 text-green-400 hover:opacity-80 transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {(status === "waiting") && qrDataUrl && (
            <>
              <p className="text-sm text-muted-foreground text-center">
                Open <span className="text-foreground font-medium">WhatsApp</span> on your phone, go to{" "}
                <span className="text-foreground font-medium">Linked Devices</span>, and scan this QR code.
              </p>
              <div className={cn("p-3 rounded-xl border-2", cfg.border, cfg.bg)}>
                <img src={qrDataUrl} alt="WhatsApp QR Code" className="w-56 h-56 rounded-lg" />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Waiting for scan…
              </div>
              <button
                onClick={handleRefresh}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3 w-3" /> Refresh QR
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Channel Group Card ───────────────────────────────────────────────────────

interface ChannelGroupCardProps {
  channelType: ChannelKey
  routes: GatewayRoute[]
  totalRoutes: number
  collapsed: boolean
  onToggleCollapse: () => void
  onAdd: () => void
  onEdit: (route: GatewayRoute) => void
  onRemove: (route: GatewayRoute) => void
}

function ChannelGroupCard({ channelType, routes, totalRoutes, collapsed, onToggleCollapse, onAdd, onEdit, onRemove }: ChannelGroupCardProps) {
  const cfg  = CHANNEL_CFG[channelType]
  const Icon = cfg.icon
  const shouldScroll = routes.length > 6

  return (
    <div className={cn("bg-card rounded-xl overflow-hidden border", cfg.border)}>
      {/* Header */}
      <div className={cn("flex items-center gap-2.5 px-4 py-3 border-b border-border/50", cfg.headerBg)}>
        <span className={cn("flex items-center justify-center w-7 h-7 rounded-lg", cfg.bg)}>
          <Icon className={cn("h-4 w-4", cfg.color)} />
        </span>
        <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
        <span className="text-xs text-muted-foreground">
          {routes.length === totalRoutes ? `${totalRoutes} ${totalRoutes === 1 ? "route" : "routes"}` : `${routes.length}/${totalRoutes} shown`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {totalRoutes > 0 && (
            <button
              onClick={onToggleCollapse}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-background/40 transition-colors"
            >
              <span>{collapsed ? "Expand" : "Collapse"}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !collapsed && "rotate-180")} />
            </button>
          )}
          <button
            onClick={onAdd}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors", cfg.bg, cfg.color, "hover:opacity-80")}
          >
            <Plus className="h-3.5 w-3.5" />
            Add binding
          </button>
        </div>
      </div>

      {/* Routes */}
      {collapsed ? (
        <div className="px-4 py-3 text-xs text-muted-foreground bg-background/30">
          {totalRoutes === 0 ? `No ${cfg.label} bindings yet` : `${routes.length === totalRoutes ? totalRoutes : routes.length} item hidden`}
        </div>
      ) : routes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/60">
          <Icon className="h-6 w-6" />
          <p className="text-sm">{totalRoutes > 0 ? "No routes match current filter" : `No ${cfg.label} bindings yet`}</p>
        </div>
      ) : (
        <ScrollArea className={cn(shouldScroll && "max-h-[22rem]")}>
          {routes.map(r => (
            <RouteRow key={r.id} route={r} onEdit={() => onEdit(r)} onRemove={() => onRemove(r)} />
          ))}
        </ScrollArea>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type ModalState =
  | { type: "add"; channelType: ChannelKey }
  | { type: "edit"; route: GatewayRoute }
  | { type: "remove"; route: GatewayRoute }
  | { type: "whatsapp-qr"; agentId: string }
  | null

export function RoutingPage() {
  const routes    = useRoutingStore(s => s.routes)
  const setRoutes = useRoutingStore(s => s.setRoutes)
  const agents    = useAgentStore(s => s.agents)

  const [modal,          setModal]          = useState<ModalState>(null)
  const [channelsConfig, setChannelsConfig] = useState<ChannelsConfig | null>(null)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Record<ChannelKey, boolean>>({
    telegram: false,
    whatsapp: false,
    discord: false,
  })

  // Load channel config on mount
  useState(() => {
    api.getChannels().then(d => setChannelsConfig(d as ChannelsConfig)).catch(() => {})
  })

  const refreshRoutes = useCallback(async () => {
    try {
      const data = await api.getRoutes() as { routes: GatewayRoute[] }
      setRoutes(data?.routes ?? [])
    } catch { /* ignore */ }
  }, [setRoutes])

  async function handleSuccess() {
    setModal(null)
    await refreshRoutes()
    api.getChannels().then(d => setChannelsConfig(d as ChannelsConfig)).catch(() => {})
  }

  async function handleWhatsAppAdded(agentId: string) {
    await refreshRoutes()
    api.getChannels().then(d => setChannelsConfig(d as ChannelsConfig)).catch(() => {})
    setModal({ type: "whatsapp-qr", agentId })
  }

  // Group by channel type, ordered
  const ORDER: ChannelKey[] = ["telegram", "whatsapp", "discord"]
  const grouped = routes.reduce<Record<string, GatewayRoute[]>>((acc, r) => {
    if (!acc[r.channelType]) acc[r.channelType] = []
    acc[r.channelType].push(r)
    return acc
  }, {})
  const normalizedQuery = query.trim().toLowerCase()
  const filteredRoutes = routes.filter(r => {
    if (!normalizedQuery) return true
    return [
      r.agentName,
      r.agentId,
      r.channelType,
      r.accountLabel,
      r.accountId,
      r.dmPolicy,
      r.groupPolicy,
    ].some(value => value?.toLowerCase().includes(normalizedQuery))
  })
  const filteredGrouped = filteredRoutes.reduce<Record<string, GatewayRoute[]>>((acc, r) => {
    if (!acc[r.channelType]) acc[r.channelType] = []
    acc[r.channelType].push(r)
    return acc
  }, {})

  // Always show all three channel types (even if empty)
  const channelKeys: ChannelKey[] = [...ORDER]

  // Agents without ANY route (across all channels)
  const routedAgentIds = new Set(routes.map(r => r.agentId))
  const unroutedAgents = agents.filter(a => !routedAgentIds.has(a.id))

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Summary + controls */}
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Radio className="h-4 w-4 text-primary" />
            <span>
              <span className="font-semibold text-foreground">{routes.length}</span>{" "}
              active route{routes.length !== 1 ? "s" : ""}
            </span>
          </div>
          {normalizedQuery && (
            <span className="text-xs text-muted-foreground">
              Showing <span className="text-foreground font-medium">{filteredRoutes.length}</span> match{filteredRoutes.length !== 1 ? "es" : ""}
            </span>
          )}
          {channelKeys.map(ch => {
            const count = grouped[ch]?.length ?? 0
            if (!count) return null
            const cfg  = CHANNEL_CFG[ch]
            const Icon = cfg.icon
            return (
              <span key={ch} className={cn("flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full", cfg.bg, cfg.color)}>
                <Icon className="h-3 w-3" />
                {count} {cfg.label}
              </span>
            )
          })}
          {unroutedAgents.length > 0 && (
            <span className="flex items-center gap-1.5 text-status-paused-text ml-auto text-xs">
              <AlertTriangle className="h-3.5 w-3.5" />
              {unroutedAgents.length} agent{unroutedAgents.length > 1 ? "s" : ""} without channel
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by agent, account, channel, or policy"
              className="w-full rounded-lg border border-border bg-input pl-9 pr-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            onClick={() => setCollapsed({ telegram: false, whatsapp: false, discord: false })}
            className="px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-surface-high transition-colors"
          >
            Expand all
          </button>
        </div>
      </div>

      {/* Channel group cards */}
      <div className="flex flex-col gap-4">
        {channelKeys.map(ch => (
          <ChannelGroupCard
            key={ch}
            channelType={ch}
            routes={filteredGrouped[ch] ?? []}
            totalRoutes={(grouped[ch] ?? []).length}
            collapsed={collapsed[ch]}
            onToggleCollapse={() => setCollapsed(prev => ({ ...prev, [ch]: !prev[ch] }))}
            onAdd={() => setModal({ type: "add", channelType: ch })}
            onEdit={r => setModal({ type: "edit", route: r })}
            onRemove={r => setModal({ type: "remove", route: r })}
          />
        ))}
      </div>

      {/* Unrouted agents */}
      {unroutedAgents.length > 0 && (
        <div className="rounded-xl border border-(--status-paused-text)/30 bg-status-paused-bg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-status-paused-text" />
            <p className="text-sm font-medium text-status-paused-text">
              {unroutedAgents.length} agent{unroutedAgents.length > 1 ? "s" : ""} not connected to any channel
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {unroutedAgents.map(a => (
              <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary text-sm">
                <AgentAvatar avatarPresetId={a.avatarPresetId} emoji={a.emoji} size="w-5 h-5" className="rounded" />
                <span>{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {modal?.type === "add" && (
        <AddBindingModal
          channelType={modal.channelType}
          existingAgentIds={new Set((grouped[modal.channelType] ?? []).map(r => r.agentId))}
          channelsConfig={channelsConfig}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
          onSuccessWithQr={modal.channelType === "whatsapp" ? handleWhatsAppAdded : undefined}
        />
      )}
      {modal?.type === "whatsapp-qr" && (
        <WhatsAppQrModal
          agentId={modal.agentId}
          onClose={handleSuccess}
          onConnected={handleSuccess}
        />
      )}
      {modal?.type === "edit" && (
        <EditBindingModal
          route={modal.route}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}
      {modal?.type === "remove" && (
        <RemoveConfirmModal
          route={modal.route}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
