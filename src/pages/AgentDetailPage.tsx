import React, { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { chatApi } from "@/lib/chat-api"
import { useChatStore } from "@/stores/useChatStore"
import { useProcessingStore, useAgentStore } from "@/stores"
import type { SkillInfo, AgentTool, Session, SkillScript, AgentChannelTelegram, AgentChannelWhatsApp, AgentChannelDiscord, AgentChannelsResult, PairingRequest, PairingRequestsByChannel } from "@/types"
import { SessionDetailModal } from "@/components/sessions/SessionDetailModal"
import {
  Loader2, RefreshCw, Zap, Save, X,
  MessageSquare, MessageSquarePlus, Wrench, DollarSign, Hash,
  Terminal, Globe, Database, Shield,
  Pencil, ArrowRight, ArrowLeft, FileText,
  RotateCcw, ChevronDown, Cpu, Radio,
  FolderOpen, Eye, Edit3, FilePlus,
  Plus, Package, Power, PowerOff, Sparkles,
  Activity, PanelLeftClose, PanelLeftOpen,
  Code2, Trash2, Copy, Check, Download, ScrollText, ImagePlus,
  Link, Unlink, Send, AlertCircle, WifiOff, ChevronRight, Timer, History,
  Wand2, StopCircle, CornerDownLeft, LayoutTemplate, Plug, ShieldCheck, UserCheck,
} from "lucide-react"
import { AvatarPicker } from "@/components/agents/AvatarPicker"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import { CronPage } from "@/pages/CronPage"
import { SyntaxEditor } from "@/components/ui/SyntaxEditor"
import { InstallSkillModal } from "@/components/skills/InstallSkillModal"
import { VersionHistoryPanel } from "@/components/versioning/VersionHistoryPanel"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { AiAssistPanel } from "@/components/ai/AiAssistPanel"
import { useCanEditAgent } from "@/lib/permissions"
import { Lock as LockIcon } from "lucide-react"
import { TemplatePicker } from "@/components/ai/TemplatePicker"
import { SkillTemplatePicker, type SkillTemplate } from "@/components/skills/SkillTemplatePicker"
import type { SkillFileNode } from "@/lib/api"

/* ─────────────────────────────────────────────────────────────────── */
/*  TYPES                                                              */
/* ─────────────────────────────────────────────────────────────────── */

interface AvailableModel {
  value: string
  label: string
  provider: string
  modelId: string
  reasoning: boolean
  contextWindow: number
}

interface AvailableChannel {
  accountId: string
  streaming: string
  dmPolicy: string
}

interface AgentDetail {
  id: string
  model: string
  status: string
  config: Record<string, unknown>
  identity: {
    name: string
    emoji: string
    creature: string
    vibe: string
  }
  soul: {
    description: string
    traits: string[]
    raw: string
  }
  tools: {
    sections: { name: string; items: string[] }[]
    raw: string
  }
  workspace: {
    path: string
    agentDir: string
    hasCustomWorkspace: boolean
    files: Record<string, boolean>
  }
  channel: {
    type: string
    accountId: string
    streaming: string
    dmPolicy: string
  } | null
  availableModels: AvailableModel[]
  availableChannels: AvailableChannel[]
  fsWorkspaceOnly?: boolean
  profile?: {
    avatarPresetId?: string | null
    color?: string | null
  }
  stats: {
    totalSessions: number
    activeSessions: number
    totalCost: number
    totalTokens: number
    totalMessages: number
    totalToolCalls: number
  }
  sessions: {
    id: string
    name: string
    type: string
    status: string
    lastMessage: string
    updatedAt: number | string
    messageCount: number
  }[]
}

/* ─────────────────────────────────────────────────────────────────── */
/*  HELPERS                                                            */
/* ─────────────────────────────────────────────────────────────────── */

function fmtTime(ts: number | string): string {
  const d = new Date(typeof ts === "number" ? ts : new Date(ts).getTime())
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

const WORKSPACE_FILES = ["IDENTITY.md", "SOUL.md", "TOOLS.md", "AGENTS.md", "USER.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md"] as const

const fileDescriptions: Record<string, string> = {
  "IDENTITY.md": "Agent persona — name, emoji, creature, vibe",
  "SOUL.md": "Core personality traits and behavioral guidelines",
  "TOOLS.md": "Available tools and integrations",
  "AGENTS.md": "Multi-agent collaboration patterns",
  "USER.md": "User context — preferences and projects",
  "MEMORY.md": "Long-term curated memory — distilled across sessions",
  "HEARTBEAT.md": "Periodic tasks — runs on every gateway heartbeat poll",
  "BOOTSTRAP.md": "One-time first-run setup ritual",
}

const fileIcons: Record<string, string> = {
  "IDENTITY.md": "🎭",
  "SOUL.md": "🧬",
  "TOOLS.md": "🔧",
  "AGENTS.md": "🤝",
  "USER.md": "👤",
  "MEMORY.md": "🧠",
  "HEARTBEAT.md": "💓",
  "BOOTSTRAP.md": "🚀",
}

const FILE_STARTERS: Record<string, string> = {
  "HEARTBEAT.md": `# HEARTBEAT.md\n\n# Add tasks below — agent will execute these on every heartbeat poll.\n# Keep this file empty (or only comments) to reply HEARTBEAT_OK silently.\n\n`,
  "BOOTSTRAP.md": `# BOOTSTRAP.md\n\n# One-time setup ritual — runs the very first time this agent starts.\n# Delete this file once the setup is complete.\n\n`,
  "USER.md": `# USER.md\n\n# User context — preferences, projects, and background info.\n\n`,
  "MEMORY.md": `# MEMORY.md — Long-Term Memory\n\n_Nothing here yet. Fill this in over time with things worth remembering across sessions._\n\n## Key Facts\n\n## Lessons Learned\n\n## Ongoing Context\n\n`,
}

const HEARTBEAT_TEMPLATES: { label: string; emoji: string; description: string; content: string }[] = [
  {
    label: "Error Monitor",
    emoji: "🚨",
    description: "Alert via Telegram if new errors appear in log file",
    content: `# HEARTBEAT.md — Error Monitor

- Check ~/project/logs/error.log for new entries since last check
- If new errors found: summarize and send to Telegram, then clear the file
- Otherwise: HEARTBEAT_OK
`,
  },
  {
    label: "Urgent TODO",
    emoji: "📋",
    description: "Notify when urgent items appear in TODO.md",
    content: `# HEARTBEAT.md — Urgent TODO Watcher

- Read TODO.md in workspace
- If any item is marked with [!] or [urgent], notify via Telegram immediately
- Otherwise: HEARTBEAT_OK

Do not repeat alerts for items already notified. Track sent alerts in memory/heartbeat-sent.md.
`,
  },
  {
    label: "Memory Cleanup",
    emoji: "🧹",
    description: "Compact old memory files periodically",
    content: `# HEARTBEAT.md — Memory Maintenance

- Check memory/ folder — count daily files (YYYY-MM-DD.md format)
- If more than 14 files exist: summarize the oldest 7 into memory/archive.md, then delete them
- Keep the summary concise — key events, decisions, lessons only
- Otherwise: HEARTBEAT_OK
`,
  },
  {
    label: "Proactive Check-in",
    emoji: "💬",
    description: "Reach out if there's been no activity for a while",
    content: `# HEARTBEAT.md — Proactive Check-in

- Check last message timestamp in session history
- If more than 8 hours have passed since last interaction:
  - Look for anything worth reporting (pending tasks, new files, errors)
  - If something noteworthy: send a brief update via Telegram
  - If nothing new: HEARTBEAT_OK
- Otherwise: HEARTBEAT_OK

Only send one proactive message per 8-hour window. Don't spam.
`,
  },
  {
    label: "File Inbox",
    emoji: "📥",
    description: "Process drop files placed in an inbox folder",
    content: `# HEARTBEAT.md — File Inbox Processor

- Check ~/inbox/ folder for new files
- For each new file found:
  - Read its content
  - Process according to file type (summarize .txt, extract data from .csv, etc.)
  - Move processed file to ~/inbox/done/
  - Send result summary to Telegram
- If inbox is empty: HEARTBEAT_OK
`,
  },
  {
    label: "Silent (disabled)",
    emoji: "🔇",
    description: "Keep heartbeat active but do nothing",
    content: `# HEARTBEAT.md

# Heartbeat is active but no tasks are configured.
# Agent will always reply HEARTBEAT_OK silently.

# Add tasks here when needed.
`,
  },
]

const toolIcons: Record<string, React.ElementType> = {
  terminal: Terminal, ssh: Terminal, git: Terminal,
  web: Globe, scraper: Globe, browser: Globe,
  sql: Database, database: Database, odoo: Database,
  sandbox: Shield, security: Shield,
}

function getToolIcon(name: string): React.ElementType {
  const lower = name.toLowerCase()
  for (const [key, icon] of Object.entries(toolIcons)) {
    if (lower.includes(key)) return icon
  }
  return Wrench
}

/* ─────────────────────────────────────────────────────────────────── */
/*  STAT PILL                                                          */
/* ─────────────────────────────────────────────────────────────────── */

function StatPill({ icon: Icon, label, value }: {
  icon: React.ElementType; label: string; value: string | number
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-foreground/2 border border-border">
      <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold">{label}</span>
      <span className="text-[11px] font-bold text-foreground tabular-nums">{value}</span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  AI ASSIST PANEL  (shared component)                                 */
/* ─────────────────────────────────────────────────────────────────── */
// NOTE: AiAssistPanel and streamAiGenerate are imported from shared component below.
// This comment block is kept as a section marker only.

// AiAssistPanel imported from shared component below

/* ─────────────────────────────────────────────────────────────────── */
/*  INLINE FILE VIEWER / EDITOR                                        */
/* ─────────────────────────────────────────────────────────────────── */

function InlineFilePanel({
  agentId,
  filename,
  onSaved,
  agentName,
}: {
  agentId: string
  filename: string
  onSaved: () => void
  agentName?: string
}) {
  const [content, setContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [isGlobal, setIsGlobal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [injectingStandard, setInjectingStandard] = useState(false)
  const [standardStatus, setStandardStatus] = useState<"injected" | "already_applied" | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    setSaved(false)
    setEditMode(false)
    setIsNew(false)
    api.getAgentFile(agentId, filename)
      .then(data => {
        if (cancelled) return
        setContent(data.content)
        setOriginalContent(data.content)
        setIsGlobal(data.isGlobal)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        const msg = (err as Error).message || ""
        if (msg.toLowerCase().includes("not found") || msg.includes("404")) {
          // File doesn't exist yet — enter create mode with starter template
          const starter = FILE_STARTERS[filename] || `# ${filename}\n\n`
          setContent(starter)
          setOriginalContent("")
          setIsNew(true)
          setEditMode(true)
        } else {
          setError(msg)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [agentId, filename])

  const isDirty = content !== originalContent

  async function handleSave() {
    setSaving(true)
    setError("")
    setSaved(false)
    try {
      await api.saveAgentFile(agentId, filename, content)
      setOriginalContent(content)
      setIsNew(false)
      setSaved(true)
      setEditMode(false)
      onSaved()
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Focus textarea on edit mode
  useEffect(() => {
    if (editMode && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [editMode])

  async function handleInjectStandard() {
    setInjectingStandard(true)
    setStandardStatus(null)
    try {
      const result = await api.applySoulStandard(agentId)
      setStandardStatus(result.status === "already_applied" ? "already_applied" : "injected")
      if (result.status === "injected") {
        // Reload file content to reflect injection
        const data = await api.getAgentFile(agentId, filename)
        setContent(data.content)
        setOriginalContent(data.content)
        onSaved()
      }
      setTimeout(() => setStandardStatus(null), 3000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setInjectingStandard(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 bg-foreground/2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg leading-none">{fileIcons[filename] || "📄"}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold text-foreground">{filename}</span>
              {isGlobal && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded">
                  Global
                </span>
              )}
              {isNew && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-sky-400 bg-sky-400/10 border border-sky-400/20 px-1.5 py-0.5 rounded">
                  New file
                </span>
              )}
              {isDirty && !isNew && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-blue-400 bg-blue-400/10 border border-blue-400/20 px-1.5 py-0.5 rounded">
                  Modified
                </span>
              )}
              {saved && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded">
                  ✓ Saved
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{fileDescriptions[filename]}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {error && (
            <span className="text-[10px] font-bold text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded max-w-40 truncate">
              {error}
            </span>
          )}
          {editMode ? (
            <>
              {!isNew && (
                <button
                  onClick={() => { setContent(originalContent); setEditMode(false) }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-foreground/10 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={(!isDirty && !isNew) || saving}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/20 border border-primary/30 text-[11px] text-primary font-bold hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {saving ? "Saving…" : isNew ? "Create" : "Save"}
              </button>
            </>
          ) : (
            <>
              {/* Research standard injection — only shown on SOUL.md */}
              {filename === "SOUL.md" && (
                <>
                  {standardStatus && (
                    <span className={cn(
                      "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                      standardStatus === "injected"
                        ? "text-blue-400 bg-blue-400/10 border-blue-400/20"
                        : "text-muted-foreground bg-muted/30 border-border/30"
                    )}>
                      {standardStatus === "injected" ? "✓ Standard injected" : "Already applied"}
                    </span>
                  )}
                  <button
                    onClick={handleInjectStandard}
                    disabled={injectingStandard}
                    title="Inject AOC Research Output Standard into SOUL.md"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-foreground/10 text-[11px] text-muted-foreground hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/8 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {injectingStandard
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Shield className="w-3 h-3" />
                    }
                    Research Std
                  </button>
                </>
              )}
              <button
                onClick={() => setShowHistory(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-foreground/10 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                title="Version history"
              >
                <History className="w-3 h-3" />
              </button>
              <button
                onClick={() => { setShowAiPanel(p => !p) }}
                className={cn("flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-bold transition-colors",
                  showAiPanel
                    ? "bg-violet-500/20 border-violet-500/30 text-violet-400"
                    : "border-foreground/10 text-muted-foreground hover:text-violet-400 hover:border-violet-500/30 hover:bg-violet-500/10"
                )}
                title="AI Assist"
              >
                <Wand2 className="w-3 h-3" /> AI
              </button>
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-foreground/10 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            </>
          )}
        </div>
      </div>

      {showHistory && (
        <VersionHistoryPanel
          scopeKey={`agent:${agentId}:${filename}`}
          currentContent={content}
          onClose={() => setShowHistory(false)}
          onRestored={(restoredContent) => {
            setContent(restoredContent)
            setOriginalContent(restoredContent)
            setShowHistory(false)
            onSaved()
          }}
        />
      )}

      {/* Heartbeat template picker — shown when editing HEARTBEAT.md */}
      {filename === "HEARTBEAT.md" && editMode && (
        <div className="shrink-0 border-b border-border bg-foreground/1 px-4 py-2.5">
          <p className="text-[10px] text-muted-foreground/50 mb-2 uppercase tracking-wider font-semibold">Insert template</p>
          <div className="flex flex-wrap gap-1.5">
            {HEARTBEAT_TEMPLATES.map(tpl => (
              <button
                key={tpl.label}
                onClick={() => setContent(tpl.content)}
                title={tpl.description}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-foreground/10 bg-foreground/3 hover:bg-foreground/8 hover:border-foreground/20 transition-colors text-[11px] text-foreground/60 hover:text-foreground"
              >
                <span>{tpl.emoji}</span>
                <span>{tpl.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto relative">
        {loading ? (
          <div className="flex items-center justify-center h-full py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : editMode ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            spellCheck={false}
            className="w-full h-full min-h-[300px] resize-none bg-transparent text-[13px] font-mono text-foreground/90 leading-relaxed p-4 outline-none placeholder:text-muted-foreground/40 caret-primary"
            placeholder={`# ${filename}\n\nStart writing…`}
          />
        ) : (
          <div className="p-4">
            <pre className="text-[13px] font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap wrap-break-word">
              {content || <span className="text-muted-foreground/40 italic">Empty file</span>}
            </pre>
          </div>
        )}
      </div>

      {/* AI Assist Panel */}
      {showAiPanel && (
        <AiAssistPanel
          fileType={filename}
          currentContent={content}
          agentName={agentName}
          agentId={agentId}
          onApply={(generated) => {
            setContent(generated)
            setEditMode(true)
            setShowAiPanel(false)
          }}
          onClose={() => setShowAiPanel(false)}
        />
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border shrink-0 bg-foreground/1">
        <span className="text-[10px] font-mono text-muted-foreground/50">
          {content.split("\n").length} lines · {content.length} chars
        </span>
        <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
          {editMode ? <Edit3 className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
          {editMode ? "Editing" : "Preview"}
        </span>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  SKILL SCRIPTS SUB-PANEL                                           */
/* ─────────────────────────────────────────────────────────────────── */

const SCRIPT_STARTERS: Record<string, string> = {
  '.sh':   '#!/bin/bash\nset -e\n\n# Script: $SCRIPT_NAME\n# Usage: bash <path>/<script>.sh [args]\n\necho "Running..."\n',
  '.py':   '#!/usr/bin/env python3\n"""Script: $SCRIPT_NAME"""\n\nimport sys\n\ndef main():\n    print("Running...")\n\nif __name__ == "__main__":\n    main()\n',
  '.js':   '#!/usr/bin/env node\n// Script: $SCRIPT_NAME\n\nconsole.log("Running...");\n',
  '.ts':   '// Script: $SCRIPT_NAME\n\nconsole.log("Running...");\n',
  '.rb':   '#!/usr/bin/env ruby\n# Script: $SCRIPT_NAME\n\nputs "Running..."\n',
}

function SkillScriptsPanel({
  agentId,
  skillSlug,
  onSkillMdUpdated,
}: {
  agentId: string
  skillSlug: string
  onSkillMdUpdated: () => void
}) {
  const [scripts, setScripts] = useState<SkillScript[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [scriptContent, setScriptContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [scriptLoading, setScriptLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState("")
  const [saveMsg, setSaveMsg] = useState("")
  const [pathInfo, setPathInfo] = useState<{ relPath: string; scriptsDirExists: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [showNewScript, setShowNewScript] = useState(false)
  const [newFilename, setNewFilename] = useState("")
  const [newError, setNewError] = useState("")
  const [creating, setCreating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadScripts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listSkillScripts(agentId, skillSlug)
      setScripts(data.scripts || [])
    } catch { setScripts([]) }
    finally { setLoading(false) }
  }, [agentId, skillSlug])

  const loadPathInfo = useCallback(async () => {
    try {
      const info = await api.getSkillScriptsPath(agentId, skillSlug)
      setPathInfo(info)
    } catch { /* non-fatal */ }
  }, [agentId, skillSlug])

  useEffect(() => { loadScripts(); loadPathInfo() }, [loadScripts, loadPathInfo])

  // Load script content when selection changes
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setScriptLoading(true)
    setError("")
    api.getSkillScript(agentId, skillSlug, selected)
      .then(data => {
        if (cancelled) return
        setScriptContent(data.content || "")
        setOriginalContent(data.content || "")
        setScriptLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError((err as Error).message)
        setScriptLoading(false)
      })
    return () => { cancelled = true }
  }, [agentId, skillSlug, selected])

  const isDirty = scriptContent !== originalContent

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setError("")
    try {
      const result = await api.saveSkillScript(agentId, skillSlug, selected, scriptContent, true)
      setOriginalContent(scriptContent)
      setSaveMsg(result.skillMdUpdated ? "✓ Saved & SKILL.md updated" : "✓ Saved")
      setTimeout(() => setSaveMsg(""), 2500)
      if (result.skillMdUpdated) onSkillMdUpdated()
      await loadScripts()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!selected) return
    setShowDeleteConfirm(false)
    setDeleting(true)
    try {
      await api.deleteSkillScript(agentId, skillSlug, selected)
      setSelected(null)
      setScriptContent("")
      setOriginalContent("")
      await loadScripts()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  function handleDownload() {
    if (!selected) return
    const blob = new Blob([scriptContent], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = selected; a.click()
    URL.revokeObjectURL(url)
  }

  function handleCopyPath() {
    if (!pathInfo || !selected) return
    const ext = selected.slice(selected.lastIndexOf('.'))
    const runner = ext === '.py' ? 'python3' : ext === '.js' ? 'node' : ext === '.ts' ? 'ts-node' : 'bash'
    navigator.clipboard.writeText(`${runner} ${pathInfo.relPath}/${selected}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function handleCreateScript() {
    const fn = newFilename.trim()
    if (!fn) { setNewError('Filename is required'); return }
    setCreating(true)
    setNewError("")
    try {
      const ext = fn.slice(fn.lastIndexOf('.'))
      const starter = (SCRIPT_STARTERS[ext] || '').replace(/\$SCRIPT_NAME/g, fn)
      await api.saveSkillScript(agentId, skillSlug, fn, starter, true)
      await loadScripts()
      await loadPathInfo()
      setSelected(fn)
      setScriptContent(starter)
      setOriginalContent(starter)
      setShowNewScript(false)
      setNewFilename("")
      onSkillMdUpdated()
    } catch (err) {
      setNewError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  function getExtEmoji(name: string) {
    const ext = name.slice(name.lastIndexOf('.'))
    const map: Record<string, string> = { '.sh': '🟢', '.bash': '🟢', '.zsh': '🟢', '.fish': '🟢', '.py': '🐍', '.js': '🟡', '.ts': '🔷', '.rb': '🔴', '.php': '🟣', '.lua': '🌙' }
    return map[ext] || '📄'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Path hint bar */}
      {pathInfo && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-emerald-500/4 shrink-0">
          <Code2 className="w-3 h-3 text-emerald-400/70 shrink-0" />
          <span className="text-[10px] font-mono text-emerald-400/80 truncate flex-1">
            {selected ? `${pathInfo.relPath}/${selected}` : pathInfo.relPath + '/'}
          </span>
          {selected && (
            <button
              onClick={handleCopyPath}
              title="Copy exec command"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border border-emerald-500/20 text-emerald-400/70 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors shrink-0"
            >
              {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
              {copied ? "Copied" : "Copy exec"}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Script list sidebar */}
        <div className="w-44 border-r border-border shrink-0 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-foreground/1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Scripts</span>
            <button
              onClick={() => setShowNewScript(true)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-[9px] text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" /> New
            </button>
          </div>

          {/* New script inline form */}
          {showNewScript && (
            <div className="px-2 py-2 border-b border-border bg-foreground/2">
              <input
                autoFocus
                value={newFilename}
                onChange={e => setNewFilename(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateScript()}
                placeholder="deploy.sh"
                className="w-full px-2 py-1 rounded bg-foreground/15 border border-foreground/10 text-[11px] font-mono text-foreground outline-none focus:border-primary/40 transition-colors"
              />
              {newError && <p className="text-[9px] text-red-400 mt-0.5">{newError}</p>}
              <div className="flex gap-1 mt-1">
                <button onClick={() => { setShowNewScript(false); setNewFilename(""); setNewError("") }} className="flex-1 py-0.5 rounded text-[9px] border border-foreground/10 text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                <button onClick={handleCreateScript} disabled={creating} className="flex-1 py-0.5 rounded text-[9px] bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40">
                  {creating ? '…' : 'Create'}
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              </div>
            ) : scripts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-3 text-center">
                <ScrollText className="w-5 h-5 text-foreground/10 mb-1.5" />
                <p className="text-[10px] text-muted-foreground/60">No scripts yet</p>
                <button onClick={() => setShowNewScript(true)} className="text-[9px] text-primary hover:underline mt-1">Create one</button>
              </div>
            ) : (
              scripts.map(sc => (
                <button
                  key={sc.name}
                  onClick={() => setSelected(sc.name)}
                  className={cn(
                    "w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors group",
                    selected === sc.name
                      ? "bg-primary/10 border-r-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/3"
                  )}
                >
                  <span className="text-xs shrink-0">{getExtEmoji(sc.name)}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-mono block truncate">{sc.name}</span>
                    <span className="text-[9px] text-muted-foreground/50">{sc.executable ? '✓ exec' : 'not exec'} · {(sc.size / 1024).toFixed(1)}k</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Script editor */}
        <div className="flex-1 min-w-0 flex flex-col">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <Code2 className="w-8 h-8 text-foreground/8 mb-2" />
              <p className="text-sm text-muted-foreground/50">Select a script to edit</p>
              <p className="text-[10px] text-muted-foreground/30 mt-1">Scripts are run by the agent via exec tool</p>
            </div>
          ) : (
            <>
              {/* Editor toolbar */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-foreground/1 shrink-0">
                <span className="text-[11px] font-mono font-bold text-foreground">{selected}</span>
                {scripts.find(s => s.name === selected)?.executable && (
                  <span className="text-[8px] font-bold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded uppercase">exec</span>
                )}
                {saveMsg && <span className="text-[10px] text-emerald-400 ml-1">{saveMsg}</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={handleDownload} title="Download script" className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setShowDeleteConfirm(true)} disabled={deleting} title="Delete script" className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
                    {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                  {isDirty && (
                    <>
                      <button onClick={() => { setScriptContent(originalContent) }} className="flex items-center gap-0.5 px-2 py-0.5 rounded border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                        <X className="w-2.5 h-2.5" /> Discard
                      </button>
                      <button onClick={handleSave} disabled={saving} className="flex items-center gap-0.5 px-2 py-0.5 rounded bg-primary/20 border border-primary/30 text-[10px] text-primary font-bold hover:bg-primary/30 transition-colors disabled:opacity-40">
                        {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />}
                        {saving ? "Saving…" : "Save"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {error && <p className="text-[10px] text-red-400 px-3 py-1 bg-red-500/5 border-b border-red-500/10">{error}</p>}
              {/* Code textarea */}
              {scriptLoading ? (
                <div className="flex items-center justify-center flex-1">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={scriptContent}
                  onChange={e => setScriptContent(e.target.value)}
                  spellCheck={false}
                  className="flex-1 w-full resize-none bg-foreground/8 text-[12px] font-mono text-foreground/90 leading-relaxed p-3 outline-none caret-primary"
                  placeholder="#!/bin/bash\n# Your script here"
                />
              )}
              {/* Footer */}
              <div className="flex items-center justify-between px-3 py-1 border-t border-border shrink-0 bg-foreground/1">
                <span className="text-[9px] font-mono text-muted-foreground/50">{scriptContent.split('\n').length} lines · {scriptContent.length} chars</span>
                {isDirty && <span className="text-[9px] font-bold text-amber-400">● Unsaved changes</span>}
              </div>
            </>
          )}
        </div>
      </div>
      {showDeleteConfirm && selected && (
        <ConfirmDialog
          title={`Delete "${selected}"?`}
          description="This script file will be permanently deleted and cannot be recovered."
          confirmLabel="Delete Script"
          destructive
          loading={deleting}
          onConfirm={doDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  AGENT SKILL FILES PANEL (all files in skill dir)                   */
/* ─────────────────────────────────────────────────────────────────── */

function AgentSkillFileNode({
  node, depth, selectedPath, onSelect,
}: { node: SkillFileNode; depth: number; selectedPath: string | null; onSelect: (p: string) => void }) {
  const [open, setOpen] = useState(depth < 2)
  const isSelected = selectedPath === node.path
  const indent = depth * 12

  if (node.type === 'dir') {
    return (
      <div>
        <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-1.5 py-1 px-2 hover:bg-foreground/3 transition-colors rounded" style={{ paddingLeft: `${8 + indent}px` }}>
          {open ? <ChevronDown className="w-3 h-3 text-muted-foreground/40 shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
          <FolderOpen className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
          <span className="text-[10px] font-semibold text-muted-foreground/70">{node.name}/</span>
          <span className="text-[9px] text-muted-foreground/30 ml-auto">{node.children?.length ?? 0}</span>
        </button>
        {open && node.children?.map(c => <AgentSkillFileNode key={c.path} node={c} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />)}
      </div>
    )
  }

  const ext = node.ext ?? ''
  const emoji = ext === '.md' ? '📄' : ['.sh', '.bash', '.zsh'].includes(ext) ? '🟢' : ext === '.py' ? '🐍' : ['.js', '.ts'].includes(ext) ? '🟡' : '📄'

  return (
    <button
      onClick={() => node.isText && onSelect(node.path)}
      disabled={!node.isText}
      className={cn("w-full flex items-center gap-1.5 py-1 px-2 transition-colors rounded", isSelected ? "bg-primary/10 text-primary" : "hover:bg-foreground/3 text-muted-foreground/70", !node.isText && "opacity-40 cursor-not-allowed")}
      style={{ paddingLeft: `${8 + indent}px` }}
    >
      <span className="text-xs shrink-0">{emoji}</span>
      <span className={cn("text-[10px] font-mono truncate flex-1", isSelected && "text-primary font-semibold")}>{node.name}</span>
      {node.size !== undefined && <span className="text-[9px] text-muted-foreground/30 shrink-0">{node.size < 1024 ? `${node.size}B` : `${(node.size / 1024).toFixed(1)}KB`}</span>}
    </button>
  )
}

function AgentSkillFilesPanel({ agentId, skillSlug, editable }: { agentId: string; skillSlug: string; editable: boolean }) {
  const [tree, setTree] = useState<SkillFileNode[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    api.getAgentSkillDirTree(agentId, skillSlug)
      .then(data => { setTree(data.tree); setLoading(false) })
      .catch(() => setLoading(false))
  }, [agentId, skillSlug])

  useEffect(() => {
    if (!selectedPath) return
    setFileLoading(true); setEditMode(false); setError('')
    api.getAgentSkillAnyFile(agentId, skillSlug, selectedPath)
      .then(data => { setFileContent(data.content); setEditContent(data.content); setFileLoading(false) })
      .catch(e => { setError((e as Error).message); setFileLoading(false) })
  }, [agentId, skillSlug, selectedPath])

  async function handleSave() {
    if (!selectedPath) return
    setSaving(true)
    try { await api.saveAgentSkillAnyFile(agentId, skillSlug, selectedPath, editContent); setFileContent(editContent); setEditMode(false) }
    catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="w-48 shrink-0 border-r border-border overflow-y-auto py-1">
        {loading ? <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" /></div>
          : tree.length === 0 ? <p className="text-[10px] text-muted-foreground/40 px-3 py-3 italic">No files</p>
          : tree.map(n => <AgentSkillFileNode key={n.path} node={n} depth={0} selectedPath={selectedPath} onSelect={setSelectedPath} />)}
      </div>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!selectedPath ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <FolderOpen className="w-8 h-8 text-foreground/8 mb-2" />
            <p className="text-[11px] text-muted-foreground/40">Pilih file untuk lihat isinya</p>
          </div>
        ) : (
          <>
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-foreground/2">
              <span className="text-[10px] font-mono text-foreground/60 flex-1 truncate">{selectedPath}</span>
              {error && <span className="text-[9px] text-red-400 truncate">{error}</span>}
              {!fileLoading && editable && !editMode && (
                <button onClick={() => { setEditContent(fileContent); setEditMode(true) }} className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-foreground/10 text-[9px] text-muted-foreground hover:text-foreground transition-colors">
                  <Edit3 className="w-2.5 h-2.5" /> Edit
                </button>
              )}
              {editMode && <>
                <button onClick={() => { setEditMode(false); setEditContent(fileContent) }} className="text-[9px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-foreground/10 transition-colors"><X className="w-2.5 h-2.5 inline" /> Cancel</button>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/20 border border-primary/30 text-[9px] text-primary font-bold disabled:opacity-40">
                  {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />} Save
                </button>
              </>}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {fileLoading ? <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" /></div>
                : editMode ? <textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="w-full h-full resize-none bg-transparent text-[11px] font-mono text-foreground/90 px-3 py-2 focus:outline-none leading-relaxed" spellCheck={false} />
                : <div className="overflow-y-auto h-full px-3 py-2"><pre className="text-[10.5px] font-mono text-foreground/70 whitespace-pre-wrap leading-relaxed">{fileContent || <span className="text-muted-foreground/30 italic">Empty</span>}</pre></div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  INLINE SKILL VIEWER / EDITOR                                       */
/* ─────────────────────────────────────────────────────────────────── */

function InlineSkillPanel({
  agentId,
  skillSlug,
  skill,
  onToggle,
  onSaved,
  agentName,
}: {
  agentId: string
  skillSlug: string
  skill: SkillInfo | null
  onToggle: () => void
  onSaved: () => void
  agentName?: string
}) {
  const [content, setContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [editMode, setEditMode] = useState(false)
  const [editable, setEditable] = useState(false)
  const [skillTab, setSkillTab] = useState<'skillmd' | 'scripts' | 'files'>('skillmd')
  const [showHistory, setShowHistory] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function reloadSkillMd() {
    api.getSkillFile(agentId, skillSlug)
      .then(data => { setContent(data.content); setOriginalContent(data.content) })
      .catch(() => {})
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    setEditMode(false)
    api.getSkillFile(agentId, skillSlug)
      .then(data => {
        if (cancelled) return
        setContent(data.content)
        setOriginalContent(data.content)
        setEditable(data.editable)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError((err as Error).message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [agentId, skillSlug])

  const isDirty = content !== originalContent

  async function handleSave() {
    setSaving(true)
    try {
      await api.saveSkillFile(agentId, skillSlug, content)
      setOriginalContent(content)
      setEditMode(false)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    setShowDeleteConfirm(false)
    setDeleting(true)
    try {
      await api.deleteAgentSkill(agentId, skillSlug)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 bg-foreground/1">
        <span className="text-sm">{skill?.emoji || "⚡"}</span>
        <span className="text-[12px] font-bold text-foreground truncate">{skill?.name || skillSlug}</span>

        {/* Sub-tabs */}
        <div className="flex items-center gap-0.5 rounded-md bg-foreground/10 border border-border p-0.5 ml-2">
          <button
            onClick={() => setSkillTab('skillmd')}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-all",
              skillTab === 'skillmd' ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ScrollText className="w-2.5 h-2.5" /> SKILL.md
          </button>
          <button
            onClick={() => setSkillTab('scripts')}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-all",
              skillTab === 'scripts' ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Code2 className="w-2.5 h-2.5" /> Scripts
          </button>
          <button
            onClick={() => setSkillTab('files')}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-all",
              skillTab === 'files' ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FolderOpen className="w-2.5 h-2.5" /> Files
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Enable/Disable toggle */}
          <button
            onClick={onToggle}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border transition-colors",
              skill?.enabled
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                : "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
            )}
          >
            {skill?.enabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
            {skill?.enabled ? "Enabled" : "Disabled"}
          </button>

          {/* Delete — only for workspace skills */}
          {skill?.source === 'workspace' && !editMode && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-red-500/20 text-[10px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
              title="Delete workspace skill"
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            </button>
          )}

          {skillTab === 'skillmd' && (
            editMode ? (
              <>
                <button
                  onClick={() => { setContent(originalContent); setEditMode(false) }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/20 border border-primary/30 text-[10px] text-primary font-bold hover:bg-primary/30 transition-colors disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowHistory(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                  title="Version history"
                >
                  <History className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setShowTemplatePicker(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-foreground/10 text-[10px] text-muted-foreground hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/10 transition-colors font-bold"
                  title="ADLC Templates"
                >
                  <LayoutTemplate className="w-3 h-3" /> Templates
                </button>
                <button
                  onClick={() => setShowAiPanel(p => !p)}
                  className={cn("flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold transition-colors",
                    showAiPanel
                      ? "bg-violet-500/20 border-violet-500/30 text-violet-400"
                      : "border-foreground/10 text-muted-foreground hover:text-violet-400 hover:border-violet-500/30 hover:bg-violet-500/10"
                  )}
                  title="AI Assist"
                >
                  <Wand2 className="w-3 h-3" /> AI
                </button>
                {editable && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                  >
                    <Edit3 className="w-3 h-3" /> Edit
                  </button>
                )}
              </>
            )
          )}
        </div>
      </div>

      {/* Description */}
      {skill?.description && skillTab === 'skillmd' && (
        <div className="px-4 py-2 border-b border-border bg-foreground/1">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{skill.description}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={cn(
              "text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
              skill.source === 'workspace' ? "bg-blue-500/15 text-blue-400" :
              skill.source === 'managed' ? "bg-purple-500/15 text-purple-400" :
              skill.source === 'personal' ? "bg-green-500/15 text-green-400" :
              "bg-foreground/5 text-muted-foreground/70"
            )}>
              {skill.sourceLabel}
            </span>
            {skill.hasApiKey && <span className="text-[8px] font-bold text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded uppercase tracking-wider">API Key</span>}
            {skill.hasEnv && <span className="text-[8px] font-bold text-violet-400 bg-violet-400/10 px-1.5 py-0.5 rounded uppercase tracking-wider">Env Vars</span>}
          </div>
        </div>
      )}

      {/* Content area — either SKILL.md or Scripts */}
      <div className="flex-1 overflow-auto relative">
        {skillTab === 'skillmd' ? (
          loading ? (
            <div className="flex items-center justify-center h-full py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full py-16">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : editMode ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              spellCheck={false}
              className="w-full h-full min-h-[200px] resize-none bg-transparent text-[12px] font-mono text-foreground/90 leading-relaxed p-4 outline-none placeholder:text-muted-foreground/40 caret-primary"
              placeholder="# SKILL.md\n\nStart writing…"
            />
          ) : (
            <div className="p-4">
              <pre className="text-[12px] font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap wrap-break-word">
                {content || <span className="text-muted-foreground/40 italic">Empty file</span>}
              </pre>
            </div>
          )
        ) : skillTab === 'scripts' ? (
          <SkillScriptsPanel
            agentId={agentId}
            skillSlug={skillSlug}
            onSkillMdUpdated={() => { reloadSkillMd(); onSaved() }}
          />
        ) : (
          <AgentSkillFilesPanel agentId={agentId} skillSlug={skillSlug} editable={editable} />
        )}
      </div>

      {showHistory && (
        <VersionHistoryPanel
          scopeKey={`skill:${agentId}:${skillSlug}`}
          currentContent={content}
          onClose={() => setShowHistory(false)}
          onRestored={(c) => {
            setContent(c)
            setOriginalContent(c)
            setShowHistory(false)
            onSaved()
          }}
        />
      )}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete "${skillSlug}"?`}
          description="This will permanently remove the skill directory. This action cannot be undone."
          confirmLabel="Delete Skill"
          destructive
          loading={deleting}
          onConfirm={doDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* AI Assist Panel */}
      {showAiPanel && skillTab === 'skillmd' && (
        <AiAssistPanel
          fileType="SKILL.md"
          currentContent={content}
          agentName={agentName}
          agentId={agentId}
          extraContext={`Skill slug: ${skillSlug}. Skill name: ${skill?.name || skillSlug}.`}
          onApply={(generated) => {
            setContent(generated)
            setEditMode(true)
            setShowAiPanel(false)
          }}
          onClose={() => setShowAiPanel(false)}
        />
      )}

      {/* ADLC Template Picker */}
      {showTemplatePicker && (
        <TemplatePicker
          mode="skill"
          onSelect={(templateContent) => {
            setContent(templateContent)
            setEditMode(true)
            setShowTemplatePicker(false)
          }}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  CREATE SKILL DIALOG                                                */
/* ─────────────────────────────────────────────────────────────────── */

function CreateSkillDialog({
  agentId,
  agentWorkspace,
  onClose,
  onCreated,
}: {
  agentId: string
  agentWorkspace?: string
  onClose: () => void
  onCreated: (slug: string) => void
}) {
  const [step, setStep] = useState<"pick" | "form">("pick")
  const [selectedTemplate, setSelectedTemplate] = useState<SkillTemplate | null>(null)
  const [showAdlcPicker, setShowAdlcPicker] = useState(false)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [scope, setScope] = useState("workspace")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-")

  const pathPreview = (() => {
    if (!slug) return null
    const ws = agentWorkspace || "~/<workspace>"
    switch (scope) {
      case "workspace":  return `${ws}/skills/${slug}/`
      case "agent":      return `${ws}/.agents/skills/${slug}/`
      case "global":     return `~/.openclaw/skills/${slug}/`
      default:           return null
    }
  })()

  function handlePickTemplate(tpl: SkillTemplate) {
    setSelectedTemplate(tpl)
    // Always update name/desc when user explicitly picks a template (overwrite previous selection)
    if (tpl.id !== "blank") {
      if (tpl.suggestedSlug) setName(tpl.suggestedSlug)
      // Use suggestedDescription first; fallback: parse from SKILL.md frontmatter
      const desc = tpl.suggestedDescription || (() => {
        const fm = tpl.content?.match(/^---\s*\n([\s\S]*?)\n---/)
        const fmBody = fm?.[1] ?? ""
        return fmBody.match(/^description:\s*"?([^"\n]+)"?/m)?.[1]?.trim() || ""
      })()
      setDescription(desc)
    }
    setStep("form")
  }

  async function handleCreate() {
    if (!slug) { setError("Name is required"); return }

    const desc = description.trim() || name.trim()
    let content: string
    if (selectedTemplate && selectedTemplate.id !== "blank") {
      content = selectedTemplate.content
        .replace(/\{slug\}/g, slug)
        .replace(/\{name\}/g, name.trim())
        .replace(/\{description\}/g, desc)
    } else {
      content = [
        `---`,
        `name: ${slug}`,
        `description: "${desc}"`,
        `---`,
        ``,
        `# ${name.trim()}`,
        ``,
        desc !== name.trim() ? desc + "\n" : "",
        `## Instructions`,
        ``,
        `Describe what this skill does and how the agent should use it.`,
        ``,
      ].join("\n")
    }

    setSaving(true)
    setError("")
    try {
      await api.createSkill(agentId, slug, scope, content)
      onCreated(slug)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const SCOPES = [
    {
      id: "workspace" as const,
      label: "Agent Workspace",
      desc: "Private to this agent",
      icon: "🤖",
      colorClass: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    },
    {
      id: "agent" as const,
      label: "Project Agent",
      desc: "Shared in project",
      icon: "📁",
      colorClass: "bg-green-500/10 border-green-500/30 text-green-400",
    },
    {
      id: "global" as const,
      label: "Global",
      desc: "All agents can use",
      icon: "🌐",
      colorClass: "bg-purple-500/10 border-purple-500/30 text-purple-400",
    },
  ]

  return (
    <>
      <div
        className="fixed inset-0 z-60 flex items-center justify-center bg-foreground/20 backdrop-blur-sm dark:bg-background/45 dark:backdrop-blur-md dark:backdrop-brightness-60"
        onClick={onClose}
      >
        <div className="bg-card border border-foreground/10 rounded-2xl shadow-2xl w-[500px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-display font-bold text-foreground">Create New Skill</h2>
            {step === "form" && (
              <div className="flex items-center gap-1 ml-1">
                <span className="text-[10px] text-muted-foreground/40">·</span>
                <button
                  onClick={() => setStep("pick")}
                  className="text-[10px] text-muted-foreground/60 hover:text-primary transition-colors"
                >
                  ← Templates
                </button>
              </div>
            )}
            <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5">
            {step === "pick" ? (
              /* ── Step 1: Template picker ── */
              <>
                <SkillTemplatePicker
                  onSelect={handlePickTemplate}
                  onBrowseAdlc={() => setShowAdlcPicker(true)}
                />
                <div className="flex gap-2 mt-4">
                  <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-border text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              /* ── Step 2: Name + scope form ── */
              <div className="space-y-4">
                {/* Template badge */}
                {selectedTemplate && selectedTemplate.id !== "blank" && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
                    <span className="text-base leading-none">{selectedTemplate.icon}</span>
                    <span className="text-[11px] font-semibold text-foreground/80">{selectedTemplate.name}</span>
                    <button
                      onClick={() => setStep("pick")}
                      className="ml-auto text-[10px] text-muted-foreground/50 hover:text-primary transition-colors"
                    >
                      Change
                    </button>
                  </div>
                )}

                {/* Skill name / slug */}
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Skill Name</label>
                  <Input
                    value={name}
                    onChange={e => { setName(e.target.value); setError("") }}
                    onKeyDown={e => e.key === "Enter" && handleCreate()}
                    placeholder="my-custom-skill"
                    className="bg-foreground/3 border-foreground/10 text-sm"
                    autoFocus
                  />
                  {slug && name !== slug && (
                    <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
                      Folder: <span className="text-primary/70">{slug}/</span>
                    </p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">
                    Description <span className="normal-case text-muted-foreground/40">(optional)</span>
                  </label>
                  <Input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="What does this skill do?"
                    className="bg-foreground/3 border-foreground/10 text-sm"
                  />
                </div>

                {/* Scope selector */}
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Scope</label>
                  <div className="grid grid-cols-3 gap-2">
                    {SCOPES.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setScope(opt.id)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center",
                          scope === opt.id
                            ? opt.colorClass
                            : "bg-foreground/2 border-border text-muted-foreground hover:border-foreground/10 hover:bg-foreground/4"
                        )}
                      >
                        <span className="text-base leading-none">{opt.icon}</span>
                        <span className="text-[11px] font-bold leading-tight">{opt.label}</span>
                        <span className="text-[9px] opacity-60 leading-tight">{opt.desc}</span>
                      </button>
                    ))}
                  </div>

                  {pathPreview && (
                    <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-foreground/3 border border-border">
                      <FolderOpen className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                      <code className="text-[10px] font-mono text-muted-foreground/70 truncate">{pathPreview}</code>
                    </div>
                  )}
                </div>

                {error && (
                  <p className="text-[11px] text-destructive bg-destructive/10 px-3 py-2 rounded-lg border border-destructive/20">{error}</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={() => setStep("pick")} className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
                    ← Back
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!name.trim() || saving}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary/20 border border-primary/30 text-sm text-primary font-bold hover:bg-primary/30 transition-colors disabled:opacity-40"
                  >
                    {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</> : <><Plus className="w-3.5 h-3.5" /> Create Skill</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ADLC full template picker overlay */}
      {showAdlcPicker && (
        <TemplatePicker
          mode="skill"
          onSelect={(content, _name) => {
            // Parse SKILL.md frontmatter for name, description
            const fm = content.match(/^---\s*\n([\s\S]*?)\n---/)
            const fmBody = fm?.[1] ?? ""
            const extractedSlug = fmBody.match(/^name:\s*([^\s\n]+)/m)?.[1]?.trim() || ""
            // description may be quoted or unquoted
            const rawDesc = fmBody.match(/^description:\s*"?([^"\n]+)"?/m)?.[1]?.trim() || ""
            const fakeTpl: SkillTemplate = {
              id: "adlc-custom",
              name: _name,
              icon: "📄",
              description: rawDesc,
              category: "workflow",
              suggestedSlug: extractedSlug,
              suggestedDescription: rawDesc,
              content,
            }
            setShowAdlcPicker(false)
            setSelectedTemplate(fakeTpl)
            if (extractedSlug) setName(extractedSlug)
            setDescription(rawDesc)
            setStep("form")
          }}
          onClose={() => setShowAdlcPicker(false)}
        />
      )}
    </>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  EDIT CONFIGURATION MODAL                                           */
/* ─────────────────────────────────────────────────────────────────── */

function SelectField({ label, value, onChange, options, icon: Icon }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  icon?: React.ElementType
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">{label}</label>
      <div className="relative">
        {Icon && (
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        )}
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cn(
            "w-full h-8 rounded-md border border-input bg-background text-sm text-foreground",
            "pr-7 appearance-none cursor-pointer outline-none",
            "focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors",
            Icon ? "pl-8" : "pl-3"
          )}
          style={{ backgroundImage: "none" }}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  )
}

interface EditConfig {
  name: string
  emoji: string
  model: string
  vibe: string
  channelAccountId: string
  channelStreaming: string
  channelDmPolicy: string
  avatarPresetId: string
  fsWorkspaceOnly: boolean
  /** ADLC role — drives Missions playbook agent matching. */
  adlcRole: string
}

const ADLC_ROLE_OPTIONS: Array<{ value: string; label: string; emoji: string }> = [
  { value: "",             label: "— none / autonomous —",   emoji: "⚪" },
  { value: "biz-analyst",  label: "Biz Analyst",              emoji: "📈" },
  { value: "pm-analyst",   label: "PM Analyst",               emoji: "📊" },
  { value: "ux-designer",  label: "UX Designer",              emoji: "🎨" },
  { value: "em-architect", label: "EM Architect",             emoji: "🏗" },
  { value: "swe",          label: "SWE",                      emoji: "💻" },
  { value: "qa-engineer",  label: "QA Engineer",              emoji: "🧪" },
  { value: "doc-writer",   label: "Doc Writer",               emoji: "📝" },
  { value: "data-analyst", label: "Data Analyst",             emoji: "📊" },
]

function EditConfigModal({
  detail,
  onClose,
  onSaved,
}: {
  detail: AgentDetail
  onClose: () => void
  onSaved: (showRestart: boolean, newAgentId?: string) => void
}) {
  const [cfg, setCfg] = useState<EditConfig>({
    name: detail.identity.name,
    emoji: detail.identity.emoji,
    model: detail.model,
    vibe: detail.identity.vibe,
    channelAccountId: detail.channel?.accountId ?? "",
    channelStreaming: detail.channel?.streaming ?? "partial",
    channelDmPolicy: detail.channel?.dmPolicy ?? "pairing",
    avatarPresetId: detail.profile?.avatarPresetId ?? "",
    fsWorkspaceOnly: detail.fsWorkspaceOnly !== false,
    adlcRole: detail.profile?.role ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const modelOptions = detail.availableModels.map(m => ({
    value: m.value,
    label: `${m.provider} — ${m.label}${m.reasoning ? " 🧠" : ""}`,
  }))

  const channelOptions = detail.availableChannels.map(c => ({
    value: c.accountId,
    label: c.accountId === "default" ? "default (main bot)" : c.accountId,
  }))
  if (channelOptions.length === 0) {
    channelOptions.push({ value: "", label: "No channels configured" })
  }

  const streamingOptions = [
    { value: "off", label: "Off — no streaming" },
    { value: "partial", label: "Partial — stream final output" },
    { value: "full", label: "Full — stream every token" },
  ]

  const dmPolicyOptions = [
    { value: "open", label: "Open — anyone can message" },
    { value: "pairing", label: "Pairing — paired users only" },
    { value: "allowlist", label: "Allowlist — explicit list" },
  ]

  async function handleSave() {
    setSaving(true)
    setError("")
    try {
      const orig = detail
      const updates: Record<string, unknown> = {}
      if (cfg.name !== orig.identity.name) updates.name = cfg.name
      if (cfg.emoji !== orig.identity.emoji) updates.emoji = cfg.emoji
      if (cfg.model !== orig.model) updates.model = cfg.model
      if (cfg.vibe !== orig.identity.vibe) updates.theme = cfg.vibe
      if (cfg.fsWorkspaceOnly !== (orig.fsWorkspaceOnly !== false)) updates.fsWorkspaceOnly = cfg.fsWorkspaceOnly

      const channelChanged =
        cfg.channelAccountId !== orig.channel?.accountId ||
        cfg.channelStreaming !== orig.channel?.streaming ||
        cfg.channelDmPolicy !== orig.channel?.dmPolicy
      if (channelChanged && cfg.channelAccountId) {
        updates.channel = {
          accountId: cfg.channelAccountId,
          streaming: cfg.channelStreaming,
          dmPolicy: cfg.channelDmPolicy,
        }
      }

      const currentPresetId = detail.profile?.avatarPresetId ?? ""
      const currentRole = detail.profile?.role ?? ""
      const roleChanged = cfg.adlcRole !== currentRole
      if (
        Object.keys(updates).length === 0 &&
        cfg.avatarPresetId === currentPresetId &&
        !roleChanged
      ) {
        onClose(); return
      }

      let newAgentId: string | undefined
      if (Object.keys(updates).length > 0) {
        const result = await api.updateAgent(orig.id, updates) as { agentId?: string }
        if (result?.agentId && result.agentId !== orig.id) {
          newAgentId = result.agentId
        }
      }

      // Avatar / role are stored in the profile row (SQLite), not openclaw.json.
      const profileUpdates: Record<string, unknown> = {}
      if (cfg.avatarPresetId !== currentPresetId) {
        const preset = AVATAR_PRESETS.find(p => p.id === cfg.avatarPresetId)
        profileUpdates.avatarPresetId = cfg.avatarPresetId || undefined
        if (preset?.color) profileUpdates.color = preset.color
      }
      if (roleChanged) {
        profileUpdates.role = cfg.adlcRole || null
      }
      if (Object.keys(profileUpdates).length > 0) {
        const profileId = newAgentId ?? orig.id
        await api.updateAgentProfile(profileId, profileUpdates)
      }

      const needsRestart = !!(updates.model || updates.channel)
      onSaved(needsRestart, newAgentId)
    } catch (err) {
      setError((err as Error).message || "Save failed")
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-card border border-foreground/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-foreground/2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-primary/70" />
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-foreground">Edit Configuration</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Changes are written to openclaw.json</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg border border-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Identity */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Identity</span>
              <div className="flex-1 h-px bg-foreground/5" />
            </div>
            <div className="grid grid-cols-[56px_1fr] gap-3 items-start">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Emoji</label>
                <input value={cfg.emoji} onChange={e => setCfg(c => ({ ...c, emoji: e.target.value }))} className="w-full h-8 rounded-md border border-input bg-background text-center text-xl outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors" maxLength={4} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Name</label>
                <Input value={cfg.name} onChange={e => setCfg(c => ({ ...c, name: e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Vibe / Theme</label>
              <Input value={cfg.vibe} onChange={e => setCfg(c => ({ ...c, vibe: e.target.value }))} className="h-8 text-sm" />
            </div>
          </section>

          {/* Profile Picture */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ImagePlus className="w-3 h-3 text-muted-foreground/60" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Profile Picture</span>
              <div className="flex-1 h-px bg-foreground/5" />
              {cfg.avatarPresetId && (
                <button
                  onClick={() => setCfg(c => ({ ...c, avatarPresetId: "" }))}
                  className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <AvatarPicker
              value={cfg.avatarPresetId}
              onChange={(preset) => setCfg(c => ({ ...c, avatarPresetId: preset.id }))}
            />
          </section>

          {/* Model */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">AI Model</span>
              <div className="flex-1 h-px bg-foreground/5" />
            </div>
            {modelOptions.length > 0 ? (
              <>
                <SelectField label="Model & Provider" value={cfg.model} onChange={v => setCfg(c => ({ ...c, model: v }))} options={modelOptions} icon={Cpu} />
                {(() => {
                  const sel = detail.availableModels.find(m => m.value === cfg.model)
                  if (!sel) return null
                  return (
                    <div className="mt-2 flex items-center gap-3 px-3 py-2 rounded-lg bg-foreground/2 border border-border">
                      <span className="text-[10px] text-muted-foreground font-mono">{cfg.model}</span>
                      {sel.reasoning && <span className="text-[9px] font-bold uppercase tracking-wider text-violet-400 bg-violet-400/10 border border-violet-400/20 px-1.5 py-0.5 rounded">Reasoning</span>}
                      {sel.contextWindow > 0 && <span className="text-[9px] text-muted-foreground ml-auto">{sel.contextWindow >= 1_000_000 ? `${(sel.contextWindow / 1_000_000).toFixed(1)}M ctx` : `${Math.round(sel.contextWindow / 1000)}k ctx`}</span>}
                    </div>
                  )
                })()}
              </>
            ) : (
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Model</label>
                <Input value={cfg.model} onChange={e => setCfg(c => ({ ...c, model: e.target.value }))} className="h-8 text-sm font-mono text-xs" />
              </div>
            )}
          </section>

          {/* ADLC Role — used by Missions to match agents to playbook steps. */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">ADLC Role</span>
              <div className="flex-1 h-px bg-foreground/5" />
              <span className="text-[9px] text-muted-foreground bg-foreground/5 px-1.5 py-0.5 rounded">for Missions</span>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Role Identity</label>
              <select
                value={cfg.adlcRole}
                onChange={(e) => setCfg(c => ({ ...c, adlcRole: e.target.value }))}
                className="w-full h-8 px-2 rounded-md border border-input bg-background text-sm"
              >
                {ADLC_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>
                ))}
              </select>
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                Assign so this agent can be picked by Missions playbooks that need this role.
              </div>
            </div>
          </section>

          {/* Channel */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Channel Binding</span>
              <div className="flex-1 h-px bg-foreground/5" />
              <span className="text-[9px] text-muted-foreground bg-foreground/5 px-1.5 py-0.5 rounded">Telegram</span>
            </div>
            <div className="space-y-3">
              {channelOptions.length > 1 && (
                <SelectField label="Telegram Account" value={cfg.channelAccountId} onChange={v => {
                  const acct = detail.availableChannels.find(c => c.accountId === v)
                  setCfg(c => ({ ...c, channelAccountId: v, channelStreaming: acct?.streaming ?? c.channelStreaming, channelDmPolicy: acct?.dmPolicy ?? c.channelDmPolicy }))
                }} options={channelOptions} icon={Radio} />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectField label="Streaming Mode" value={cfg.channelStreaming} onChange={v => setCfg(c => ({ ...c, channelStreaming: v }))} options={streamingOptions} />
                <SelectField label="DM Policy" value={cfg.channelDmPolicy} onChange={v => setCfg(c => ({ ...c, channelDmPolicy: v }))} options={dmPolicyOptions} />
              </div>
            </div>
          </section>

          {/* Security */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Security</span>
              <div className="flex-1 h-px bg-foreground/5" />
            </div>
            <button
              type="button"
              onClick={() => setCfg(c => ({ ...c, fsWorkspaceOnly: !c.fsWorkspaceOnly }))}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors ${
                cfg.fsWorkspaceOnly
                  ? "bg-foreground/4 border-foreground/10"
                  : "bg-amber-500/8 border-amber-500/25"
              }`}
            >
              <div className="text-left">
                <p className="text-xs font-semibold text-foreground/80">Filesystem Access</p>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                  {cfg.fsWorkspaceOnly
                    ? "Sandboxed — workspace directory only"
                    : "Unrestricted — can read files outside workspace (required for Telegram/WhatsApp media)"}
                </p>
              </div>
              <div className={`ml-3 relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${cfg.fsWorkspaceOnly ? "bg-foreground/15" : "bg-amber-500/60"}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${cfg.fsWorkspaceOnly ? "translate-x-1" : "translate-x-[18px]"}`} />
              </div>
            </button>
          </section>

          {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-foreground/1">
          <p className="text-[10px] text-muted-foreground/50">Saved to ~/.openclaw/openclaw.json</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-foreground/10 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary/20 border border-primary/30 text-sm text-primary font-semibold hover:bg-primary/30 transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  GATEWAY RESTART DIALOG                                             */
/* ─────────────────────────────────────────────────────────────────── */

function RestartGatewayDialog({ onConfirm, onDismiss, reason }: {
  onConfirm: () => void
  onDismiss: () => void
  reason?: string
}) {
  const [restarting, setRestarting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleRestart() {
    setRestarting(true)
    try { await onConfirm(); setDone(true); setTimeout(onDismiss, 1500) }
    catch { setRestarting(false) }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-sm bg-card border border-foreground/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="h-1 bg-linear-to-r from-amber-500/80 via-orange-500/80 to-amber-500/80" />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
              <RotateCcw className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-foreground">Restart Gateway?</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Changes saved to openclaw.json</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">
            {reason || "Configuration updated. Restart the gateway for the new settings to take effect."}
          </p>
          {done ? (
            <div className="flex items-center justify-center gap-2 py-2 text-emerald-400 text-sm font-semibold">✓ Gateway restarting…</div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={onDismiss} className="flex-1 px-4 py-2 rounded-xl border border-foreground/10 text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">Later</button>
              <button onClick={handleRestart} disabled={restarting} className="flex-1 px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-sm text-amber-300 font-semibold hover:bg-amber-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {restarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {restarting ? "Restarting…" : "Restart Now"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  CHANNELS PANEL                                                     */
/* ─────────────────────────────────────────────────────────────────── */

type DmPolicy = "pairing" | "allowlist" | "open" | "disabled"
type Streaming = "off" | "partial" | "full"
type GroupPolicy = "open" | "allowlist" | "disabled"

const DM_POLICY_LABELS: Record<DmPolicy, string> = {
  pairing: "Pairing (bot must /start first)",
  allowlist: "Allowlist only",
  open: "Open (anyone)",
  disabled: "Disabled",
}

const GROUP_POLICY_LABELS: Record<GroupPolicy, string> = {
  open: "Open (any server)",
  allowlist: "Allowlist only",
  disabled: "Disabled",
}

const STREAMING_LABELS: Record<Streaming, string> = {
  off: "Off",
  partial: "Partial (key messages)",
  full: "Full (all tokens)",
}

function ChannelBadge({ type }: { type: "telegram" | "whatsapp" | "discord" }) {
  if (type === "telegram") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/12 text-sky-600 dark:text-sky-400 border border-sky-500/20">
      <img src="/telegram.webp" className="w-3 h-3 rounded-full" alt="" /> Telegram
    </span>
  )
  if (type === "discord") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
      <img src="/discord.png" className="w-3 h-3 rounded-full" alt="" /> Discord
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/12 text-green-600 dark:text-green-400 border border-green-500/20">
      <img src="/wa.png" className="w-3 h-3 rounded-full" alt="" /> WhatsApp
    </span>
  )
}

function TelegramChannelCard({
  ch, agentId, onSaved, onRemove,
}: {
  ch: AgentChannelTelegram; agentId: string; onSaved: () => void; onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [dmPolicy, setDmPolicy] = useState<DmPolicy>(ch.dmPolicy)
  const [streaming, setStreaming] = useState<Streaming>(ch.streaming)
  const [botToken, setBotToken] = useState(ch.botToken)
  const [err, setErr] = useState("")

  async function handleSave() {
    setSaving(true); setErr("")
    try {
      await api.updateAgentChannel(agentId, "telegram", ch.accountId, { botToken, dmPolicy, streaming })
      setEditing(false)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setSaving(false) }
  }

  async function doRemove() {
    setShowRemoveConfirm(false)
    setRemoving(true)
    try {
      await api.removeAgentChannel(agentId, "telegram", ch.accountId)
      onRemove()
    } catch (e) {
      setErr((e as Error).message)
      setRemoving(false)
    }
  }

  return (
    <div className="rounded-xl border border-sky-500/20 bg-card overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-sky-500/10 bg-sky-500/5">
        <ChannelBadge type="telegram" />
        <span className="text-[12px] font-mono font-medium text-foreground/80 flex-1 truncate">
          {ch.accountId}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setEditing(e => !e); setErr("") }}
            className={cn("w-7 h-7 rounded-md flex items-center justify-center transition-colors",
              editing ? "bg-sky-500/20 text-sky-600" : "hover:bg-foreground/8 text-muted-foreground hover:text-foreground"
            )}
            title="Edit Settings"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowRemoveConfirm(true)}
            disabled={removing}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors"
            title="Remove binding"
          >
            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {showRemoveConfirm && (
        <ConfirmDialog
          title="Remove Telegram Binding?"
          description="The bot token for this account will be removed from openclaw.json. The agent will stop receiving Telegram messages."
          confirmLabel="Remove Binding"
          destructive
          loading={removing}
          onConfirm={doRemove}
          onCancel={() => setShowRemoveConfirm(false)}
        />
      )}

      {editing ? (
        <div className="px-5 py-4 space-y-4 bg-foreground/2">
          {err && <p className="text-[11px] font-medium text-red-500 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">{err}</p>}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider block mb-1.5">Bot Token</label>
            <input
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
              className="w-full text-xs font-mono bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-sky-500/40 focus:ring-2 focus:ring-sky-500/10 transition-all"
              placeholder="123456:ABC-DEF..."
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider block mb-1.5">DM Policy</label>
              <select
                value={dmPolicy}
                onChange={e => setDmPolicy(e.target.value as DmPolicy)}
                className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-sky-500/40 focus:ring-2 focus:ring-sky-500/10 transition-all"
              >
                {(Object.keys(DM_POLICY_LABELS) as DmPolicy[]).map(v => (
                  <option key={v} value={v}>{DM_POLICY_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider block mb-1.5">Streaming</label>
              <select
                value={streaming}
                onChange={e => setStreaming(e.target.value as Streaming)}
                className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-sky-500/40 focus:ring-2 focus:ring-sky-500/10 transition-all"
              >
                {(Object.keys(STREAMING_LABELS) as Streaming[]).map(v => (
                  <option key={v} value={v}>{STREAMING_LABELS[v]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500/15 border border-sky-500/25 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-500/25 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4 bg-background">
          <div className="space-y-1">
            <span className="block text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">DM Policy</span>
            <span className="text-[12px] font-medium text-foreground/90">{DM_POLICY_LABELS[ch.dmPolicy] ?? ch.dmPolicy}</span>
          </div>
          <div className="space-y-1">
            <span className="block text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">Streaming</span>
            <span className="text-[12px] font-medium text-foreground/90">{STREAMING_LABELS[ch.streaming] ?? ch.streaming}</span>
          </div>
          <div className="space-y-1">
            <span className="block text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">Bot Token</span>
            <span className="text-[12px] font-mono text-muted-foreground/70 bg-foreground/4 px-2 py-0.5 rounded border border-foreground/5 inline-block truncate max-w-full">
              {ch.botToken ? ch.botToken.slice(0, 8) + "…" : "—"}
            </span>
          </div>
        </div>
      )}
      <ChannelAllowFromSection agentId={agentId} channel="telegram" accountId={ch.accountId} />
    </div>
  )
}

function WhatsAppChannelCard({
  ch, agentId, onSaved, onRemove,
}: {
  ch: AgentChannelWhatsApp; agentId: string; onSaved: () => void; onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [dmPolicy, setDmPolicy] = useState<DmPolicy>(ch.dmPolicy)
  const [allowFrom, setAllowFrom] = useState(ch.allowFrom.join(", "))
  const [err, setErr] = useState("")

  // QR pairing state
  const [qrStatus, setQrStatus] = useState<"idle" | "loading" | "waiting" | "connected" | "error">("idle")
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const waitingRef = useRef(false)

  const startQr = useCallback(async () => {
    setQrStatus("loading")
    setQrError(null)
    setQrDataUrl(null)
    try {
      const res = await api.channelLoginStart("whatsapp", ch.accountId)
      if (res.qrDataUrl) {
        setQrDataUrl(res.qrDataUrl)
        setQrStatus("waiting")
      } else {
        setQrStatus("connected")
      }
    } catch (e) {
      setQrError(e instanceof Error ? e.message : "Failed to start WhatsApp login")
      setQrStatus("error")
    }
  }, [ch.accountId])

  // Poll for QR scan completion
  useEffect(() => {
    if (qrStatus !== "waiting" || waitingRef.current) return
    waitingRef.current = true
    api.channelLoginWait("whatsapp", ch.accountId)
      .then(() => {
        setQrStatus("connected")
        onSaved()
      })
      .catch((e: unknown) => {
        if (waitingRef.current) {
          setQrError(e instanceof Error ? e.message : "Connection timed out")
          setQrStatus("error")
        }
      })
    return () => { waitingRef.current = false }
  }, [qrStatus, ch.accountId, onSaved])

  function handleRefreshQr() {
    waitingRef.current = false
    startQr()
  }

  async function handleSave() {
    setSaving(true); setErr("")
    try {
      const af = allowFrom.split(",").map(s => s.trim()).filter(Boolean)
      await api.updateAgentChannel(agentId, "whatsapp", ch.accountId, { dmPolicy, allowFrom: af })
      setEditing(false)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setSaving(false) }
  }

  async function doRemove() {
    setShowRemoveConfirm(false)
    setRemoving(true)
    try {
      await api.removeAgentChannel(agentId, "whatsapp", ch.accountId)
      onRemove()
    } catch (e) {
      setErr((e as Error).message)
      setRemoving(false)
    }
  }

  return (
    <div className="rounded-xl border border-green-500/20 bg-card overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-green-500/10 bg-green-500/5">
        <ChannelBadge type="whatsapp" />
        <span className="text-[12px] font-mono font-medium text-foreground/80 flex-1 truncate">
          {ch.accountId}
        </span>
        {ch.pairingRequired && qrStatus !== "connected" && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase tracking-wider">
            Pairing needed
          </span>
        )}
        {qrStatus === "connected" && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
            Connected
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setEditing(e => !e); setErr("") }}
            className={cn("w-7 h-7 rounded-md flex items-center justify-center transition-colors",
              editing ? "bg-green-500/20 text-green-600" : "hover:bg-foreground/8 text-muted-foreground hover:text-foreground"
            )}
            title="Edit Settings"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowRemoveConfirm(true)}
            disabled={removing}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors"
            title="Remove binding"
          >
            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* QR Pairing Section */}
      {ch.pairingRequired && !editing && qrStatus === "idle" && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-amber-500/6 border border-amber-500/15">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300/80">WhatsApp pairing required</p>
              <p className="text-[10px] text-amber-700/70 dark:text-amber-300/50 mt-0.5">
                Scan a QR code from your phone to link this agent to WhatsApp.
              </p>
            </div>
          </div>
          <button
            onClick={startQr}
            className="mt-2.5 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-green-500/15 border border-green-500/25 text-xs font-semibold text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors"
          >
            <img src="/wa.png" className="w-3.5 h-3.5 rounded-full" alt="" />
            Scan QR Code
          </button>
        </div>
      )}

      {qrStatus === "loading" && (
        <div className="flex flex-col items-center gap-2 py-6">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">Generating QR code…</p>
        </div>
      )}

      {qrStatus === "error" && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-red-500/6 border border-red-500/15">
          <p className="text-[11px] text-red-600 dark:text-red-400">{qrError}</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleRefreshQr}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
            <button
              onClick={() => setQrStatus("idle")}
              className="px-3 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {qrStatus === "waiting" && qrDataUrl && (
        <div className="flex flex-col items-center gap-3 px-4 py-4">
          <p className="text-[11px] text-muted-foreground text-center">
            Open <span className="text-foreground font-medium">WhatsApp</span> → <span className="text-foreground font-medium">Linked Devices</span> → scan this QR
          </p>
          <div className="p-2.5 rounded-xl border-2 border-green-500/20 bg-green-500/5">
            <img src={qrDataUrl} alt="WhatsApp QR Code" className="w-48 h-48 rounded-lg" />
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Waiting for scan…
          </div>
          <button
            onClick={handleRefreshQr}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh QR
          </button>
        </div>
      )}

      {qrStatus === "connected" && (
        <div className="flex items-center gap-2 mx-4 mt-3 p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
          <Check className="w-4 h-4 text-emerald-500 shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">WhatsApp connected!</p>
            <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/60">Agent is now reachable via WhatsApp.</p>
          </div>
        </div>
      )}

      {editing ? (
        <div className="px-5 py-4 space-y-4 bg-foreground/2">
          {err && <p className="text-[11px] font-medium text-red-500 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">{err}</p>}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider block mb-1.5">DM Policy</label>
            <select
              value={dmPolicy}
              onChange={e => setDmPolicy(e.target.value as DmPolicy)}
              className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-green-500/40 focus:ring-2 focus:ring-green-500/10 transition-all"
            >
              {(Object.keys(DM_POLICY_LABELS) as DmPolicy[]).map(v => (
                <option key={v} value={v}>{DM_POLICY_LABELS[v]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider block mb-1.5">
              Allow From <span className="text-muted-foreground/50 font-normal normal-case">(comma-separated phone numbers, leave empty for all)</span>
            </label>
            <input
              value={allowFrom}
              onChange={e => setAllowFrom(e.target.value)}
              className="w-full text-xs font-mono bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-green-500/40 focus:ring-2 focus:ring-green-500/10 transition-all"
              placeholder="+62812…, +62813…"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500/15 border border-green-500/25 text-xs font-semibold text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-background">
          <div className="space-y-1">
            <span className="block text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">DM Policy</span>
            <span className="text-[12px] font-medium text-foreground/90">{DM_POLICY_LABELS[ch.dmPolicy] ?? ch.dmPolicy}</span>
          </div>
          <div className="space-y-1">
            <span className="block text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">Allow From</span>
            <span className="text-[12px] font-medium text-foreground/90">{ch.allowFrom.length > 0 ? ch.allowFrom.join(", ") : "Anyone"}</span>
          </div>
        </div>
      )}
      {showRemoveConfirm && (
        <ConfirmDialog
          title="Remove WhatsApp Binding?"
          description="This will remove the WhatsApp account binding. The agent will stop receiving WhatsApp messages."
          confirmLabel="Remove Binding"
          destructive
          loading={removing}
          onConfirm={doRemove}
          onCancel={() => setShowRemoveConfirm(false)}
        />
      )}
      <ChannelAllowFromSection agentId={agentId} channel="whatsapp" accountId={ch.accountId} />
    </div>
  )
}

function DiscordChannelCard({
  ch, agentId, onSaved, onRemove,
}: {
  ch: AgentChannelDiscord; agentId: string; onSaved: () => void; onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [dmPolicy, setDmPolicy] = useState<DmPolicy>(ch.dmPolicy)
  const [groupPolicy, setGroupPolicy] = useState<GroupPolicy>(ch.groupPolicy)
  const [botToken, setBotToken] = useState("")
  const [err, setErr] = useState("")

  async function handleSave() {
    setSaving(true); setErr("")
    try {
      await api.updateAgentChannel(agentId, "discord", ch.accountId, {
        ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
        dmPolicy,
        groupPolicy,
      })
      setEditing(false)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setSaving(false) }
  }

  async function doRemove() {
    setShowRemoveConfirm(false)
    setRemoving(true)
    try {
      await api.removeAgentChannel(agentId, "discord", ch.accountId)
      onRemove()
    } catch (e) {
      setErr((e as Error).message)
      setRemoving(false)
    }
  }

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-card overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-indigo-500/10 bg-indigo-500/5">
        <ChannelBadge type="discord" />
        <span className="text-[12px] font-mono font-medium text-foreground/80 flex-1 truncate">
          {ch.accountId}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setEditing(e => !e); setErr("") }}
            className={cn("w-7 h-7 rounded-md flex items-center justify-center transition-colors",
              editing ? "bg-indigo-500/20 text-indigo-600" : "hover:bg-foreground/8 text-muted-foreground hover:text-foreground"
            )}
            title="Edit Settings"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowRemoveConfirm(true)}
            disabled={removing}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors"
            title="Remove binding"
          >
            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="px-5 py-4 space-y-4 bg-foreground/2">
          {err && <p className="text-[11px] font-medium text-red-500 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">{err}</p>}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider block mb-1.5">Replace Bot Token</label>
            <input
              type="password"
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
              className="w-full text-xs font-mono bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-indigo-500/40 focus:ring-2 focus:ring-indigo-500/10 transition-all"
              placeholder="Leave blank to keep current token"
            />
            <p className="text-[10px] text-muted-foreground/40 mt-1">Only fill this if you want to replace the current Discord bot token.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider block mb-1.5">DM Policy</label>
              <select
                value={dmPolicy}
                onChange={e => setDmPolicy(e.target.value as DmPolicy)}
                className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-indigo-500/40 focus:ring-2 focus:ring-indigo-500/10 transition-all"
              >
                {(Object.keys(DM_POLICY_LABELS) as DmPolicy[]).map(v => (
                  <option key={v} value={v}>{DM_POLICY_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider block mb-1.5">Guild/Server Policy</label>
              <select
                value={groupPolicy}
                onChange={e => setGroupPolicy(e.target.value as GroupPolicy)}
                className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-indigo-500/40 focus:ring-2 focus:ring-indigo-500/10 transition-all"
              >
                {(Object.keys(GROUP_POLICY_LABELS) as GroupPolicy[]).map(v => (
                  <option key={v} value={v}>{GROUP_POLICY_LABELS[v]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500/15 border border-indigo-500/25 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/25 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4 bg-background">
          <div className="space-y-1">
            <span className="block text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">DM Policy</span>
            <span className="text-[12px] font-medium text-foreground/90">{DM_POLICY_LABELS[ch.dmPolicy] ?? ch.dmPolicy}</span>
          </div>
          <div className="space-y-1">
            <span className="block text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">Guild Policy</span>
            <span className="text-[12px] font-medium text-foreground/90">{GROUP_POLICY_LABELS[ch.groupPolicy] ?? ch.groupPolicy}</span>
          </div>
          <div className="space-y-1">
            <span className="block text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">Bot Token</span>
            <span className={cn("text-[12px] font-medium", ch.hasToken ? "text-emerald-500" : "text-amber-500")}>
              {ch.hasToken ? "Configured" : "Missing"}
            </span>
          </div>
        </div>
      )}
      {showRemoveConfirm && (
        <ConfirmDialog
          title="Remove Discord Binding?"
          description="This will remove the Discord bot binding for this agent. The agent will stop receiving Discord messages."
          confirmLabel="Remove Binding"
          destructive
          loading={removing}
          onConfirm={doRemove}
          onCancel={() => setShowRemoveConfirm(false)}
        />
      )}
      <ChannelAllowFromSection agentId={agentId} channel="discord" accountId={ch.accountId} />
      <DiscordGuildsSection agentId={agentId} />
    </div>
  )
}

function AddChannelForm({
  agentId, existingTypes, onAdded, onCancel,
}: {
  agentId: string; existingTypes: string[]; onAdded: (type: string) => void; onCancel: () => void
}) {
  const telegramExists = existingTypes.includes("telegram")
  const whatsappExists = existingTypes.includes("whatsapp")
  const discordExists = existingTypes.includes("discord")

  // Default to the first available (non-bound) channel type
  const defaultType: "telegram" | "whatsapp" | "discord" = telegramExists ? (whatsappExists ? "discord" : "whatsapp") : "telegram"
  const [type, setType] = useState<"telegram" | "whatsapp" | "discord">(defaultType)
  const [botToken, setBotToken] = useState("")
  const [discordBotToken, setDiscordBotToken] = useState("")
  const [dmPolicy, setDmPolicy] = useState<DmPolicy>("pairing")
  const [groupPolicy, setGroupPolicy] = useState<GroupPolicy>("open")
  const [streaming, setStreaming] = useState<Streaming>("partial")
  const [allowFrom, setAllowFrom] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")

  // Frontend validation
  const telegramTokenValid = !botToken.trim() || /^\d+:[A-Za-z0-9_-]+$/.test(botToken.trim())
  const whatsappNumbersValid = (() => {
    if (!allowFrom.trim()) return true
    const nums = allowFrom.split(",").map(s => s.trim()).filter(Boolean)
    return nums.every(n => /^\+\d{7,15}$/.test(n))
  })()

  const canSubmit = (() => {
    if (type === "telegram") return !!botToken.trim() && telegramTokenValid
    if (type === "discord") return !!discordBotToken.trim()
    return whatsappNumbersValid // whatsapp has no strictly required fields beyond policies
  })()

  async function handleAdd() {
    setSaving(true); setErr("")
    try {
      const af = allowFrom.split(",").map(s => s.trim()).filter(Boolean)
      await api.addAgentChannel(agentId, {
        type,
        ...(type === "telegram" ? { botToken, streaming } : {}),
        ...(type === "whatsapp" ? { allowFrom: af } : {}),
        ...(type === "discord" ? { botToken: discordBotToken, groupPolicy } : {}),
        dmPolicy,
      })
      const label = type.charAt(0).toUpperCase() + type.slice(1)
      onAdded(label)
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  const CHANNEL_OPTIONS = [
    { id: "telegram" as const, label: "Telegram", exists: telegramExists, icon: <img src="/telegram.webp" className="w-3.5 h-3.5 rounded-full" alt="" /> },
    { id: "whatsapp" as const, label: "WhatsApp", exists: whatsappExists, icon: <img src="/wa.png" className="w-3.5 h-3.5 rounded-full" alt="" /> },
    { id: "discord" as const, label: "Discord", exists: discordExists, icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.912 19.912 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg> },
  ]

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/4 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground">Add Channel Binding</p>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      <div className="flex gap-2">
        {CHANNEL_OPTIONS.map(({ id: t, label, exists, icon }) => {
          const isSelected = type === t
          return (
            <button
              key={t}
              onClick={() => !exists && setType(t)}
              disabled={exists}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs font-semibold transition-all",
                exists
                  ? "border-border bg-foreground/3 text-muted-foreground/30 cursor-not-allowed"
                  : isSelected
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-foreground/4"
              )}
            >
              <div className="flex items-center gap-1.5">
                {icon}
                {label}
              </div>
              {exists && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/30">Already bound</span>
              )}
            </button>
          )
        })}
      </div>

      {type === "telegram" && (
        <>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Bot Token <span className="text-red-400">*</span></label>
            <input
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
              className={cn(
                "w-full text-xs font-mono bg-foreground/4 border rounded-lg px-3 py-2 outline-none focus:border-primary/40",
                botToken.trim() && !telegramTokenValid ? "border-red-500/50" : "border-border"
              )}
              placeholder="123456:ABC-DEF..."
            />
            {botToken.trim() && !telegramTokenValid && (
              <p className="text-[10px] text-red-400 mt-1">Invalid format — expected: 123456789:ABCdefGHI...</p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">DM Policy</label>
              <select value={dmPolicy} onChange={e => setDmPolicy(e.target.value as DmPolicy)}
                className="w-full text-xs bg-foreground/4 border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary/40">
                {(Object.keys(DM_POLICY_LABELS) as DmPolicy[]).map(v => (
                  <option key={v} value={v}>{DM_POLICY_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Streaming</label>
              <select value={streaming} onChange={e => setStreaming(e.target.value as Streaming)}
                className="w-full text-xs bg-foreground/4 border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary/40">
                {(Object.keys(STREAMING_LABELS) as Streaming[]).map(v => (
                  <option key={v} value={v}>{STREAMING_LABELS[v]}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      {type === "whatsapp" && (
        <>
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/6 border border-amber-500/15">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 dark:text-amber-300/80">
              After adding, you must run <code className="font-mono bg-foreground/6 px-1 rounded">openclaw channels login --channel whatsapp --account {agentId}</code> to complete WhatsApp pairing.
            </p>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">DM Policy</label>
            <select value={dmPolicy} onChange={e => setDmPolicy(e.target.value as DmPolicy)}
              className="w-full text-xs bg-foreground/4 border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary/40">
              {(Object.keys(DM_POLICY_LABELS) as DmPolicy[]).map(v => (
                <option key={v} value={v}>{DM_POLICY_LABELS[v]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">
              Allow From <span className="text-muted-foreground/40 font-normal normal-case">(optional, comma-separated)</span>
            </label>
            <input
              value={allowFrom}
              onChange={e => setAllowFrom(e.target.value)}
              className={cn(
                "w-full text-xs font-mono bg-foreground/4 border rounded-lg px-3 py-2 outline-none focus:border-primary/40",
                allowFrom.trim() && !whatsappNumbersValid ? "border-red-500/50" : "border-border"
              )}
              placeholder="+62812…, +62813…"
            />
            {allowFrom.trim() && !whatsappNumbersValid && (
              <p className="text-[10px] text-red-400 mt-1">Phone numbers must start with + followed by 7-15 digits (e.g. +628123456789)</p>
            )}
          </div>
        </>
      )}

      {type === "discord" && (
        <>
          <div className="rounded-lg bg-indigo-500/6 border border-indigo-500/15 p-3 space-y-1.5">
            <p className="text-[11px] font-semibold text-indigo-400">Discord Setup Steps</p>
            <ol className="text-[11px] text-indigo-300/70 space-y-1 list-decimal list-inside">
              <li>Go to <span className="font-mono text-indigo-300/90">discord.com/developers</span> → New Application → Bot tab</li>
              <li>Enable <strong>Message Content Intent</strong> + <strong>Server Members Intent</strong></li>
              <li>Copy the bot token from the Bot tab</li>
              <li>Invite the bot to your server via OAuth2 → URL Generator (scopes: <code className="font-mono bg-foreground/8 px-1 rounded">bot</code> + <code className="font-mono bg-foreground/8 px-1 rounded">applications.commands</code>)</li>
              <li>Paste the token below and save the binding</li>
            </ol>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Bot Token</label>
            <input
              type="password"
              value={discordBotToken}
              onChange={e => setDiscordBotToken(e.target.value)}
              className="w-full text-xs font-mono bg-foreground/4 border border-border rounded-lg px-3 py-2 outline-none focus:border-primary/40"
              placeholder="Paste Discord bot token"
            />
            <p className="text-[10px] text-muted-foreground/40 mt-1">Stored in <span className="font-mono">channels.discord.accounts.{agentId}.token</span>.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">DM Policy</label>
              <select value={dmPolicy} onChange={e => setDmPolicy(e.target.value as DmPolicy)}
                className="w-full text-xs bg-foreground/4 border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary/40">
                {(Object.keys(DM_POLICY_LABELS) as DmPolicy[]).map(v => (
                  <option key={v} value={v}>{DM_POLICY_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Guild/Server Policy</label>
              <select value={groupPolicy} onChange={e => setGroupPolicy(e.target.value as GroupPolicy)}
                className="w-full text-xs bg-foreground/4 border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary/40">
                {(Object.keys(GROUP_POLICY_LABELS) as GroupPolicy[]).map(v => (
                  <option key={v} value={v}>{GROUP_POLICY_LABELS[v]}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleAdd}
          disabled={saving || !canSubmit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/25 text-xs font-semibold text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
          Add Binding
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── CustomToolsPanel ────────────────────────────────────────────────────────

interface CustomTool {
  name: string; emoji: string; lang: string; size: number; relPath: string; execHint: string
  enabled: boolean; scope: 'shared' | 'agent'; content?: string; mtime?: string
}

interface CustomToolsData { shared: CustomTool[]; agent: CustomTool[] }

const EXT_COLOR: Record<string, string> = {
  '.sh': 'text-emerald-400', '.bash': 'text-emerald-400', '.zsh': 'text-emerald-400',
  '.py': 'text-blue-400', '.js': 'text-yellow-400', '.ts': 'text-sky-400',
  '.rb': 'text-red-400', '.lua': 'text-purple-400',
}

const ALLOWED_EXT_LIST = ['.sh', '.py', '.js', '.ts', '.rb', '.bash', '.zsh', '.fish', '.lua']

const STARTER_CONTENT: Record<string, string> = {
  '.sh': '#!/bin/bash\nset -euo pipefail\n\n# Your script here\necho "Hello from script"\n',
  '.py': '#!/usr/bin/env python3\n\n# Your script here\nprint("Hello from script")\n',
  '.js': '#!/usr/bin/env node\n\n// Your script here\nconsole.log("Hello from script");\n',
  '.ts': '#!/usr/bin/env ts-node\n\nconsole.log("Hello from script");\n',
}

function ToolToggle({ enabled, loading, onToggle }: { enabled: boolean; loading: boolean; onToggle: () => void }) {
  return (
    <button onClick={() => !loading && onToggle()} disabled={loading} className="shrink-0">
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        : <div className={cn("w-9 h-5 rounded-full flex items-center transition-colors", enabled ? "bg-amber-500 justify-end" : "bg-foreground/15 justify-start")}>
            <div className="w-4 h-4 rounded-full bg-white mx-0.5 shadow-sm" />
          </div>
      }
    </button>
  )
}

function AgentScriptEditor({
  tool, agentId, onSaved, onDeleted, onClose,
}: { tool: CustomTool; agentId: string; onSaved: (t: CustomTool) => void; onDeleted: (name: string) => void; onClose: () => void }) {
  const [content, setContent] = useState(tool.content ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [displayName, setDisplayName] = useState((tool as CustomTool & { displayName?: string }).displayName ?? '')
  const [description, setDescription] = useState((tool as CustomTool & { description?: string }).description ?? '')
  const [metaDirty, setMetaDirty] = useState(false)
  const [showAiPanel, setShowAiPanel] = useState(false)

  useEffect(() => {
    setContent(tool.content ?? '')
    setDisplayName((tool as CustomTool & { displayName?: string }).displayName ?? '')
    setDescription((tool as CustomTool & { description?: string }).description ?? '')
    setDirty(false)
    setMetaDirty(false)
  }, [tool.name])

  async function handleSave() {
    setSaving(true)
    try {
      const [result] = await Promise.all([
        api.saveAgentScript(agentId, tool.name, content) as Promise<CustomTool>,
        metaDirty ? api.updateAgentScriptMeta(agentId, tool.name, { name: displayName, description }) : Promise.resolve(null),
      ])
      onSaved({ ...result, scope: 'agent', enabled: tool.enabled, content, displayName, description } as CustomTool)
      setDirty(false)
      setMetaDirty(false)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    try {
      await api.deleteAgentScript(agentId, tool.name)
      onDeleted(tool.name)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Delete failed') }
  }

  return (
    <div className="flex flex-col h-full min-h-0 border-t border-border">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-foreground/2 border-b border-border">
        <span className="text-base">{tool.emoji}</span>
        <span className="text-[12px] font-mono font-semibold text-foreground flex-1">{tool.name}</span>
        {(dirty || metaDirty) && (
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
          </button>
        )}
        <button
          onClick={() => setShowAiPanel(p => !p)}
          className={cn("flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold transition-colors",
            showAiPanel
              ? "bg-violet-500/20 border-violet-500/30 text-violet-400"
              : "border-foreground/10 text-muted-foreground hover:text-violet-400 hover:border-violet-500/30 hover:bg-violet-500/10"
          )}
          title="AI Assist"
        >
          <Wand2 className="w-3 h-3" /> AI
        </button>
        {!confirmDelete
          ? <button onClick={() => setConfirmDelete(true)} className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
          : <div className="flex items-center gap-1 text-xs text-destructive">
              <span>Delete?</span>
              <button onClick={handleDelete} className="font-bold hover:underline">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-muted-foreground">No</button>
            </div>
        }
        <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* Metadata fields */}
      <div className="shrink-0 flex flex-col gap-1.5 px-3 py-2.5 border-b border-border/30 bg-foreground/1">
        <input
          value={displayName}
          onChange={e => { setDisplayName(e.target.value); setMetaDirty(true) }}
          placeholder="Display name (e.g. Backup Database)"
          className="bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none border-b border-transparent focus:border-border/50 py-0.5 transition-colors w-full font-medium"
        />
        <input
          value={description}
          onChange={e => { setDescription(e.target.value); setMetaDirty(true) }}
          placeholder="Description — what does this script do? (injected into TOOLS.md)"
          className="bg-transparent text-[11px] text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none border-b border-transparent focus:border-border/30 py-0.5 transition-colors w-full"
        />
      </div>
      {/* Editor with live syntax highlighting */}
      <SyntaxEditor
        value={content}
        onChange={v => { setContent(v); setDirty(true) }}
        ext={tool.name.match(/(\.[^.]+)$/)?.[1] || ''}
        className="flex-1 min-h-0"
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            if (dirty || metaDirty) handleSave()
          }
        }}
      />
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-t border-border/30 text-[10px] text-muted-foreground/40">
        <span><kbd>⌘S</kbd> save</span><span><kbd>Tab</kbd> indent</span>
        <span className="ml-auto">{content.split('\n').length} lines</span>
        {dirty && <span className="text-amber-400/60 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-amber-400/60" />unsaved</span>}
      </div>

      {/* AI Assist Panel */}
      {showAiPanel && (
        <AiAssistPanel
          fileType="script"
          currentContent={content}
          agentId={agentId}
          extraContext={[
            `Script name: ${tool.name}`,
            `Language: ${tool.lang || tool.name.match(/(\.[^.]+)$/)?.[1] || 'bash'}`,
            description ? `Purpose: ${description}` : "",
            `Exec hint: ${tool.execHint}`,
            `Scope: agent-specific (agent: ${agentId})`,
          ].filter(Boolean).join(". ")}
          placeholder={`Describe what this script should do… (e.g. "Check postgres connection and return JSON status", "List files changed in last 24h")`}
          onApply={(generated) => {
            setContent(generated)
            setDirty(true)
            setShowAiPanel(false)
          }}
          onClose={() => setShowAiPanel(false)}
        />
      )}
    </div>
  )
}

// Syntax highlighting map for react-syntax-highlighter
const EXT_LANGUAGE: Record<string, string> = {
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
  '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
  '.rb': 'ruby', '.lua': 'lua',
}

// Lazy import to keep bundle light
const SyntaxHighlighter = React.lazy(() =>
  import('react-syntax-highlighter').then(m => ({ default: m.default || m.Light || m.Prism }))
)

// Shared dark theme tokens — manually applied via CSS-in-JS
const SH_STYLE: Record<string, React.CSSProperties> = {
  'hljs-keyword':   { color: '#c792ea' },
  'hljs-string':    { color: '#c3e88d' },
  'hljs-comment':   { color: '#546e7a', fontStyle: 'italic' },
  'hljs-number':    { color: '#f78c6c' },
  'hljs-built_in':  { color: '#82aaff' },
  'hljs-variable':  { color: '#f07178' },
  'hljs-title':     { color: '#82aaff' },
  'hljs-params':    { color: '#e5c07b' },
  'hljs-subst':     { color: '#e06c75' },
  'hljs-attr':      { color: '#ffcb6b' },
}

function CodeView({ content, ext, editable = false, onChange }: {
  content: string; ext: string; editable?: boolean; onChange?: (v: string) => void
}) {
  const lang = EXT_LANGUAGE[ext] || 'plaintext'

  if (editable) {
    return (
      <textarea
        value={content}
        onChange={e => onChange?.(e.target.value)}
        spellCheck={false}
        className="w-full h-full resize-none bg-[#0d0d0f] text-[12px] font-mono text-foreground/90 px-4 py-4 focus:outline-none leading-relaxed"
        style={{ tabSize: 2 }}
        onKeyDown={e => {
          if (e.key === 'Tab') {
            e.preventDefault()
            const s = e.currentTarget.selectionStart
            const newVal = content.slice(0, s) + '  ' + content.slice(e.currentTarget.selectionEnd)
            onChange?.(newVal)
            requestAnimationFrame(() => { e.currentTarget.selectionStart = e.currentTarget.selectionEnd = s + 2 })
          }
        }}
      />
    )
  }

  // Read-only with syntax highlighting
  return (
    <React.Suspense fallback={<pre className="px-4 py-4 text-[12px] font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap">{content}</pre>}>
      <SyntaxHighlighter
        language={lang}
        useInlineStyles={true}
        customStyle={{
          background: '#0d0d0f',
          fontSize: '12px',
          lineHeight: '1.6',
          padding: '16px',
          margin: 0,
          overflowX: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
        style={SH_STYLE as never}
        showLineNumbers
        lineNumberStyle={{ color: '#3e4451', fontSize: '11px', minWidth: '2.5em', paddingRight: '12px', userSelect: 'none' }}
      >
        {content}
      </SyntaxHighlighter>
    </React.Suspense>
  )
}

function SharedScriptPreview({ tool, onClose }: { tool: CustomTool; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const ext = tool.name.match(/(\.[^.]+)$/)?.[1] || ''

  useEffect(() => {
    api.getScript(tool.name)
      .then(r => setContent((r as { content?: string }).content ?? ''))
      .catch(() => setContent('# Failed to load'))
  }, [tool.name])

  return (
    <div className="flex flex-col h-full min-h-0 border-t border-border">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-foreground/2 border-b border-border">
        <span className="text-base">{tool.emoji}</span>
        <span className="text-[12px] font-mono font-semibold text-foreground flex-1">{tool.name}</span>
        <span className={cn("text-[9px] font-mono font-semibold mr-1", EXT_COLOR[ext] || 'text-muted-foreground')}>{ext}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 font-bold uppercase">shared · read-only</span>
        <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ml-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {content === null
          ? <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" /></div>
          : <SyntaxEditor value={content} onChange={() => {}} ext={ext} readOnly className="h-full" />
        }
      </div>
    </div>
  )
}

function CustomToolsPanel({ agentId, onCountChange }: { agentId: string; onCountChange?: (n: number) => void }) {
  const [data, setData] = useState<CustomToolsData>({ shared: [], agent: [] })
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editTool, setEditTool] = useState<CustomTool | null>(null)
  const [previewTool, setPreviewTool] = useState<CustomTool | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newExt, setNewExt] = useState('.sh')
  const [creating, setCreating] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await api.getAgentCustomTools(agentId) as { tools: CustomToolsData }
      const shared = r.tools?.shared ?? []
      const agent  = r.tools?.agent  ?? []
      setData({ shared, agent })
      onCountChange?.(shared.length + agent.length)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [agentId])

  async function handleToggle(tool: CustomTool) {
    setToggling(tool.name)
    const newEnabled = !tool.enabled
    const key = tool.scope === 'agent' ? 'agent' : 'shared'
    setData(prev => ({ ...prev, [key]: prev[key].map(t => t.name === tool.name ? { ...t, enabled: newEnabled } : t) }))
    try {
      await api.toggleAgentCustomTool(agentId, tool.name, newEnabled, tool.scope)
    } catch (e: unknown) {
      setData(prev => ({ ...prev, [key]: prev[key].map(t => t.name === tool.name ? { ...t, enabled: tool.enabled } : t) }))
      setError(e instanceof Error ? e.message : 'Toggle failed')
    } finally {
      setToggling(null)
    }
  }

  async function openEdit(tool: CustomTool) {
    const full = await api.getAgentScript(agentId, tool.name) as CustomTool
    setEditTool({ ...tool, ...full })
    setPreviewTool(null)
  }

  async function handleCreateAgent() {
    if (!newName.trim()) return
    const filename = `${newName.trim().replace(/[^a-zA-Z0-9_.\-]/g, '_')}${newExt}`
    setCreating(true)
    try {
      const content = STARTER_CONTENT[newExt] || `# ${filename}\n`
      const result = await api.saveAgentScript(agentId, filename, content) as CustomTool
      const newTool: CustomTool = { ...result, scope: 'agent', enabled: false, content }
      setData(prev => ({ ...prev, agent: [newTool, ...prev.agent] }))
      setEditTool(newTool)
      setShowNewForm(false)
      setNewName('')
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Create failed') }
    finally { setCreating(false) }
  }

  function ToolRow({ tool }: { tool: CustomTool }) {
    const ext = tool.name.match(/(\.[^.]+)$/)?.[1] || ''
    const extColor = EXT_COLOR[ext] || 'text-muted-foreground'
    const isToggling = toggling === tool.name
    const isActive = (editTool?.name === tool.name) || (previewTool?.name === tool.name)

    function handleRowClick() {
      if (tool.scope === 'agent') {
        setPreviewTool(null)
        openEdit(tool)
      } else {
        setEditTool(null)
        setPreviewTool(isActive ? null : tool)
      }
    }

    return (
      <div
        onClick={handleRowClick}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer",
          isActive
            ? "bg-amber-500/10 border-amber-500/30"
            : tool.enabled
              ? "bg-foreground/3 border-amber-500/15 hover:bg-amber-500/5"
              : "bg-foreground/1 border-border/50 hover:bg-foreground/4 hover:border-border"
        )}
      >
        <span className="text-base shrink-0">{tool.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-semibold text-foreground truncate">{tool.name}</span>
            <span className={cn("text-[9px] font-mono", extColor)}>{ext}</span>
          </div>
          <p className="text-[9px] font-mono text-muted-foreground/40 truncate">{tool.execHint}</p>
        </div>
        {/* Stop propagation on toggle so row click doesn't fire */}
        <div onClick={e => e.stopPropagation()}>
          <ToolToggle enabled={tool.enabled} loading={isToggling} onToggle={() => handleToggle(tool)} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Left: lists | Right: editor/preview */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Lists panel */}
        <div className="w-56 shrink-0 border-r border-border overflow-y-auto flex flex-col">
          {loading && <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" /></div>}
          {error && <p className="text-[11px] text-destructive px-3 py-2">{error}</p>}

          {!loading && (
            <>
              {/* Agent scripts */}
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400">Agent Scripts</span>
                  <button onClick={() => { setShowNewForm(!showNewForm); setEditTool(null); setPreviewTool(null) }}
                    className="p-0.5 rounded text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                {showNewForm && (
                  <div className="flex flex-col gap-1.5 mb-2 p-2 rounded-lg bg-secondary border border-border">
                    <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreateAgent()}
                      placeholder="script-name"
                      className="w-full bg-background border border-border rounded px-2 py-1 text-[11px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
                    <div className="flex gap-1 flex-wrap">
                      {ALLOWED_EXT_LIST.slice(0,5).map(e => (
                        <button key={e} type="button" onClick={() => setNewExt(e)}
                          className={cn("px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-colors",
                            newExt === e ? "bg-primary text-primary-foreground" : "bg-foreground/5 text-muted-foreground hover:text-foreground")}>
                          {e}
                        </button>
                      ))}
                    </div>
                    <button onClick={handleCreateAgent} disabled={!newName.trim() || creating}
                      className="flex items-center justify-center gap-1 py-1 rounded bg-primary text-primary-foreground text-[11px] font-bold disabled:opacity-50">
                      {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create
                    </button>
                  </div>
                )}
                {data.agent.length === 0 && !showNewForm && (
                  <p className="text-[10px] text-muted-foreground/40 italic py-1">No agent scripts yet</p>
                )}
                <div className="space-y-1">
                  {data.agent.map(t => <ToolRow key={t.name} tool={t} />)}
                </div>
              </div>

              <div className="mx-3 border-t border-border/40 my-2" />

              {/* Shared scripts */}
              <div className="px-3 pb-3">
                <span className="text-[9px] font-bold uppercase tracking-widest text-sky-400 block mb-1.5">Shared Scripts</span>
                {data.shared.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/40 italic py-1">No scripts in ~/.openclaw/scripts/</p>
                )}
                <div className="space-y-1">
                  {data.shared.map(t => <ToolRow key={t.name} tool={t} />)}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right panel: editor or preview */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {editTool && (
            <AgentScriptEditor
              tool={editTool}
              agentId={agentId}
              onSaved={t => setData(prev => ({ ...prev, agent: prev.agent.map(a => a.name === t.name ? t : a) }))}
              onDeleted={name => { setData(prev => ({ ...prev, agent: prev.agent.filter(a => a.name !== name) })); setEditTool(null) }}
              onClose={() => setEditTool(null)}
            />
          )}
          {previewTool && !editTool && (
            <SharedScriptPreview tool={previewTool} onClose={() => setPreviewTool(null)} />
          )}
          {!editTool && !previewTool && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-6">
              <Terminal className="w-7 h-7 text-muted-foreground/15" />
              <p className="text-[12px] text-muted-foreground/50">Select a script to edit or preview</p>
              <p className="text-[10px] text-muted-foreground/30">Enabled scripts inject context into TOOLS.md</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Pairing Requests Panel ──────────────────────────────────────────────────

function PairingRequestsPanel({ agentId }: { agentId: string }) {
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
    if (!confirm(`Reject ${channel} pairing request ${code}? This deletes the pending request.`)) return
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

// ─── Channel Allow-From Section (embedded in each channel card) ──────────────

function ChannelAllowFromSection({
  agentId, channel, accountId,
}: {
  agentId: string; channel: "telegram" | "whatsapp" | "discord"; accountId: string
}) {
  const [entries, setEntries] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const agentFromList = useAgentStore((s) => s.agents.find((a) => a.id === agentId))
  const canEdit = useCanEditAgent(agentFromList)

  const idHint =
    channel === "telegram" ? "Telegram chat/user ID (numeric)" :
    channel === "whatsapp" ? "WhatsApp JID (e.g. 6281234567890@s.whatsapp.net)" :
    "Discord user ID (numeric snowflake)"

  const channelLabel = channel === "telegram" ? "Telegram" : channel === "whatsapp" ? "WhatsApp" : "Discord"

  const load = useCallback(async () => {
    try {
      const res = await api.getAgentAllowFrom(agentId)
      const match = res.bindings.find(b => b.channel === channel && b.accountId === accountId)
      setEntries(match ? match.entries : [])
    } catch { setEntries([]) }
  }, [agentId, channel, accountId])

  useEffect(() => { load() }, [load])

  // Refresh when an approve elsewhere on the page modifies this binding's
  // allowFrom file (PairingRequestsPanel emits this after a successful approve).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      if (detail.agentId !== agentId) return
      if (detail.channel && detail.channel !== channel) return
      load()
    }
    window.addEventListener("aoc:allowfrom-refresh", handler)
    return () => window.removeEventListener("aoc:allowfrom-refresh", handler)
  }, [agentId, channel, load])

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleAdd() {
    const value = draft.trim()
    if (!value) return
    setBusy(`add:${value}`)
    try {
      const res = await api.addAllowFromEntry(agentId, channel, accountId, value)
      if (res.ok) {
        setDraft("")
        showToast(res.added ? `Added ${value}` : `Already in list`, true)
        await load()
      } else {
        showToast(res.error || "Add failed", false)
      }
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove(entry: string) {
    if (!confirm(`Remove ${entry} from ${channelLabel} allow list?`)) return
    setBusy(`del:${entry}`)
    try {
      const res = await api.removeAllowFromEntry(agentId, channel, accountId, entry)
      if (res.ok) {
        showToast(`Removed ${entry}`, true)
        await load()
      } else {
        showToast(res.error || "Remove failed", false)
      }
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  if (entries === null) return null

  const adding = busy?.startsWith("add:")
  const isEmpty = entries.length === 0

  return (
    <div className="px-5 py-4 border-t border-border bg-background/50 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Allow From</span>
        <span className="text-[10px] text-muted-foreground/40 font-medium">DM allowlist (store-side)</span>
        <span className={cn(
          "ml-auto text-[10px] font-mono font-bold px-2 py-0.5 rounded border tabular-nums",
          isEmpty
            ? "border-foreground/10 bg-foreground/4 text-muted-foreground/50"
            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        )}>
          {entries.length} entries
        </span>
      </div>

      {toast && (
        <div className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium",
          toast.ok
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
            : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
        )}>
          {toast.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {toast.msg}
        </div>
      )}

      {isEmpty ? (
        <div className="flex items-center justify-center p-4 rounded-lg border border-dashed border-foreground/10 bg-foreground/2">
          <p className="text-[11px] text-muted-foreground/50 font-medium flex items-center gap-2">
            <LockIcon className="w-3.5 h-3.5" />
            {canEdit
              ? "No entries — anyone DM-ing this bot will need to pair first."
              : "No entries (read-only)."}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {entries.map(entry => {
            const removing = busy === `del:${entry}`
            return (
              <div
                key={entry}
                className="group inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-md border border-border bg-foreground/4 hover:bg-foreground/8 hover:border-foreground/20 transition-all text-[11px] font-mono text-foreground/80 shadow-sm"
              >
                <span className="truncate max-w-[280px]">{entry}</span>
                {canEdit && (
                  <button
                    onClick={() => handleRemove(entry)}
                    disabled={removing}
                    className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-red-500/15 hover:text-red-500 text-muted-foreground disabled:opacity-40 shrink-0"
                    title="Remove"
                  >
                    {removing ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {canEdit ? (
        <div className="flex items-center gap-2 mt-2">
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAdd() } }}
            placeholder={idHint}
            className="h-8 text-[11px] font-mono bg-background border-border focus:border-emerald-500/40 focus:ring-emerald-500/10"
          />
          <button
            onClick={handleAdd}
            disabled={!draft.trim() || adding}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all h-8",
              !draft.trim() || adding
                ? "bg-foreground/4 text-muted-foreground/50 cursor-not-allowed border border-transparent"
                : "bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25"
            )}
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </div>
      ) : (
        !isEmpty && (
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 px-1 font-medium mt-2">
            <LockIcon className="w-3 h-3" />
            Read-only — only the agent owner or an admin can edit this list.
          </p>
        )
      )}
    </div>
  )
}

// ─── Discord Guilds Section ──────────────────────────────────────────────────

function DiscordGuildsSection({ agentId }: { agentId: string }) {
  const [data, setData] = useState<import("@/types").DiscordGuildsResult | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [newGuildId, setNewGuildId] = useState("")
  const [newLabel, setNewLabel] = useState("")
  const [newRequireMention, setNewRequireMention] = useState(true)
  const [newUsers, setNewUsers] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [editRequireMention, setEditRequireMention] = useState(true)
  const [editUsersDraft, setEditUsersDraft] = useState("")

  const agentFromList = useAgentStore((s) => s.agents.find((a) => a.id === agentId))
  const canEdit = useCanEditAgent(agentFromList)

  const load = useCallback(async () => {
    try {
      const res = await api.getAgentDiscordGuilds(agentId)
      setData(res); setLoadErr(null)
    } catch (e) {
      setLoadErr((e as Error).message)
      setData(null)
    }
  }, [agentId])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const parseUserList = (text: string): string[] =>
    text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)

  async function handleAdd() {
    const guildId = newGuildId.trim()
    if (!guildId) return
    setBusy(`add:${guildId}`)
    try {
      const users = parseUserList(newUsers)
      const res = await api.upsertAgentDiscordGuild(agentId, guildId, {
        label: newLabel.trim(),
        requireMention: newRequireMention,
        users,
      })
      if (res.ok) {
        setNewGuildId(""); setNewLabel(""); setNewUsers(""); setNewRequireMention(true)
        showToast(`Added guild ${newLabel.trim() || guildId}`, true)
        await load()
      } else {
        showToast(res.error || "Add failed", false)
      }
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  function startEdit(g: import("@/types").DiscordGuildEntry) {
    setEditingId(g.guildId)
    setEditLabel(g.label || "")
    setEditRequireMention(g.requireMention)
    setEditUsersDraft(g.users.join(", "))
  }

  async function handleSaveEdit(guildId: string) {
    setBusy(`edit:${guildId}`)
    try {
      const users = parseUserList(editUsersDraft)
      const res = await api.upsertAgentDiscordGuild(agentId, guildId, {
        label: editLabel.trim(),
        requireMention: editRequireMention,
        users,
      })
      if (res.ok) {
        setEditingId(null)
        showToast(`Updated guild ${editLabel.trim() || guildId}`, true)
        await load()
      } else {
        showToast(res.error || "Update failed", false)
      }
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove(guildId: string) {
    if (!confirm(`Remove guild ${guildId} from allowlist? The agent will stop responding in this server's channels.`)) return
    setBusy(`del:${guildId}`)
    try {
      const res = await api.removeAgentDiscordGuild(agentId, guildId)
      if (res.ok) {
        showToast(`Removed guild ${guildId}`, true)
        await load()
      } else {
        showToast(res.error || "Remove failed", false)
      }
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  if (loadErr) {
    return (
      <div className="px-5 py-4 border-t border-border bg-red-500/5">
        <p className="text-[11px] text-red-500 font-medium flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          Failed to load guilds: {loadErr}
        </p>
      </div>
    )
  }
  if (!data) return null

  const guilds = data.guilds || []
  const isEmpty = guilds.length === 0
  const adding = busy === "add:" + newGuildId.trim()

  return (
    <div className="px-5 py-4 border-t border-border bg-background/50 space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Allowed Guilds</span>
        <span className="text-[10px] text-muted-foreground/40 font-medium">guild allowlist · per-account</span>
        <span className={cn(
          "ml-auto text-[10px] font-mono font-bold px-2 py-0.5 rounded border tabular-nums",
          isEmpty
            ? "border-foreground/10 bg-foreground/4 text-muted-foreground/50"
            : "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
        )}>
          {guilds.length} {guilds.length === 1 ? "guild" : "guilds"}
        </span>
      </div>

      {toast && (
        <div className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium",
          toast.ok
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
            : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
        )}>
          {toast.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {toast.msg}
        </div>
      )}

      {/* Existing guild entries */}
      {isEmpty ? (
        <div className="flex items-center justify-center p-4 rounded-lg border border-dashed border-foreground/10 bg-foreground/2">
          <p className="text-[11px] text-muted-foreground/50 font-medium flex items-center gap-2">
            {!canEdit && <LockIcon className="w-3.5 h-3.5" />}
            {canEdit
              ? "No guilds configured — agent won't respond in any Discord server channel until added below."
              : "No guilds configured (read-only)."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {guilds.map(g => {
            const editing = editingId === g.guildId
            const removing = busy === `del:${g.guildId}`
            const saving = busy === `edit:${g.guildId}`
            return (
              <div key={g.guildId} className="rounded-xl border border-border bg-card shadow-sm p-3.5 space-y-3 transition-all hover:border-foreground/15">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {g.label ? (
                        <>
                          <span className="text-[13px] font-bold text-foreground/90 truncate">{g.label}</span>
                          <span className="text-[10px] font-mono font-medium text-muted-foreground/60 truncate bg-foreground/5 px-1.5 py-0.5 rounded">{g.guildId}</span>
                        </>
                      ) : (
                        <span className="text-[13px] font-mono font-bold text-foreground/90 truncate">{g.guildId}</span>
                      )}
                      <span className={cn(
                        "text-[9px] font-bold px-2 py-0.5 rounded border ml-1",
                        g.requireMention
                          ? "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      )}>
                        {g.requireMention ? "@mention required" : "respond to all"}
                      </span>
                    </div>
                    <p className="text-[11px] font-medium text-muted-foreground/50">
                      {g.users.length} authorized {g.users.length === 1 ? "user" : "users"}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {editing ? (
                        <>
                          <button
                            onClick={() => handleSaveEdit(g.guildId)}
                            disabled={saving}
                            className="w-7 h-7 rounded-md flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                            title="Save Changes"
                          >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="w-7 h-7 rounded-md flex items-center justify-center border border-border text-muted-foreground hover:bg-foreground/5 transition-colors"
                            title="Cancel Edit"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(g)}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
                            title="Edit Guild"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemove(g.guildId)}
                            disabled={removing}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40 transition-colors"
                            title="Remove Guild"
                          >
                            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {editing ? (
                  <div className="bg-foreground/2 p-3 rounded-lg border border-border/50 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground/60 block mb-1">Friendly Label</label>
                        <Input
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          placeholder="e.g. Team Server"
                          maxLength={60}
                          className="h-8 text-[11px] bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground/60 block mb-1">Authorized Users</label>
                        <Input
                          value={editUsersDraft}
                          onChange={e => setEditUsersDraft(e.target.value)}
                          placeholder="User IDs (comma separated)"
                          className="h-8 text-[11px] font-mono bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
                        />
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[11px] font-medium text-foreground/80 cursor-pointer p-2 rounded hover:bg-foreground/5 transition-colors">
                      <input
                        type="checkbox"
                        checked={editRequireMention}
                        onChange={e => setEditRequireMention(e.target.checked)}
                        className="w-3.5 h-3.5 accent-indigo-500 rounded-sm"
                      />
                      Require @mention for bot to respond
                    </label>
                  </div>
                ) : (
                  g.users.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/40">
                      {g.users.map(u => (
                        <span key={u} className="inline-flex items-center px-2 py-0.5 rounded border border-foreground/10 bg-foreground/4 text-[10px] font-mono font-medium text-muted-foreground">
                          {u}
                        </span>
                      ))}
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add new guild form */}
      {canEdit ? (
        <div className="rounded-xl border border-dashed border-foreground/15 bg-foreground/2 p-4 space-y-3 transition-colors hover:border-foreground/30 hover:bg-foreground/4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded flex items-center justify-center bg-indigo-500/10">
              <Plus className="w-3 h-3 text-indigo-500" />
            </div>
            <span className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">Add Discord Server</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground/60 px-0.5">Server ID *</label>
              <Input
                value={newGuildId}
                onChange={e => setNewGuildId(e.target.value)}
                placeholder="Numeric snowflake (17–19 digits)"
                className="h-8 text-[11px] font-mono bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground/60 px-0.5">Friendly Label</label>
              <Input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. My Workspace (Optional)"
                maxLength={60}
                className="h-8 text-[11px] bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground/60 px-0.5">Authorized Users</label>
            <Input
              value={newUsers}
              onChange={e => setNewUsers(e.target.value)}
              placeholder="Authorized user IDs (comma separated, optional)"
              className="h-8 text-[11px] font-mono bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="inline-flex items-center gap-2 text-[11px] font-medium text-foreground/80 cursor-pointer p-1.5 -ml-1.5 rounded hover:bg-foreground/5 transition-colors">
              <input
                type="checkbox"
                checked={newRequireMention}
                onChange={e => setNewRequireMention(e.target.checked)}
                className="w-3.5 h-3.5 accent-indigo-500 rounded-sm"
              />
              Require @mention
            </label>
            <button
              onClick={handleAdd}
              disabled={!newGuildId.trim() || adding}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold transition-all shadow-sm",
                !newGuildId.trim() || adding
                  ? "bg-foreground/5 text-muted-foreground/50 cursor-not-allowed border border-transparent"
                  : "bg-indigo-500/15 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/25"
              )}
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add Server
            </button>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 px-1 font-medium">
          <LockIcon className="w-3 h-3" />
          Read-only — only the agent owner or an admin can edit guild allowlist.
        </p>
      )}

      <p className="text-[10px] font-medium text-muted-foreground/40 px-1 mt-2">
        Stored in <span className="font-mono bg-foreground/5 px-1 py-0.5 rounded">channels.discord.accounts.{data.accountId}.guilds</span>. Edits take effect after gateway restart.
      </p>
    </div>
  )
}

function ChannelsPanel({ agentId, gatewayConnected, onRestart }: {
  agentId: string; gatewayConnected: boolean; onRestart: () => void
}) {
  const [channels, setChannels] = useState<AgentChannelsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [addingChannel, setAddingChannel] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const data = await api.getAgentChannels(agentId)
      setChannels(data)
    } catch { setChannels({ telegram: [], whatsapp: [], discord: [] }) }
    finally { setLoading(false) }
  }, [agentId])

  useEffect(() => { load() }, [load])

  const existingTypes = [
    ...(channels?.telegram.length ? ["telegram"] : []),
    ...(channels?.whatsapp.length ? ["whatsapp"] : []),
    ...(channels?.discord.length ? ["discord"] : []),
  ]
  const allBindings = [
    ...(channels?.telegram ?? []),
    ...(channels?.whatsapp ?? []),
    ...(channels?.discord ?? []),
  ]

  async function handleSaved(feedbackMsg?: string) {
    await load(true)
    if (feedbackMsg) showToast(feedbackMsg, true)
    onRestart()
  }

  async function handleRemoved(type: string) {
    await load(true)
    showToast(`${type} channel removed`, true)
    onRestart()
  }

  return (
    <div className="space-y-3">
      {/* Toast feedback */}
      {toast && (
        <div className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium animate-in fade-in slide-in-from-top-1 duration-200",
          toast.ok
            ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
            : "bg-red-500/8 border-red-500/20 text-red-600 dark:text-red-400"
        )}>
          {toast.ok ? <Check className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* Gateway status bar */}
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium",
        gatewayConnected
          ? "bg-emerald-500/6 border-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/6 border-amber-500/15 text-amber-600 dark:text-amber-400"
      )}>
        {gatewayConnected
          ? <><Send className="w-3.5 h-3.5 shrink-0" /> Gateway connected — Test Chat available</>
          : <><WifiOff className="w-3.5 h-3.5 shrink-0" /> Gateway offline — start OpenClaw gateway to use Test Chat</>
        }
      </div>

      {/* Pending pairing requests */}
      <PairingRequestsPanel agentId={agentId} />

      {/* Channel cards */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {allBindings.length === 0 && !addingChannel && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/40">
              <Globe className="w-7 h-7" />
              <p className="text-sm">No channel bindings yet</p>
              <p className="text-xs">Add Telegram, WhatsApp, or Discord to receive messages</p>
            </div>
          )}

          {channels?.telegram.map(ch => (
            <TelegramChannelCard
              key={ch.accountId}
              ch={ch}
              agentId={agentId}
              onSaved={() => handleSaved("Telegram channel updated")}
              onRemove={() => handleRemoved("Telegram")}
            />
          ))}
          {channels?.whatsapp.map(ch => (
            <WhatsAppChannelCard
              key={ch.accountId}
              ch={ch}
              agentId={agentId}
                      onSaved={() => handleSaved("WhatsApp channel updated")}
              onRemove={() => handleRemoved("WhatsApp")}
            />
          ))}
          {channels?.discord.map(ch => (
            <DiscordChannelCard
              key={ch.accountId}
              ch={ch}
              agentId={agentId}
              onSaved={() => handleSaved("Discord channel updated")}
              onRemove={() => handleRemoved("Discord")}
            />
          ))}

          {addingChannel ? (
            <AddChannelForm
              agentId={agentId}
              existingTypes={existingTypes}
              onAdded={(type) => { setAddingChannel(false); handleSaved(`${type} channel added`) }}
              onCancel={() => setAddingChannel(false)}
            />
          ) : existingTypes.length < 3 && (
            <button
              onClick={() => setAddingChannel(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-foreground/15 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/4 transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Add Channel Binding
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  DELETE AGENT MODAL                                                  */
/* ─────────────────────────────────────────────────────────────────── */

function DeleteAgentModal({
  agentId,
  agentName,
  onClose,
  onDeleted,
}: {
  agentId: string
  agentName: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [confirmText, setConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState("")

  const canDelete = confirmText.trim() === agentId

  const handleDelete = async () => {
    if (!canDelete) return
    setDeleting(true)
    setError("")
    try {
      await api.deleteAgent(agentId)
      onDeleted()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed")
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-red-500/5">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Delete Agent</h2>
            <p className="text-[11px] text-muted-foreground">This action is permanent and cannot be undone.</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* What will be deleted */}
          <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              The following will be permanently deleted:
            </p>
            <ul className="text-[11px] text-muted-foreground space-y-1 ml-5 list-disc">
              <li>Agent workspace files <span className="font-mono text-foreground/50">~/.openclaw/workspaces/{agentId}/</span></li>
              <li>Agent state directory <span className="font-mono text-foreground/50">~/.openclaw/agents/{agentId}/</span></li>
              <li>Config entries in <span className="font-mono text-foreground/50">openclaw.json</span> (accounts, bindings)</li>
              <li>Dashboard profile &amp; avatar</li>
            </ul>
            <p className="text-[11px] text-amber-400/80 mt-2 flex items-start gap-1.5">
              <span className="shrink-0 mt-px">⚠</span>
              Session history is preserved. Gateway restart required to apply channel changes.
            </p>
          </div>

          {/* Agent info */}
          <div className="flex items-center gap-3 px-3 py-2.5 bg-foreground/3 border border-border rounded-lg">
            <div className="w-8 h-8 rounded-lg bg-foreground/5 flex items-center justify-center text-base">
              {agentName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{agentName}</p>
              <p className="text-[10px] font-mono text-muted-foreground/60">{agentId}</p>
            </div>
          </div>

          {/* Confirm input */}
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
              Type <span className="font-mono text-foreground/80 bg-foreground/8 px-1 py-0.5 rounded">{agentId}</span> to confirm deletion:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && canDelete && handleDelete()}
              placeholder={agentId}
              autoFocus
              className={cn(
                "w-full bg-background border rounded-lg px-3 py-2 text-sm font-mono transition-all outline-none",
                canDelete
                  ? "border-red-500/60 text-foreground focus:border-red-500"
                  : "border-border text-foreground focus:border-foreground/20"
              )}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            className="flex-1 px-4 py-2 rounded-lg bg-red-500/90 text-white text-sm font-semibold hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {deleting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting…</> : <><Trash2 className="w-3.5 h-3.5" /> Delete Agent</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  AGENT CONNECTIONS TAB                                               */
/* ─────────────────────────────────────────────────────────────────── */

const CONN_TYPE_META: Record<string, { label: string; color: string }> = {
  bigquery: { label: 'BigQuery', color: 'text-blue-400' },
  postgres: { label: 'PostgreSQL', color: 'text-indigo-400' },
  ssh:      { label: 'SSH/VPS', color: 'text-emerald-400' },
  website:  { label: 'Website', color: 'text-orange-400' },
  github:   { label: 'GitHub', color: 'text-purple-400' },
  odoocli:  { label: 'Odoo', color: 'text-violet-400' },
}

function AgentConnectionsTab({ agentId }: { agentId: string }) {
  const [allConns, setAllConns] = useState<import("@/types").Connection[]>([])
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [connRes, assignRes] = await Promise.all([
        api.getConnections(),
        api.getAgentConnections(agentId),
      ])
      setAllConns(connRes.connections)
      setAssignedIds(new Set(assignRes.connectionIds))
    } catch { /* ignore */ }
    setLoading(false)
  }, [agentId])

  useEffect(() => { load() }, [load])

  const toggle = async (connId: string) => {
    const next = new Set(assignedIds)
    if (next.has(connId)) next.delete(connId)
    else next.add(connId)
    setAssignedIds(next)
    setSaving(true)
    try {
      await api.setAgentConnections(agentId, [...next])
    } catch { /* revert on error */ setAssignedIds(assignedIds) }
    setSaving(false)
  }

  if (loading) return <div className="flex-1 flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>

  if (allConns.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 text-center gap-2">
      <Plug className="w-8 h-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">No connections configured yet.</p>
      <p className="text-xs text-muted-foreground/50">Go to Connections page to add data sources, repos, or services.</p>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">
          Toggle connections this agent can access. {saving && <span className="text-primary ml-1">Saving…</span>}
        </p>
        <span className="text-xs text-muted-foreground/50">{assignedIds.size}/{allConns.length} assigned</span>
      </div>
      {allConns.map(conn => {
        const assigned = assignedIds.has(conn.id)
        const meta = conn.metadata || {}
        const typeMeta = CONN_TYPE_META[conn.type] || { label: conn.type, color: 'text-muted-foreground' }
        let detail = ''
        if (conn.type === 'bigquery') detail = meta.projectId || ''
        else if (conn.type === 'postgres') detail = `${meta.host || 'localhost'}:${meta.port || 5432}/${meta.database || '?'}`
        else if (conn.type === 'ssh') detail = `${meta.sshUser || 'root'}@${meta.sshHost || '?'}`
        else if (conn.type === 'website') detail = meta.url || ''
        else if (conn.type === 'github') detail = `${meta.repoOwner || ''}/${meta.repoName || ''} · ${meta.branch || 'main'}`
        else if (conn.type === 'odoocli') detail = `${meta.odooUrl || '?'} · ${meta.odooDb || '?'}`

        return (
          <button
            key={conn.id}
            onClick={() => toggle(conn.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all",
              assigned
                ? "border-primary/40 bg-primary/5"
                : "border-border/40 bg-card/30 opacity-60 hover:opacity-100"
            )}
          >
            <div className={cn("w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
              assigned ? "border-primary bg-primary" : "border-muted-foreground/30"
            )}>
              {assigned && <Check className="w-3 h-3 text-primary-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{conn.name}</span>
                <span className={cn("text-[10px] font-medium", typeMeta.color)}>{typeMeta.label}</span>
              </div>
              {detail && <p className="text-[11px] text-muted-foreground/50 font-mono truncate">{detail}</p>}
            </div>
            {!conn.enabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground/50 shrink-0">Disabled</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  MAIN PAGE                                                          */
/* ─────────────────────────────────────────────────────────────────── */

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Ownership — gate write actions based on the agents list entry (has provisionedBy)
  const agentFromList = useAgentStore((s) => s.agents.find((a) => a.id === id))
  const canEdit = useCanEditAgent(agentFromList)

  // Modals
  const [editing, setEditing] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showRestartDialog, setShowRestartDialog] = useState(false)
  const [restartReason, setRestartReason] = useState("")
  const [saveMsg, setSaveMsg] = useState("")
  const [testingChat, setTestingChat] = useState(false)

  // File explorer
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileRefreshKey, setFileRefreshKey] = useState(0)
  const initialFileAutoSelected = React.useRef(false)

  // Skills
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [showCreateSkill, setShowCreateSkill] = useState(false)
  const [showInstallSkill, setShowInstallSkill] = useState(false)
  const [skillsLoading, setSkillsLoading] = useState(false)

  // Built-in tools
  const [tools, setTools] = useState<AgentTool[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)

  // Active tab in Skills & Tools panel
  const [activeTab, setActiveTab] = useState<'skills' | 'tools' | 'custom-tools'>('skills')
  const [customToolsTotal, setCustomToolsTotal] = useState(0)

  // Sidebar collapse states
  const [fileSidebarCollapsed, setFileSidebarCollapsed] = useState(false)
  const [skillSidebarCollapsed, setSkillSidebarCollapsed] = useState(false)
  const [collapsedSkillGroups, setCollapsedSkillGroups] = useState<Set<string>>(new Set())

  // Main body tab
  const [bodyTab, setBodyTab] = useState<'files' | 'skills' | 'channels' | 'connections' | 'schedules'>('files')

  // Live session monitoring
  const [viewingSession, setViewingSession] = useState<Session | null>(null)

  // Gateway connectivity (for ChannelsPanel status bar + Test Chat)
  const [gatewayConnected, setGatewayConnected] = useState(false)
  useEffect(() => {
    api.getGatewayStatus().then(s => setGatewayConnected(!!s.portOpen)).catch(() => setGatewayConnected(false))
    const t = setInterval(() => {
      api.getGatewayStatus().then(s => setGatewayConnected(!!s.portOpen)).catch(() => setGatewayConnected(false))
    }, 8000)
    return () => clearInterval(t)
  }, [])

  const handleTestChat = useCallback(async () => {
    if (!id || testingChat) return
    if (!gatewayConnected) {
      setRestartReason("Gateway is offline. Start the OpenClaw gateway first, then try Test Chat again.")
      setShowRestartDialog(true)
      return
    }
    setTestingChat(true)
    try {
      const result = await chatApi.createSession(id) as Record<string, unknown>
      const sessionKey = (result.key as string) ?? (result.sessionKey as string) ?? ((result.session as Record<string, unknown>)?.key as string)
      if (!sessionKey) throw new Error("No session key returned")
      const chatStore = useChatStore.getState()
      const newSession = { sessionKey, agentId: id, channel: "webchat", createdAt: Date.now(), updatedAt: Date.now() }
      chatStore.setSessions([newSession, ...chatStore.sessions])
      await chatApi.subscribe(sessionKey)
      chatStore.setActiveSessionKey(sessionKey)
      navigate("/chat")
    } catch (err) {
      setSaveMsg(`❌ ${err instanceof Error ? err.message : "Failed to start chat"}`)
      setTimeout(() => setSaveMsg(""), 5000)
    } finally {
      setTestingChat(false)
    }
  }, [id, testingChat, gatewayConnected, navigate])

  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError("")
    try {
      const data = await api.getAgentDetail(id) as AgentDetail
      setDetail(data)
      // Auto-select first existing file only on initial load
      if (!initialFileAutoSelected.current) {
        initialFileAutoSelected.current = true
        const first = WORKSPACE_FILES.find(f => data.workspace.files[f.replace(".md", "").toLowerCase()])
        if (first) setSelectedFile(first)
      }
    } catch (err) {
      setError((err as Error).message || "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { initialFileAutoSelected.current = false; loadDetail() }, [loadDetail])

  // Detect if agent is currently processing.
  // Realtime signal from WS (processing_start/end) takes precedence over the
  // REST-snapshotted `detail.status` so the LIVE badge flips instantly.
  const liveAgentProcessing = useProcessingStore((s) => (id ? (s.agentCounts[id] ?? 0) > 0 : false))
  const isProcessing = liveAgentProcessing || detail?.status === "active"

  // Active session: first session with status 'active', falling back to just the most recent one
  const activeSession = useMemo(() => {
    if (!detail?.sessions) return null
    return detail.sessions.find(s => s.status === "active") ?? detail.sessions[0] ?? null
  }, [detail?.sessions])

  // Always poll — slow when idle (detects processing start), fast when processing
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!id) return
    const interval = isProcessing ? 2500 : 6000
    const run = () => {
      api.getAgentDetail(id).then(data => setDetail(data as AgentDetail)).catch(() => {})
    }
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(run, interval)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [isProcessing, id])

  // Convert active session data to the Session shape expected by SessionDetailModal
  function openLiveSession() {
    if (!activeSession || !detail) return
    const sessionForModal: Session = {
      id: activeSession.id,
      agentId: detail.id,
      agentName: detail.identity.name,
      status: activeSession.status as Session["status"],
      trigger: activeSession.type,
      model: detail.model,
      messageCount: activeSession.messageCount,
      totalTokens: 0,
      totalCost: 0,
    } as Session
    setViewingSession(sessionForModal)
  }

  const loadSkills = useCallback(async () => {
    if (!id) return
    setSkillsLoading(true)
    try {
      const data = await api.getAgentSkills(id)
      setSkills(data.skills || [])
    } catch { setSkills([]) }
    finally { setSkillsLoading(false) }
  }, [id])

  useEffect(() => { loadSkills() }, [loadSkills])

  const loadTools = useCallback(async () => {
    if (!id) return
    setToolsLoading(true)
    try {
      const data = await api.getAgentTools(id)
      setTools((data as { tools: AgentTool[] }).tools || [])
    } catch { setTools([]) }
    finally { setToolsLoading(false) }
  }, [id])

  useEffect(() => { loadTools() }, [loadTools])

  async function handleToggleSkill(skill: SkillInfo) {
    if (!id) return
    try {
      await api.toggleAgentSkill(id, skill.slug || skill.name, !skill.enabled)
      await loadSkills()
      setRestartReason(
        `Skill "${skill.name}" has been ${skill.enabled ? 'disabled' : 'enabled'} for this agent. Restart the gateway for the change to take effect on the next agent turn.`
      )
      setTimeout(() => setShowRestartDialog(true), 200)
    } catch (err) {
      console.error('Failed to toggle skill', err)
    }
  }

  async function handleToggleTool(tool: AgentTool) {
    if (!id) return
    try {
      await api.toggleAgentTool(id, tool.name, !tool.enabled)
      await loadTools()
      setRestartReason(
        `Tool "${tool.label}" has been ${tool.enabled ? 'denied' : 're-enabled'} for this agent. Restart the gateway for the change to take effect.`
      )
      setTimeout(() => setShowRestartDialog(true), 200)
    } catch (err) {
      console.error('Failed to toggle tool', err)
    }
  }

  function handleSaved(showRestart: boolean, newAgentId?: string) {
    setEditing(false)
    setSaveMsg("✓ Saved")
    setTimeout(() => setSaveMsg(""), 3000)
    if (newAgentId) {
      // Agent was renamed — navigate to new URL, loadDetail will run via useEffect
      navigate(`/agents/${newAgentId}`, { replace: true })
    } else {
      loadDetail()
      setFileRefreshKey(k => k + 1)
    }
    if (showRestart) {
      setRestartReason("Model or channel configuration changed. Restart the gateway for the new settings to take effect.")
      setTimeout(() => setShowRestartDialog(true), 300)
    }
  }

  return (
    <div className="flex flex-col min-h-0 h-full w-full">
      {/* Modals */}
      {editing && detail && <EditConfigModal detail={detail} onClose={() => setEditing(false)} onSaved={handleSaved} />}
      {showDeleteModal && detail && id && (
        <DeleteAgentModal
          agentId={id}
          agentName={detail.identity.name}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => navigate("/agents")}
        />
      )}
      {showRestartDialog && <RestartGatewayDialog onConfirm={() => api.restartGateway()} onDismiss={() => setShowRestartDialog(false)} reason={restartReason} />}
      {showCreateSkill && id && <CreateSkillDialog
        agentId={id}
        agentWorkspace={detail?.workspace?.path}
        onClose={() => setShowCreateSkill(false)}
        onCreated={(slug) => { setShowCreateSkill(false); loadSkills().then(() => setSelectedSkill(slug)) }}
      />}
      {showInstallSkill && (
        <InstallSkillModal
          onClose={() => setShowInstallSkill(false)}
          onInstalled={() => { setShowInstallSkill(false); loadSkills() }}
        />
      )}
      {viewingSession && <SessionDetailModal session={viewingSession} onClose={() => setViewingSession(null)} />}

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={loadDetail} className="text-xs text-primary hover:underline">Retry</button>
        </div>
      ) : detail ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* ── Back nav ── */}
          <button
            onClick={() => navigate("/agents")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors mb-2 shrink-0 self-start group"
          >
            <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
            Back to Registry
          </button>

          {/* ── Header Card (compact) ── */}
          <div className="px-3 py-2.5 bg-foreground/1 border border-border rounded-xl shrink-0 mb-3 shadow-sm">

            {/* Single row: avatar + name/meta + actions */}
            <div className="flex items-center gap-2.5">
              <AgentAvatar avatarPresetId={detail.profile?.avatarPresetId} emoji={detail.identity.emoji} size="w-9 h-9" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h2 className="text-sm font-display font-bold text-foreground tracking-tight leading-none truncate">{detail.identity.name}</h2>
                  <span className="text-[9px] font-mono text-muted-foreground/50 bg-foreground/5 px-1 py-0.5 rounded border border-border shrink-0">
                    {detail.id.toUpperCase()}
                  </span>
                  <span className={cn(
                    "text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border shrink-0",
                    isProcessing
                      ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/20 animate-pulse"
                      : "text-muted-foreground bg-foreground/5 border-foreground/10"
                  )}>
                    {isProcessing ? "LIVE" : detail.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground/60 min-w-0">
                  <Cpu className="w-2.5 h-2.5 shrink-0" />
                  <span className="font-mono text-primary/60 truncate">{detail.model}</span>
                  {detail.channel && (
                    <><span className="text-foreground/15">·</span>
                    <Globe className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{detail.channel.type}</span></>
                  )}
                </div>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={handleTestChat}
                  disabled={testingChat}
                  title={!gatewayConnected ? "Gateway offline" : "Test Chat"}
                  className={cn(
                    "w-7 h-7 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-50",
                    gatewayConnected
                      ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-500 hover:bg-emerald-500/25"
                      : "bg-foreground/5 border-foreground/10 text-muted-foreground/40"
                  )}
                >
                  {testingChat ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : gatewayConnected ? <MessageSquarePlus className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                </button>
                {canEdit && (
                  <button onClick={() => setEditing(true)} title="Edit Configuration"
                    className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/30 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={loadDetail}
                  className="w-7 h-7 rounded-lg border border-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                  <RefreshCw className="w-3 h-3" />
                </button>
                {canEdit && (
                  <button onClick={() => setShowDeleteModal(true)} title="Delete agent"
                    className="w-7 h-7 rounded-lg border border-red-500/20 flex items-center justify-center text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
                {!canEdit && (
                  <span title="Read-only — you are not the owner" className="px-2 h-7 rounded-lg bg-muted/50 border border-border text-[10px] text-muted-foreground inline-flex items-center gap-1">
                    <LockIcon className="w-3 h-3" /> Read-only
                  </span>
                )}
              </div>
            </div>

            {/* Stats — single scrollable row */}
            <div className="flex items-center gap-1.5 mt-2 overflow-x-auto scrollbar-none">
              <StatPill icon={Hash} label="Sessions" value={detail.stats.totalSessions} />
              <StatPill icon={MessageSquare} label="Messages" value={formatTokens(detail.stats.totalMessages)} />
              <StatPill icon={Wrench} label="Tools" value={formatTokens(detail.stats.totalToolCalls)} />
              <StatPill icon={Zap} label="Tokens" value={formatTokens(detail.stats.totalTokens)} />
              <StatPill icon={DollarSign} label="Cost" value={`$${detail.stats.totalCost.toFixed(2)}`} />
            </div>

            {/* ── Processing Banner ── */}
            {isProcessing && (
              <button
                onClick={openLiveSession}
                className="mt-2.5 w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 hover:bg-emerald-500/12 hover:border-emerald-500/30 transition-all cursor-pointer group"
              >
                <Activity className="w-4 h-4 text-emerald-400 animate-pulse shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-emerald-300">Agent is processing</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/15 px-1.5 py-0.5 rounded animate-pulse">LIVE</span>
                  </div>
                  <p className="text-[10px] text-emerald-400/60 truncate mt-0.5">
                    {activeSession?.lastMessage ?? (activeSession ? `${activeSession.name} — ${activeSession.messageCount} messages` : "Session in progress…")}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-emerald-400/70 group-hover:text-emerald-300 transition-colors shrink-0">
                  <span className="font-medium">Open Live View</span>
                  <ArrowRight className="w-3 h-3" />
                </div>
              </button>
            )}
          </div>

          {/* ── Body with tab navigation ── */}
          <div className="flex-1 min-h-0 flex flex-col bg-foreground/1 border border-border rounded-2xl overflow-hidden shadow-sm">

            {/* Tab bar */}
            <div className="flex items-center gap-0 px-3 border-b border-border bg-foreground/2 shrink-0 overflow-x-auto">
              {([
                { key: 'files',     label: 'Agent Files',    icon: FolderOpen },
                { key: 'skills',      label: 'Skills & Tools', icon: Sparkles   },
                { key: 'channels',    label: 'Channels',       icon: Link       },
                { key: 'connections', label: 'Connections',    icon: Plug       },
                { key: 'schedules',   label: 'Schedules',      icon: Timer      },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setBodyTab(key)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-all",
                    bodyTab === key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-foreground/20"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                  {key === 'channels' && (
                    <span className={cn(
                      "ml-1 w-1.5 h-1.5 rounded-full shrink-0",
                      gatewayConnected ? "bg-emerald-500" : "bg-foreground/20"
                    )} />
                  )}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 pr-2">
                {detail.stats.totalSessions > 0 && (
                  <span className="text-[10px] text-muted-foreground/40 font-mono">{detail.stats.totalSessions} sessions</span>
                )}
              </div>
            </div>

            {/* ═══ FILES TAB ═══ */}
            {bodyTab === 'files' && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="hidden md:flex items-center gap-2 px-5 py-3 border-b border-border bg-foreground/2 shrink-0">
                  {detail.workspace.hasCustomWorkspace && (
                    <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded uppercase tracking-wider">Custom Workspace</span>
                  )}
                  <button
                    onClick={() => setFileSidebarCollapsed(c => !c)}
                    title={fileSidebarCollapsed ? "Expand file list" : "Collapse file list"}
                    className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                  >
                    {fileSidebarCollapsed
                      ? <><PanelLeftOpen className="w-3.5 h-3.5" /><span>Expand</span></>
                      : <><PanelLeftClose className="w-3.5 h-3.5" /><span>Collapse</span></>
                    }
                  </button>
                </div>
                <div className="flex flex-1 min-h-0 overflow-hidden">
                  {/* File list
                      Mobile: always render; hide when a file is selected (full-screen preview)
                      Desktop: respect fileSidebarCollapsed; always show when file selected (both panels) */}
                  <div className={cn(
                    "border-r border-border shrink-0 py-1.5 overflow-y-auto",
                    // Mobile: full-width; desktop: fixed sidebar width
                    "w-full md:w-52",
                    // Mobile hide when viewing a file; desktop show unless collapsed
                    selectedFile ? "hidden md:block" : "block",
                    // Desktop collapse toggle (only applies at md+)
                    fileSidebarCollapsed && "md:hidden"
                  )}>
                      {WORKSPACE_FILES.map(file => {
                        const fileKey = file.replace(".md", "").toLowerCase()
                        const exists = !!detail.workspace.files[fileKey]
                        const isSelected = selectedFile === file
                        return (
                          <button
                            key={file}
                            onClick={() => setSelectedFile(file)}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors group",
                              isSelected
                                ? "bg-primary/10 border-r-2 border-primary text-foreground"
                                : exists
                                  ? "text-foreground/70 hover:bg-foreground/3 hover:text-foreground"
                                  : "text-foreground/25 hover:bg-foreground/3 hover:text-foreground/60"
                            )}
                          >
                            <span className={cn("text-base leading-none", !exists && "grayscale opacity-30")}>
                              {fileIcons[file] || "📄"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className={cn("text-[13px] font-mono font-medium block leading-tight", isSelected && "text-primary font-bold")}>{file}</span>
                              <span className="text-[10px] text-muted-foreground/50 leading-tight truncate block">
                                {exists ? fileDescriptions[file] : "Not found"}
                              </span>
                            </div>
                            {!exists && <FilePlus className="w-3.5 h-3.5 text-foreground/10 shrink-0" />}
                          </button>
                        )
                      })}
                  </div>
                  {/* Detail panel — on mobile only show when a file is selected */}
                  <div className={cn(
                    "flex-1 min-w-0 min-h-0 overflow-y-auto flex-col",
                    selectedFile ? "flex" : "hidden md:flex"
                  )}>
                    {/* Mobile back button */}
                    {selectedFile && (
                      <button
                        className="md:hidden flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground hover:text-foreground border-b border-border shrink-0 bg-foreground/2 w-full"
                        onClick={() => setSelectedFile(null)}
                      >
                        <ArrowLeft className="w-3 h-3" />
                        <span>Files</span>
                      </button>
                    )}
                    {selectedFile && id ? (
                      <InlineFilePanel key={`${selectedFile}-${fileRefreshKey}`} agentId={id} filename={selectedFile} onSaved={loadDetail} agentName={detail?.identity?.name || id} />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
                        <FileText className="w-10 h-10 mb-3 opacity-30" />
                        <p className="text-sm">Select a file to preview</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ SKILLS & TOOLS TAB ═══ */}
            {bodyTab === 'skills' && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* Sub-tab bar — responsive two-row layout on mobile */}
                <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-border bg-foreground/2 shrink-0">
                  {/* Sub-tab pills */}
                  <div className="flex items-center gap-0.5 rounded-lg bg-foreground/10 border border-border p-0.5 overflow-x-auto scrollbar-none">
                    <button
                      onClick={() => setActiveTab('skills')}
                      className={cn("flex-1 sm:flex-none px-3 py-1 rounded text-[11px] font-bold transition-all whitespace-nowrap",
                        activeTab === 'skills' ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground")}
                    >
                      Skills <span className={cn("ml-1 text-[9px] px-1 py-px rounded", activeTab === 'skills' ? "bg-primary/20 text-primary" : "bg-foreground/5 text-muted-foreground")}>{skills.length}</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('tools')}
                      className={cn("flex-1 sm:flex-none px-3 py-1 rounded text-[11px] font-bold transition-all whitespace-nowrap",
                        activeTab === 'tools' ? "bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-500/30" : "text-muted-foreground hover:text-foreground")}
                    >
                      Built-in <span className={cn("ml-1 text-[9px] px-1 py-px rounded", activeTab === 'tools' ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : "bg-foreground/5 text-muted-foreground")}>
                        {tools.filter(t => !t.enabled).length > 0 ? `${tools.filter(t => !t.enabled).length} denied` : tools.length}
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveTab('custom-tools')}
                      className={cn("flex-1 sm:flex-none px-3 py-1 rounded text-[11px] font-bold transition-all whitespace-nowrap",
                        activeTab === 'custom-tools' ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" : "text-muted-foreground hover:text-foreground")}
                    >
                      Custom {customToolsTotal > 0 && <span className={cn("ml-1 text-[9px] px-1 py-px rounded", activeTab === 'custom-tools' ? "bg-amber-500/20 text-amber-400" : "bg-foreground/5 text-muted-foreground")}>{customToolsTotal}</span>}
                    </button>
                  </div>
                  {/* Action buttons row */}
                  {activeTab === 'skills' && (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setSkillSidebarCollapsed(c => !c)}
                        className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
                        {skillSidebarCollapsed ? <><PanelLeftOpen className="w-3 h-3" /><span>Expand</span></> : <><PanelLeftClose className="w-3 h-3" /><span>Collapse</span></>}
                      </button>
                      <div className="ml-auto flex items-center gap-1.5">
                        <button onClick={() => setShowInstallSkill(true)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-400 font-medium hover:bg-amber-500/20 transition-colors">
                          <Download className="w-3 h-3" /> Install
                        </button>
                        <button onClick={() => setShowCreateSkill(true)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20 text-[11px] text-primary font-bold hover:bg-primary/20 transition-colors">
                          <Plus className="w-3 h-3" /> New
                        </button>
                      </div>
                    </div>
                  )}
                  {activeTab === 'tools' && (
                    <p className="text-[10px] text-muted-foreground/40 italic">Toggles write to tools.deny</p>
                  )}
                  {activeTab === 'custom-tools' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await api.syncAgentTaskScript(id!)
                            setSaveMsg("✓ Task script synced")
                            setTimeout(() => setSaveMsg(""), 3000)
                          } catch (e) {
                            setSaveMsg(`❌ Sync failed`)
                            setTimeout(() => setSaveMsg(""), 4000)
                          }
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-400 font-medium hover:bg-amber-500/20 transition-colors"
                      >
                        📋 Sync Task Script
                      </button>
                    </div>
                  )}
                </div>

                {activeTab === 'skills' && (
                  <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Skills list — full-width on mobile, hide when skill selected */}
                    <div className={cn(
                      "border-r border-border shrink-0 py-1.5 overflow-y-auto",
                      "w-full md:w-52",
                      // Mobile: hide when a skill is open (show detail full-screen)
                      selectedSkill ? "hidden md:block" : "block",
                      // Desktop: respect collapse toggle
                      skillSidebarCollapsed && "md:hidden"
                    )}>
                        {skillsLoading ? (
                          <div className="flex items-center justify-center h-full"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                        ) : skills.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                            <Package className="w-6 h-6 text-foreground/10 mb-2" />
                            <p className="text-[11px] text-muted-foreground">No skills installed</p>
                            <p className="text-[10px] text-muted-foreground/50 mt-1">Create one to get started</p>
                          </div>
                        ) : (() => {
                          const SOURCE_ORDER = ['workspace', 'project-agent', 'personal', 'managed']
                          const SOURCE_META: Record<string, { label: string; color: string; dot: string; borderColor: string }> = {
                            'workspace':     { label: 'Workspace',     color: 'text-blue-400',   dot: 'bg-blue-400',   borderColor: 'border-blue-500/20' },
                            'project-agent': { label: 'Project Agent', color: 'text-indigo-400', dot: 'bg-indigo-400', borderColor: 'border-indigo-500/20' },
                            'personal':      { label: 'Personal',      color: 'text-green-400',  dot: 'bg-green-400',  borderColor: 'border-green-500/20' },
                            'managed':       { label: 'Managed',       color: 'text-purple-400', dot: 'bg-purple-400', borderColor: 'border-purple-500/20' },
                          }
                          // Group skills by source, preserving SOURCE_ORDER, extras at end
                          const grouped = new Map<string, SkillInfo[]>()
                          for (const sk of skills) {
                            const key = SOURCE_ORDER.includes(sk.source) ? sk.source : 'extra'
                            if (!grouped.has(key)) grouped.set(key, [])
                            grouped.get(key)!.push(sk)
                          }
                          const orderedKeys = [...SOURCE_ORDER.filter(k => grouped.has(k)), ...(grouped.has('extra') ? ['extra'] : [])]

                          return orderedKeys.map(sourceKey => {
                            const groupSkills = grouped.get(sourceKey)!
                            const meta = SOURCE_META[sourceKey] ?? { label: groupSkills[0]?.sourceLabel ?? sourceKey, color: 'text-muted-foreground', dot: 'bg-foreground/30', borderColor: 'border-border' }
                            const isCollapsed = collapsedSkillGroups.has(sourceKey)
                            const toggleGroup = () => setCollapsedSkillGroups(prev => {
                              const next = new Set(prev)
                              next.has(sourceKey) ? next.delete(sourceKey) : next.add(sourceKey)
                              return next
                            })
                            // Max visible items before scroll: 5 items × ~36px each = 180px
                            const ITEM_H = 36
                            const MAX_VISIBLE = 8
                            const listHeight = Math.min(groupSkills.length, MAX_VISIBLE) * ITEM_H

                            return (
                              <div key={sourceKey} className={cn("border-b last:border-b-0", meta.borderColor)}>
                                {/* Collapsible group header */}
                                <button
                                  onClick={toggleGroup}
                                  className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-foreground/3 transition-colors group/header"
                                >
                                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", meta.dot)} />
                                  <span className={cn("text-[9px] font-bold uppercase tracking-widest flex-1 text-left", meta.color)}>{meta.label}</span>
                                  <span className="text-[9px] text-muted-foreground/40 mr-1">{groupSkills.length}</span>
                                  {isCollapsed
                                    ? <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover/header:text-muted-foreground/60 transition-colors" />
                                    : <ChevronDown className="w-3 h-3 text-muted-foreground/30 group-hover/header:text-muted-foreground/60 transition-colors" />
                                  }
                                </button>
                                {/* Scrollable skill list — max MAX_VISIBLE items then scrolls */}
                                {!isCollapsed && (
                                  <div
                                    className="overflow-y-auto"
                                    style={{ maxHeight: `${listHeight}px` }}
                                  >
                                    {groupSkills.map(skill => {
                                      const isSelected = selectedSkill === skill.slug
                                      return (
                                        <button key={skill.slug} onClick={() => setSelectedSkill(skill.slug)}
                                          className={cn("w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors group",
                                            isSelected ? "bg-primary/10 border-r-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-foreground/3")}>
                                          <span className="text-sm shrink-0">{skill.emoji || '⚡'}</span>
                                          <div className="min-w-0 flex-1">
                                            <span className="text-[12px] font-semibold block truncate">{skill.name}</span>
                                            {!skill.enabled && (
                                              <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-px rounded bg-amber-500/15 text-amber-400">Off</span>
                                            )}
                                          </div>
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })
                        })()}
                    </div>
                    {/* Skill detail — full-width on mobile, hidden when no skill selected */}
                    <div className={cn(
                      "min-w-0 min-h-0 flex flex-col overflow-hidden",
                      "flex-1",
                      !selectedSkill ? "hidden md:flex" : "flex"
                    )}>
                      {/* Mobile back button */}
                      {selectedSkill && (
                        <button
                          className="md:hidden flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground hover:text-foreground border-b border-border shrink-0 bg-foreground/2 w-full"
                          onClick={() => setSelectedSkill(null)}
                        >
                          <ArrowLeft className="w-3 h-3" /> Skills
                        </button>
                      )}
                      {selectedSkill && id ? (
                        <InlineSkillPanel agentId={id} skillSlug={selectedSkill}
                          skill={skills.find(s => s.slug === selectedSkill) || null}
                          onToggle={() => { const s = skills.find(sk => sk.slug === selectedSkill); if (s) handleToggleSkill(s) }}
                          onSaved={loadSkills}
                          agentName={detail?.identity?.name || id} />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center px-6">
                          <Sparkles className="w-8 h-8 text-foreground/8 mb-3" />
                          <p className="text-sm text-muted-foreground/60">Select a skill to view or edit</p>
                          <p className="text-[11px] text-muted-foreground/40 mt-1">Skills inject SKILL.md instructions into the agent</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'custom-tools' && id && (
                  <CustomToolsPanel agentId={id} onCountChange={setCustomToolsTotal} />
                )}

                {activeTab === 'tools' && (
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {toolsLoading ? (
                      <div className="flex items-center justify-center h-full"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                    ) : (() => {
                      const groups: Record<string, AgentTool[]> = {}
                      tools.forEach(t => { if (!groups[t.group]) groups[t.group] = []; groups[t.group].push(t) })
                      const groupMeta: Record<string, { label: string; color: string }> = {
                        runtime:    { label: '⚙️ Runtime',    color: 'text-orange-500' },
                        fs:         { label: '📁 File System', color: 'text-yellow-600' },
                        web:        { label: '🌐 Web',         color: 'text-sky-500' },
                        memory:     { label: '🧠 Memory',      color: 'text-purple-500' },
                        messaging:  { label: '💬 Messaging',   color: 'text-green-600' },
                        sessions:   { label: '🤝 Sessions',    color: 'text-blue-500' },
                        ui:         { label: '🎨 Media / UI',  color: 'text-pink-500' },
                        automation: { label: '🔁 Automation',  color: 'text-amber-600' },
                      }
                      return (
                        <div className="px-4 py-3 space-y-4">
                          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-violet-500/8 border border-violet-500/20">
                            <Wrench className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-violet-700 dark:text-violet-300/80 leading-relaxed">
                              These are <strong>built-in runtime tools</strong> independent of skills. Disabling here writes to <code className="font-mono bg-foreground/5 px-1 rounded">agents.list[].tools.deny</code> in openclaw.json.
                            </p>
                          </div>
                          {Object.entries(groups).map(([group, groupTools]) => {
                            const meta = groupMeta[group] || { label: group, color: 'text-muted-foreground' }
                            const deniedCount = groupTools.filter(t => !t.enabled).length
                            return (
                              <div key={group}>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className={cn("text-[11px] font-bold", meta.color)}>{meta.label}</span>
                                  {deniedCount > 0 && <span className="text-[9px] font-bold px-1.5 py-px rounded bg-red-500/15 text-red-400 border border-red-500/20">{deniedCount} denied</span>}
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  {groupTools.map(tool => (
                                    <button key={tool.name}
                                      onClick={() => !tool.deniedGlobally && handleToggleTool(tool)}
                                      disabled={tool.deniedGlobally}
                                      title={tool.deniedGlobally ? 'Denied globally' : tool.description}
                                      className={cn("flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-all",
                                        tool.enabled ? "bg-foreground/2 border-border hover:bg-foreground/5 hover:border-foreground/15" : "bg-red-500/5 border-red-500/20 opacity-75 hover:opacity-90",
                                        tool.deniedGlobally && "cursor-not-allowed")}>
                                      <div className="min-w-0">
                                        <span className={cn("text-[11px] font-mono font-semibold block", tool.enabled ? "text-foreground" : "text-red-400 line-through")}>{tool.name}</span>
                                        {tool.deniedGlobally && <span className="text-[9px] text-muted-foreground">global deny</span>}
                                      </div>
                                      <div className={cn("w-7 h-4 rounded-full shrink-0 flex items-center transition-colors",
                                        tool.enabled ? "bg-emerald-500/60 justify-end" : "bg-red-500/40 justify-start",
                                        tool.deniedGlobally && "opacity-30")}>
                                        <div className={cn("w-3 h-3 rounded-full mx-0.5 transition-colors", tool.enabled ? "bg-emerald-500" : "bg-red-500")} />
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ═══ CHANNELS TAB ═══ */}
            {bodyTab === 'channels' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="px-4 py-4 space-y-4">
                  {id && (
                    <ChannelsPanel
                      agentId={id}
                      gatewayConnected={gatewayConnected}
                      onRestart={() => {
                        setRestartReason("Channel configuration changed. Restart the gateway for the new settings to take effect.")
                        setTimeout(() => setShowRestartDialog(true), 200)
                      }}
                    />
                  )}
                  <div className="bg-card rounded-xl border border-border px-5 py-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center bg-primary/10">
                        <MessageSquare className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <h3 className="text-[13px] font-bold text-foreground">Recent Sessions</h3>
                      <span className="text-[10px] font-medium text-muted-foreground bg-foreground/5 px-2 py-0.5 rounded ml-auto">
                        {detail.sessions.length} total
                      </span>
                    </div>
                    {detail.sessions.length > 0 ? (
                      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-foreground/10 scrollbar-track-transparent">
                        {detail.sessions.slice(0, 8).map((sess) => {
                          const isActive = sess.status === "active"
                          const handleClick = () => {
                            setViewingSession({
                              id: sess.id, agentId: detail.id, agentName: detail.identity.name,
                              status: sess.status, trigger: sess.type, model: detail.model,
                              messageCount: sess.messageCount, totalTokens: 0, totalCost: 0,
                            } as Session)
                          }
                          return (
                            <button key={sess.id} onClick={handleClick}
                              className={cn("flex flex-col gap-1.5 px-3.5 py-3 rounded-lg border text-left transition-all group shrink-0 w-56",
                                isActive 
                                  ? "bg-emerald-500/5 border-emerald-500/30 hover:bg-emerald-500/10 shadow-sm" 
                                  : "bg-foreground/2 border-border hover:bg-foreground/5 hover:border-foreground/20")}>
                              <div className="flex items-center gap-2 w-full">
                                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", isActive ? "bg-emerald-500 animate-pulse" : "bg-foreground/20")} />
                                <span className="text-[10px] font-mono font-medium text-muted-foreground group-hover:text-foreground/70 transition-colors truncate">{fmtTime(sess.updatedAt)}</span>
                                {isActive && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold uppercase rounded-sm animate-pulse ml-0.5">Live</span>}
                                <ArrowRight className="w-3 h-3 text-transparent group-hover:text-muted-foreground/50 ml-auto shrink-0 transition-colors" />
                              </div>
                              <p className="text-[12px] text-foreground/80 font-medium line-clamp-2 leading-snug group-hover:text-foreground transition-colors mt-0.5">
                                {sess.lastMessage || `${sess.name} — ${sess.messageCount} messages`}
                              </p>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground/50 border border-dashed border-border rounded-lg bg-foreground/2">
                        <MessageSquare className="w-5 h-5 mb-2 opacity-50" />
                        <span className="text-[11px] font-medium">No recent activity</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ CONNECTIONS TAB ═══ */}
            {bodyTab === 'connections' && id && (
              <AgentConnectionsTab agentId={id} />
            )}

            {/* ═══ SCHEDULES TAB ═══ */}
            {bodyTab === 'schedules' && id && (
              <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
                <CronPage filterAgentId={id} />
              </div>
            )}

          </div>
        </div>
      ) : null}
    </div>
  )
}
