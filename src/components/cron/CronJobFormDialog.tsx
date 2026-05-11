import { useState, useEffect, useRef } from "react"
import { Loader2, ChevronDown, ChevronUp, Info, Check, Wand2, X, Plus, FileCode2, BookOpen } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { useAgentStore } from "@/stores"
import { api } from "@/lib/api"
import type { CronJob, CronJobKind, CronSessionType, CronDeliveryMode, CronThinking } from "@/types"
import { cn } from "@/lib/utils"
import { CronScheduleBuilder } from "./CronScheduleBuilder"
import { IntervalPicker } from "./IntervalPicker"
import { OneShotPicker } from "./OneShotPicker"

// ─── Timezone list ────────────────────────────────────────────────────────────

const TIMEZONES = [
  { value: "Asia/Jakarta",     label: "WIB — UTC+7 (Jakarta)" },
  { value: "Asia/Makassar",    label: "WITA — UTC+8 (Makassar)" },
  { value: "Asia/Jayapura",    label: "WIT — UTC+9 (Jayapura)" },
  { value: "UTC",              label: "UTC+0" },
  { value: "America/New_York", label: "ET — UTC-5/-4 (New York)" },
  { value: "America/Chicago",  label: "CT — UTC-6/-5 (Chicago)" },
  { value: "America/Denver",   label: "MT — UTC-7/-6 (Denver)" },
  { value: "America/Los_Angeles", label: "PT — UTC-8/-7 (LA)" },
  { value: "Europe/London",    label: "GMT/BST — UTC+0/+1 (London)" },
  { value: "Europe/Paris",     label: "CET — UTC+1/+2 (Paris)" },
  { value: "Asia/Singapore",   label: "SGT — UTC+8 (Singapore)" },
  { value: "Asia/Tokyo",       label: "JST — UTC+9 (Tokyo)" },
  { value: "Asia/Kolkata",     label: "IST — UTC+5:30 (India)" },
  { value: "Australia/Sydney", label: "AEST — UTC+10/+11 (Sydney)" },
]

// ─── Field label helper ───────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
      {children}
      {required && <span className="text-destructive">*</span>}
    </label>
  )
}

function FieldGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-1", className)}>{children}</div>
}

/** Row layout: small uppercase label on the left, control on the right. */
function Row({
  label, required, children, align = "center",
}: { label: string; required?: boolean; children: React.ReactNode; align?: "center" | "start" }) {
  return (
    <div className={cn("flex gap-3", align === "start" ? "items-start" : "items-center")}>
      <label className="w-20 shrink-0 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1.5">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-1 first:mt-0">
      <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-[0.14em]">{children}</span>
      <span className="flex-1 h-px bg-border/60" />
    </div>
  )
}

// ─── Radio group ──────────────────────────────────────────────────────────────

function RadioGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; desc?: string }[]
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border ghost-border",
            value === opt.value
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-surface-high"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={cn(
          "w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer",
          checked ? "bg-primary border-primary" : "border-border bg-secondary"
        )}
      >
        {checked && <div className="w-2 h-2 rounded-sm bg-primary-foreground" />}
      </div>
      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
        {label}
      </span>
    </label>
  )
}

// ─── Textarea (with optional fullscreen toggle) ───────────────────────────────

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  const [fullscreen, setFullscreen] = useState(false)
  const [resizable, setResizable] = useState(false)

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreen])

  const sharedClass = cn(
    "w-full rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground",
    "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50",
    "font-mono",
    resizable ? "resize-y" : "resize-none"
  )

  const toolbar = (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className="opacity-70">{value.length.toLocaleString()} chars</span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => setResizable((r) => !r)}
        title={resizable ? "Lock size" : "Allow resize"}
        className="px-1.5 py-0.5 rounded hover:bg-muted/40 hover:text-foreground transition-colors"
      >
        {resizable ? "↕ Lock" : "↕ Resize"}
      </button>
      <button
        type="button"
        onClick={() => setFullscreen((f) => !f)}
        title={fullscreen ? "Exit fullscreen (Esc)" : "Expand to fullscreen"}
        className="px-1.5 py-0.5 rounded hover:bg-muted/40 hover:text-foreground transition-colors"
      >
        {fullscreen ? "⤓ Exit" : "⤢ Fullscreen"}
      </button>
    </div>
  )

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Task / Prompt</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Press <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px]">Esc</kbd> or click <em>Done</em> to return.</p>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
          >
            Done
          </button>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
          className={cn(
            "flex-1 w-full rounded-lg bg-secondary border border-border px-4 py-3 text-sm text-foreground",
            "placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50",
            "font-mono leading-relaxed"
          )}
        />
        <div className="mt-2">{toolbar}</div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={sharedClass}
      />
      {toolbar}
    </div>
  )
}

