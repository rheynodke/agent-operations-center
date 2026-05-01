import { useState, useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import {
  BookOpen, Wrench, Search, RefreshCw, ChevronRight,
  Globe, FolderGit2, User, Package, Boxes, Key, Settings2,
  CheckCircle2, XCircle, Layers, AlertCircle, Edit3, Save,
  X, Loader2, Plus, Sparkles, ScrollText, Terminal, Download, History, Trash2,
  Wand2, LayoutTemplate, FolderOpen, FileText, FileCode2, ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { SkillFileNode } from "@/lib/api"
import { useAgentStore } from "@/stores"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { CustomToolsTab } from "@/components/skills/CustomToolsTab"
import { InstallSkillModal } from "@/components/skills/InstallSkillModal"
import { SkillsTerminal } from "@/components/skills/SkillsTerminal"
import { useCanUseClaudeTerminal } from "@/lib/permissions"
import { VersionHistoryPanel } from "@/components/versioning/VersionHistoryPanel"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { AiAssistPanel } from "@/components/ai/AiAssistPanel"
import { TemplatePicker } from "@/components/ai/TemplatePicker"
import { SkillTemplatePicker, SKILL_TEMPLATES, type SkillTemplate } from "@/components/skills/SkillTemplatePicker"
import type { GlobalSkillInfo, GlobalToolInfo, ToolGroup } from "@/types"

// ─── Source config ────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  workspace:       { label: "Workspace",     icon: FolderGit2, color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20" },
  "project-agent": { label: "Project Agent", icon: Boxes,      color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  personal:        { label: "Personal",      icon: User,       color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/20" },
  managed:         { label: "Managed",       icon: Package,    color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20" },
}

function getSourceConfig(source: string) {
  return SOURCE_CONFIG[source] ?? { label: source, icon: Globe, color: "text-muted-foreground", bg: "bg-muted/10 border-muted/20" }
}

const GROUP_CONFIG: Record<ToolGroup, { label: string; emoji: string }> = {
  runtime:    { label: "Runtime",     emoji: "⚙️" },
  fs:         { label: "File System", emoji: "📁" },
  web:        { label: "Web",         emoji: "🌐" },
  memory:     { label: "Memory",      emoji: "🧠" },
  messaging:  { label: "Messaging",   emoji: "💬" },
  sessions:   { label: "Sessions",    emoji: "🔗" },
  ui:         { label: "Media / UI",  emoji: "🎨" },
  automation: { label: "Automation",  emoji: "🤖" },
}

// ─── Shared badges ────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const cfg = getSourceConfig(source)
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border", cfg.bg, cfg.color)}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  )
}

function AgentChip({ avatarPresetId, emoji, name, enabled }: { avatarPresetId?: string | null; emoji: string; name: string; enabled: boolean }) {
  return (
    <span
      title={`${name}: ${enabled ? "enabled" : "disabled"}`}
      className={cn(
        "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[10px] border transition-colors",
        enabled
          ? "bg-status-active/20 border-status-active/30 text-status-active-text"
          : "bg-muted/10 border-white/5 text-muted-foreground/50 line-through"
      )}
    >
      <AgentAvatar avatarPresetId={avatarPresetId} emoji={emoji} size="w-4 h-4" className="rounded-full" />
      <span>{name}</span>
    </span>
  )
}

// ─── Create Skill Modal ───────────────────────────────────────────────────────

const SCOPES = [
  { id: "workspace", label: "Workspace",    desc: "Default agent workspace",   icon: "🤖", color: "bg-blue-500/10 border-blue-500/30 text-blue-400" },
  { id: "agent",     label: "Project Agent",desc: "Shared across project",      icon: "📁", color: "bg-green-500/10 border-green-500/30 text-green-400" },
  { id: "global",    label: "Global",        desc: "All agents can use",         icon: "🌐", color: "bg-purple-500/10 border-purple-500/30 text-purple-400" },
]

function CreateSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: (slug: string) => void }) {
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
    switch (scope) {
      case "workspace": return `~/.openclaw/workspace/skills/${slug}/`
      case "agent":     return `~/.openclaw/workspace/.agents/skills/${slug}/`
      case "global":    return `~/.openclaw/skills/${slug}/`
      default:          return null
    }
  })()

  function handlePickTemplate(tpl: SkillTemplate) {
    setSelectedTemplate(tpl)
    if (tpl.suggestedSlug && !name) setName(tpl.suggestedSlug)
    if (tpl.suggestedDescription && !description) setDescription(tpl.suggestedDescription)
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
      await api.createGlobalSkill(slug, scope, content)
      onCreated(slug)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-card border border-white/10 rounded-2xl shadow-2xl w-[500px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
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
            <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
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
                  <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-[12px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
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

                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Skill Name</label>
                  <input
                    value={name}
                    onChange={e => { setName(e.target.value); setError("") }}
                    onKeyDown={e => e.key === "Enter" && handleCreate()}
                    placeholder="my-custom-skill"
                    autoFocus
                    className="w-full px-3 py-2 rounded-lg bg-white/3 border border-white/10 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-colors"
                  />
                  {slug && name !== slug && (
                    <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
                      Folder: <span className="text-primary/70">{slug}/</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">
                    Description <span className="normal-case text-muted-foreground/40">(optional)</span>
                  </label>
                  <input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="What does this skill do?"
                    className="w-full px-3 py-2 rounded-lg bg-white/3 border border-white/10 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Scope</label>
                  <div className="grid grid-cols-3 gap-2">
                    {SCOPES.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setScope(s.id)}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all",
                          scope === s.id ? s.color : "border-white/8 bg-white/2 text-muted-foreground hover:bg-white/5 hover:border-white/15"
                        )}
                      >
                        <span className="text-lg">{s.icon}</span>
                        <span className="text-[11px] font-semibold">{s.label}</span>
                        <span className="text-[9px] opacity-60">{s.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {pathPreview && (
                  <p className="text-[10px] text-muted-foreground/50 font-mono bg-white/2 rounded-lg px-3 py-2 border border-white/5 break-all">
                    {pathPreview}
                  </p>
                )}

                {error && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {error}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={() => setStep("pick")} className="flex-1 py-2 rounded-xl border border-white/10 text-[12px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                    ← Back
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!slug || saving}
                    className="flex-1 py-2 rounded-xl bg-primary/20 border border-primary/30 text-[12px] text-primary font-bold hover:bg-primary/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {saving ? "Creating…" : "Create Skill"}
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
            // Extract slug from frontmatter name field
            const slugMatch = content.match(/^---[\s\S]*?\nname:\s*([^\s\n]+)/)
            const extractedSlug = slugMatch?.[1]?.trim() || ""
            const fakeTpl: SkillTemplate = {
              id: "adlc-custom",
              name: _name,
              icon: "📄",
              description: "",
              category: "workflow",
              suggestedSlug: extractedSlug,
              suggestedDescription: "",
              content,
            }
            setShowAdlcPicker(false)
            setSelectedTemplate(fakeTpl)
            if (extractedSlug && !name) setName(extractedSlug)
            setStep("form")
          }}
          onClose={() => setShowAdlcPicker(false)}
        />
      )}
    </>
  )
}

