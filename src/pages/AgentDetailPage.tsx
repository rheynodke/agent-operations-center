import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { chatApi } from "@/lib/chat-api"
import { useChatStore } from "@/stores/useChatStore"
import type { SkillInfo, AgentTool, Session, SkillScript } from "@/types"
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
} from "lucide-react"
import { AvatarPicker } from "@/components/agents/AvatarPicker"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"

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

const WORKSPACE_FILES = ["IDENTITY.md", "SOUL.md", "TOOLS.md", "AGENTS.md", "USER.md", "BOOTSTRAP.md"] as const

const fileDescriptions: Record<string, string> = {
  "IDENTITY.md": "Agent persona — name, emoji, creature, vibe",
  "SOUL.md": "Core personality traits and behavioral guidelines",
  "TOOLS.md": "Available tools and integrations",
  "AGENTS.md": "Multi-agent collaboration patterns",
  "USER.md": "User context — preferences and projects",
  "BOOTSTRAP.md": "One-time first-run setup ritual",
}

const fileIcons: Record<string, string> = {
  "IDENTITY.md": "🎭",
  "SOUL.md": "🧬",
  "TOOLS.md": "🔧",
  "AGENTS.md": "🤝",
  "USER.md": "👤",
  "BOOTSTRAP.md": "🚀",
}

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
/*  INLINE FILE VIEWER / EDITOR                                        */
/* ─────────────────────────────────────────────────────────────────── */

