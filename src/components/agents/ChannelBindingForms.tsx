import { useState } from "react"
import {
  Trash2, Zap, Phone, Eye, EyeOff, AlertCircle, Hash,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChannelBinding } from "@/types"

// ── Shared primitives (also re-exported for ProvisionAgentWizard) ──────────────

export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
      {children} {required && <span className="text-rose-400">*</span>}
    </label>
  )
}

export function WizardInput({
  className, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return (
    <input
      {...props}
      className={cn(
        "w-full bg-foreground/6 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40",
        "focus:outline-none focus:border-emerald-500/60 focus:bg-foreground/8 transition-all",
        className,
      )}
    />
  )
}

export function WizardTextarea({
  className, ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full bg-foreground/6 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40",
        "focus:outline-none focus:border-emerald-500/60 focus:bg-foreground/8 transition-all resize-none",
        className,
      )}
    />
  )
}

export function WizardSelect({
  className, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { className?: string }) {
  return (
    <select
      {...props}
      className={cn(
        "w-full bg-foreground/6 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground dark:scheme-dark",
        "focus:outline-none focus:border-emerald-500/60 transition-all appearance-none",
        className,
      )}
    />
  )
}

// ── Telegram ────────────────────────────────────────────────────────────────────

export function TelegramBinding({
  binding, onChange, onRemove,
}: {
  binding: ChannelBinding
  onChange: (b: ChannelBinding) => void
  onRemove: () => void
}) {
  const [showToken, setShowToken] = useState(false)
  const [allowFromText, setAllowFromText] = useState(
    (binding.allowFrom || []).join(", "),
  )

  const handleAllowFromChange = (val: string) => {
    setAllowFromText(val)
    const list = val.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    onChange({ ...binding, allowFrom: list })
  }

  return (
    <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-sky-500/20 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <span className="text-sm font-bold text-sky-300">Telegram</span>
        </div>
        <button onClick={onRemove} className="text-muted-foreground/50 hover:text-rose-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div>
        <FieldLabel required>Bot Token</FieldLabel>
        <div className="relative">
          <WizardInput
            type={showToken ? "text" : "password"}
            placeholder="123456789:AABBccdd..."
            value={binding.botToken || ""}
            onChange={e => onChange({ ...binding, botToken: e.target.value })}
            className="pr-9 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground/60 transition-colors"
          >
            {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">Get from <span className="text-sky-400">@BotFather</span> on Telegram.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>DM Policy</FieldLabel>
          <WizardSelect
            value={binding.dmPolicy || "pairing"}
            onChange={e => onChange({ ...binding, dmPolicy: e.target.value as ChannelBinding["dmPolicy"] })}
          >
            <option value="pairing">pairing</option>
            <option value="allowlist">allowlist</option>
            <option value="open">open</option>
            <option value="disabled">disabled</option>
          </WizardSelect>
        </div>
        <div>
          <FieldLabel>Streaming</FieldLabel>
          <WizardSelect
            value={binding.streaming || "partial"}
            onChange={e => onChange({ ...binding, streaming: e.target.value as ChannelBinding["streaming"] })}
          >
            <option value="partial">partial</option>
            <option value="full">full</option>
            <option value="off">off</option>
          </WizardSelect>
        </div>
      </div>

      {binding.dmPolicy === "allowlist" && (
        <div>
          <FieldLabel>Allowed Telegram User / Chat IDs</FieldLabel>
          <WizardInput
            placeholder="123456789, 987654321, -1001234567890…"
            value={allowFromText}
            onChange={e => handleAllowFromChange(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            Comma-separated Telegram user IDs or chat IDs. Get your ID via <span className="text-sky-400">@userinfobot</span>.
          </p>
        </div>
      )}
    </div>
  )
}

// ── WhatsApp ───────────────────────────────────────────────────────────────────

export function WhatsAppBinding({
  binding, onChange, onRemove,
}: {
  binding: ChannelBinding
  onChange: (b: ChannelBinding) => void
  onRemove: () => void
}) {
  const [allowFromText, setAllowFromText] = useState(
    (binding.allowFrom || []).join(", "),
  )

  const handleAllowFromChange = (val: string) => {
    setAllowFromText(val)
    const list = val.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    onChange({ ...binding, allowFrom: list })
  }

  return (
    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center">
            <Phone className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <span className="text-sm font-bold text-emerald-300">WhatsApp</span>
        </div>
        <button onClick={onRemove} className="text-muted-foreground/50 hover:text-rose-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* QR notice */}
      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
        <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-300/80">
          <strong>QR pairing required</strong> after provisioning. You'll be prompted to scan a QR code with your WhatsApp.
        </p>
      </div>

      <div>
        <FieldLabel>DM Policy</FieldLabel>
        <WizardSelect
          value={binding.dmPolicy || "pairing"}
          onChange={e => onChange({ ...binding, dmPolicy: e.target.value as ChannelBinding["dmPolicy"] })}
        >
          <option value="pairing">pairing</option>
          <option value="allowlist">allowlist</option>
          <option value="open">open</option>
          <option value="disabled">disabled</option>
        </WizardSelect>
      </div>

      <div>
        <FieldLabel>Allow From (phone numbers)</FieldLabel>
        <WizardInput
          placeholder="+15551234567, +628123456789…"
          value={allowFromText}
          onChange={e => handleAllowFromChange(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">Comma-separated. Leave blank to allow based on DM policy.</p>
      </div>
    </div>
  )
}

// ── Discord ────────────────────────────────────────────────────────────────────

export function DiscordBinding({
  binding, onChange, onRemove,
}: {
  binding: ChannelBinding
  onChange: (b: ChannelBinding) => void
  onRemove: () => void
}) {
  return (
    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-500/20 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.912 19.912 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
            </svg>
          </div>
          <span className="text-sm font-bold text-indigo-300">Discord</span>
        </div>
        <button onClick={onRemove} className="text-muted-foreground/50 hover:text-rose-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Setup guide */}
      <div className="rounded-lg bg-indigo-500/6 border border-indigo-500/20 p-3 space-y-1.5">
        <p className="text-[11px] font-semibold text-indigo-400">Discord Setup</p>
        <ol className="text-[11px] text-indigo-300/70 space-y-1 list-decimal list-inside">
          <li>Go to <span className="font-mono text-indigo-300/90">discord.com/developers</span> → New Application → Bot tab</li>
          <li>Enable <strong>Message Content Intent</strong> + <strong>Server Members Intent</strong></li>
          <li>Copy the bot token from the Bot tab</li>
          <li>Invite bot to server via OAuth2 URL Generator (scopes: <span className="font-mono text-indigo-300/90">bot</span> + <span className="font-mono text-indigo-300/90">applications.commands</span>)</li>
          <li>Paste the token below for this agent</li>
        </ol>
      </div>

      <div>
        <FieldLabel required>Bot Token</FieldLabel>
        <div className="relative">
          <WizardInput
            type="password"
            placeholder="Paste Discord bot token"
            value={binding.botToken || ""}
            onChange={e => onChange({ ...binding, botToken: e.target.value })}
            className="font-mono text-xs pl-8"
          />
          <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">
          Saved per agent under <span className="font-mono">channels.discord.accounts.&lt;agentId&gt;.token</span>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>DM Policy</FieldLabel>
          <WizardSelect
            value={binding.dmPolicy || "pairing"}
            onChange={e => onChange({ ...binding, dmPolicy: e.target.value as ChannelBinding["dmPolicy"] })}
          >
            <option value="pairing">pairing</option>
            <option value="allowlist">allowlist</option>
            <option value="open">open</option>
            <option value="disabled">disabled</option>
          </WizardSelect>
        </div>
        <div>
          <FieldLabel>Guild/Server Policy</FieldLabel>
          <WizardSelect
            value={binding.groupPolicy || "open"}
            onChange={e => onChange({ ...binding, groupPolicy: e.target.value as ChannelBinding["groupPolicy"] })}
          >
            <option value="open">open</option>
            <option value="allowlist">allowlist</option>
            <option value="disabled">disabled</option>
          </WizardSelect>
        </div>
      </div>
    </div>
  )
}
