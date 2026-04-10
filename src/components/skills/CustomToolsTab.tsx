/**
 * CustomToolsTab — Workspace Scripts playground
 *
 * Lists, creates, and edits scripts stored at ~/.openclaw/scripts/
 * These scripts can be referenced in cron jobs or executed by agents.
 */
import React, { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"
import type { WorkspaceScript } from "@/types"
import { cn } from "@/lib/utils"
import { SyntaxEditor, EXT_LANGUAGE } from "@/components/ui/SyntaxEditor"
import { AiAssistPanel } from "@/components/ai/AiAssistPanel"
import { TemplatePicker } from "@/components/ai/TemplatePicker"
import {
  Plus, Trash2, RefreshCw, Copy, Check, FileCode2, Terminal,
  Pencil, Save, X, AlertCircle, Loader2, FolderOpen, ChevronRight,
  Wand2, LayoutTemplate,
} from "lucide-react"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALLOWED_EXT = [".sh", ".py", ".js", ".ts", ".rb", ".bash", ".zsh", ".fish", ".lua"]

const EXT_COLOR: Record<string, string> = {
  ".sh": "text-emerald-400", ".bash": "text-emerald-400", ".zsh": "text-emerald-400", ".fish": "text-emerald-400",
  ".py": "text-blue-400",
  ".js": "text-yellow-400",
  ".ts": "text-sky-400",
  ".rb": "text-red-400",
  ".lua": "text-purple-400",
}

const STARTER: Record<string, string> = {
  ".sh": "#!/bin/bash\nset -euo pipefail\n\n# Your script here\necho \"Hello from script\"\n",
  ".py": "#!/usr/bin/env python3\n\n# Your script here\nprint(\"Hello from script\")\n",
  ".js": "#!/usr/bin/env node\n\n// Your script here\nconsole.log(\"Hello from script\");\n",
  ".ts": "#!/usr/bin/env ts-node\n\n// Your script here\nconsole.log(\"Hello from script\");\n",
  ".rb": "#!/usr/bin/env ruby\n\n# Your script here\nputs \"Hello from script\"\n",
  ".lua": "-- Your script here\nprint(\"Hello from script\")\n",
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  return `${(bytes / 1024).toFixed(1)}KB`
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60000) return "just now"
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// ─── Create dialog ────────────────────────────────────────────────────────────

function CreateScriptDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (script: WorkspaceScript) => void
}) {
  const [name, setName] = useState("")
  const [ext, setExt] = useState(".sh")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const filename = name.trim() ? `${name.trim().replace(/[^a-zA-Z0-9_.\-]/g, "_")}${ext}` : ""

  async function handleCreate() {
    if (!name.trim()) { setError("Name required"); return }
    setLoading(true)
    setError(null)
    try {
      const content = STARTER[ext] || `# ${filename}\n`
      const result = await api.saveScript(filename, content) as WorkspaceScript
      onCreate(result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-popover ghost-border shadow-[var(--shadow-elevated)] p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-foreground">New Script</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="my-script"
              className="w-full rounded-lg bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</label>
            <div className="grid grid-cols-4 gap-1.5">
              {ALLOWED_EXT.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setExt(e)}
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-xs font-mono font-semibold transition-colors border",
                    ext === e
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {filename && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60 bg-secondary/50 rounded-lg px-3 py-2">
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono">~/.openclaw/scripts/<span className="text-foreground">{filename}</span></span>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Script editor ────────────────────────────────────────────────────────────

function ScriptEditor({
  script,
  onSaved,
  onDeleted,
  onRenamed,
  agentId,
}: {
  script: WorkspaceScript
  onSaved: (s: WorkspaceScript) => void
  onDeleted: (name: string) => void
  onRenamed: (oldName: string, s: WorkspaceScript) => void
  agentId?: string
}) {
  const [content, setContent] = useState(script.content ?? "")
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(script.name.replace(/\.[^.]+$/, ""))
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Metadata
  const [displayName, setDisplayName] = useState(script.displayName ?? "")
  const [description, setDescription] = useState(script.description ?? "")
  const [metaDirty, setMetaDirty] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)

  // Reset when script changes
  useEffect(() => {
    setContent(script.content ?? "")
    setDisplayName(script.displayName ?? "")
    setDescription(script.description ?? "")
    setDirty(false)
    setMetaDirty(false)
    setConfirmDelete(false)
    setRenaming(false)
  }, [script.name])

  async function handleSaveMeta() {
    setSavingMeta(true)
    try {
      await api.updateScriptMeta(script.name, { name: displayName, description })
      onSaved({ ...script, displayName, description })
      setMetaDirty(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to save metadata")
    } finally {
      setSavingMeta(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const [result] = await Promise.all([
        api.saveScript(script.name, content) as Promise<WorkspaceScript>,
        metaDirty ? api.updateScriptMeta(script.name, { name: displayName, description }) : Promise.resolve(null),
      ])
      onSaved({ ...result, content, displayName, description })
      setDirty(false)
      setMetaDirty(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.deleteScript(script.name)
      onDeleted(script.name)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to delete")
      setDeleting(false)
    }
  }

  async function handleRename() {
    const ext = script.name.match(/(\.[^.]+)$/)?.[1] || ""
    const full = `${newName.trim().replace(/[^a-zA-Z0-9_.\-]/g, "_")}${ext}`
    if (full === script.name) { setRenaming(false); return }
    try {
      const result = await api.renameScript(script.name, full) as WorkspaceScript
      onRenamed(script.name, result)
      setRenaming(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to rename")
    }
  }

  function copyHint() {
    navigator.clipboard.writeText(script.execHint).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const extColor = EXT_COLOR[script.ext] || "text-muted-foreground"

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-start justify-between gap-3 px-4 py-3 border-b border-border/40">
        <div className="flex flex-col gap-1 min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false) }}
                className="bg-secondary border border-border rounded-lg px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <span className={cn("text-sm font-mono", extColor)}>{script.ext}</span>
              <button onClick={handleRename} className="p-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setRenaming(false)} className="p-1 rounded-md hover:bg-secondary text-muted-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-lg">{script.emoji}</span>
              <span className="font-mono font-semibold text-foreground truncate">{script.name}</span>
              <button onClick={() => setRenaming(true)} className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary transition-colors">
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className={cn("font-mono font-semibold", extColor)}>{script.lang}</span>
            <span>{fmtSize(script.size)}</span>
            <span>modified {fmtDate(script.mtime)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          )}
          <button
            onClick={() => setShowTemplatePicker(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs font-bold text-muted-foreground hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/10 transition-colors"
            title="ADLC Script Templates"
          >
            <LayoutTemplate className="h-3.5 w-3.5" /> Templates
          </button>
          <button
            onClick={() => setShowAiPanel(p => !p)}
            className={cn("flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-bold transition-colors",
              showAiPanel
                ? "bg-violet-500/20 border-violet-500/30 text-violet-400"
                : "border-border text-muted-foreground hover:text-violet-400 hover:border-violet-500/30 hover:bg-violet-500/10"
            )}
            title="AI Assist"
          >
            <Wand2 className="h-3.5 w-3.5" /> AI
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-lg px-2 py-1">
              <span className="text-xs text-destructive">Delete?</span>
              <button onClick={handleDelete} disabled={deleting} className="text-xs font-semibold text-destructive hover:underline ml-1">
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground hover:text-foreground ml-1">No</button>
            </div>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="shrink-0 flex flex-col gap-2 px-4 py-3 border-b border-border/30 bg-secondary/20">
        <div className="flex items-center gap-2">
          <input
            value={displayName}
            onChange={e => { setDisplayName(e.target.value); setMetaDirty(true) }}
            placeholder="Display name (e.g. Health Check)"
            className="flex-1 bg-transparent border-b border-border/40 focus:border-primary/50 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none py-0.5 transition-colors"
          />
          {metaDirty && !dirty && (
            <button onClick={handleSaveMeta} disabled={savingMeta}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50">
              {savingMeta ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save meta
            </button>
          )}
        </div>
        <input
          value={description}
          onChange={e => { setDescription(e.target.value); setMetaDirty(true) }}
          placeholder="Description — what does this script do? (injected into TOOLS.md)"
          className="bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none border-b border-transparent focus:border-border/40 py-0.5 transition-colors w-full"
        />
      </div>

      {/* Exec hint */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-secondary/30 border-b border-border/30">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <code className="flex-1 text-xs font-mono text-muted-foreground/70 truncate">{script.execHint}</code>
        <button
          onClick={copyHint}
          className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-foreground transition-colors shrink-0"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>

      {/* Live syntax-highlighted editor */}
      <SyntaxEditor
        value={content}
        onChange={v => { setContent(v); setDirty(true) }}
        ext={script.ext}
        className="flex-1 min-h-0"
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault()
            if (dirty || metaDirty) handleSave()
          }
        }}
      />

      {/* AI Assist Panel */}
      {showAiPanel && (
        <AiAssistPanel
          fileType="script"
          currentContent={content}
          agentId={agentId}
          extraContext={[
            `Script name: ${script.name}`,
            `Language: ${script.lang} (${script.ext})`,
            description ? `Purpose: ${description}` : "",
            `Exec hint: ${script.execHint}`,
            agentId ? `Agent ID: ${agentId}` : "Scope: shared (all agents)",
          ].filter(Boolean).join(". ")}
          placeholder={`Describe what this script should do… (e.g. "Check postgres connection and return status", "List all running docker containers as JSON")`}
          onApply={(generated) => {
            setContent(generated)
            setDirty(true)
            setShowAiPanel(false)
          }}
          onClose={() => setShowAiPanel(false)}
        />
      )}

      {/* ADLC Script Template Picker */}
      {showTemplatePicker && (
        <TemplatePicker
          mode="script"
          onSelect={(templateContent) => {
            setContent(templateContent)
            setDirty(true)
            setShowTemplatePicker(false)
          }}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}

      {/* Footer shortcuts */}
      <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-t border-border/30 text-[10px] text-muted-foreground/40">
        <span><kbd>⌘S</kbd> save</span>
        <span><kbd>Tab</kbd> indent</span>
        <span className="ml-auto font-mono">{content.split("\n").length} lines</span>
      </div>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

interface CustomToolsTabProps {
  onScriptSelect?: (script: WorkspaceScript) => void
  agentId?: string
}

export function CustomToolsTab({ onScriptSelect, agentId }: CustomToolsTabProps) {
  const [scripts, setScripts] = useState<WorkspaceScript[]>([])
  const [selected, setSelected] = useState<WorkspaceScript | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState("")
  const [loadingContent, setLoadingContent] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await api.listScripts() as { scripts: WorkspaceScript[] }
      setScripts(r.scripts ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function selectScript(s: WorkspaceScript) {
    if (s.name === selected?.name && selected?.content !== undefined) return
    setLoadingContent(true)
    try {
      const full = await api.getScript(s.name) as WorkspaceScript
      setSelected(full)
    } catch {
      setSelected(s)
    } finally {
      setLoadingContent(false)
    }
  }

  function handleCreated(script: WorkspaceScript) {
    setScripts((prev) => [script, ...prev])
    setShowCreate(false)
    selectScript(script)
  }

  function handleSaved(script: WorkspaceScript) {
    setScripts((prev) => prev.map((s) => s.name === script.name ? { ...s, ...script } : s))
    setSelected(script)
  }

  function handleDeleted(name: string) {
    setScripts((prev) => prev.filter((s) => s.name !== name))
    if (selected?.name === name) setSelected(null)
  }

  function handleRenamed(oldName: string, newScript: WorkspaceScript) {
    setScripts((prev) => prev.map((s) => s.name === oldName ? newScript : s))
    selectScript(newScript)
  }

  const filtered = scripts.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  )

  const extGroups = [...new Set(filtered.map((s) => s.ext))].sort()

  return (
    <div className="flex h-full min-h-0">
      {showCreate && (
        <CreateScriptDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreated}
        />
      )}

      {/* Left panel */}
      <div className="w-64 shrink-0 border-r border-border/40 flex flex-col min-h-0">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-3 border-b border-border/30">
          <div className="flex-1 flex items-center gap-1.5 bg-secondary rounded-lg px-2.5 py-1.5">
            <svg className="h-3 w-3 text-muted-foreground/50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            title="New script"
            className="p-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={load}
            disabled={loading}
            title="Refresh"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0 disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>

        {/* Script list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground/40">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {error && (
            <div className="px-3 py-4 text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
              <div className="p-3 rounded-xl bg-secondary">
                <FolderOpen className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <p className="text-xs text-muted-foreground/60">
                {search ? "No scripts match" : "No scripts yet"}
              </p>
              {!search && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="text-xs text-primary hover:underline"
                >
                  Create your first script
                </button>
              )}
            </div>
          )}

          {/* Group by extension */}
          {!loading && filtered.length > 0 && extGroups.map((ext) => {
            const group = filtered.filter((s) => s.ext === ext)
            return (
              <div key={ext}>
                <div className="px-3 py-1.5 flex items-center gap-1.5">
                  <span className={cn("text-[10px] font-mono font-semibold uppercase", EXT_COLOR[ext] || "text-muted-foreground")}>
                    {ext}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">{group.length}</span>
                </div>
                {group.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => selectScript(s)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      selected?.name === s.name
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                    )}
                  >
                    <span className="text-base shrink-0">{s.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{s.name}</p>
                      <p className="text-[10px] text-muted-foreground/50">{fmtSize(s.size)} · {fmtDate(s.mtime)}</p>
                    </div>
                    {selected?.name === s.name && <ChevronRight className="h-3 w-3 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            )
          })}
        </div>

        {/* Footer stats */}
        <div className="shrink-0 border-t border-border/30 px-3 py-2 text-[10px] text-muted-foreground/40 flex items-center gap-2">
          <FileCode2 className="h-3 w-3" />
          <span>{scripts.length} script{scripts.length !== 1 ? "s" : ""}</span>
          <span className="ml-auto font-mono">~/.openclaw/scripts/</span>
        </div>
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {loadingContent ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/40">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : selected ? (
          <ScriptEditor
            script={selected}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onRenamed={handleRenamed}
            agentId={agentId}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground/40">
            <div className="p-5 rounded-2xl bg-secondary/50">
              <Terminal className="h-8 w-8" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground">Select a script to edit</p>
              <p className="text-xs mt-1 opacity-60">Scripts are stored at ~/.openclaw/scripts/</p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm hover:bg-primary/15 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create new script
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
