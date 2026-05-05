import { useState, useCallback, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  X, ChevronRight, ChevronLeft, Check, Bot, Plus,
  MessageCircle, Loader2,
  Sparkles, Copy, Terminal,
} from "lucide-react"
import { api } from "@/lib/api"
import { useAgentStore } from "@/stores"
import { cn } from "@/lib/utils"
import type { ChannelBinding, ProvisionAgentOpts, AgentRoleTemplate } from "@/types"
import { AvatarPicker } from "@/components/agents/AvatarPicker"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import {
  TelegramBinding, WhatsAppBinding, DiscordBinding,
  FieldLabel, WizardInput, WizardTextarea, WizardSelect,
} from "@/components/agents/ChannelBindingForms"

// ── Constants ─────────────────────────────────────────────────────────────────

const EMOJI_PRESETS = [
  "🤖","✨","🧠","🔮","⚡","🛸","🦾","🎯","🚀","💎",
  "🐉","🦅","🐺","🦊","🦁","🐻","🤡","🕵️","🧙","👾",
  "⚙️","🔧","🛡️","⚔️","🗡️","🎪","🌊","🔥","❄️","🌟",
]

const COLOR_PRESETS = [
  { label: "Emerald",  value: "#10b981" },
  { label: "Violet",  value: "#8b5cf6" },
  { label: "Amber",   value: "#f59e0b" },
  { label: "Sky",     value: "#0ea5e9" },
  { label: "Rose",    value: "#f43f5e" },
  { label: "Teal",    value: "#14b8a6" },
  { label: "Orange",  value: "#f97316" },
  { label: "Indigo",  value: "#6366f1" },
]

const STEPS = [
  { id: 1, label: "Identity",    icon: Bot },
  { id: 2, label: "Personality", icon: Sparkles },
  { id: 3, label: "Channels",    icon: MessageCircle },
  { id: 4, label: "Review",      icon: Check },
]

// ── Helper ─────────────────────────────────────────────────────────────────────