// ─── Skill SKILL.md Editor ────────────────────────────────────────────────────

function SkillMdEditor({ slug, editable, onSaved }: { slug: string; editable: boolean; onSaved: () => void }) {
  const [content, setContent] = useState("")
  const [original, setOriginal] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [externalChange, setExternalChange] = useState(false)
  const [error, setError] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editModeRef = useRef(editMode)
  editModeRef.current = editMode

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    setEditMode(false)
    setExternalChange(false)
    api.getGlobalSkillFile(slug)
      .then(data => {
        if (cancelled) return
        setContent(data.content)
        setOriginal(data.content)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError((err as Error).message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [slug])

  // Live-reload: refetch this file when a `skills:updated` event fires.
  // If the user is mid-edit, don't clobber their changes — just surface a
  // "modified on disk" hint they can choose to reload from.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onUpdate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        try {
          const data = await api.getGlobalSkillFile(slug)
          if (editModeRef.current) {
            setExternalChange(data.content !== original)
          } else {
            setContent(data.content)
            setOriginal(data.content)
          }
        } catch { /* ignore transient errors */ }
      }, 300)
    }
    window.addEventListener("aoc:skills-updated", onUpdate)
    return () => {
      window.removeEventListener("aoc:skills-updated", onUpdate)
      if (timer) clearTimeout(timer)
    }
  }, [slug, original])

  useEffect(() => {
    if (editMode && textareaRef.current) textareaRef.current.focus()
  }, [editMode])

  const isDirty = content !== original

  async function handleSave() {
    setSaving(true)
    setError("")
    try {
      await api.saveGlobalSkillFile(slug, content)
      setOriginal(content)
      setEditMode(false)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-32">
      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
    </div>
  )

  if (error) return (
    <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-destructive/80">
      <AlertCircle className="w-3.5 h-3.5" /> {error}
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-white/1">
        <ScrollText className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[11px] font-semibold text-muted-foreground/70">SKILL.md</span>
        {externalChange && editMode && (
          <button
            onClick={async () => {
              try {
                const data = await api.getGlobalSkillFile(slug)
                setContent(data.content)
                setOriginal(data.content)
                setExternalChange(false)
              } catch {}
            }}
            className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 hover:bg-amber-500/20"
            title="Reload from disk (discards your edits)"
          >
            modified on disk · reload
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {editMode ? (
            <>
              <button
                onClick={() => { setContent(original); setEditMode(false) }}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
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
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                title="Version history"
              >
                <History className="w-3 h-3" />
              </button>
              <button
                onClick={() => setShowTemplatePicker(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10px] text-muted-foreground hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/10 transition-colors font-bold"
                title="ADLC Templates"
              >
                <LayoutTemplate className="w-3 h-3" /> Templates
              </button>
              <button
                onClick={() => setShowAiPanel(p => !p)}
                className={cn("flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold transition-colors",
                  showAiPanel
                    ? "bg-violet-500/20 border-violet-500/30 text-violet-400"
                    : "border-white/10 text-muted-foreground hover:text-violet-400 hover:border-violet-500/30 hover:bg-violet-500/10"
                )}
                title="AI Assist"
              >
                <Wand2 className="w-3 h-3" /> AI
              </button>
              {editable ? (
                <button
                  onClick={() => setEditMode(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                >
                  <Edit3 className="w-3 h-3" /> Edit
                </button>
              ) : (
                <span className="text-[9px] text-muted-foreground/40 px-1">read-only</span>
              )}
            </>
          )}
        </div>
      </div>

      {showHistory && (
        <VersionHistoryPanel
          scopeKey={`skill:global:${slug}`}
          currentContent={content}
          onClose={() => setShowHistory(false)}
          onRestored={(c) => { setContent(c); setOriginal(c); setShowHistory(false); onSaved() }}
        />
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {editMode ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            className="w-full h-full resize-none bg-transparent text-[12px] font-mono text-foreground/90 px-4 py-3 focus:outline-none leading-relaxed"
            spellCheck={false}
          />
        ) : (
          <div className="overflow-y-auto h-full px-4 py-3">
            <pre className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap leading-relaxed">{content || <span className="text-muted-foreground/30 italic">Empty SKILL.md</span>}</pre>
          </div>
        )}
      </div>

      {/* AI Assist Panel */}
      {showAiPanel && (
        <AiAssistPanel
          fileType="SKILL.md"
          currentContent={content}
          extraContext={`Skill slug: ${slug}`}
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
          onSelect={(templateContent, name) => {
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

// ─── Skill Files Panel ────────────────────────────────────────────────────────

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: SkillFileNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(depth < 2)
  const isSelected = selectedPath === node.path
  const indent = depth * 12

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-left hover:bg-foreground/3 transition-colors rounded"
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          {open ? <ChevronDown className="w-3 h-3 text-muted-foreground/40 shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
          <FolderOpen className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
          <span className="text-[11px] font-semibold text-muted-foreground/70">{node.name}/</span>
          <span className="text-[9px] text-muted-foreground/30 ml-auto">{node.children?.length ?? 0}</span>
        </button>
        {open && node.children?.map(child => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    )
  }

  const fileEmoji = node.ext === '.md' ? '📄' : node.ext === '.sh' || node.ext === '.bash' || node.ext === '.zsh' ? '🟢' : node.ext === '.py' ? '🐍' : node.ext === '.js' || node.ext === '.ts' ? '🟡' : '📄'

  return (
    <button
      onClick={() => node.isText && onSelect(node.path)}
      disabled={!node.isText}
      className={cn(
        "w-full flex items-center gap-1.5 py-1 px-2 text-left transition-colors rounded",
        isSelected ? "bg-primary/10 text-foreground" : "hover:bg-foreground/3 text-muted-foreground/70",
        !node.isText && "opacity-40 cursor-not-allowed"
      )}
      style={{ paddingLeft: `${8 + indent}px` }}
    >
      <span className="text-xs shrink-0">{fileEmoji}</span>
      <span className={cn("text-[11px] font-mono truncate flex-1", isSelected && "text-primary font-semibold")}>
        {node.name}
      </span>
      {node.size !== undefined && (
        <span className="text-[9px] text-muted-foreground/30 shrink-0">
          {node.size < 1024 ? `${node.size}B` : `${(node.size / 1024).toFixed(1)}KB`}
        </span>
      )}
    </button>
  )
}

function SkillFilesPanel({ slug, editable }: { slug: string; editable: boolean }) {
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
    api.getSkillDirTree(slug)
      .then(data => { setTree(data.tree); setLoading(false) })
      .catch(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    if (!selectedPath) return
    setFileLoading(true)
    setEditMode(false)
    setError('')
    api.getSkillAnyFile(slug, selectedPath)
      .then(data => { setFileContent(data.content); setEditContent(data.content); setFileLoading(false) })
      .catch(e => { setError((e as Error).message); setFileLoading(false) })
  }, [slug, selectedPath])

  // Live-reload: refresh the file tree + currently opened file when
  // `skills:updated` fires, without unmounting or showing a loader.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const editingRef = editMode
    const onUpdate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        try {
          const t = await api.getSkillDirTree(slug)
          setTree(t.tree)
        } catch {}
        if (selectedPath && !editingRef) {
          try {
            const data = await api.getSkillAnyFile(slug, selectedPath)
            setFileContent(data.content)
            setEditContent(data.content)
          } catch {}
        }
      }, 300)
    }
    window.addEventListener("aoc:skills-updated", onUpdate)
    return () => {
      window.removeEventListener("aoc:skills-updated", onUpdate)
      if (timer) clearTimeout(timer)
    }
  }, [slug, selectedPath, editMode])

  async function handleSave() {
    if (!selectedPath) return
    setSaving(true)
    try {
      await api.saveSkillAnyFile(slug, selectedPath, editContent)
      setFileContent(editContent)
      setEditMode(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* File tree — full-width on mobile, sidebar on desktop */}
      <div className={cn(
        "shrink-0 border-r border-border overflow-y-auto py-1.5",
        "w-full md:w-52",
        selectedPath ? "hidden md:block" : "block"
      )}>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" /></div>
        ) : tree.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/40 px-3 py-4 italic">No files found</p>
        ) : (
          tree.map(node => (
            <FileTreeNode key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={setSelectedPath} />
          ))
        )}
      </div>

      {/* File viewer — hidden on mobile when no file selected */}
      <div className={cn(
        "flex-1 min-w-0 flex flex-col overflow-hidden",
        selectedPath ? "flex" : "hidden md:flex"
      )}>
        {!selectedPath ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <FileText className="w-8 h-8 text-foreground/8 mb-3" />
            <p className="text-[12px] text-muted-foreground/40">Select a file to view its contents</p>
            <p className="text-[10px] text-muted-foreground/30 mt-1">assets/ · references/ · scripts/ · SKILL.md</p>
          </div>
        ) : (
          <>
            {/* Mobile back button */}
            <button
              onClick={() => setSelectedPath(null)}
              className="md:hidden flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground hover:text-foreground border-b border-border shrink-0 bg-foreground/2 w-full"
            >
              <ChevronRight className="w-3 h-3 rotate-180" />
              <span>Files</span>
            </button>
            {/* File header */}
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-foreground/2">
              <span className="text-[11px] font-mono text-foreground/70 flex-1 truncate">{selectedPath}</span>
              {error && <span className="text-[10px] text-red-400">{error}</span>}
              {!fileLoading && editable && !editMode && (
                <button
                  onClick={() => { setEditContent(fileContent); setEditMode(true) }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                >
                  <Edit3 className="w-3 h-3" /> Edit
                </button>
              )}
              {editMode && (
                <>
                  <button
                    onClick={() => { setEditMode(false); setEditContent(fileContent) }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-foreground/10 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-3 h-3" /> Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary/20 border border-primary/30 text-[10px] text-primary font-bold hover:bg-primary/30 transition-colors disabled:opacity-40"
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Save
                  </button>
                </>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {fileLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" /></div>
              ) : editMode ? (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full h-full resize-none bg-transparent text-[11.5px] font-mono text-foreground/90 px-4 py-3 focus:outline-none leading-relaxed"
                  spellCheck={false}
                />
              ) : (
                <div className="overflow-y-auto h-full px-4 py-3">
                  <pre className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap leading-relaxed">
                    {fileContent || <span className="text-muted-foreground/30 italic">Empty file</span>}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Skill Detail Panel ───────────────────────────────────────────────────────

function SkillDetail({
  skill,
  onClose,
  onRefresh,
}: {
  skill: GlobalSkillInfo
  onClose: () => void
  onRefresh: () => void
}) {
  const navigate = useNavigate()
  const [detailTab, setDetailTab] = useState<"info" | "editor" | "files">("info")
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const enabledAgents = skill.agentAssignments.filter(a => a.enabled)
  const disabledAgents = skill.agentAssignments.filter(a => !a.enabled)

  async function doDelete() {
    setShowDeleteConfirm(false)
    setDeleting(true)
    try {
      await api.deleteGlobalSkill(skill.slug)
      onClose()
      onRefresh()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mobile back button */}
      <button
        onClick={onClose}
        className="md:hidden flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground hover:text-foreground border-b border-border shrink-0 bg-foreground/2 w-full"
      >
        <ChevronRight className="w-3 h-3 rotate-180" />
        <span>Skills</span>
      </button>
      {/* Header */}
      <div className="shrink-0 px-4 md:px-5 py-3 border-b border-foreground/5 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-xl md:text-2xl leading-none mt-0.5 shrink-0">{skill.emoji ?? "📦"}</span>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-sm leading-snug truncate">{skill.name}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{skill.description || "No description"}</p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <SourceBadge source={skill.source} />
              {skill.hasApiKey && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-yellow-500/10 border-yellow-500/20 text-yellow-400">
                  <Key className="w-2.5 h-2.5" /> API Key
                </span>
              )}
              {skill.hasEnv && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-purple-500/10 border-purple-500/20 text-purple-400">
                  <Settings2 className="w-2.5 h-2.5" /> Env Vars
                </span>
              )}
              {!skill.globallyEnabled && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-red-500/10 border-red-500/20 text-red-400">
                  <XCircle className="w-2.5 h-2.5" /> Globally Disabled
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {skill.editable && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-red-500/20 text-[11px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
              title="Delete skill"
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
          <button onClick={onClose} className="text-muted-foreground/50 hover:text-muted-foreground text-lg leading-none transition-colors">
            ×
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="shrink-0 flex items-center gap-0.5 px-3 md:px-4 pt-2 pb-0 border-b border-foreground/5 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setDetailTab("info")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors -mb-px",
            detailTab === "info" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Info & Agents
        </button>
        <button
          onClick={() => setDetailTab("editor")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors -mb-px",
            detailTab === "editor" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <ScrollText className="w-3 h-3" />
          SKILL.md
          {skill.editable && <span className="w-1.5 h-1.5 rounded-full bg-primary/60 ml-0.5" />}
        </button>
        <button
          onClick={() => setDetailTab("files")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors -mb-px",
            detailTab === "files" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <FolderOpen className="w-3 h-3" />
          Files
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {detailTab === "info" ? (
          <div className="overflow-y-auto h-full px-5 py-4 space-y-5">
            {/* Agent Assignments */}
            <div>
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Agent Assignments ({skill.agentAssignments.length})
              </h4>
              {skill.agentAssignments.length === 0 ? (
                <p className="text-[12px] text-muted-foreground/50 italic">No agents configured</p>
              ) : (
                <div className="space-y-1.5">
                  {enabledAgents.map(a => (
                    <div
                      key={a.agentId}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-status-active/5 border border-status-active/15 cursor-pointer hover:bg-status-active/10 transition-colors group"
                      onClick={() => navigate(`/agents/${a.agentId}`)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AgentAvatar avatarPresetId={a.avatarPresetId} emoji={a.agentEmoji} size="w-7 h-7" />
                        <span className="text-[12px] font-medium text-foreground truncate">{a.agentName}</span>
                        {a.hasAllowlist && <span className="text-[9px] text-muted-foreground/40 shrink-0">allowlisted</span>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-status-active-text" />
                        <ChevronRight className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
                  {disabledAgents.map(a => (
                    <div
                      key={a.agentId}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/5 border border-white/5 cursor-pointer hover:bg-muted/10 transition-colors group"
                      onClick={() => navigate(`/agents/${a.agentId}`)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AgentAvatar avatarPresetId={a.avatarPresetId} emoji={a.agentEmoji} size="w-7 h-7" className="opacity-40" />
                        <span className="text-[12px] text-muted-foreground/50 truncate">{a.agentName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <XCircle className="w-3.5 h-3.5 text-muted-foreground/30" />
                        <ChevronRight className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Path */}
            <div>
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Location</h4>
              <p className="text-[11px] text-muted-foreground/60 font-mono break-all bg-white/2 rounded-lg px-3 py-2 border border-white/5">
                {skill.path}
              </p>
            </div>

            {/* Quick actions */}
            {skill.agentAssignments.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Actions</h4>
                <div className="flex flex-wrap gap-1.5">
                  {skill.agentAssignments.slice(0, 4).map(a => (
                    <button
                      key={a.agentId}
                      onClick={() => navigate(`/agents/${a.agentId}`)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/3 border border-white/8 hover:bg-white/6 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <AgentAvatar avatarPresetId={a.avatarPresetId} emoji={a.agentEmoji} size="w-5 h-5" />
                      <span>Open {a.agentName}</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : detailTab === "editor" ? (
          <SkillMdEditor slug={skill.slug} editable={skill.editable} onSaved={onRefresh} />
        ) : (
          <SkillFilesPanel slug={skill.slug} editable={skill.editable} />
        )}
      </div>
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete "${skill.name}"?`}
          description="This will permanently remove the skill directory. It will no longer be available to any agent."
          confirmLabel="Delete Skill"
          destructive
          loading={deleting}
          onConfirm={doDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}

// ─── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab({
  skills,
  agents,
  onCreateClick,
  onRefresh,
}: {
  skills: GlobalSkillInfo[]
  agents: { id: string; name: string; emoji: string }[]
  onCreateClick: () => void
  onRefresh: () => void
}) {
  const [search, setSearch] = useState("")
  const [sourceFilter, setSourceFilter] = useState<string>("all")
  const [selectedSkill, setSelectedSkill] = useState<GlobalSkillInfo | null>(null)

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: skills.length }
    for (const s of skills) counts[s.source] = (counts[s.source] ?? 0) + 1
    return counts
  }, [skills])

  const uniqueSources = useMemo(() => [...new Set(skills.map(s => s.source))], [skills])

  const filtered = useMemo(() => {
    return skills.filter(s => {
      if (sourceFilter !== "all" && s.source !== sourceFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      }
      return true
    })
  }, [skills, sourceFilter, search])

  // Sync selected skill when list refreshes
  useEffect(() => {
    if (selectedSkill) {
      const updated = skills.find(s => s.slug === selectedSkill.slug)
      if (updated) setSelectedSkill(updated)
    }
  }, [skills]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 min-h-0 gap-0">
      {/* Left panel — full-width on mobile, fixed sidebar on desktop */}
      <div className={cn(
        "flex flex-col shrink-0 border-r border-foreground/5 min-h-0",
        "w-full md:w-72",
        selectedSkill ? "hidden md:flex" : "flex"
      )}>
        {/* Search + Create */}
        <div className="shrink-0 px-3 pt-3 pb-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search skills…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-foreground/4 border border-foreground/8 text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>
          <button
            onClick={onCreateClick}
            title="Create new skill"
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Source filters — horizontal scroll on mobile, vertical on desktop */}
        <div className="shrink-0 px-3 pb-2 flex md:flex-col gap-1 md:gap-0.5 overflow-x-auto md:overflow-x-visible scrollbar-none">
          <button
            onClick={() => setSourceFilter("all")}
            className={cn("flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors text-left whitespace-nowrap shrink-0",
              sourceFilter === "all" ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}
          >
            <div className="flex items-center gap-2"><Layers className="w-3.5 h-3.5" />All Sources</div>
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">{sourceCounts.all}</span>
          </button>
          {uniqueSources.map(source => {
            const cfg = getSourceConfig(source)
            const Icon = cfg.icon
            return (
              <button
                key={source}
                onClick={() => setSourceFilter(source)}
                className={cn("flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors text-left whitespace-nowrap shrink-0",
                  sourceFilter === source ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}
              >
                <div className={cn("flex items-center gap-2", sourceFilter === source ? cfg.color : "")}>
                  <Icon className="w-3.5 h-3.5" />{cfg.label}
                </div>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">{sourceCounts[source] ?? 0}</span>
              </button>
            )
          })}
        </div>

        <div className="shrink-0 mx-3 border-t border-foreground/5 hidden md:block" />

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 text-muted-foreground/40 text-[12px]">
              <AlertCircle className="w-5 h-5 mb-1.5" />
              No skills found
            </div>
          ) : filtered.map(skill => {
            const isSelected = selectedSkill?.slug === skill.slug
            const enabledCount = skill.agentAssignments.filter(a => a.enabled).length
            return (
              <button
                key={skill.slug}
                onClick={() => setSelectedSkill(isSelected ? null : skill)}
                className={cn("w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-lg transition-colors",
                  isSelected ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}
              >
                <span className="text-base leading-none mt-0.5 shrink-0">{skill.emoji ?? "📦"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className={cn("text-[12px] font-medium truncate", isSelected ? "text-foreground" : "")}>
                      {skill.name}
                    </span>
                    {enabledCount > 0 && (
                      <span className="text-[9px] text-status-active-text shrink-0 tabular-nums">{enabledCount}✓</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <SourceBadge source={skill.source} />
                    {skill.editable && <span className="text-[9px] text-primary/60">editable</span>}
                    {!skill.globallyEnabled && <span className="text-[9px] text-red-400">disabled</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right panel — hidden on mobile when no skill selected */}
      <div className={cn(
        "flex-1 min-w-0 min-h-0 overflow-hidden",
        selectedSkill ? "flex flex-col" : "hidden md:flex md:flex-col"
      )}>
        {selectedSkill ? (
          <SkillDetail
            skill={selectedSkill}
            onClose={() => setSelectedSkill(null)}
            onRefresh={onRefresh}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-3">
            <BookOpen className="w-10 h-10" />
            <p className="text-[13px]">Select a skill to view details & edit</p>
            <p className="text-[11px]">{skills.length} skills across {agents.length} agents</p>
            <button
              onClick={onCreateClick}
              className="mt-1 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-[12px] hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Create New Skill
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tools Tab ────────────────────────────────────────────────────────────────

function ToolsTab({ tools, agents }: { tools: GlobalToolInfo[]; agents: { id: string; name: string; emoji: string }[] }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [groupFilter, setGroupFilter] = useState<string>("all")

  const groups = useMemo(() => [...new Set(tools.map(t => t.group))] as ToolGroup[], [tools])

  const filtered = useMemo(() => tools.filter(t => {
    if (groupFilter !== "all" && t.group !== groupFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return t.name.toLowerCase().includes(q) || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    }
    return true
  }), [tools, groupFilter, search])

  const byGroup = useMemo(() => {
    const map: Record<string, GlobalToolInfo[]> = {}
    for (const t of filtered) {
      if (!map[t.group]) map[t.group] = []
      map[t.group].push(t)
    }
    return map
  }, [filtered])

  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0 gap-0">
      {/* Group filter — horizontal scroll on mobile, vertical sidebar on desktop */}
      <div className="flex md:flex-col md:w-52 shrink-0 border-b md:border-b-0 md:border-r border-foreground/5 min-h-0">
        <div className="shrink-0 px-3 pt-3 pb-2 w-full">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search tools…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-foreground/4 border border-foreground/8 text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>
        </div>
        <div className="flex md:flex-col flex-1 overflow-x-auto md:overflow-x-visible md:overflow-y-auto min-h-0 px-3 pb-2 md:pb-3 gap-0.5 scrollbar-none">
          <button
            onClick={() => setGroupFilter("all")}
            className={cn("flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors text-left whitespace-nowrap shrink-0",
              groupFilter === "all" ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}
          >
            <div className="flex items-center gap-2"><span>🔧</span>All Tools</div>
            <span className="text-[10px] text-muted-foreground/60">{tools.length}</span>
          </button>
          {groups.map(group => {
            const cfg = GROUP_CONFIG[group] ?? { label: group, emoji: "🔧" }
            return (
              <button
                key={group}
                onClick={() => setGroupFilter(group)}
                className={cn("flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors text-left whitespace-nowrap shrink-0",
                  groupFilter === group ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}
              >
                <div className="flex items-center gap-2"><span>{cfg.emoji}</span>{cfg.label}</div>
                <span className="text-[10px] text-muted-foreground/60">{tools.filter(t => t.group === group).length}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 min-w-0 px-3 md:px-5 py-4 space-y-6">
        {agents.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/15 text-[12px] text-yellow-400/80">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            No agents configured — tools status is unavailable
          </div>
        )}
        {Object.entries(byGroup).map(([group, groupTools]) => {
          const cfg = GROUP_CONFIG[group as ToolGroup] ?? { label: group, emoji: "🔧" }
          return (
            <div key={group}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{cfg.emoji}</span>
                <h3 className="text-[13px] font-semibold text-foreground">{cfg.label}</h3>
                <span className="text-[10px] text-muted-foreground/50 ml-1">{groupTools.length} tools</span>
              </div>
              <div className="space-y-1.5">
                {groupTools.map(tool => {
                  const allEnabled = tool.agentAssignments.every(a => a.enabled)
                  const noneEnabled = tool.totalAgents > 0 && tool.agentAssignments.every(a => !a.enabled)
                  return (
                    <div key={tool.name} className="flex items-start gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-xl bg-foreground/1 border border-foreground/5 hover:border-foreground/10 hover:bg-foreground/2 transition-colors">
                      <div className="mt-0.5 shrink-0">
                        {noneEnabled
                          ? <span className="w-2 h-2 rounded-full bg-muted-foreground/20 block mt-1" />
                          : allEnabled
                            ? <span className="w-2 h-2 rounded-full bg-status-active-text block mt-1" />
                            : <span className="w-2 h-2 rounded-full bg-yellow-400/60 block mt-1" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-2">
                          <span className="text-[12px] font-semibold text-foreground font-mono truncate">{tool.name}</span>
                          <span className="text-[10px] sm:text-[11px] text-muted-foreground shrink-0">{tool.label}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground/60 mt-0.5 line-clamp-2">{tool.description}</p>
                        {tool.agentAssignments.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {tool.agentAssignments.map(a => (
                              <button key={a.agentId} onClick={() => navigate(`/agents/${a.agentId}`)}>
                                <AgentChip avatarPresetId={a.avatarPresetId} emoji={a.agentEmoji} name={a.agentName} enabled={a.enabled} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {tool.totalAgents > 0 && (
                        <div className="shrink-0 text-right">
                          <span className={cn("text-[11px] font-semibold tabular-nums",
                            allEnabled ? "text-status-active-text" : noneEnabled ? "text-muted-foreground/40" : "text-yellow-400")}>
                            {tool.enabledCount}/{tool.totalAgents}
                          </span>
                          <p className="text-[9px] text-muted-foreground/40">agents</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/30 gap-2">
            <Wrench className="w-8 h-8" />
            <p className="text-[12px]">No tools match your search</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function StatBadge({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-foreground/2 border border-foreground/5 shrink-0 whitespace-nowrap">
      <Icon className={cn("w-3 h-3 text-muted-foreground/60", color)} />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">{label}</span>
      <span className={cn("text-[12px] font-bold text-foreground tabular-nums", color)}>{value}</span>
    </div>
  )
}

type TabId = "skills" | "tools" | "custom-tools"

export function SkillsPage() {
  const storeAgents = useAgentStore((s) => s.agents)
  const canUseTerminal = useCanUseClaudeTerminal()
  const [tab, setTab] = useState<TabId>("skills")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skills, setSkills] = useState<GlobalSkillInfo[]>([])
  const [tools, setTools] = useState<GlobalToolInfo[]>([])
  const [agents, setAgents] = useState<{ id: string; name: string; emoji: string }[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [scriptCount, setScriptCount] = useState(0)

  /** Enrich agentAssignments in skills/tools with avatarPresetId from the store */
  function enrichWithAvatars<T extends { agentAssignments: { agentId: string; avatarPresetId?: string | null }[] }>(items: T[]): T[] {
    return items.map(item => ({
      ...item,
      agentAssignments: item.agentAssignments.map(a => ({
        ...a,
        avatarPresetId: a.avatarPresetId ?? storeAgents.find(ag => ag.id === a.agentId)?.avatarPresetId ?? null,
      }))
    }))
  }

  // `loading` is true only for the first load (full-page spinner). Subsequent
  // refetches (from the refresh button or skills:updated WS event) run silently
  // via `refreshing` so the open preview pane doesn't unmount.
  async function load({ silent = false }: { silent?: boolean } = {}) {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [skillsRes, toolsRes, scriptsRes] = await Promise.all([
        api.getGlobalSkills(), api.getGlobalTools(),
        api.listScripts().catch(() => ({ scripts: [] })),
      ])
      setSkills(skillsRes.skills)
      setAgents(skillsRes.agents)
      setTools(toolsRes.tools)
      setScriptCount((scriptsRes as { scripts: unknown[] }).scripts?.length ?? 0)
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  // Hot-reload: server broadcasts `skills:updated` via /ws → useWebSocket dispatches
  // the `aoc:skills-updated` window event → we debounce-refetch here, silently,
  // so the open preview/editor pane stays mounted.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onUpdate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { load({ silent: true }) }, 400)
    }
    window.addEventListener("aoc:skills-updated", onUpdate)
    return () => {
      window.removeEventListener("aoc:skills-updated", onUpdate)
      if (timer) clearTimeout(timer)
    }
  }, [])

  const globallyEnabled = skills.filter(s => s.globallyEnabled).length
  const uniqueSources = [...new Set(skills.map(s => s.source))].length

  return (
    <div className="flex flex-col h-full min-h-0">
      {showCreate && (
        <CreateSkillModal
          onClose={() => setShowCreate(false)}
          onCreated={(slug) => {
            setShowCreate(false)
            load()
          }}
        />
      )}
      {showInstall && (
        <InstallSkillModal
          onClose={() => setShowInstall(false)}
          onInstalled={(_slug) => {
            setShowInstall(false)
            load()
          }}
        />
      )}

      {/* Header */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-foreground font-display">Skills & Tools</h1>
          <p className="text-[11px] sm:text-[12px] text-muted-foreground mt-0.5 hidden sm:block">Global registry of skills and built-in tools across all agents</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setShowInstall(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] sm:text-[12px] text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Install from</span> External
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/25 text-[11px] sm:text-[12px] text-primary hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
          <button
            onClick={() => load({ silent: true })}
            disabled={loading || refreshing}
            className="flex items-center justify-center w-8 h-8 sm:w-auto sm:h-auto sm:gap-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-foreground/3 border border-foreground/8 text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/6 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (loading || refreshing) && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {!loading && !error && (
        <div className="shrink-0 flex items-center gap-2 sm:gap-3 mb-4 overflow-x-auto scrollbar-none">
          <StatBadge label="Skills" value={skills.length} icon={BookOpen} />
          <StatBadge label="Enabled" value={globallyEnabled} icon={CheckCircle2} color="text-status-active-text" />
          <StatBadge label="Sources" value={uniqueSources} icon={Layers} />
          <StatBadge label="Agents" value={agents.length} icon={Package} />
          <StatBadge label="Tools" value={tools.length} icon={Wrench} />
        </div>
      )}

      {/* Body: main card + optional right-pane terminal */}
      <div className="flex-1 min-h-0 flex gap-0">
      <div className="flex-1 min-w-0 bg-foreground/1 border border-foreground/5 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        {/* Tabs */}
        <div className="shrink-0 flex items-center gap-0.5 sm:gap-1 px-3 sm:px-4 pt-3 pb-0 border-b border-foreground/5 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setTab("skills")}
            className={cn("flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-[12px] font-medium border-b-2 transition-colors -mb-px whitespace-nowrap",
              tab === "skills" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Skills
            {skills.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-foreground/8 text-[9px] text-muted-foreground tabular-nums">{skills.length}</span>
            )}
          </button>
          <button
            onClick={() => setTab("tools")}
            className={cn("flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-[12px] font-medium border-b-2 transition-colors -mb-px whitespace-nowrap",
              tab === "tools" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span className="sm:hidden">Built-in</span>
            <span className="hidden sm:inline">Built-in Tools</span>
            {tools.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-foreground/8 text-[9px] text-muted-foreground tabular-nums">{tools.length}</span>
            )}
          </button>
          <button
            onClick={() => setTab("custom-tools")}
            className={cn("flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 text-[11px] sm:text-[12px] font-medium border-b-2 transition-colors -mb-px whitespace-nowrap",
              tab === "custom-tools" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <Terminal className="w-3.5 h-3.5" />
            Custom
            {scriptCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-foreground/8 text-[9px] text-muted-foreground tabular-nums">{scriptCount}</span>
            )}
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground/40" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground/50">
            <AlertCircle className="w-8 h-8 text-destructive/50" />
            <p className="text-[13px]">{error}</p>
            <button onClick={load} className="mt-1 px-3 py-1.5 rounded-lg bg-white/3 border border-white/8 text-[12px] hover:bg-white/6 transition-colors">
              Retry
            </button>
          </div>
        ) : tab === "skills" ? (
          <SkillsTab skills={enrichWithAvatars(skills)} agents={agents} onCreateClick={() => setShowCreate(true)} onRefresh={load} />
        ) : tab === "tools" ? (
          <ToolsTab tools={enrichWithAvatars(tools)} agents={agents} />
        ) : (
          <CustomToolsTab />
        )}
      </div>

        {canUseTerminal && <SkillsTerminal cwd={tab === "custom-tools" ? "scripts" : "skills"} />}
      </div>
    </div>
  )
}
