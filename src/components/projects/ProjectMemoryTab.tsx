// ── ProjectMemoryTab ────────────────────────────────────────────────────────
//
// Phase A2 — structured persistent project memory. Four kinds:
//   - decision  (what we chose + why; default status='resolved')
//   - question  (open question awaiting an answer; status='open' default)
//   - risk      (4-risk framework: value/usability/feasibility/viability)
//   - glossary  (term + definition)
//
// Items here are injected into agent dispatch context.json under
// `projectMemory` so every dispatched task sees the latest. PM-friendly UI:
// inline create per kind, click to expand/edit, status pills.

import { useEffect, useMemo, useState } from "react"
import { Lightbulb, HelpCircle, AlertTriangle, BookOpen, Plus, Trash2, CheckCircle2, Archive, X, Loader2, Pencil, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { confirmDialog } from "@/lib/dialogs"
import type {
  ProjectMemoryItem, ProjectMemoryKind, ProjectMemoryMeta,
  ProjectMemoryStatus, ProjectRiskCategory, ProjectRiskSeverity,
} from "@/types"

const KIND_CONFIG: Record<ProjectMemoryKind, {
  label: string; plural: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string; bg: string; border: string;
  description: string;
  emptyHint: string;
}> = {
  decision: {
    label: "Decision", plural: "Decisions",
    icon: Lightbulb, tone: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20",
    description: "What we chose and why. Captures rationale so the team / agents don't re-litigate.",
    emptyHint: "No decisions logged yet.",
  },
  question: {
    label: "Question", plural: "Open Questions",
    icon: HelpCircle, tone: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20",
    description: "Things we still need answers on. Shown to agents at every dispatch.",
    emptyHint: "No open questions.",
  },
  risk: {
    label: "Risk", plural: "Risks",
    icon: AlertTriangle, tone: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20",
    description: "Active risks (Value / Usability / Feasibility / Viability framework).",
    emptyHint: "No risks tracked.",
  },
  glossary: {
    label: "Term", plural: "Glossary",
    icon: BookOpen, tone: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20",
    description: "Domain terms and definitions. Helps agents speak the right language.",
    emptyHint: "No terms defined.",
  },
}

const STATUS_CONFIG: Record<ProjectMemoryStatus, { label: string; tone: string }> = {
  open:     { label: "Open",     tone: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  resolved: { label: "Resolved", tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  archived: { label: "Archived", tone: "text-muted-foreground/60 bg-muted/30 border-border/40" },
}

const RISK_CATEGORY_LABEL: Record<ProjectRiskCategory, string> = {
  value: "Value", usability: "Usability", feasibility: "Feasibility", viability: "Viability",
}
const RISK_SEVERITY_LABEL: Record<ProjectRiskSeverity, string> = {
  low: "Low", medium: "Medium", high: "High",
}

export function ProjectMemoryTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [items, setItems] = useState<ProjectMemoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeKind, setActiveKind] = useState<ProjectMemoryKind>("decision")

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await api.listProjectMemory(projectId)
      setItems(r.items)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<ProjectMemoryKind, number> = { decision: 0, question: 0, risk: 0, glossary: 0 }
    for (const it of items) {
      if (it.kind === 'question' || it.kind === 'risk') {
        if (it.status === 'open') c[it.kind]++
      } else {
        c[it.kind]++
      }
    }
    return c
  }, [items])

  const filtered = items.filter(it => it.kind === activeKind)
  const cfg = KIND_CONFIG[activeKind]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">Project Memory</h2>
        <p className="text-xs text-muted-foreground">
          Persistent context surfaced into every agent dispatch. Decisions, open questions, risks, and glossary.
        </p>
      </div>

      {/* Kind tabs */}
      <div className="flex items-center gap-1 border-b border-border/40">
        {(Object.keys(KIND_CONFIG) as ProjectMemoryKind[]).map(k => {
          const c = KIND_CONFIG[k]
          const Icon = c.icon
          const isActive = activeKind === k
          return (
            <button
              key={k}
              onClick={() => setActiveKind(k)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4", isActive && c.tone)} />
              {c.plural}
              {counts[k] > 0 && (
                <span className={cn(
                  "text-[10px] font-mono px-1.5 py-0.5 rounded-full",
                  isActive ? cn(c.bg, c.tone) : "bg-muted/40 text-muted-foreground"
                )}>
                  {counts[k]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Section description */}
      <p className="text-xs text-muted-foreground -mt-2">{cfg.description}</p>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Create row */}
      {canEdit && (
        <CreateMemoryForm
          projectId={projectId}
          kind={activeKind}
          onCreated={(item) => setItems(prev => [item, ...prev])}
        />
      )}

      {/* List */}
      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading memory…
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-6 text-center">{cfg.emptyHint}</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map(item => (
            <MemoryRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              onUpdate={(updated) => setItems(prev => prev.map(p => p.id === updated.id ? updated : p))}
              onDelete={(id) => setItems(prev => prev.filter(p => p.id !== id))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Create form (kind-aware) ──────────────────────────────────────────────

function CreateMemoryForm({
  projectId, kind, onCreated,
}: {
  projectId: string
  kind: ProjectMemoryKind
  onCreated: (item: ProjectMemoryItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [riskCategory, setRiskCategory] = useState<ProjectRiskCategory>("value")
  const [riskSeverity, setRiskSeverity] = useState<ProjectRiskSeverity>("medium")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTitle(""); setBody(""); setRiskCategory("value"); setRiskSeverity("medium"); setError(null)
  }

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required"); return }
    setSubmitting(true); setError(null)
    try {
      const meta: ProjectMemoryMeta = kind === 'risk' ? { category: riskCategory, severity: riskSeverity } : {}
      const r = await api.createProjectMemory(projectId, { kind, title: title.trim(), body, meta })
      onCreated(r.item)
      reset(); setOpen(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSubmitting(false) }
  }

  const cfg = KIND_CONFIG[kind]
  const placeholder = {
    decision: "e.g. Use SQLite for v1 (not Postgres)",
    question: "e.g. Should free tier include API access?",
    risk: "e.g. Users may not adopt the new flow",
    glossary: "e.g. Dispatch",
  }[kind]
  const bodyPlaceholder = {
    decision: "Why this choice + what we considered…",
    question: "Context, who needs to answer, by when…",
    risk: "Likelihood, impact, mitigation idea…",
    glossary: "Definition (markdown ok)…",
  }[kind]

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-3 w-3" /> New {cfg.label}
      </Button>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-4 space-y-3">
      {error && <div className="text-xs text-destructive">{error}</div>}
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary/60"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={bodyPlaceholder}
        rows={3}
        className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-xs focus:outline-none focus:border-primary/60 resize-none"
      />
      {kind === 'risk' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1 block">Category</label>
            <Select value={riskCategory} onValueChange={(v) => setRiskCategory(v as ProjectRiskCategory)}>
              <SelectTrigger className="h-8 text-xs">{RISK_CATEGORY_LABEL[riskCategory]}</SelectTrigger>
              <SelectContent>
                {(Object.keys(RISK_CATEGORY_LABEL) as ProjectRiskCategory[]).map(c => (
                  <SelectItem key={c} value={c} className="text-xs">{RISK_CATEGORY_LABEL[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1 block">Severity</label>
            <Select value={riskSeverity} onValueChange={(v) => setRiskSeverity(v as ProjectRiskSeverity)}>
              <SelectTrigger className="h-8 text-xs">{RISK_SEVERITY_LABEL[riskSeverity]}</SelectTrigger>
              <SelectContent>
                {(Object.keys(RISK_SEVERITY_LABEL) as ProjectRiskSeverity[]).map(s => (
                  <SelectItem key={s} value={s} className="text-xs">{RISK_SEVERITY_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { reset(); setOpen(false) }} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={submitting || !title.trim()}>
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
      </div>
    </div>
  )
}

// ── Single row (view + edit) ──────────────────────────────────────────────

function MemoryRow({
  item, canEdit, onUpdate, onDelete,
}: {
  item: ProjectMemoryItem
  canEdit: boolean
  onUpdate: (item: ProjectMemoryItem) => void
  onDelete: (id: string) => void
}) {
  const cfg = KIND_CONFIG[item.kind]
  const Icon = cfg.icon
  const statusCfg = STATUS_CONFIG[item.status]
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [body, setBody] = useState(item.body)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const r = await api.updateProjectMemory(item.id, { title: title.trim(), body })
      onUpdate(r.item)
      setEditing(false)
    } catch (e) { console.error(e) }
    finally { setBusy(false) }
  }

  async function setStatus(status: ProjectMemoryStatus) {
    setBusy(true)
    try {
      const r = await api.updateProjectMemory(item.id, { status })
      onUpdate(r.item)
    } finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!await confirmDialog({ title: `Delete this ${cfg.label.toLowerCase()}?`, confirmLabel: "Delete", destructive: true })) return
    setBusy(true)
    try { await api.deleteProjectMemory(item.id); onDelete(item.id) }
    finally { setBusy(false) }
  }

  const showStatus = item.kind === 'question' || item.kind === 'risk'

  return (
    <li className="rounded-lg border border-border/40 bg-card/30 p-3 group">
      <div className="flex items-start gap-3">
        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", cfg.tone)} />

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-input border border-border/50 rounded-md px-2 py-1 text-sm focus:outline-none focus:border-primary/60"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="w-full bg-input border border-border/50 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-primary/60 resize-none"
              />
              <div className="flex items-center gap-2 justify-end">
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setTitle(item.title); setBody(item.body); setEditing(false) }}>
                  Cancel
                </Button>
                <Button size="sm" className="h-6 text-xs" onClick={save} disabled={busy || !title.trim()}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-foreground/90 break-words">{item.title}</p>
                {showStatus && (
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", statusCfg.tone)}>
                    {statusCfg.label}
                  </span>
                )}
                {item.kind === 'risk' && item.meta?.category && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 bg-muted/40 text-muted-foreground font-medium">
                    {RISK_CATEGORY_LABEL[item.meta.category as ProjectRiskCategory]}
                  </span>
                )}
                {item.kind === 'risk' && item.meta?.severity && (
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border font-medium",
                    item.meta.severity === 'high' ? 'border-red-500/30 bg-red-500/10 text-red-400'
                    : item.meta.severity === 'medium' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    : 'border-border/40 bg-muted/30 text-muted-foreground'
                  )}>
                    {RISK_SEVERITY_LABEL[item.meta.severity as ProjectRiskSeverity]}
                  </span>
                )}
              </div>
              {item.body && (
                <p className="text-xs text-muted-foreground/90 mt-1.5 whitespace-pre-wrap break-words">{item.body}</p>
              )}
              <p className="text-[10px] text-muted-foreground/50 mt-2">
                {new Date(item.createdAt).toLocaleString()}
              </p>
            </>
          )}
        </div>

        {/* Actions */}
        {!editing && canEdit && (
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {showStatus && item.status === 'open' && (
              <button
                onClick={() => setStatus('resolved')}
                disabled={busy}
                title="Mark resolved"
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-emerald-400 transition-colors"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </button>
            )}
            {showStatus && item.status === 'resolved' && (
              <button
                onClick={() => setStatus('open')}
                disabled={busy}
                title="Reopen"
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-amber-400 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {item.status !== 'archived' && (
              <button
                onClick={() => setStatus('archived')}
                disabled={busy}
                title="Archive"
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              title="Edit"
              className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              title="Delete"
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