function slugify(str: string) {
  return str.toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || ""
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, idx) => {
        const done = current > step.id
        const active = current === step.id
        const Icon = step.icon
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                done  && "bg-emerald-500 border-emerald-500 text-white",
                active && "bg-foreground/5 border-emerald-500 text-emerald-400",
                !done && !active && "bg-foreground/3 border-border text-muted-foreground/50"
              )}>
                {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={cn(
                "text-[10px] font-semibold uppercase tracking-wider transition-colors",
                active ? "text-emerald-400" : done ? "text-emerald-400/60" : "text-muted-foreground/30"
              )}>{step.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={cn(
                "h-px w-16 mx-2 mb-5 transition-colors",
                done ? "bg-emerald-500/50" : "bg-white/10"
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Identity ──────────────────────────────────────────────────────────

function Step1Identity({
  form, setForm, models, defaultModel
}: {
  form: Partial<ProvisionAgentOpts>
  setForm: (f: Partial<ProvisionAgentOpts>) => void
  models: { id: string; name: string }[]
  defaultModel: string
}) {
  const [idManuallySet, setIdManuallySet] = useState(false)

  const handleNameChange = (val: string) => {
    const updates: Partial<ProvisionAgentOpts> = { name: val }
    if (!idManuallySet) updates.id = slugify(val)
    setForm({ ...form, ...updates })
  }

  const handleIdChange = (val: string) => {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30)
    setIdManuallySet(true)
    setForm({ ...form, id: cleaned })
  }

  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <FieldLabel required>Display Name</FieldLabel>
        <WizardInput
          id="agent-name"
          placeholder="e.g. Tadaki, Sales Bot, Code Reviewer…"
          value={form.name || ""}
          onChange={e => handleNameChange(e.target.value)}
          autoFocus
        />
      </div>

      {/* ID */}
      <div>
        <FieldLabel required>Agent ID</FieldLabel>
        <div className="relative">
          <WizardInput
            id="agent-id"
            placeholder="e.g. tadaki, sales-bot…"
            value={form.id || ""}
            onChange={e => handleIdChange(e.target.value)}
            className="font-mono"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/40 font-mono">
            {(form.id || "").length}/30
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">Lowercase letters, numbers, hyphens. Cannot be changed later.</p>
      </div>

      {/* Avatar / Mascot Picker */}
      <div>
        <FieldLabel>Mascot Character</FieldLabel>
        <AvatarPicker
          value={form.avatarPresetId || null}
          onChange={preset => setForm({
            ...form,
            avatarPresetId: preset.id,
            color: preset.color,
            emoji: "🤖",
          })}
        />
        {form.avatarPresetId && (() => {
          const preset = AVATAR_PRESETS.find(p => p.id === form.avatarPresetId)
          return preset ? (
            <p className="text-[10px] text-muted-foreground/50 mt-2">
              Selected: <span className="font-semibold" style={{ color: preset.color }}>{preset.name}</span>
              {" · "}<span className="italic">{preset.vibe}</span>
            </p>
          ) : null
        })()}
      </div>

      {/* Theme */}
      <div>
        <FieldLabel>Theme / Vibe</FieldLabel>
        <WizardInput
          id="agent-theme"
          placeholder="e.g. operator strategist, creative assistant, data analyst…"
          value={form.theme || ""}
          onChange={e => setForm({ ...form, theme: e.target.value })}
        />
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">Becomes agent's identity theme in the config.</p>
      </div>

      {/* Description */}
      <div>
        <FieldLabel>Description</FieldLabel>
        <WizardInput
          id="agent-description"
          placeholder="What does this agent do?"
          value={form.description || ""}
          onChange={e => setForm({ ...form, description: e.target.value })}
        />
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">Shown in the dashboard. Saved to local SQLite profile.</p>
      </div>

      {/* Filesystem Security */}
      <div>
        <FieldLabel>Filesystem Access</FieldLabel>
        <button
          type="button"
          onClick={() => setForm({ ...form, fsWorkspaceOnly: !(form.fsWorkspaceOnly !== false) })}
          className={cn(
            "w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors text-left",
            form.fsWorkspaceOnly !== false
              ? "bg-foreground/3 border-white/8"
              : "bg-amber-500/8 border-amber-500/25"
          )}
        >
          <div>
            <p className="text-xs font-semibold text-foreground/80">
              {form.fsWorkspaceOnly !== false ? "Sandboxed" : "Unrestricted"}
            </p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
              {form.fsWorkspaceOnly !== false
                ? "Agent can only access its workspace directory"
                : "Agent can read files outside workspace — required for Telegram/WhatsApp media"}
            </p>
          </div>
          <div className={cn(
            "ml-3 relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
            form.fsWorkspaceOnly !== false ? "bg-white/15" : "bg-amber-500/60"
          )}>
            <span className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
              form.fsWorkspaceOnly !== false ? "translate-x-1" : "translate-x-[18px]"
            )} />
          </div>
        </button>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5">Can be changed later in agent settings.</p>
      </div>
    </div>
  )
}

// ── Step 2: Personality ───────────────────────────────────────────────────────