// ─── Agent select (avatar-based custom dropdown) ─────────────────────────────

interface AgentSelectProps {
  value: string
  onChange: (id: string) => void
  agents: import("@/types").Agent[]
}

function AgentSelect({ value, onChange, agents }: AgentSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = agents.find((a) => a.id === value)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-left hover:bg-surface-high transition-colors focus:outline-none focus:ring-1 focus:ring-primary/50"
      >
        {selected ? (
          <>
            <AgentAvatar
              avatarPresetId={selected.avatarPresetId}
              emoji={selected.emoji}
              size="w-7 h-7"
            />
            <span className="flex-1 text-foreground">{selected.name}</span>
          </>
        ) : (
          <>
            <div className="w-7 h-7 rounded-lg bg-white/5 ring-1 ring-white/8 flex items-center justify-center text-base shrink-0">
              🤖
            </div>
            <span className="flex-1 text-muted-foreground">Default agent</span>
          </>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl bg-popover ghost-border shadow-[var(--shadow-elevated)] py-1 overflow-hidden">
          {/* Default option */}
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false) }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-white/5 ring-1 ring-white/8 flex items-center justify-center text-base shrink-0">
              🤖
            </div>
            <span className="flex-1 text-muted-foreground">Default agent</span>
            {!value && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
          </button>

          {/* Divider */}
          {agents.length > 0 && <div className="mx-3 border-t border-border/40 my-1" />}

          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => { onChange(agent.id); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors"
            >
              <AgentAvatar
                avatarPresetId={agent.avatarPresetId}
                emoji={agent.emoji}
                size="w-7 h-7"
              />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-foreground font-medium truncate">{agent.name}</p>
                {agent.model && (
                  <p className="text-[10px] text-muted-foreground/50 font-mono truncate">{agent.model}</p>
                )}
              </div>
              {value === agent.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Announce selector ────────────────────────────────────────────────────────

const CHANNEL_IMG: Record<string, string> = {
  telegram: "/telegram.webp",
  discord:  "/discord.png",
}
const CHANNEL_EMOJI: Record<string, string> = {
  whatsapp: "📱",
  slack:    "💬",
}

function ChannelIcon({ channel, size = 18 }: { channel: string; size?: number }) {
  const src = CHANNEL_IMG[channel]
  if (src) return <img src={src} alt={channel} width={size} height={size} className="rounded-sm object-contain shrink-0" />
  return <span style={{ fontSize: size - 2 }}>{CHANNEL_EMOJI[channel] || "📡"}</span>
}

interface AnnounceSelectorProps {
  channels: { channel: string; label: string; accounts: { accountId: string; targets: { to: string; label: string; chatType?: string }[] }[] }[]
  selectedChannel: string
  selectedAccount: string
  selectedTo: string
  agentId: string   // auto-match bot account to the selected agent
  onChannelChange: (ch: string) => void
  onAccountChange: (acc: string) => void
  onToChange: (to: string) => void
}

function AnnounceSelector({ channels, selectedChannel, selectedAccount, selectedTo, agentId, onChannelChange, onAccountChange, onToChange }: AnnounceSelectorProps) {
  const channelData = channels.find((c) => c.channel === selectedChannel)

  // Resolve effective account: prefer agent-matched > single account > selected
  const resolvedAccount = (() => {
    if (!channelData) return ""
    // If agentId matches one of the accounts, use it automatically
    if (agentId && channelData.accounts.some((a) => a.accountId === agentId)) return agentId
    // Single account — use it directly
    if (channelData.accounts.length === 1) return channelData.accounts[0].accountId
    return selectedAccount
  })()

  const accountData = channelData?.accounts.find((a) => a.accountId === resolvedAccount)
  const targets = accountData?.targets ?? []

  // Sync resolved account back when it changes
  useEffect(() => {
    if (resolvedAccount && resolvedAccount !== selectedAccount) {
      onAccountChange(resolvedAccount)
    }
  }, [resolvedAccount])

  // Show bot account row only when agentId doesn't auto-match and there are multiple accounts
  const showAccountPicker = !!channelData &&
    channelData.accounts.length > 1 &&
    !(agentId && channelData.accounts.some((a) => a.accountId === agentId))

  return (
    <div className="flex flex-col gap-3 p-3 rounded-xl bg-secondary/40 border border-border/40">

      {/* Step 1: Channel type */}
      <FieldGroup>
        <Label required>Channel</Label>
        <div className="flex flex-wrap gap-2">
          {channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">No channels configured</p>
          ) : channels.map((ch) => (
            <button
              key={ch.channel}
              type="button"
              onClick={() => onChannelChange(ch.channel)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors border",
                selectedChannel === ch.channel
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:bg-surface-high"
              )}
            >
              <ChannelIcon channel={ch.channel} size={16} />
              <span>{ch.label}</span>
            </button>
          ))}
        </div>
      </FieldGroup>

      {/* Auto-matched bot account badge */}
      {channelData && !showAccountPicker && resolvedAccount && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ChannelIcon channel={selectedChannel} size={14} />
          <span>Bot account:</span>
          <span className="font-medium text-foreground">{resolvedAccount}</span>
          {agentId && resolvedAccount === agentId && (
            <span className="text-[10px] text-primary/60 bg-primary/8 px-1.5 py-0.5 rounded-md">matched agent</span>
          )}
        </div>
      )}

      {/* Step 2: Account picker (only when no auto-match) */}
      {showAccountPicker && (
        <FieldGroup>
          <Label required>Bot account</Label>
          <select
            value={selectedAccount}
            onChange={(e) => onAccountChange(e.target.value)}
            className="w-full rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Select account…</option>
            {channelData.accounts.map((acc) => (
              <option key={acc.accountId} value={acc.accountId}>
                {acc.accountId}{acc.targets.length > 0 ? ` (${acc.targets.length} contact${acc.targets.length > 1 ? "s" : ""})` : ""}
              </option>
            ))}
          </select>
        </FieldGroup>
      )}

      {/* Step 3: Target */}
      {resolvedAccount && (
        <FieldGroup>
          <Label required>Send to</Label>
          {targets.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {targets.map((t) => (
                <button
                  key={t.to}
                  type="button"
                  onClick={() => onToChange(t.to)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left transition-colors border",
                    selectedTo === t.to
                      ? "bg-primary/10 border-primary/40 text-foreground"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:bg-surface-high"
                  )}
                >
                  <div className={cn("w-2 h-2 rounded-full shrink-0", selectedTo === t.to ? "bg-primary" : "bg-muted-foreground/30")} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{t.label}</p>
                    <p className="text-[11px] font-mono text-muted-foreground/50">{t.to}{t.chatType ? ` · ${t.chatType}` : ""}</p>
                  </div>
                  {selectedTo === t.to && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
              <Input
                value={targets.some((t) => t.to === selectedTo) ? "" : selectedTo}
                onChange={(e) => onToChange(e.target.value)}
                placeholder="Or enter custom ID…"
                className="text-xs mt-1"
              />
            </div>
          ) : (
            <Input
              value={selectedTo}
              onChange={(e) => onToChange(e.target.value)}
              placeholder="Chat ID or channel ID"
            />
          )}
        </FieldGroup>
      )}
    </div>
  )
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  name: string
  agentId: string
  // schedule
  kind: CronJobKind
  scheduleAt: string
  scheduleEvery: string
  scheduleCron: string
  tz: string
  // execution
  session: CronSessionType
  customSessionId: string
  message: string
  model: string
  thinking: CronThinking
  lightContext: boolean
  deleteAfterRun: boolean
  timeoutSeconds: string
  // main session
  systemEvent: string
  wakeMode: "now" | "next-heartbeat"
  // delivery
  deliveryMode: CronDeliveryMode
  deliveryChannel: string
  deliveryTo: string
  deliveryWebhook: string
  // context injection
  selectedSkills: string[]    // skill slugs
  scriptPaths: string[]       // script file paths
}

const EMPTY_FORM: FormState = {
  name: "",
  agentId: "",
  kind: "cron",
  scheduleAt: "",
  scheduleEvery: "",
  scheduleCron: "",
  tz: "Asia/Jakarta",
  session: "isolated",
  customSessionId: "",
  message: "",
  model: "",
  thinking: "off",
  lightContext: false,
  deleteAfterRun: false,
  timeoutSeconds: "",
  systemEvent: "",
  wakeMode: "now",
  deliveryMode: "none",
  deliveryChannel: "",
  deliveryTo: "",
  deliveryWebhook: "",
  selectedSkills: [],
  scriptPaths: [],
}

function jobToForm(job: CronJob): FormState {
  const kind = job.kind || "cron"
  return {
    name: job.name || "",
    agentId: job.agentId || "",
    kind,
    scheduleAt:    kind === "at"    ? (job.schedule || "") : "",
    scheduleEvery: kind === "every" ? (job.schedule || "") : "",
    scheduleCron:  kind === "cron"  ? (job.schedule || "") : "",
    tz: job.tz || "UTC",
    session: (job.session as CronSessionType) || "isolated",
    customSessionId: job.customSessionId || "",
    message: job.message || "",
    model: job.model || "",
    thinking: job.thinking || "off",
    lightContext: job.lightContext || false,
    deleteAfterRun: job.deleteAfterRun || false,
    timeoutSeconds: job.timeoutSeconds ? String(job.timeoutSeconds) : "",
    systemEvent: job.systemEvent || "",
    wakeMode: job.wakeMode || "now",
    deliveryMode: job.deliveryMode || "none",
    deliveryChannel: job.deliveryChannel || "",
    deliveryTo: job.deliveryTo || "",
    deliveryWebhook: job.deliveryWebhook || "",
    selectedSkills: [],
    scriptPaths: [],
  }
}

// ─── Context block builder ────────────────────────────────────────────────────

interface SkillInfo { name: string; slug: string; description: string; path: string; enabled: boolean; allowed: boolean; emoji?: string | null }

function buildContextBlock(f: FormState): string {
  const parts: string[] = []
  if (f.selectedSkills.length > 0) {
    parts.push(`## Skills to use\n${f.selectedSkills.map((s) => `- Use skill: ${s}`).join("\n")}`)
  }
  if (f.scriptPaths.length > 0) {
    parts.push(`## Scripts to execute\n${f.scriptPaths.filter(Boolean).map((p) => `- Execute script: ${p}`).join("\n")}`)
  }
  return parts.join("\n\n")
}

// ─── Context injector UI ──────────────────────────────────────────────────────

interface ContextInjectorProps {
  agentId: string
  selectedSkills: string[]
  scriptPaths: string[]
  onSkillsChange: (skills: string[]) => void
  onScriptPathsChange: (paths: string[]) => void
  contextPreview: string
}

function ContextInjector({ agentId, selectedSkills, scriptPaths, onSkillsChange, onScriptPathsChange, contextPreview }: ContextInjectorProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [availableScripts, setAvailableScripts] = useState<{ name: string; emoji: string; relPath: string; execHint: string }[]>([])
  const [loadingSkills, setLoadingSkills] = useState(false)
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [showScriptPicker, setShowScriptPicker] = useState(false)
  const scriptPickerRef = useRef<HTMLDivElement>(null)

  // Load skills when agent changes
  useEffect(() => {
    if (!agentId) { setSkills([]); return }
    setLoadingSkills(true)
    api.getAgentSkills(agentId)
      .then((r) => setSkills((r as { skills: SkillInfo[] }).skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoadingSkills(false))
  }, [agentId])

  // Load available scripts once
  useEffect(() => {
    api.listScripts()
      .then((r) => setAvailableScripts((r as { scripts: { name: string; emoji: string; relPath: string; execHint: string }[] }).scripts ?? []))
      .catch(() => {})
  }, [])

  // Close script picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (scriptPickerRef.current && !scriptPickerRef.current.contains(e.target as Node)) {
        setShowScriptPicker(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function toggleSkill(slug: string) {
    onSkillsChange(selectedSkills.includes(slug)
      ? selectedSkills.filter((s) => s !== slug)
      : [...selectedSkills, slug]
    )
  }

  function toggleScript(relPath: string) {
    onScriptPathsChange(scriptPaths.includes(relPath)
      ? scriptPaths.filter((p) => p !== relPath)
      : [...scriptPaths, relPath]
    )
  }

  const hasContext = selectedSkills.length > 0 || scriptPaths.length > 0
  const enabledSkills = skills.filter((s) => s.allowed || s.enabled)
  const unselectedScripts = availableScripts.filter((s) => !scriptPaths.includes(s.relPath))

  return (
    <div className="flex flex-col gap-2">
      {/* Trigger row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Skills button */}
        <button
          type="button"
          onClick={() => { setShowSkillPicker(!showSkillPicker); setShowScriptPicker(false) }}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors",
            showSkillPicker || selectedSkills.length > 0
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-secondary border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <BookOpen className="h-3 w-3" />
          {loadingSkills ? <Loader2 className="h-3 w-3 animate-spin" /> : "Skills"}
          {selectedSkills.length > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold">{selectedSkills.length}</span>
          )}
        </button>

        {/* Scripts dropdown trigger */}
        <div ref={scriptPickerRef} className="relative">
          <button
            type="button"
            onClick={() => { setShowScriptPicker(!showScriptPicker); setShowSkillPicker(false) }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors",
              showScriptPicker || scriptPaths.length > 0
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-secondary border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <FileCode2 className="h-3 w-3" />
            Scripts
            {scriptPaths.length > 0 && (
              <span className="bg-amber-500 text-white rounded-full px-1.5 py-0.5 text-[10px] font-semibold">{scriptPaths.length}</span>
            )}
            <ChevronDown className={cn("h-3 w-3 transition-transform", showScriptPicker && "rotate-180")} />
          </button>

          {/* Script dropdown */}
          {showScriptPicker && (
            <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-xl bg-popover ghost-border shadow-[var(--shadow-elevated)] py-1 overflow-hidden">
              {availableScripts.length === 0 ? (
                <div className="px-3 py-4 text-center">
                  <p className="text-xs text-muted-foreground/60">No scripts in ~/.openclaw/scripts/</p>
                  <p className="text-[10px] text-muted-foreground/40 mt-1">Create scripts in Skills & Tools → Custom Tools</p>
                </div>
              ) : (
                <>
                  <div className="px-3 py-1.5 border-b border-border/30">
                    <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">~/.openclaw/scripts/</p>
                  </div>
                  {availableScripts.map((s) => {
                    const selected = scriptPaths.includes(s.relPath)
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => toggleScript(s.relPath)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                          selected ? "bg-amber-500/10 text-foreground" : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <span className="text-base shrink-0">{s.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{s.name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground/50 truncate">{s.execHint}</p>
                        </div>
                        {selected && <Check className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Skill picker */}
      {showSkillPicker && (
        <div className="rounded-xl bg-secondary/40 border border-border/40 p-3 flex flex-col gap-2">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
            {agentId ? `${enabledSkills.length} skills available` : "Select an agent first"}
          </p>
          {enabledSkills.length > 0 && (
            <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {enabledSkills.map((sk) => (
                <button
                  key={sk.slug}
                  type="button"
                  onClick={() => toggleSkill(sk.slug)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors border",
                    selectedSkills.includes(sk.slug)
                      ? "bg-primary/10 border-primary/30 text-foreground"
                      : "bg-secondary border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  <span className="text-base shrink-0 mt-0.5">{sk.emoji || "🔧"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{sk.name}</p>
                    <p className="text-[10px] text-muted-foreground/60 line-clamp-2 mt-0.5">
                      {sk.description?.replace(/^["']|["']$/g, "") || "No description"}
                    </p>
                  </div>
                  {selectedSkills.includes(sk.slug) && <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />}
                </button>
              ))}
            </div>
          )}
          {!agentId && (
            <p className="text-xs text-muted-foreground/50 text-center py-2">Select an agent to see its skills</p>
          )}
        </div>
      )}

      {/* Selected chips */}
      {hasContext && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSkills.map((slug) => {
            const sk = skills.find((s) => s.slug === slug)
            return (
              <span key={slug} className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs text-primary">
                <BookOpen className="h-2.5 w-2.5" />
                {sk?.name || slug}
                <button type="button" onClick={() => toggleSkill(slug)} className="ml-0.5 hover:text-destructive transition-colors">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )
          })}
          {scriptPaths.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-xs text-amber-400">
              <FileCode2 className="h-2.5 w-2.5" />
              <span className="font-mono truncate max-w-[180px]">{p.split("/").pop()}</span>
              <button type="button" onClick={() => onScriptPathsChange(scriptPaths.filter((x) => x !== p))} className="ml-0.5 hover:text-destructive transition-colors">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Context preview */}
      {contextPreview && (
        <div className="rounded-xl bg-primary/5 border border-primary/15 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Wand2 className="h-3 w-3 text-primary/60" />
            <span className="text-[10px] text-primary/60 font-semibold uppercase tracking-wide">Injected context preview</span>
          </div>
          <pre className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap font-mono leading-relaxed">{contextPreview}</pre>
        </div>
      )}
    </div>
  )
}

function formToPayload(f: FormState): Record<string, unknown> {
  const schedule =
    f.kind === "at" ? f.scheduleAt :
    f.kind === "every" ? f.scheduleEvery :
    f.scheduleCron

  const payload: Record<string, unknown> = {
    name: f.name.trim(),
    kind: f.kind,
    schedule,
    tz: f.tz || "UTC",
    session: f.session === "custom" ? `session:${f.customSessionId}` : f.session,
  }
  if (f.agentId) payload.agentId = f.agentId

  if (f.session === "isolated") {
    const contextBlock = buildContextBlock(f)
    const userMsg = f.message.trim()
    const combined = contextBlock ? `${contextBlock}\n\n${userMsg}` : userMsg
    if (combined) payload.message = combined
    if (f.model.trim())    payload.model   = f.model.trim()
    if (f.thinking !== "off") payload.thinking = f.thinking
    if (f.lightContext)    payload.lightContext = true
    if (f.deleteAfterRun) payload.deleteAfterRun = true
    if (f.timeoutSeconds) payload.timeoutSeconds = Number(f.timeoutSeconds)
    payload.deliveryMode = f.deliveryMode
    if (f.deliveryMode === "announce") {
      payload.deliveryChannel = f.deliveryChannel
      payload.deliveryTo = f.deliveryTo
    }
    if (f.deliveryMode === "webhook") {
      payload.deliveryWebhook = f.deliveryWebhook
    }
  }

  if (f.session === "main") {
    if (f.systemEvent.trim()) payload.systemEvent = f.systemEvent.trim()
    payload.wakeMode = f.wakeMode
  }

  return payload
}

function validate(f: FormState): string | null {
  if (!f.name.trim()) return "Name is required"
  if (f.kind === "at" && !f.scheduleAt.trim()) return "Schedule value is required"
  if (f.kind === "every" && !f.scheduleEvery.trim()) return "Interval is required"
  if (f.kind === "cron") {
    const parts = f.scheduleCron.trim().split(/\s+/)
    if (parts.length < 5 || parts.length > 6) return "Cron expression must have 5 or 6 fields"
  }
  if (f.session === "isolated" && !f.message.trim() && !buildContextBlock(f)) return "Task message is required for isolated sessions"
  if (f.session === "custom" && !f.customSessionId.trim()) return "Session ID is required"
  if (f.deliveryMode === "announce" && (!f.deliveryChannel.trim() || !f.deliveryTo.trim())) {
    return "Channel and target are required for announce delivery"
  }
  if (f.deliveryMode === "webhook" && !f.deliveryWebhook.trim()) {
    return "Webhook URL is required"
  }
  return null
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  job?: CronJob
  onSaved: (job: CronJob) => void
  defaultAgentId?: string
}

// ─── Delivery targets type ────────────────────────────────────────────────────

interface DeliveryTarget { to: string; label: string; chatType?: string }
interface DeliveryAccount { accountId: string; targets: DeliveryTarget[] }
interface DeliveryChannel { channel: string; label: string; accounts: DeliveryAccount[] }

export function CronJobFormDialog({ open, onOpenChange, job, onSaved, defaultAgentId }: Props) {
  const agents = useAgentStore((s) => s.agents)
  const isEdit = !!job

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [deliveryChannels, setDeliveryChannels] = useState<DeliveryChannel[]>([])

  // Load delivery targets once
  useEffect(() => {
    api.getCronDeliveryTargets()
      .then((r) => setDeliveryChannels((r as { channels: DeliveryChannel[] }).channels ?? []))
      .catch(() => {})
  }, [])

  // Re-populate on open
  useEffect(() => {
    if (open) {
      setForm(job ? jobToForm(job) : { ...EMPTY_FORM, agentId: defaultAgentId ?? "" })
      setError(null)
      setShowAdvanced(false)
    }
  }, [open, job])

  const contextPreview = buildContextBlock(form)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    const err = validate(form)
    if (err) { setError(err); return }
    setLoading(true)
    setError(null)
    try {
      const payload = formToPayload(form)
      let result: { job?: CronJob }
      if (isEdit && job) {
        result = await api.updateCronJob(job.id, payload) as { job?: CronJob }
      } else {
        result = await api.createCronJob(payload) as { job?: CronJob }
      }
      // Normalise returned job — fallback to constructing from payload if gateway
      // returned something minimal
      const saved: CronJob = result?.job ?? {
        id: (payload as Record<string, string>).id || job?.id || crypto.randomUUID(),
        name: form.name,
        schedule: payload.schedule as string,
        status: "active",
        kind: form.kind,
        tz: form.tz,
        session: form.session,
        message: form.message || undefined,
        agentId: form.agentId || undefined,
        ...payload,
      } as CronJob
      onSaved(saved)
      onOpenChange(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-base">{isEdit ? "Edit Schedule" : "New Schedule"}</DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit ? "Update cron job settings." : "Create a new automated scheduled task."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">

          {/* ── Identity ── */}
          <SectionTitle>Identity</SectionTitle>

          <Row label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Morning brief"
              className="h-8 text-sm"
            />
          </Row>

          <Row label="Agent">
            <AgentSelect
              value={form.agentId}
              onChange={(v) => set("agentId", v)}
              agents={agents}
            />
          </Row>

          {/* ── Schedule ── */}
          <SectionTitle>Schedule</SectionTitle>

          <Row label="Type">
            <RadioGroup<CronJobKind>
              value={form.kind}
              onChange={(v) => set("kind", v)}
              options={[
                { value: "cron", label: "Recurring (cron)" },
                { value: "every", label: "Interval" },
                { value: "at", label: "One-shot" },
              ]}
            />
          </Row>

          {form.kind === "cron" && (
            <>
              <Row label="When" required align="start">
                <CronScheduleBuilder
                  value={form.scheduleCron}
                  onChange={(c) => set("scheduleCron", c)}
                  tzLabel={TIMEZONES.find((tz) => tz.value === form.tz)?.label.split(" — ")[0]}
                />
              </Row>
              <Row label="Timezone">
                <select
                  value={form.tz}
                  onChange={(e) => set("tz", e.target.value)}
                  className="w-full rounded-md bg-secondary border border-border px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 h-8"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </Row>
            </>
          )}

          {form.kind === "every" && (
            <Row label="Every" required>
              <IntervalPicker
                value={form.scheduleEvery}
                onChange={(v) => set("scheduleEvery", v)}
              />
            </Row>
          )}

          {form.kind === "at" && (
            <Row label="Run" required>
              <OneShotPicker
                value={form.scheduleAt}
                onChange={(v) => set("scheduleAt", v)}
              />
            </Row>
          )}

          {/* ── Execution ── */}
          <SectionTitle>Execution</SectionTitle>

          <Row label="Session">
            <RadioGroup<CronSessionType>
              value={form.session}
              onChange={(v) => set("session", v)}
              options={[
                { value: "isolated", label: "Isolated" },
                { value: "main", label: "Main session" },
                { value: "current", label: "Current" },
                { value: "custom", label: "Custom ID" },
              ]}
            />
          </Row>

          {form.session === "custom" && (
            <Row label="Session ID" required>
              <Input
                value={form.customSessionId}
                onChange={(e) => set("customSessionId", e.target.value)}
                placeholder="my-workflow"
                className="h-8 text-sm"
              />
            </Row>
          )}

          {form.session === "isolated" && (
            <>
              <Row label="Context" align="start">
                <ContextInjector
                  agentId={form.agentId}
                  selectedSkills={form.selectedSkills}
                  scriptPaths={form.scriptPaths}
                  onSkillsChange={(v) => set("selectedSkills", v)}
                  onScriptPathsChange={(v) => set("scriptPaths", v)}
                  contextPreview={contextPreview}
                />
              </Row>

              <Row label="Task" required align="start">
                <div className="space-y-1">
                  <Textarea
                    value={form.message}
                    onChange={(v) => set("message", v)}
                    placeholder="Describe what the agent should do during this scheduled run."
                    rows={3}
                  />
                  {contextPreview && (
                    <p className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
                      <Wand2 className="h-3 w-3" />
                      Context above will be prepended to this task when submitted
                    </p>
                  )}
                </div>
              </Row>

              <Row label="Delivery">
                <RadioGroup<CronDeliveryMode>
                  value={form.deliveryMode}
                  onChange={(v) => set("deliveryMode", v)}
                  options={[
                    { value: "none", label: "None (internal)" },
                    { value: "announce", label: "Announce" },
                    { value: "webhook", label: "Webhook" },
                  ]}
                />
              </Row>

              {form.deliveryMode === "announce" && (
                <Row label="" align="start">
                  <AnnounceSelector
                    channels={deliveryChannels}
                    selectedChannel={form.deliveryChannel}
                    selectedAccount={form.deliveryChannel ? (form as FormState & { deliveryAccount?: string }).deliveryAccount || "" : ""}
                    selectedTo={form.deliveryTo}
                    agentId={form.agentId}
                    onChannelChange={(ch) => setForm((f) => ({ ...f, deliveryChannel: ch, deliveryTo: "" }))}
                    onAccountChange={(acc) => setForm((f) => ({ ...f, ...(f as unknown as Record<string,string>), deliveryAccount: acc, deliveryTo: "" } as unknown as FormState))}
                    onToChange={(to) => set("deliveryTo", to)}
                  />
                </Row>
              )}

              {form.deliveryMode === "webhook" && (
                <Row label="Webhook" required>
                  <Input
                    value={form.deliveryWebhook}
                    onChange={(e) => set("deliveryWebhook", e.target.value)}
                    placeholder="https://…"
                    className="h-8 text-sm"
                  />
                </Row>
              )}

              {/* Advanced toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors self-start ml-[88px]"
              >
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Advanced options
              </button>

              {showAdvanced && (
                <div className="flex flex-col gap-2 ml-[88px] p-2.5 rounded-lg bg-secondary/50 border border-border/40">
                  <Row label="Model">
                    <Input
                      value={form.model}
                      onChange={(e) => set("model", e.target.value)}
                      placeholder="Leave blank for agent default"
                      className="h-8 text-sm"
                    />
                  </Row>

                  <Row label="Thinking">
                    <RadioGroup<CronThinking>
                      value={form.thinking}
                      onChange={(v) => set("thinking", v)}
                      options={[
                        { value: "off", label: "Off" },
                        { value: "standard", label: "Standard" },
                        { value: "high", label: "High" },
                      ]}
                    />
                  </Row>

                  <Row label="Timeout">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={form.timeoutSeconds}
                        onChange={(e) => set("timeoutSeconds", e.target.value)}
                        placeholder="300"
                        className="h-8 w-24 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">seconds</span>
                    </div>
                  </Row>

                  <Row label="Options" align="start">
                    <div className="flex flex-col gap-1.5">
                      <Checkbox
                        checked={form.lightContext}
                        onChange={(v) => set("lightContext", v)}
                        label="Light context (skip workspace bootstrap)"
                      />
                      {form.kind === "at" && (
                        <Checkbox
                          checked={form.deleteAfterRun}
                          onChange={(v) => set("deleteAfterRun", v)}
                          label="Delete after run"
                        />
                      )}
                    </div>
                  </Row>
                </div>
              )}
            </>
          )}

          {form.session === "main" && (
            <>
              <Row label="Event" align="start">
                <Textarea
                  value={form.systemEvent}
                  onChange={(v) => set("systemEvent", v)}
                  placeholder="Reminder: check the calendar for upcoming events."
                  rows={2}
                />
              </Row>
              <Row label="Wake">
                <RadioGroup<"now" | "next-heartbeat">
                  value={form.wakeMode}
                  onChange={(v) => set("wakeMode", v)}
                  options={[
                    { value: "now", label: "Wake immediately" },
                    { value: "next-heartbeat", label: "Next heartbeat" },
                  ]}
                />
              </Row>
            </>
          )}
        </div>

        {error && (
          <p className="mt-4 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save changes" : "Create schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
