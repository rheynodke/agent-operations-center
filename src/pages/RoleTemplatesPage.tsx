import { useState, useEffect, useMemo } from "react"
import {
  Search, Loader2, RefreshCw, Package, Sparkles, Wrench,
  FileText, Tag, Hash, ChevronRight, ChevronDown, FolderOpen,
  AlertCircle, Info, Plus, Edit3, Trash2, Copy, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { SkillFileNode } from "@/lib/api"
import { useRoleTemplateStore } from "@/stores"
import type { RoleTemplateSummary, RoleTemplateRecord } from "@/types"
import { RoleTemplateFormModal, type FormMode } from "@/components/roles/RoleTemplateFormModal"
import { ApplyToAgentModal } from "@/components/roles/ApplyToAgentModal"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Play } from "lucide-react"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function OriginBadge({ origin, builtIn }: { origin: string; builtIn: boolean }) {
  if (builtIn) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-amber-500/25 bg-amber-500/10 text-amber-400">
        <Package className="w-2.5 h-2.5" /> Built-in
      </span>
    )
  }
  if (origin.startsWith("forked:")) {
    const parent = origin.slice("forked:".length)
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-violet-500/25 bg-violet-500/10 text-violet-300" title={`Forked from ${parent}`}>
        <ChevronRight className="w-2.5 h-2.5" /> Forked
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-sky-500/25 bg-sky-500/10 text-sky-300">
      Custom
    </span>
  )
}

function colorStyle(hex: string | null): React.CSSProperties {
  if (!hex) return {}
  return { backgroundColor: hex + "20", borderColor: hex + "55", color: hex }
}

// ─── Sidebar list item ───────────────────────────────────────────────────────