function buildRoleSoul(name: string | undefined, template: AgentRoleTemplate): string {
  const agentName = name?.trim() || template.role
  // Replace role name in heading and opening line, then prepend identity line
  const body = template.agentFiles.soul
    .replace(new RegExp(`# Soul of ${template.role}`, 'g'), `# Soul of ${agentName}`)
    .replace(new RegExp(`You are ${template.role}`, 'g'), `You are ${agentName}`)
  // Inject identity block right after the heading (first blank line)
  const identityLine = `\nYou are **${agentName}**, an ADLC autonomous agent with the role of **${template.role}** (${template.emoji}).\n`
  return body.replace(/^(# Soul of [^\n]+\n)/, `$1${identityLine}`)
}

function buildSoulTemplate(name?: string, theme?: string, description?: string): string {
  const agentName = name?.trim() || "this agent"
  const parts: string[] = []

  parts.push(`You are ${agentName}, an autonomous AI agent.`)

  if (theme?.trim()) {
    parts.push(`\nRole / Vibe: **${theme.trim()}**`)
  }

  if (description?.trim()) {
    parts.push(`\n${description.trim()}`)
  }

  parts.push(`
## Core Identity
${theme?.trim() ? `As a ${theme.trim()}, describe what makes ${agentName} unique and what drives their decisions.` : `Describe who this agent is and what makes them unique.`}

## Personality Traits
- **Trait 1** — e.g. Direct and concise. Gets to the point without fluff.
- **Trait 2** — e.g. Resourceful. Finds solutions where others see walls.
- **Trait 3** — e.g. Reliable. Follows through on commitments.

## Communication Style
How does this agent speak and interact? (tone, formality, language, emoji usage, etc.)

## Areas of Expertise
${description?.trim() ? `Based on the role above, list the main areas of knowledge and skill.` : `- Primary focus area\n- Secondary focus area`}

## Boundaries
What this agent will NOT do or engage with.`)

  return parts.join("\n")
}

function Step2Personality({
  form, setForm, models, defaultModel, template
}: {
  form: Partial<ProvisionAgentOpts>
  setForm: (f: Partial<ProvisionAgentOpts>) => void
  models: { id: string; name: string }[]
  defaultModel: string
  template?: AgentRoleTemplate
}) {
  const applyTemplate = () => {
    if (template?.agentFiles.soul) {
      setForm({ ...form, soulContent: buildRoleSoul(form.name, template) })
    } else {
      setForm({ ...form, soulContent: buildSoulTemplate(form.name, form.theme, form.description) })
    }
  }

  return (
    <div className="space-y-5">
      {/* Model */}
      <div>
        <FieldLabel>AI Model</FieldLabel>
        <div className="relative">
          <WizardSelect
            id="agent-model"
            value={form.model || defaultModel}
            onChange={e => setForm({ ...form, model: e.target.value })}
          >
            {defaultModel && (
              <option value={defaultModel}>{defaultModel} (default)</option>
            )}
            {models.filter(m => m.id !== defaultModel).map(m => (
              <option key={m.id} value={m.id}>{m.name || m.id}</option>
            ))}
          </WizardSelect>
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50">
            <ChevronRight className="w-4 h-4 rotate-90" />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">
          Default: <span className="text-muted-foreground font-mono">{defaultModel || "not set"}</span>
        </p>
      </div>

      {/* Soul Content */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <FieldLabel>Persona / Soul</FieldLabel>
          <button
            type="button"
            onClick={applyTemplate}
            className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400/70 hover:text-emerald-400 transition-colors px-2 py-1 rounded-md hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/20"
          >
            <Sparkles className="w-3 h-3" />
            {template ? `Use ${template.role} Soul` : "Use Template"}
          </button>
        </div>
        <WizardTextarea
          id="agent-soul"
          rows={10}
          placeholder={`Describe the agent's personality and style...\n\nClick "Use Template" above to start from a structured template.`}
          value={form.soulContent || ""}
          onChange={e => setForm({ ...form, soulContent: e.target.value })}
        />
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">
          This becomes <span className="text-muted-foreground font-mono">SOUL.md</span> in the agent's workspace. Leave blank for a default template.
        </p>
      </div>
    </div>
  )
}

// ── Step 3: Channels ──────────────────────────────────────────────────────────


function Step3Channels({
  form, setForm
}: {
  form: Partial<ProvisionAgentOpts>
  setForm: (f: Partial<ProvisionAgentOpts>) => void
}) {
  const channels = form.channels || []

  const hasTelegram = channels.some(c => c.type === "telegram")
  const hasWhatsApp = channels.some(c => c.type === "whatsapp")
  const hasDiscord  = channels.some(c => c.type === "discord")

  const addTelegram = () => {
    if (hasTelegram) return
    setForm({ ...form, channels: [...channels, { type: "telegram", dmPolicy: "pairing", streaming: "partial" }] })
  }

  const addWhatsApp = () => {
    if (hasWhatsApp) return
    setForm({ ...form, channels: [...channels, { type: "whatsapp", dmPolicy: "pairing", allowFrom: [] }] })
  }

  const addDiscord = () => {
    if (hasDiscord) return
    setForm({ ...form, channels: [...channels, { type: "discord", dmPolicy: "pairing", groupPolicy: "open", botToken: "" }] })
  }

  const updateChannel = (idx: number, binding: ChannelBinding) => {
    const updated = [...channels]
    updated[idx] = binding
    setForm({ ...form, channels: updated })
  }

  const removeChannel = (idx: number) => {
    setForm({ ...form, channels: channels.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground/70">
        Bind this agent to communication channels. This step is <strong className="text-foreground/60">optional</strong> — you can add channels later from the Agent Detail page.
      </p>

      {/* Existing bindings */}
      {channels.map((ch, idx) => (
        ch.type === "telegram"
          ? <TelegramBinding key={idx} binding={ch} onChange={b => updateChannel(idx, b)} onRemove={() => removeChannel(idx)} />
          : ch.type === "discord"
            ? <DiscordBinding key={idx} binding={ch} onChange={b => updateChannel(idx, b)} onRemove={() => removeChannel(idx)} />
            : <WhatsAppBinding key={idx} binding={ch} onChange={b => updateChannel(idx, b)} onRemove={() => removeChannel(idx)} />
      ))}

      {/* Add buttons */}
      <div className="flex flex-wrap gap-2">
        {!hasTelegram && (
          <button
            type="button"
            onClick={addTelegram}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-semibold hover:bg-sky-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Telegram
          </button>
        )}
        {!hasWhatsApp && (
          <button
            type="button"
            onClick={addWhatsApp}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add WhatsApp
          </button>
        )}
        {!hasDiscord && (
          <button
            type="button"
            onClick={addDiscord}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold hover:bg-indigo-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Discord
          </button>
        )}
      </div>

      {channels.length === 0 && (
        <div className="flex items-center gap-2 text-muted-foreground/50 text-[11px] mt-2">
          <MessageCircle className="w-3.5 h-3.5" />
          No channels added. You can still chat with this agent from the dashboard, and add channels later.
        </div>
      )}
    </div>
  )
}

// ── Step 4: Review ────────────────────────────────────────────────────────────

function ReviewRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-white/4">
      <span className="text-[11px] text-muted-foreground/70 font-medium shrink-0">{label}</span>
      <span className={cn("text-[11px] text-right", mono ? "font-mono text-foreground/70" : "text-foreground/70")}>{value || "—"}</span>
    </div>
  )
}

function Step4Review({
  form, restartGateway, setRestartGateway, template
}: {
  form: Partial<ProvisionAgentOpts>
  restartGateway: boolean
  setRestartGateway: (v: boolean) => void
  template?: AgentRoleTemplate
}) {
  const workspacePath = `~/.openclaw/workspaces/${form.id}`
  const agentDirPath  = `~/.openclaw/agents/${form.id}/agent`

  const channels = form.channels || []
  const hasWhatsApp = channels.some(c => c.type === "whatsapp")

  return (
    <div className="space-y-5">
      {/* Summary card */}
      <div className="bg-foreground/2 rounded-xl border border-border/60 overflow-hidden">
        <div className="px-4 py-3 bg-foreground/2 border-b border-white/4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{form.emoji || "🤖"}</span>
            <div>
              <p className="text-sm font-bold text-foreground/90">{form.name}</p>
              <p className="text-[10px] font-mono text-muted-foreground/50">{form.id}</p>
            </div>
            {form.color && (
              <div className="ml-auto w-4 h-4 rounded-full border border-white/20" style={{ backgroundColor: form.color }} />
            )}
          </div>
        </div>

        <div className="px-4 py-1">
          <ReviewRow label="Model" value={form.model || "default"} mono />
          <ReviewRow label="Theme" value={form.theme || ""} />
          <ReviewRow label="Description" value={form.description || ""} />
          <ReviewRow label="Workspace" value={workspacePath} mono />
          <ReviewRow label="Agent Dir" value={agentDirPath} mono />
          <ReviewRow label="Channels" value={channels.length > 0 ? channels.map(c => c.type).join(", ") : "None (can be added later)"} />
          <ReviewRow label="Filesystem" value={form.fsWorkspaceOnly !== false ? "Sandboxed (workspace only)" : "Unrestricted"} />
        </div>
      </div>

      {/* ADLC Template summary */}
      {template && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{template.emoji}</span>
            <span className="text-xs font-bold text-emerald-400">ADLC Template: {template.role}</span>
          </div>
          {template.skillSlugs.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-1.5">Skills to install</p>
              <div className="flex flex-wrap gap-1.5">
                {template.skillSlugs.map(slug => (
                  <span key={slug} className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] font-mono text-emerald-400">{slug}</span>
                ))}
              </div>
            </div>
          )}
          {template.scriptTemplates.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-1.5">Scripts to create</p>
              <div className="flex flex-wrap gap-1.5">
                {template.scriptTemplates.map(s => (
                  <span key={s.filename} className="px-2 py-0.5 bg-foreground/4 border border-border rounded text-[10px] font-mono text-muted-foreground">{s.filename}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Files to create */}
      <div>
        <p className="text-[10px] text-muted-foreground/70 font-semibold uppercase tracking-wider mb-2">Files that will be created</p>
        <div className="flex flex-wrap gap-1.5">
          {["IDENTITY.md", "SOUL.md", "AGENTS.md", "TOOLS.md", "USER.md"].map(f => (
            <span key={f} className="px-2 py-1 bg-foreground/3 border border-border rounded text-[10px] font-mono text-muted-foreground">{f}</span>
          ))}
        </div>
      </div>

      {/* WhatsApp pairing notice */}
      {hasWhatsApp && (
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-4">
          <div className="flex items-start gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-300 mb-1">WhatsApp QR Pairing Required</p>
              <p className="text-[11px] text-amber-300/60">After provisioning, run this command in your terminal to link the WhatsApp number:</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-foreground/8 rounded-lg px-3 py-2.5">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            <code className="text-[11px] font-mono text-emerald-300 flex-1">
              openclaw channels login --channel whatsapp --account {form.id}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(`openclaw channels login --channel whatsapp --account ${form.id}`)}
              className="text-muted-foreground/50 hover:text-foreground/60 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Restart gateway toggle */}
      <label className="flex items-center gap-3 cursor-pointer group">
        <div
          onClick={() => setRestartGateway(!restartGateway)}
          className={cn(
            "w-9 h-5 rounded-full relative transition-colors duration-200",
            restartGateway ? "bg-emerald-500" : "bg-white/10"
          )}
        >
          <div className={cn(
            "w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform duration-200 shadow",
            restartGateway ? "translate-x-4" : "translate-x-0.5"
          )} />
        </div>
        <div>
          <span className="text-sm font-medium text-foreground/70 group-hover:text-foreground transition-colors">
            Restart gateway after provisioning
          </span>
          <p className="text-[10px] text-muted-foreground/50">Required for the new agent to start receiving messages.</p>
        </div>
      </label>
    </div>
  )
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
  template?: AgentRoleTemplate
}

export function ProvisionAgentWizard({ onClose, template }: Props) {
  const navigate = useNavigate()
  const setAgents = useAgentStore(s => s.setAgents)

  const [step, setStep] = useState(1)
  const [form, setForm] = useState<Partial<ProvisionAgentOpts>>({
    emoji: "🤖",
    channels: [],
    model: "",
    fsWorkspaceOnly: true,
  })
  const [restartGateway, setRestartGateway] = useState(true)
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [defaultModel, setDefaultModel] = useState("")
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<{ agentId: string; whatsappPairingRequired: boolean } | null>(null)

  // Load models from first agent detail (has availableModels)
  useEffect(() => {
    api.getAgentDetail("main").then(d => {
      const ms = (d as any).availableModels || []
      setModels(ms.map((m: any) => ({
        id: m.id || m.value || m.modelId || String(m),
        name: m.name || m.label || m.id || m.value || m.modelId || String(m),
      })))
      const primary = (d as any).config?.model || ""
      setDefaultModel(primary)
      setForm(f => ({ ...f, model: f.model || primary }))
    }).catch(() => {})
  }, [])

  // Pre-fill form from ADLC role template (role config only — name/id left for user)
  useEffect(() => {
    if (!template) return
    setForm(f => ({
      ...f,
      // Leave name and id blank so user sets their own unique identity
      // Leave soulContent blank — user should click "Use Template" on step 2 after entering name
      emoji: template.emoji,
      color: template.color,
      description: template.description,
      model: template.modelRecommendation,
      soulContent: '',
      fsWorkspaceOnly: false,
    }))
  }, [template])

  // ── Validation per step ────────────────────────────────────────────────────

  const validateStep = useCallback(() => {
    const errs: string[] = []
    if (step === 1) {
      if (!form.name?.trim()) errs.push("Display name is required")
      if (!form.id?.trim()) errs.push("Agent ID is required")
      if (form.id && !/^[a-z0-9][a-z0-9-]{0,29}$/.test(form.id)) {
        errs.push("Agent ID must start with a letter/number and contain only lowercase letters, numbers, hyphens (max 30)")
      }
    }
    if (step === 3) {
      // Channels are optional — can be added later via Agent Detail page
      for (const ch of form.channels || []) {
        if (ch.type === "telegram" && !ch.botToken?.trim()) {
          errs.push("Telegram bot token is required")
        }
        if (ch.type === "telegram" && ch.botToken && !/^\d+:[A-Za-z0-9_-]+$/.test(ch.botToken.trim())) {
          errs.push("Telegram bot token format is invalid")
        }
      }
    }
    setErrors(errs)
    return errs.length === 0
  }, [step, form])

  const handleNext = () => {
    if (!validateStep()) return
    // Auto-inject soul when moving to step 2
    if (step === 1 && !form.soulContent?.trim()) {
      if (template?.agentFiles.soul) {
        setForm(f => ({ ...f, soulContent: buildRoleSoul(f.name, template) }))
      } else {
        setForm(f => ({ ...f, soulContent: buildSoulTemplate(f.name, f.theme, f.description) }))
      }
    }
    setStep(s => Math.min(s + 1, 4))
  }

  const handleBack = () => {
    setErrors([])
    setStep(s => Math.max(s - 1, 1))
  }

  // ── Provision ─────────────────────────────────────────────────────────────

  const handleProvision = async () => {
    if (!validateStep()) return
    setLoading(true)
    setErrors([])
    try {
      const opts: ProvisionAgentOpts = {
        id: form.id!.trim(),
        name: form.name!.trim(),
        emoji: form.emoji || "🤖",
        model: form.model || defaultModel || undefined,
        theme: form.theme?.trim() || undefined,
        description: form.description?.trim() || undefined,
        color: form.color || undefined,
        avatarPresetId: form.avatarPresetId || undefined,
        soulContent: form.soulContent?.trim() || undefined,
        channels: form.channels || [],
      }

      if (form.fsWorkspaceOnly === false) opts.fsWorkspaceOnly = false

      // ADLC template fields
      if (template) {
        opts.adlcRole = template.id
        opts.fsWorkspaceOnly = false
        opts.agentFiles = template.agentFiles
        opts.skillSlugs = template.skillSlugs
        opts.skillContents = template.skillContents
        opts.scriptTemplates = template.scriptTemplates
      }

      const result = await api.provisionAgent(opts)

      if (restartGateway) {
        try { await api.restartGateway() } catch {}
      }

      // Refresh agent list
      try {
        const data = await api.getAgents() as any
        setAgents(data.agents || [])
      } catch {}
      setDone({ agentId: result.agentId, whatsappPairingRequired: result.whatsappPairingRequired })
    } catch (err: any) {
      setErrors([err.message || "Provisioning failed"])
    } finally {
      setLoading(false)
    }
  }

  // ── Success screen ─────────────────────────────────────────────────────────

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(12px)" }}>
        <div className="bg-card border border-border rounded-2xl p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Agent Provisioned!</h2>
          <p className="text-sm text-muted-foreground mb-1">
            <span className="font-mono text-foreground/70">{done.agentId}</span> is ready.
          </p>
          {restartGateway && (
            <p className="text-xs text-emerald-400/60 mb-2">Gateway restarted ✓</p>
          )}
          {done.whatsappPairingRequired && (
            <div className="my-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-left">
              <p className="text-xs font-bold text-amber-300 mb-2">Complete WhatsApp pairing</p>
              <p className="text-[11px] text-muted-foreground/70 mb-2">
                Open the agent's <strong className="text-foreground/60">Channels</strong> tab and scan the QR code from the dashboard, or run:
              </p>
              <div className="flex items-center gap-2 bg-foreground/8 rounded-lg px-3 py-2">
                <code className="text-[11px] font-mono text-emerald-300 flex-1">
                  openclaw channels login --channel whatsapp --account {done.agentId}
                </code>
                <button onClick={() => navigator.clipboard?.writeText(`openclaw channels login --channel whatsapp --account ${done.agentId}`)} className="text-muted-foreground/50 hover:text-foreground/60">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
          {!done.whatsappPairingRequired && (form.channels || []).length === 0 && (
            <div className="my-4 bg-foreground/4 border border-border/60 rounded-xl p-4 text-left">
              <p className="text-[11px] text-muted-foreground/70">
                No channels configured. You can add Telegram, WhatsApp, or Discord from the agent's <strong className="text-foreground/60">Channels</strong> tab.
              </p>
            </div>
          )}
          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg bg-foreground/5 border border-border text-foreground/60 text-sm hover:bg-foreground/8 transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => { navigate(`/agents/${done.agentId}`); onClose() }}
              className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors"
            >
              Open Agent →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Wizard layout ──────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(12px)" }}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">Provision Agent</h2>
            {template ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-sm leading-none">{template.emoji}</span>
                <span className="text-[11px] text-muted-foreground/70">Role:</span>
                <span className="text-[11px] font-semibold" style={{ color: template.color }}>{template.role}</span>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground/70">Configure and deploy a new autonomous agent.</p>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground/50 hover:text-foreground/70 transition-colors p-1.5 rounded-lg hover:bg-foreground/6">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-5 shrink-0">
          <StepIndicator current={step} />
        </div>

        {/* Step content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
          {step === 1 && <Step1Identity form={form} setForm={setForm} models={models} defaultModel={defaultModel} />}
          {step === 2 && <Step2Personality form={form} setForm={setForm} models={models} defaultModel={defaultModel} template={template} />}
          {step === 3 && <Step3Channels form={form} setForm={setForm} />}
          {step === 4 && <Step4Review form={form} restartGateway={restartGateway} setRestartGateway={setRestartGateway} template={template} />}
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="mx-6 mb-3 shrink-0">
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-3 space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-rose-400 flex items-center gap-2">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  {e}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border/60 shrink-0">
          <button
            onClick={handleBack}
            disabled={step === 1}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/6 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>

          <span className="text-[10px] text-muted-foreground/40 font-mono">Step {step} of 4</span>

          {step < 4 ? (
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/20 transition-all"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleProvision}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Provisioning…</>
              ) : (
                <><Zap className="w-4 h-4" /> Provision Agent</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