function InlineFilePanel({
  agentId,
  filename,
  onSaved,
}: {
  agentId: string
  filename: string
  onSaved: () => void
}) {
  const [content, setContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [isGlobal, setIsGlobal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    setSaved(false)
    setEditMode(false)
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
        setError((err as Error).message)
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
              {isDirty && (
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
              <button
                onClick={() => { setContent(originalContent); setEditMode(false) }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-foreground/10 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <X className="w-3 h-3" /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!isDirty || saving}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/20 border border-primary/30 text-[11px] text-primary font-bold hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-foreground/10 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>
      </div>

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

  async function handleDelete() {
    if (!selected || !confirm(`Delete ${selected}?`)) return
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
                  <button onClick={handleDelete} disabled={deleting} title="Delete script" className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
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
}: {
  agentId: string
  skillSlug: string
  skill: SkillInfo | null
  onToggle: () => void
  onSaved: () => void
}) {
  const [content, setContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [editMode, setEditMode] = useState(false)
  const [editable, setEditable] = useState(false)
  const [skillTab, setSkillTab] = useState<'skillmd' | 'scripts'>('skillmd')
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

          {skillTab === 'skillmd' && editable && (
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
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
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
        ) : (
          <SkillScriptsPanel
            agentId={agentId}
            skillSlug={skillSlug}
            onSkillMdUpdated={() => { reloadSkillMd(); onSaved() }}
          />
        )}
      </div>
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
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [scope, setScope] = useState("workspace")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-")

  // Compute path preview based on scope
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

  async function handleCreate() {
    if (!slug) { setError("Name is required"); return }

    const desc = description.trim() || name.trim()
    const content = [
      `---`,
      `name: ${slug}`,
      `description: ${desc}`,
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
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-foreground/20 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-foreground/10 rounded-2xl shadow-2xl w-[460px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-bold text-foreground">Create New Skill</h2>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
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

            {/* Path preview */}
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
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors">
            Cancel
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
    </div>
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
}

function EditConfigModal({
  detail,
  onClose,
  onSaved,
}: {
  detail: AgentDetail
  onClose: () => void
  onSaved: (showRestart: boolean) => void
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

      if (Object.keys(updates).length === 0 && cfg.avatarPresetId === (detail.profile?.avatarPresetId ?? "")) {
        onClose(); return
      }

      if (Object.keys(updates).length > 0) {
        await api.updateAgent(orig.id, updates)
      }

      // Save avatar to SQLite profile separately
      if (cfg.avatarPresetId !== (detail.profile?.avatarPresetId ?? "")) {
        const preset = AVATAR_PRESETS.find(p => p.id === cfg.avatarPresetId)
        await api.updateAgentProfile(orig.id, {
          avatarPresetId: cfg.avatarPresetId || undefined,
          color: preset?.color ?? undefined,
        })
      }

      const needsRestart = !!(updates.model || updates.channel)
      onSaved(needsRestart)
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
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Streaming Mode" value={cfg.channelStreaming} onChange={v => setCfg(c => ({ ...c, channelStreaming: v }))} options={streamingOptions} />
                <SelectField label="DM Policy" value={cfg.channelDmPolicy} onChange={v => setCfg(c => ({ ...c, channelDmPolicy: v }))} options={dmPolicyOptions} />
              </div>
            </div>
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
/*  MAIN PAGE                                                          */
/* ─────────────────────────────────────────────────────────────────── */

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Modals
  const [editing, setEditing] = useState(false)
  const [showRestartDialog, setShowRestartDialog] = useState(false)
  const [restartReason, setRestartReason] = useState("")
  const [saveMsg, setSaveMsg] = useState("")
  const [testingChat, setTestingChat] = useState(false)

  // File explorer
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // Skills
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [showCreateSkill, setShowCreateSkill] = useState(false)
  const [skillsLoading, setSkillsLoading] = useState(false)

  // Built-in tools
  const [tools, setTools] = useState<AgentTool[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)

  // Active tab in Skills & Tools panel
  const [activeTab, setActiveTab] = useState<'skills' | 'tools'>('skills')

  // Sidebar collapse states
  const [fileSidebarCollapsed, setFileSidebarCollapsed] = useState(false)
  const [skillSidebarCollapsed, setSkillSidebarCollapsed] = useState(false)

  // Live session monitoring
  const [viewingSession, setViewingSession] = useState<Session | null>(null)

  const handleTestChat = useCallback(async () => {
    if (!id || testingChat) return
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
      alert(`Failed to start test chat: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setTestingChat(false)
    }
  }, [id, testingChat, navigate])

  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError("")
    try {
      const data = await api.getAgentDetail(id) as AgentDetail
      setDetail(data)
      // Auto-select first existing file
      if (!selectedFile) {
        const first = WORKSPACE_FILES.find(f => data.workspace.files[f.replace(".md", "").toLowerCase()])
        if (first) setSelectedFile(first)
      }
    } catch (err) {
      setError((err as Error).message || "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [id, selectedFile])

  useEffect(() => { loadDetail() }, [loadDetail])

  // Detect if agent is currently processing
  const isProcessing = detail?.status === "active"

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

  function handleSaved(showRestart: boolean) {
    setEditing(false)
    setSaveMsg("✓ Saved")
    setTimeout(() => setSaveMsg(""), 3000)
    loadDetail()
    if (showRestart) {
      setRestartReason("Model or channel configuration changed. Restart the gateway for the new settings to take effect.")
      setTimeout(() => setShowRestartDialog(true), 300)
    }
  }

  return (
    <div className="flex flex-col min-h-0 h-full w-full">
      {/* Modals */}
      {editing && detail && <EditConfigModal detail={detail} onClose={() => setEditing(false)} onSaved={handleSaved} />}
      {showRestartDialog && <RestartGatewayDialog onConfirm={() => api.restartGateway()} onDismiss={() => setShowRestartDialog(false)} reason={restartReason} />}
      {showCreateSkill && id && <CreateSkillDialog
        agentId={id}
        agentWorkspace={detail?.workspace?.path}
        onClose={() => setShowCreateSkill(false)}
        onCreated={(slug) => { setShowCreateSkill(false); loadSkills().then(() => setSelectedSkill(slug)) }}
      />}
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

          {/* ── Header Card ── */}
          <div className="px-4 py-3 bg-foreground/1 border border-border rounded-xl shrink-0 mb-3 shadow-sm">
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <AgentAvatar
                avatarPresetId={detail.profile?.avatarPresetId}
                emoji={detail.identity.emoji}
                size="w-11 h-11"
              />
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h2 className="text-lg font-display font-bold text-foreground tracking-tight leading-none">{detail.identity.name}</h2>
                  <span className="text-[10px] font-mono text-muted-foreground/60 bg-foreground/5 px-1.5 py-0.5 rounded border border-border shrink-0">ID: {detail.id.toUpperCase()}</span>
                  <span className={cn(
                    "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border shrink-0 transition-all",
                    isProcessing
                      ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/20 animate-pulse"
                      : "text-muted-foreground bg-foreground/5 border-foreground/10"
                  )}>
                    {isProcessing && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse" />}
                    {isProcessing ? "LIVE" : detail.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1 font-mono text-primary/70 shrink-0"><Cpu className="w-3 h-3" />{detail.model}</span>
                  {detail.channel && (
                    <span className="flex items-center gap-1 shrink-0"><Globe className="w-3 h-3 text-primary/50" />{detail.channel.type} ({detail.channel.accountId})</span>
                  )}
                  {detail.identity.vibe && (
                    <span className="italic text-muted-foreground/40 truncate hidden sm:block max-w-xs">"{detail.identity.vibe}"</span>
                  )}
                </div>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                {saveMsg && <span className="text-xs font-medium text-emerald-400 mr-1">{saveMsg}</span>}
                <button onClick={loadDetail} className="w-7 h-7 rounded-lg border border-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleTestChat}
                  disabled={testingChat}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-xs text-emerald-400 font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {testingChat
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <MessageSquarePlus className="w-3.5 h-3.5" />
                  }
                  {testingChat ? "Starting…" : "Test Chat"}
                </button>
                <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 border border-primary/30 text-xs text-primary font-semibold hover:bg-primary/30 transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> Edit Configuration
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              <StatPill icon={Hash} label="Sessions" value={detail.stats.totalSessions} />
              <StatPill icon={MessageSquare} label="Messages" value={formatTokens(detail.stats.totalMessages)} />
              <StatPill icon={Wrench} label="Tool Calls" value={formatTokens(detail.stats.totalToolCalls)} />
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

          {/* ── Body ── */}
          <div className="flex-1 min-h-0 flex flex-col gap-4">

            {/* ═══ Main 2-column: Agent Files | Skills & Tools ═══ */}
            <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-4">

              {/* ── AGENT FILES ── */}
              <div className="flex-1 min-h-0 min-w-0 bg-foreground/1 border border-border rounded-2xl overflow-hidden shadow-sm flex flex-col">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-foreground/2 shrink-0">
                  <FolderOpen className="w-4 h-4 text-primary/60" />
                  <h3 className="text-sm font-display font-bold text-foreground">Agent Files</h3>
                  {detail.workspace.hasCustomWorkspace && (
                    <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded uppercase tracking-wider ml-2">Custom Workspace</span>
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
                  {/* File list sidebar */}
                  {!fileSidebarCollapsed && (
                    <div className="w-52 border-r border-border shrink-0 py-1.5 overflow-y-auto">
                      {WORKSPACE_FILES.map(file => {
                        const fileKey = file.replace(".md", "").toLowerCase()
                        const exists = !!detail.workspace.files[fileKey]
                        const isSelected = selectedFile === file
                        return (
                          <button
                            key={file}
                            onClick={() => exists && setSelectedFile(file)}
                            disabled={!exists}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors group",
                              isSelected
                                ? "bg-primary/10 border-r-2 border-primary text-foreground"
                                : exists
                                  ? "text-foreground/70 hover:bg-foreground/3 hover:text-foreground"
                                  : "text-foreground/15 cursor-not-allowed"
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
                            {!exists && (
                              <FilePlus className="w-3.5 h-3.5 text-foreground/10 shrink-0" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* File content panel */}
                  <div className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col">
                    {selectedFile && id ? (
                      <InlineFilePanel
                        key={selectedFile}
                        agentId={id}
                        filename={selectedFile}
                        onSaved={loadDetail}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
                        <FileText className="w-10 h-10 mb-3 opacity-30" />
                        <p className="text-sm">Select a file to preview</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── SKILLS & TOOLS ── */}
              <div className="flex-1 min-h-0 min-w-0 bg-foreground/1 rounded-2xl border border-border overflow-hidden shadow-sm flex flex-col">
                {/* Header with tab switcher */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-foreground/2 shrink-0">
                  <Sparkles className="w-4 h-4 text-primary/60" />
                  <div className="flex items-center gap-0.5 rounded-lg bg-foreground/10 border border-border p-0.5">
                    <button
                      onClick={() => setActiveTab('skills')}
                      className={cn(
                        "px-3 py-1 rounded text-[11px] font-bold transition-all",
                        activeTab === 'skills'
                          ? "bg-primary/20 text-primary border border-primary/30"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Skills
                      <span className={cn("ml-1.5 text-[9px] px-1 py-px rounded", activeTab === 'skills' ? "bg-primary/20 text-primary" : "bg-foreground/5 text-muted-foreground")}>{skills.length}</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('tools')}
                      className={cn(
                        "px-3 py-1 rounded text-[11px] font-bold transition-all",
                        activeTab === 'tools'
                          ? "bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-500/30"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Tools
                      <span className={cn("ml-1.5 text-[9px] px-1 py-px rounded", activeTab === 'tools' ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : "bg-foreground/5 text-muted-foreground")}>
                        {tools.filter(t => !t.enabled).length > 0 ? `${tools.filter(t => !t.enabled).length} denied` : tools.length}
                      </span>
                    </button>
                  </div>
                  {activeTab === 'skills' && (
                    <>
                      <button
                        onClick={() => setSkillSidebarCollapsed(c => !c)}
                        title={skillSidebarCollapsed ? "Expand skill list" : "Collapse skill list"}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                      >
                        {skillSidebarCollapsed
                          ? <><PanelLeftOpen className="w-3.5 h-3.5" /><span>Expand</span></>
                          : <><PanelLeftClose className="w-3.5 h-3.5" /><span>Collapse</span></>
                        }
                      </button>
                      <button
                        onClick={() => setShowCreateSkill(true)}
                        className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20 text-[11px] text-primary font-bold hover:bg-primary/20 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> New Skill
                      </button>
                    </>
                  )}
                  {activeTab === 'tools' && (
                    <span className="ml-auto text-[10px] text-muted-foreground/50 italic">Toggles write to tools.deny</span>
                  )}
                </div>

                {/* ── SKILLS TAB ── */}
                {activeTab === 'skills' && (
                  <div className="flex flex-1 min-h-0 overflow-hidden">
                    {!skillSidebarCollapsed && (
                      <div className="w-52 border-r border-border shrink-0 py-1.5 overflow-y-auto">
                        {skillsLoading ? (
                          <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : skills.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                            <Package className="w-6 h-6 text-foreground/10 mb-2" />
                            <p className="text-[11px] text-muted-foreground">No skills installed</p>
                            <p className="text-[10px] text-muted-foreground/50 mt-1">Create one to get started</p>
                          </div>
                        ) : (
                          skills.map(skill => {
                            const isSelected = selectedSkill === skill.slug
                            return (
                              <button
                                key={skill.slug}
                                onClick={() => setSelectedSkill(skill.slug)}
                                className={cn(
                                  "w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors group",
                                  isSelected
                                    ? "bg-primary/10 border-r-2 border-primary text-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/3"
                                )}
                              >
                                <span className="text-sm shrink-0">{skill.emoji || '⚡'}</span>
                                <div className="min-w-0 flex-1">
                                  <span className="text-[12px] font-semibold block truncate">{skill.name}</span>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className={cn(
                                      "text-[8px] font-bold uppercase tracking-wider px-1 py-px rounded",
                                      skill.source === 'workspace' ? "bg-blue-500/15 text-blue-400" :
                                      skill.source === 'managed' ? "bg-purple-500/15 text-purple-400" :
                                      skill.source === 'personal' ? "bg-green-500/15 text-green-400" :
                                      "bg-foreground/5 text-muted-foreground/70"
                                    )}>{skill.sourceLabel}</span>
                                    {!skill.enabled && (
                                      <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-px rounded bg-amber-500/15 text-amber-400">Off</span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            )
                          })
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
                      {selectedSkill && id ? (
                        <InlineSkillPanel
                          agentId={id}
                          skillSlug={selectedSkill}
                          skill={skills.find(s => s.slug === selectedSkill) || null}
                          onToggle={() => { const s = skills.find(sk => sk.slug === selectedSkill); if (s) handleToggleSkill(s) }}
                          onSaved={loadSkills}
                        />
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

                {/* ── TOOLS TAB ── */}
                {activeTab === 'tools' && (
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {toolsLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (() => {
                      const groups: Record<string, AgentTool[]> = {}
                      tools.forEach(t => {
                        if (!groups[t.group]) groups[t.group] = []
                        groups[t.group].push(t)
                      })
                      const groupMeta: Record<string, { label: string; color: string }> = {
                        runtime:    { label: '⚙️ Runtime',    color: 'text-orange-500' },
                        fs:         { label: '📁 File System', color: 'text-yellow-600' },
                        web:        { label: '🌐 Web',          color: 'text-sky-500' },
                        memory:     { label: '🧠 Memory',       color: 'text-purple-500' },
                        messaging:  { label: '💬 Messaging',    color: 'text-green-600' },
                        sessions:   { label: '🤝 Sessions',     color: 'text-blue-500' },
                        ui:         { label: '🎨 Media / UI',   color: 'text-pink-500' },
                        automation: { label: '🔁 Automation',   color: 'text-amber-600' },
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
                                  {deniedCount > 0 && (
                                    <span className="text-[9px] font-bold px-1.5 py-px rounded bg-red-500/15 text-red-400 border border-red-500/20">{deniedCount} denied</span>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  {groupTools.map(tool => (
                                    <button
                                      key={tool.name}
                                      onClick={() => !tool.deniedGlobally && handleToggleTool(tool)}
                                      disabled={tool.deniedGlobally}
                                      title={tool.deniedGlobally ? 'Denied globally — change in global tools config' : tool.description}
                                      className={cn(
                                        "flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-all",
                                        tool.enabled
                                          ? "bg-foreground/2 border-border hover:bg-foreground/5 hover:border-foreground/15"
                                          : "bg-red-500/5 border-red-500/20 opacity-75 hover:opacity-90",
                                        tool.deniedGlobally && "cursor-not-allowed"
                                      )}
                                    >
                                      <div className="min-w-0">
                                        <span className={cn("text-[11px] font-mono font-semibold block", tool.enabled ? "text-foreground" : "text-red-400 line-through")}>
                                          {tool.name}
                                        </span>
                                        {tool.deniedGlobally && (
                                          <span className="text-[9px] text-muted-foreground">global deny</span>
                                        )}
                                      </div>
                                      <div className={cn(
                                        "w-7 h-4 rounded-full shrink-0 flex items-center transition-colors",
                                        tool.enabled ? "bg-emerald-500/60 justify-end" : "bg-red-500/40 justify-start",
                                        tool.deniedGlobally && "opacity-30"
                                      )}>
                                        <div className={cn(
                                          "w-3 h-3 rounded-full mx-0.5 transition-colors",
                                          tool.enabled ? "bg-emerald-500" : "bg-red-500"
                                        )} />
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
            </div>

            {/* ═══ Recent Sessions — compact horizontal strip ═══ */}
            <div className="shrink-0 bg-foreground/1 rounded-xl border border-border px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                <h3 className="text-xs font-display font-bold text-foreground">Recent Sessions</h3>
                <span className="text-[9px] text-muted-foreground/50 ml-auto">{detail.sessions.length} total</span>
              </div>
              {detail.sessions.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                  {detail.sessions.slice(0, 8).map((sess) => {
                    const isActive = sess.status === "active"
                    const handleClick = () => {
                      const sessionForModal: Session = {
                        id: sess.id,
                        agentId: detail.id,
                        agentName: detail.identity.name,
                        status: sess.status,
                        trigger: sess.type,
                        model: detail.model,
                        messageCount: sess.messageCount,
                        totalTokens: 0,
                        totalCost: 0,
                      } as Session
                      setViewingSession(sessionForModal)
                    }
                    return (
                      <button
                        key={sess.id}
                        onClick={handleClick}
                        className={cn(
                          "flex flex-col gap-1 px-3 py-2 rounded-lg border text-left transition-all group shrink-0 w-52",
                          isActive
                            ? "bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/8"
                            : "bg-foreground/2 border-border hover:bg-foreground/4 hover:border-foreground/15"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            isActive ? "bg-emerald-400 animate-pulse" : "bg-foreground/20"
                          )} />
                          <span className="text-[10px] font-mono text-muted-foreground/70">{fmtTime(sess.updatedAt)}</span>
                          {isActive && <span className="text-[8px] px-1 py-px bg-emerald-500/20 text-emerald-400 font-bold uppercase rounded animate-pulse ml-0.5">Live</span>}
                          <ArrowRight className="w-2.5 h-2.5 text-transparent group-hover:text-muted-foreground/50 ml-auto transition-colors" />
                        </div>
                        <p className="text-[11px] text-foreground/70 font-medium line-clamp-1 leading-tight group-hover:text-foreground transition-colors">
                          {sess.lastMessage || `${sess.name} — ${sess.messageCount} messages`}
                        </p>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-2 py-1 text-muted-foreground/40">
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-xs">No recent activity</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