function TemplateCard({
  t, selected, onSelect,
}: { t: RoleTemplateSummary; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-all group",
        selected
          ? "border-primary/40 bg-primary/8"
          : "border-border bg-card/50 hover:bg-card hover:border-foreground/15",
      )}
    >
      {/* Color strip */}
      <div
        className="w-1 self-stretch rounded-full shrink-0"
        style={{ backgroundColor: t.color || "#6366f1" }}
      />
      <span className="text-lg shrink-0 mt-0.5">{t.emoji || "🧩"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("text-[13px] font-semibold truncate", selected ? "text-foreground" : "text-foreground/90")}>
            {t.role}
          </span>
          {t.adlcAgentNumber != null && (
            <span
              className="text-[9px] font-mono font-bold px-1 py-px rounded border"
              style={colorStyle(t.color)}
            >
              #{t.adlcAgentNumber}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/80 mt-0.5 line-clamp-2 leading-snug">
          {t.description || <span className="italic">No description</span>}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <OriginBadge origin={t.origin} builtIn={t.builtIn} />
          <span className="text-[10px] text-muted-foreground/60 font-mono">
            {t.skillCount} skill{t.skillCount === 1 ? "" : "s"} · {t.scriptCount} script{t.scriptCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </button>
  )
}

// ─── Detail tabs ─────────────────────────────────────────────────────────────

type DetailTab = "meta" | "files" | "skills" | "scripts"

function DetailTabs({ value, onChange }: { value: DetailTab; onChange: (t: DetailTab) => void }) {
  const tabs: Array<{ id: DetailTab; label: string; icon: React.ElementType }> = [
    { id: "meta",    label: "Metadata",     icon: Info },
    { id: "files",   label: "Agent Files",  icon: FileText },
    { id: "skills",  label: "Skills",       icon: Sparkles },
    { id: "scripts", label: "Scripts",      icon: Wrench },
  ]
  return (
    <div className="flex gap-1 border-b border-border px-4 shrink-0">
      {tabs.map(t => {
        const Icon = t.icon
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 transition-colors -mb-px",
              value === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function MetadataPanel({ t }: { t: RoleTemplateRecord }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["ID", <code className="font-mono text-[11px] text-foreground/80">{t.id}</code>],
    ["Role", t.role],
    ["ADLC #", t.adlcAgentNumber ?? <span className="text-muted-foreground/40">—</span>],
    ["Emoji", t.emoji || <span className="text-muted-foreground/40">—</span>],
    ["Color", t.color ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded border border-border" style={{ backgroundColor: t.color }} />
        <code className="font-mono text-[11px]">{t.color}</code>
      </span>
    ) : <span className="text-muted-foreground/40">—</span>],
    ["Model", t.modelRecommendation || <span className="text-muted-foreground/40">—</span>],
    ["Origin", <OriginBadge origin={t.origin} builtIn={t.builtIn} />],
    ["FS workspace-only", t.fsWorkspaceOnly ? "Yes" : "No"],
    ["Tags", t.tags.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {t.tags.map((tag, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted/30 text-muted-foreground">
            <Tag className="w-2.5 h-2.5" />{tag}
          </span>
        ))}
      </div>
    ) : <span className="text-muted-foreground/40">None</span>],
  ]
  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto">
      {/* Description block */}
      {t.description && (
        <div className="rounded-xl border border-border bg-surface-high px-4 py-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Description</p>
          <p className="text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap">{t.description}</p>
        </div>
      )}
      {/* Field grid */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([label, value], i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-36 align-top">{label}</td>
                <td className="px-3 py-2 text-[13px] text-foreground/90">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type AgentFileKey = "identity" | "soul" | "tools" | "agents"
const AGENT_FILE_DEFS: Array<{ key: AgentFileKey; label: string }> = [
  { key: "identity", label: "IDENTITY.md" },
  { key: "soul",     label: "SOUL.md" },
  { key: "tools",    label: "TOOLS.md" },
  { key: "agents",   label: "AGENTS.md" },
]

function AgentFilesPanel({ t, onChanged }: { t: RoleTemplateRecord; onChanged?: () => void }) {
  const editable = !t.builtIn
  const presentKeys = AGENT_FILE_DEFS.filter(d => !!t.agentFiles[d.key])
  const [active, setActive] = useState<AgentFileKey>((presentKeys[0]?.key as AgentFileKey) || "identity")
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentContent = t.agentFiles[active] || ""
  const missing = !t.agentFiles[active]

  // Reset edit state when template or active file changes
  useEffect(() => {
    setEditMode(false)
    setDraft("")
    setError(null)
  }, [t.id, active])

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      const nextFiles = { ...t.agentFiles, [active]: draft }
      await api.updateRoleTemplate(t.id, { agentFiles: nextFiles })
      setEditMode(false)
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true); setError(null)
    try {
      const nextFiles = { ...t.agentFiles }
      delete nextFiles[active]
      await api.updateRoleTemplate(t.id, { agentFiles: nextFiles })
      setEditMode(false)
      // jump to another present file if available
      const remaining = AGENT_FILE_DEFS.filter(d => d.key !== active && !!t.agentFiles[d.key])
      if (remaining.length > 0) setActive(remaining[0].key)
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function startEdit() {
    setDraft(currentContent)
    setEditMode(true)
    setError(null)
  }

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* File picker */}
      <div className="shrink-0 border-r border-border w-44 overflow-y-auto py-1.5">
        {AGENT_FILE_DEFS.map(d => {
          const has = !!t.agentFiles[d.key]
          const isActive = active === d.key
          if (!has && !editable) return null
          return (
            <button
              key={d.key}
              onClick={() => setActive(d.key)}
              className={cn(
                "w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/3",
                !has && "opacity-50",
              )}
            >
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate flex-1 text-left">{d.label}</span>
              {!has && editable && (
                <span className="text-[9px] text-muted-foreground/50">—</span>
              )}
            </button>
          )
        })}
      </div>
      {/* Content area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-muted/10">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-foreground/2">
          <FileText className="w-3 h-3 text-muted-foreground/70" />
          <code className="text-[11px] font-mono text-foreground/80 truncate">
            {AGENT_FILE_DEFS.find(d => d.key === active)?.label}
          </code>
          {!editMode && !missing && (
            <span className="text-[10px] text-muted-foreground/50 font-mono">
              {formatBytes(currentContent.length)} · {currentContent.split("\n").length} lines
            </span>
          )}
          <div className="flex-1" />
          {editable && !editMode && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <Edit3 className="w-3 h-3" /> {missing ? "Add" : "Edit"}
            </button>
          )}
          {editable && !editMode && !missing && (
            <button
              onClick={handleClear}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/25 bg-red-500/5 text-[10px] text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
              title="Remove file from template"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          {editMode && (
            <>
              <button
                onClick={() => setEditMode(false)}
                disabled={saving}
                className="px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary/15 border border-primary/25 text-[10px] text-primary font-medium hover:bg-primary/25 disabled:opacity-40 transition-colors"
              >
                {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save"}
              </button>
            </>
          )}
        </div>
        {error && (
          <div className="shrink-0 mx-4 my-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive">
            {error}
          </div>
        )}
        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {editMode ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              autoFocus
              spellCheck={false}
              className="w-full h-full bg-background border-0 text-foreground/90 px-4 py-3 text-[11px] font-mono leading-relaxed resize-none focus:outline-none"
              placeholder={`# ${AGENT_FILE_DEFS.find(d => d.key === active)?.label}\n\nMarkdown content…`}
            />
          ) : missing ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/60 px-6 text-center">
              <FileText className="w-6 h-6 opacity-40" />
              <p className="text-sm">Not in this template</p>
              {editable && (
                <p className="text-[11px] text-muted-foreground/50">
                  Click <strong>Add</strong> to create this file
                </p>
              )}
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <pre className="px-4 py-3 text-[11px] font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
                {currentContent}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  return `${(n / 1024).toFixed(1)}KB`
}

function shortenHomePath(p: string | null | undefined): string {
  if (!p) return ""
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")
}

// ─── Installed-skill file-tree viewer (shared shape with SkillsPage) ─────────

function FileTreeNode({
  node, depth, selectedPath, onSelect,
}: {
  node: SkillFileNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(depth < 2)
  const isSelected = selectedPath === node.path
  const indent = depth * 12

  if (node.type === "dir") {
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

  const ext = node.ext ?? ""
  const emoji = ext === ".md" ? "📄"
    : [".sh", ".bash", ".zsh"].includes(ext) ? "🟢"
    : ext === ".py" ? "🐍"
    : [".js", ".ts"].includes(ext) ? "🟡"
    : "📄"

  return (
    <button
      onClick={() => node.isText && onSelect(node.path)}
      disabled={!node.isText}
      className={cn(
        "w-full flex items-center gap-1.5 py-1 px-2 text-left transition-colors rounded",
        isSelected ? "bg-primary/10 text-foreground" : "hover:bg-foreground/3 text-muted-foreground/70",
        !node.isText && "opacity-40 cursor-not-allowed",
      )}
      style={{ paddingLeft: `${8 + indent}px` }}
    >
      <span className="text-xs shrink-0">{emoji}</span>
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

/**
 * Read-only file tree + content viewer for an installed skill. Uses the
 * existing /api/skills/:slug/tree + /anyfile endpoints (same as SkillsPage).
 */
function InstalledSkillFilesViewer({ slug }: { slug: string }) {
  const [tree, setTree] = useState<SkillFileNode[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>("SKILL.md")
  const [content, setContent] = useState("")
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setTreeLoading(true); setTreeError(null); setSelectedPath("SKILL.md")
    api.getSkillDirTree(slug)
      .then(d => { if (!cancelled) { setTree(d.tree); setTreeLoading(false) } })
      .catch(e => { if (!cancelled) { setTreeError(e instanceof Error ? e.message : String(e)); setTreeLoading(false) } })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    if (!selectedPath) return
    let cancelled = false
    setFileLoading(true); setFileError(null)
    api.getSkillAnyFile(slug, selectedPath)
      .then(d => { if (!cancelled) { setContent(d.content); setFileLoading(false) } })
      .catch(e => { if (!cancelled) { setFileError(e instanceof Error ? e.message : String(e)); setFileLoading(false) } })
    return () => { cancelled = true }
  }, [slug, selectedPath])

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* File tree */}
      <div className="shrink-0 border-r border-border w-52 overflow-y-auto py-1.5">
        {treeLoading && (
          <div className="flex justify-center py-6"><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/50" /></div>
        )}
        {treeError && (
          <p className="text-[11px] text-destructive px-3 py-3">{treeError}</p>
        )}
        {!treeLoading && !treeError && tree.length === 0 && (
          <p className="text-[11px] text-muted-foreground/40 px-3 py-4 italic">No files</p>
        )}
        {tree.map(n => (
          <FileTreeNode key={n.path} node={n} depth={0} selectedPath={selectedPath} onSelect={setSelectedPath} />
        ))}
      </div>
      {/* Content viewer */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-muted/10">
        {selectedPath && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-foreground/2">
            <FileText className="w-3 h-3 text-muted-foreground/70" />
            <code className="text-[11px] font-mono text-foreground/80 truncate">{selectedPath}</code>
            <div className="flex-1" />
            {!fileLoading && !fileError && (
              <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
                {formatBytes(content.length)} · {content.split("\n").length} lines
              </span>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {fileLoading && (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
          {fileError && !fileLoading && (
            <div className="px-4 py-3 text-[12px] text-destructive">{fileError}</div>
          )}
          {!selectedPath && !fileLoading && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 gap-2">
              <FileText className="w-6 h-6 opacity-50" />
              <p className="text-[12px]">Select a file</p>
            </div>
          )}
          {selectedPath && !fileLoading && !fileError && (
            <pre className="px-4 py-3 text-[11px] font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

function AddSkillPicker({
  existing, onPick, onCancel, disabled,
}: {
  existing: string[]
  onPick: (slug: string) => void
  onCancel: () => void
  disabled: boolean
}) {
  const [allSkills, setAllSkills] = useState<Array<{ slug: string; name: string; source?: string }> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [manualMode, setManualMode] = useState(false)
  const [manualSlug, setManualSlug] = useState("")

  useEffect(() => {
    let cancelled = false
    api.getGlobalSkills()
      .then(d => { if (!cancelled) { setAllSkills(d.skills || []); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const existingSet = new Set(existing)
  const filtered = useMemo(() => {
    if (!allSkills) return []
    const q = query.trim().toLowerCase()
    return allSkills
      .filter(s => !existingSet.has(s.slug))
      .filter(s => !q || s.slug.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 12)
  }, [allSkills, query, existingSet])

  return (
    <div className="shrink-0 border-b border-border bg-muted/20 p-2 flex flex-col gap-1.5">
      {manualMode ? (
        <>
          <input
            autoFocus
            type="text"
            value={manualSlug}
            onChange={e => setManualSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            placeholder="skill-slug"
            className="w-full bg-input border border-border rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-1">
            <button
              onClick={() => manualSlug && onPick(manualSlug)}
              disabled={disabled || !manualSlug}
              className="flex-1 text-[10px] py-1 rounded bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 disabled:opacity-40 transition-colors"
            >
              Add "{manualSlug || "…"}"
            </button>
            <button
              onClick={() => setManualMode(false)}
              className="text-[10px] py-1 px-2 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              ←
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground/60 px-0.5">
            Reference to a skill slug — even if not yet installed.
          </p>
        </>
      ) : (
        <>
          <div className="flex gap-1">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search installed skills…"
              className="flex-1 bg-input border border-border rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground p-1 rounded"
              title="Cancel"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
            {loading && (
              <div className="flex items-center justify-center py-3 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
              </div>
            )}
            {error && <p className="text-[10px] text-destructive px-1">{error}</p>}
            {!loading && filtered.length === 0 && (
              <p className="text-[10px] text-muted-foreground/50 italic text-center py-2">
                {query ? "No matches" : "All installed skills already added"}
              </p>
            )}
            {filtered.map(s => (
              <button
                key={s.slug}
                onClick={() => onPick(s.slug)}
                disabled={disabled}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] hover:bg-primary/10 transition-colors disabled:opacity-40"
              >
                <Hash className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0" />
                <code className="font-mono text-foreground truncate flex-1">{s.slug}</code>
                {s.source && (
                  <span className="text-[9px] text-muted-foreground/40 uppercase">{s.source}</span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => setManualMode(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground py-1 border-t border-border/60 pt-1.5"
          >
            + Reference a slug not yet installed
          </button>
        </>
      )}
    </div>
  )
}

function SkillStatusBadge({ status }: { status: "bundled" | "installed" | "missing" }) {
  if (status === "bundled") {
    return (
      <span className="text-[9px] font-mono px-1 py-px rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        bundled
      </span>
    )
  }
  if (status === "installed") {
    return (
      <span className="text-[9px] font-mono px-1 py-px rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
        installed
      </span>
    )
  }
  return (
    <span className="text-[9px] font-mono px-1 py-px rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
      missing
    </span>
  )
}

function SkillsPanel({ t, onChanged }: { t: RoleTemplateRecord; onChanged?: () => void }) {
  const [active, setActive] = useState<string | null>(t.skillSlugs[0] || null)
  const [showAdd, setShowAdd] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  // Reset selection when template changes
  useEffect(() => {
    setActive(t.skillSlugs[0] || null)
    setShowAdd(false)
    setMutationError(null)
  }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const editable = !t.builtIn

  async function addSlug(slug: string) {
    if (mutating || t.skillSlugs.includes(slug)) return
    setMutating(true); setMutationError(null)
    try {
      await api.updateRoleTemplate(t.id, { skillSlugs: [...t.skillSlugs, slug] })
      setShowAdd(false)
      setActive(slug)
      onChanged?.()
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e))
    } finally {
      setMutating(false)
    }
  }

  async function removeSlug(slug: string) {
    if (mutating) return
    setMutating(true); setMutationError(null)
    try {
      const next = t.skillSlugs.filter(s => s !== slug)
      // Also drop bundled content for the removed slug to keep things tidy
      const nextContents = { ...t.skillContents }
      delete nextContents[slug]
      await api.updateRoleTemplate(t.id, { skillSlugs: next, skillContents: nextContents })
      if (active === slug) setActive(next[0] || null)
      onChanged?.()
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e))
    } finally {
      setMutating(false)
    }
  }

  if (t.skillSlugs.length === 0 && !editable) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
        No skills bundled in this template
      </div>
    )
  }

  const resolution = t.skillResolution || {}
  const activeRes = active ? resolution[active] : null
  const activeContent = activeRes?.content || ""
  const activeStatus = activeRes?.status || "missing"

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Skill list */}
      <div className="shrink-0 border-r border-border w-56 flex flex-col overflow-hidden">
        <div className="shrink-0 bg-card px-3 py-2 border-b border-border flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-muted-foreground" />
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
            {t.skillSlugs.length} skill{t.skillSlugs.length === 1 ? "" : "s"}
          </p>
          {editable && (
            <button
              onClick={() => setShowAdd(v => !v)}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                showAdd
                  ? "bg-primary/20 text-primary"
                  : "bg-primary/10 text-primary hover:bg-primary/20",
              )}
              title="Add skill"
              disabled={mutating}
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
        {showAdd && editable && (
          <AddSkillPicker
            existing={t.skillSlugs}
            onPick={addSlug}
            onCancel={() => setShowAdd(false)}
            disabled={mutating}
          />
        )}
        {mutationError && (
          <div className="mx-2 my-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
            {mutationError}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {t.skillSlugs.length === 0 && (
            <p className="text-[11px] text-muted-foreground/50 italic px-3 py-4 text-center">
              {editable ? "Click + to add skills" : "No skills"}
            </p>
          )}
          {t.skillSlugs.map(slug => {
            const res = resolution[slug]
            const status = res?.status || "missing"
            const bytes = res?.content?.length ?? 0
            const isActive = slug === active
            return (
              <div
                key={slug}
                className={cn(
                  "group w-full flex items-start gap-1.5 px-3 py-2 transition-colors border-l-2",
                  isActive
                    ? "bg-primary/10 border-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/3",
                )}
              >
                <button
                  onClick={() => setActive(slug)}
                  className="flex-1 min-w-0 flex items-start gap-1.5 text-left"
                >
                  <Hash className={cn("w-3 h-3 shrink-0 mt-0.5", isActive ? "text-primary" : "text-muted-foreground/50")} />
                  <div className="flex-1 min-w-0">
                    <code className={cn("block font-mono text-[11px] truncate", isActive ? "text-primary font-semibold" : "")}>
                      {slug}
                    </code>
                    <div className="flex items-center gap-1 mt-0.5">
                      <SkillStatusBadge status={status} />
                      {bytes > 0 && (
                        <span className="text-[9px] font-mono text-muted-foreground/40">{formatBytes(bytes)}</span>
                      )}
                    </div>
                  </div>
                </button>
                {editable && (
                  <button
                    onClick={() => removeSlug(slug)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-0.5"
                    title="Remove skill ref"
                    disabled={mutating}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {/* Skill content viewer */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-muted/10">
        {active && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-foreground/2">
            <Hash className="w-3 h-3 text-muted-foreground/70" />
            <code className="text-[11px] font-mono text-foreground/80 truncate">{active}</code>
            <SkillStatusBadge status={activeStatus} />
            {activeStatus === "installed" && activeRes?.path && (
              <code className="text-[10px] text-muted-foreground/60 font-mono truncate hidden md:inline">
                {shortenHomePath(activeRes.path)}
              </code>
            )}
            <div className="flex-1" />
            {activeStatus === "bundled" && activeRes?.content && (
              <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
                {formatBytes(activeContent.length)} · {activeContent.split("\n").length} lines
              </span>
            )}
          </div>
        )}
        {/* Body renders based on status */}
        {activeStatus === "missing" ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2 text-muted-foreground/60">
            <AlertCircle className="w-6 h-6 text-amber-400/60" />
            <p className="text-sm">Skill not installed</p>
            <p className="text-[11px] text-muted-foreground/50">
              Expected at <code className="font-mono">~/.openclaw/skills/{active}</code> but not found.
              Install via the Skills page or the Install-from-External flow.
            </p>
          </div>
        ) : activeStatus === "installed" && active ? (
          <InstalledSkillFilesViewer slug={active} />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <pre className="px-4 py-3 text-[11px] font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
              {activeContent}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

const SCRIPT_FILENAME_RE = /^[a-zA-Z0-9._-]{1,96}$/

function ScriptsPanel({ t, onChanged }: { t: RoleTemplateRecord; onChanged?: () => void }) {
  const editable = !t.builtIn
  const [activeIdx, setActiveIdx] = useState(0)
  const [editMode, setEditMode] = useState<"none" | "edit" | "add">("none")
  const [draftFilename, setDraftFilename] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when template changes
  useEffect(() => {
    setActiveIdx(0); setEditMode("none"); setError(null)
  }, [t.id])

  const hasScripts = t.scriptTemplates.length > 0
  const active = hasScripts ? (t.scriptTemplates[activeIdx] || t.scriptTemplates[0]) : null

  function startEdit() {
    if (!active) return
    setDraftFilename(active.filename)
    setDraftContent(active.content)
    setEditMode("edit")
    setError(null)
  }

  function startAdd() {
    setDraftFilename("")
    setDraftContent("#!/bin/bash\nset -euo pipefail\n\n")
    setEditMode("add")
    setError(null)
  }

  function cancelEdit() {
    setEditMode("none")
    setError(null)
  }

  const filenameValid = SCRIPT_FILENAME_RE.test(draftFilename)
  const filenameDuplicate = editMode === "add"
    ? t.scriptTemplates.some(s => s.filename === draftFilename)
    : t.scriptTemplates.some((s, i) => i !== activeIdx && s.filename === draftFilename)

  async function handleSave() {
    if (!filenameValid || filenameDuplicate) return
    setSaving(true); setError(null)
    try {
      let next: Array<{ filename: string; content: string }>
      let nextIdx = activeIdx
      if (editMode === "add") {
        next = [...t.scriptTemplates, { filename: draftFilename, content: draftContent }]
        nextIdx = next.length - 1
      } else {
        next = t.scriptTemplates.map((s, i) =>
          i === activeIdx ? { filename: draftFilename, content: draftContent } : s,
        )
      }
      await api.updateRoleTemplate(t.id, { scriptTemplates: next })
      setActiveIdx(nextIdx)
      setEditMode("none")
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!active) return
    setSaving(true); setError(null)
    try {
      const next = t.scriptTemplates.filter((_, i) => i !== activeIdx)
      await api.updateRoleTemplate(t.id, { scriptTemplates: next })
      setActiveIdx(Math.max(0, Math.min(activeIdx, next.length - 1)))
      setEditMode("none")
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Script list */}
      <div className="shrink-0 border-r border-border w-56 flex flex-col overflow-hidden">
        <div className="shrink-0 bg-card px-3 py-2 border-b border-border flex items-center gap-1.5">
          <Wrench className="w-3 h-3 text-muted-foreground" />
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
            {t.scriptTemplates.length} script{t.scriptTemplates.length === 1 ? "" : "s"}
          </p>
          {editable && (
            <button
              onClick={startAdd}
              disabled={saving || editMode !== "none"}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
              title="Add script"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {!hasScripts && editMode !== "add" && (
            <p className="text-[11px] text-muted-foreground/50 italic px-3 py-4 text-center">
              {editable ? "Click + to add a script" : "No scripts"}
            </p>
          )}
          {t.scriptTemplates.map((s, i) => {
            const isActive = i === activeIdx && editMode !== "add"
            return (
              <button
                key={i}
                onClick={() => { setActiveIdx(i); setEditMode("none") }}
                className={cn(
                  "w-full flex items-start gap-1.5 px-3 py-2 text-left transition-colors border-l-2",
                  isActive
                    ? "bg-primary/10 border-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/3",
                )}
              >
                <Wrench className={cn("w-3 h-3 shrink-0 mt-0.5", isActive ? "text-primary" : "text-muted-foreground/50")} />
                <div className="flex-1 min-w-0">
                  <code className={cn("block font-mono text-[11px] truncate", isActive ? "text-primary font-semibold" : "")}>
                    {s.filename}
                  </code>
                  <span className="text-[9px] font-mono text-muted-foreground/40">
                    {formatBytes(s.content.length)}
                  </span>
                </div>
              </button>
            )
          })}
          {editMode === "add" && (
            <div className="border-l-2 border-primary bg-primary/5 px-3 py-2 flex items-start gap-1.5">
              <Wrench className="w-3 h-3 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <code className="block font-mono text-[11px] text-primary font-semibold truncate">
                  {draftFilename || "(new script)"}
                </code>
                <span className="text-[9px] font-mono text-muted-foreground/60">draft</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Content area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-muted/10">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-foreground/2">
          <Wrench className="w-3 h-3 text-muted-foreground/70" />
          {editMode !== "none" ? (
            <input
              type="text"
              value={draftFilename}
              onChange={e => setDraftFilename(e.target.value)}
              placeholder="script.sh"
              autoFocus={editMode === "add"}
              className={cn(
                "text-[11px] font-mono bg-input border rounded px-2 py-0.5 w-64 focus:outline-none focus:ring-1",
                filenameValid && !filenameDuplicate
                  ? "border-border focus:ring-primary"
                  : "border-red-500/40 focus:ring-red-500",
              )}
            />
          ) : active ? (
            <code className="text-[11px] font-mono text-foreground/80 truncate">{active.filename}</code>
          ) : (
            <span className="text-[11px] text-muted-foreground/50 italic">No script selected</span>
          )}
          {editMode === "none" && active && (
            <span className="text-[10px] text-muted-foreground/50 font-mono">
              {formatBytes(active.content.length)} · {active.content.split("\n").length} lines
            </span>
          )}
          <div className="flex-1" />
          {editable && editMode === "none" && active && (
            <>
              <button
                onClick={startEdit}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
              <button
                onClick={handleRemove}
                disabled={saving}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/25 bg-red-500/5 text-[10px] text-red-400 hover:bg-red-500/15 disabled:opacity-40 transition-colors"
                title="Remove script"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
          {editMode !== "none" && (
            <>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !filenameValid || filenameDuplicate}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary/15 border border-primary/25 text-[10px] text-primary font-medium hover:bg-primary/25 disabled:opacity-40 transition-colors"
              >
                {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : editMode === "add" ? "Create" : "Save"}
              </button>
            </>
          )}
        </div>
        {editMode !== "none" && (!filenameValid || filenameDuplicate) && draftFilename && (
          <div className="shrink-0 mx-4 my-1 rounded border border-red-500/30 bg-red-500/5 px-3 py-1 text-[10px] text-red-400">
            {filenameDuplicate
              ? "A script with this filename already exists"
              : "Invalid filename — letters, digits, dots, hyphens, underscores only"}
          </div>
        )}
        {error && (
          <div className="shrink-0 mx-4 my-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive">
            {error}
          </div>
        )}
        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {editMode !== "none" ? (
            <textarea
              value={draftContent}
              onChange={e => setDraftContent(e.target.value)}
              spellCheck={false}
              className="w-full h-full bg-background border-0 text-foreground/90 px-4 py-3 text-[11px] font-mono leading-relaxed resize-none focus:outline-none"
              placeholder="#!/bin/bash&#10;set -euo pipefail&#10;&#10;# your script here"
            />
          ) : active ? (
            <div className="h-full overflow-y-auto">
              <pre className="px-4 py-3 text-[11px] font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
                {active.content}
              </pre>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/50">
              <Wrench className="w-6 h-6 opacity-40" />
              <p className="text-sm">No script selected</p>
              {editable && (
                <p className="text-[11px] text-muted-foreground/40">Click + above to add one</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Detail panel (fetches full record on selection) ──────────────────────────

interface DetailPanelProps {
  id: string
  refreshTick: number
  onRecordLoaded: (r: RoleTemplateRecord) => void
  onEdit: (r: RoleTemplateRecord) => void
  onFork: (r: RoleTemplateRecord) => void
  onDelete: (r: RoleTemplateRecord, usage: string[]) => void
  onApply: (r: RoleTemplateRecord) => void
  onMutated?: () => void
}

function DetailPanel({ id, refreshTick, onRecordLoaded, onEdit, onFork, onDelete, onApply, onMutated }: DetailPanelProps) {
  const [record, setRecord] = useState<RoleTemplateRecord | null>(null)
  const [usage, setUsage] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>("meta")
  const [localTick, setLocalTick] = useState(0) // bumped on in-panel mutations (skill add/remove)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null); setRecord(null); setTab("meta")
    Promise.all([
      api.getRoleTemplate(id),
      api.getRoleTemplateUsage(id).catch(() => ({ agentIds: [], count: 0 })),
    ])
      .then(([t, u]) => {
        if (cancelled) return
        setRecord(t.template); setUsage(u.agentIds); setLoading(false)
        onRecordLoaded(t.template)
      })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [id, refreshTick, localTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMutated = () => {
    setLocalTick(n => n + 1)
    onMutated?.()
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !record) {
    return (
      <div className="flex-1 flex items-center justify-center text-destructive text-sm px-6">
        <AlertCircle className="w-4 h-4 mr-2" />
        {error || "Not found"}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-border flex items-start gap-3">
        <div
          className="w-1 self-stretch rounded-full shrink-0"
          style={{ backgroundColor: record.color || "#6366f1" }}
        />
        <span className="text-2xl">{record.emoji || "🧩"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-foreground">{record.role}</h2>
            {record.adlcAgentNumber != null && (
              <span
                className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border"
                style={colorStyle(record.color)}
              >
                ADLC #{record.adlcAgentNumber}
              </span>
            )}
            <OriginBadge origin={record.origin} builtIn={record.builtIn} />
            {usage.length > 0 && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                title={`Used by: ${usage.join(", ")}`}
              >
                In use by {usage.length}
              </span>
            )}
          </div>
          <code className="text-[11px] text-muted-foreground/60 font-mono">{record.id}</code>
        </div>
        {/* Action buttons */}
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            onClick={() => onApply(record)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-[11px] text-primary font-semibold hover:bg-primary/20 transition-colors"
            title="Apply to an agent"
          >
            <Play className="w-3 h-3" /> Apply to Agent
          </button>
          {!record.builtIn && (
            <button
              onClick={() => onEdit(record)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
              title="Edit metadata"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          )}
          <button
            onClick={() => onFork(record)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-500/25 bg-sky-500/8 text-[11px] text-sky-300 hover:bg-sky-500/15 transition-colors"
            title={record.builtIn ? "Fork to customize" : "Duplicate"}
          >
            <Copy className="w-3 h-3" /> Fork
          </button>
          {!record.builtIn && (
            <button
              onClick={() => onDelete(record, usage)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-500/25 bg-red-500/8 text-[11px] text-red-400 hover:bg-red-500/15 transition-colors"
              title="Delete template"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Built-in readonly banner */}
      {record.builtIn && (
        <div className="shrink-0 px-5 py-2 border-b border-border bg-amber-500/5 flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
          <p className="text-[11px] text-amber-300/90">
            Built-in template — read-only. Use <strong>Fork</strong> to create an editable copy.
          </p>
        </div>
      )}

      {/* Tabs */}
      <DetailTabs value={tab} onChange={setTab} />

      {/* Tab body */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "meta"    && <MetadataPanel t={record} />}
        {tab === "files"   && <AgentFilesPanel t={record} onChanged={handleMutated} />}
        {tab === "skills"  && <SkillsPanel t={record} onChanged={handleMutated} />}
        {tab === "scripts" && <ScriptsPanel t={record} onChanged={handleMutated} />}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function RoleTemplatesPage() {
  const { templates, loading, error, refresh } = useRoleTemplateStore()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [detailTick, setDetailTick] = useState(0) // bump to force DetailPanel refetch after mutations
  const [formMode, setFormMode] = useState<FormMode | null>(null)
  const [applyTarget, setApplyTarget] = useState<RoleTemplateRecord | null>(null)
  const [deleteCtx, setDeleteCtx] = useState<{ record: RoleTemplateRecord; usage: string[] } | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!query.trim()) return templates
    const q = query.toLowerCase()
    return templates.filter(t =>
      t.role.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q)),
    )
  }, [templates, query])

  // Default-select first template once loaded
  useEffect(() => {
    if (!selected && filtered.length > 0) setSelected(filtered[0].id)
  }, [filtered, selected])

  const { builtIn, custom } = useMemo(() => {
    const b: RoleTemplateSummary[] = []
    const c: RoleTemplateSummary[] = []
    filtered.forEach(t => (t.builtIn ? b : c).push(t))
    return { builtIn: b, custom: c }
  }, [filtered])

  async function handleDelete(force: boolean) {
    if (!deleteCtx) return
    setDeleteLoading(true); setDeleteError(null)
    try {
      await api.deleteRoleTemplate(deleteCtx.record.id, force)
      setDeleteCtx(null)
      // If the deleted template was selected, clear selection
      if (selected === deleteCtx.record.id) setSelected(null)
      await refresh()
      setDetailTick(t => t + 1)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Modals */}
      {formMode && (
        <RoleTemplateFormModal
          mode={formMode}
          onClose={() => setFormMode(null)}
          onSaved={async (t) => {
            setFormMode(null)
            await refresh()
            setSelected(t.id)
            setDetailTick(n => n + 1)
          }}
        />
      )}
      {applyTarget && (
        <ApplyToAgentModal
          template={applyTarget}
          onClose={() => setApplyTarget(null)}
          onApplied={() => {
            // bump usage badge
            refresh()
            setDetailTick(t => t + 1)
          }}
        />
      )}
      {deleteCtx && (
        <ConfirmDialog
          title={`Delete "${deleteCtx.record.role}"?`}
          description={
            deleteCtx.usage.length > 0
              ? `This template is in use by ${deleteCtx.usage.length} agent(s): ${deleteCtx.usage.join(", ")}. Deleting will clear their role.${deleteError ? `\n\n${deleteError}` : ""}`
              : `This removes the template permanently. Skills and scripts at ~/.openclaw/skills/ are not affected.${deleteError ? `\n\n${deleteError}` : ""}`
          }
          destructive
          loading={deleteLoading}
          confirmLabel={deleteCtx.usage.length > 0 ? "Force delete" : "Delete"}
          onConfirm={() => handleDelete(deleteCtx.usage.length > 0)}
          onCancel={() => { setDeleteCtx(null); setDeleteError(null) }}
        />
      )}

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-foreground font-display">Role Templates</h1>
          <p className="text-[11px] sm:text-[12px] text-muted-foreground mt-0.5">
            ADLC agent role presets — agent files, skill bundles, and scripts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refresh()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setFormMode({ kind: "create" })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/25 text-[11px] text-primary font-medium hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-3 h-3" /> New Template
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex gap-3 rounded-2xl border border-border bg-card overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="p-3 shrink-0 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search templates…"
                className="w-full bg-input border border-border rounded-lg pl-8 pr-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
            {loading && templates.length === 0 && (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-[12px] text-destructive">{error}</p>
              </div>
            )}
            {builtIn.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-2 mb-1.5">
                  Built-in ({builtIn.length})
                </p>
                <div className="flex flex-col gap-1.5">
                  {builtIn.map(t => (
                    <TemplateCard key={t.id} t={t} selected={t.id === selected} onSelect={() => setSelected(t.id)} />
                  ))}
                </div>
              </div>
            )}
            {custom.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-2 mb-1.5">
                  Custom ({custom.length})
                </p>
                <div className="flex flex-col gap-1.5">
                  {custom.map(t => (
                    <TemplateCard key={t.id} t={t} selected={t.id === selected} onSelect={() => setSelected(t.id)} />
                  ))}
                </div>
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground/50">
                <Search className="w-6 h-6 opacity-50" />
                <p className="text-[12px]">No templates match "{query}"</p>
              </div>
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {selected ? (
            <DetailPanel
              id={selected}
              refreshTick={detailTick}
              onRecordLoaded={() => {}}
              onEdit={(r) => setFormMode({ kind: "edit", source: r })}
              onFork={(r) => setFormMode({ kind: "fork", source: r })}
              onDelete={(r, usage) => setDeleteCtx({ record: r, usage })}
              onApply={(r) => setApplyTarget(r)}
              onMutated={() => { refresh() }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 gap-2">
              <Package className="w-8 h-8 opacity-40" />
              <p className="text-sm">Select a template to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default RoleTemplatesPage
