// ── ProjectPlanTab ──────────────────────────────────────────────────────────
//
// First-class epic planning surface for ADLC projects. Replaces the cramped
// EpicsCard that lived in Settings. Each epic gets a rich card with:
//   - title, description, status pill
//   - progress bar (done / total)
//   - status breakdown (counts per status)
//   - stage breakdown (ADLC stages — counts in active stages)
//   - "View on board" link that filters to this epic
//   - inline edit (title/description/status) and delete
//
// Plus a "No epic" section at the bottom showing orphan tasks (tasks without
// epicId) so the operator can drag-assign them later (drag is future work).
//
// Epic is OPTIONAL — the empty state explains this. Skip for small projects.

import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2, Loader2, Pencil, Save, ChevronRight, Layers, X, AlertCircle, CheckCircle2, Clock, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Epic, EpicStatus, Task, TaskStage } from "@/types"
import { STAGE_LABEL, STAGE_TONE, ALL_STAGES } from "@/lib/projectLabels"

const EPIC_STATUS_CONFIG: Record<EpicStatus, { label: string; tone: string; dot: string }> = {
  open:        { label: "Planned",     tone: "text-zinc-300 bg-zinc-500/10 border-zinc-500/30",   dot: "bg-zinc-400" },
  in_progress: { label: "In Progress", tone: "text-amber-300 bg-amber-500/10 border-amber-500/30", dot: "bg-amber-400" },
  done:        { label: "Done",        tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400" },
  cancelled:   { label: "Cancelled",   tone: "text-red-300 bg-red-500/10 border-red-500/30",       dot: "bg-red-400" },
}

const TASK_STATUS_TONE: Record<string, string> = {
  backlog:     "text-zinc-400 bg-zinc-500/10",
  todo:        "text-blue-400 bg-blue-500/10",
  in_progress: "text-amber-400 bg-amber-500/10",
  in_review:   "text-purple-400 bg-purple-500/10",
  blocked:     "text-red-400 bg-red-500/10",
  done:        "text-emerald-400 bg-emerald-500/10",
  cancelled:   "text-muted-foreground bg-muted/30",
}

interface Stats {
  total: number
  done: number
  inProgress: number
  blocked: number
  inReview: number
  todo: number
  backlog: number
  byStage: Partial<Record<TaskStage, number>>
}

function buildStats(tasks: Task[]): Stats {
  const s: Stats = { total: 0, done: 0, inProgress: 0, blocked: 0, inReview: 0, todo: 0, backlog: 0, byStage: {} }
  for (const t of tasks) {
    s.total++
    if (t.status === 'done') s.done++
    else if (t.status === 'in_progress') s.inProgress++
    else if (t.status === 'blocked') s.blocked++
    else if (t.status === 'in_review') s.inReview++
    else if (t.status === 'todo') s.todo++
    else if (t.status === 'backlog') s.backlog++
    if (t.stage) s.byStage[t.stage] = (s.byStage[t.stage] || 0) + 1
  }
  return s
}

export function ProjectPlanTab({
  projectId, canEdit, onJumpToBoardWithFilter,
}: {
  projectId: string
  canEdit: boolean
  /** Optional: navigate to Board tab with epicId filter applied. */
  onJumpToBoardWithFilter?: (epicId: string | null) => void
}) {
  const [epics, setEpics] = useState<Epic[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOrphans, setShowOrphans] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    try {
      const [eRes, tRes] = await Promise.all([
        api.listEpics(projectId),
        api.getTasks({ projectId }),
      ])
      setEpics(eRes.epics)
      setTasks(tRes.tasks)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Group tasks by epicId
  const tasksByEpic = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      const k = t.epicId || '__orphan__'
      const list = map.get(k) || []
      list.push(t)
      map.set(k, list)
    }
    return map
  }, [tasks])

  const orphanTasks = tasksByEpic.get('__orphan__') || []

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground mb-1">Plan</h2>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Group related tasks under an epic to track a single outcome across stages.
            Epics are optional — skip if your project is small.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="h-8 text-xs gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> New Epic
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {createOpen && (
        <CreateEpicForm
          projectId={projectId}
          onCreated={(epic) => { setEpics(prev => [...prev, epic]); setCreateOpen(false) }}
          onCancel={() => setCreateOpen(false)}
        />
      )}

      {/* Loading */}
      {loading && epics.length === 0 && tasks.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      )}

      {/* Empty state */}
      {!loading && epics.length === 0 && !createOpen && (
        <div className="rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-10 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-foreground/80 font-medium mb-1">No epics yet</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto mb-4">
            Use epics when you have a cluster of tasks pursuing one outcome (e.g. <em>"Auth v1"</em>, <em>"Onboarding redesign"</em>).
            Otherwise tasks live directly in the project — that's fine too.
          </p>
          {canEdit && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Create your first epic
            </Button>
          )}
        </div>
      )}

      {/* Epic cards */}
      {epics.length > 0 && (
        <div className="space-y-3">
          {epics.map(epic => {
            const epicTasks = tasksByEpic.get(epic.id) || []
            return (
              <EpicCard
                key={epic.id}
                epic={epic}
                tasks={epicTasks}
                canEdit={canEdit}
                onUpdated={(updated) => setEpics(prev => prev.map(e => e.id === updated.id ? updated : e))}
                onDeleted={(id) => setEpics(prev => prev.filter(e => e.id !== id))}
                onJumpToBoard={() => onJumpToBoardWithFilter?.(epic.id)}
              />
            )
          })}
        </div>
      )}

      {/* Orphan tasks */}
      {orphanTasks.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card/20 overflow-hidden">
          <button
            onClick={() => setShowOrphans(!showOrphans)}
            className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border/30 hover:bg-muted/20 transition-colors"
          >
            {showOrphans ? <Eye className="h-3.5 w-3.5 text-muted-foreground" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="text-xs font-semibold text-foreground/80">No epic</span>
            <span className="text-[10px] text-muted-foreground/60">
              {orphanTasks.length} task{orphanTasks.length === 1 ? '' : 's'} not grouped
            </span>
            {onJumpToBoardWithFilter && (
              <button
                onClick={(e) => { e.stopPropagation(); onJumpToBoardWithFilter('__none__' as unknown as string) }}
                className="ml-auto text-[10px] text-primary hover:underline"
              >
                View on board →
              </button>
            )}
          </button>
          {showOrphans && (
            <ul className="divide-y divide-border/20">
              {orphanTasks.slice(0, 8).map(t => (
                <li key={t.id} className="px-4 py-2 flex items-center gap-2 text-xs">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", TASK_STATUS_TONE[t.status])}>
                    {t.status.replace('_', ' ')}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-foreground/80" title={t.title}>{t.title}</span>
                </li>
              ))}
              {orphanTasks.length > 8 && (
                <li className="px-4 py-1.5 text-[10px] text-muted-foreground/60 text-center italic">
                  + {orphanTasks.length - 8} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── Single epic card ──────────────────────────────────────────────────────

function EpicCard({
  epic, tasks, canEdit, onUpdated, onDeleted, onJumpToBoard,
}: {
  epic: Epic
  tasks: Task[]
  canEdit: boolean
  onUpdated: (epic: Epic) => void
  onDeleted: (id: string) => void
  onJumpToBoard: () => void
}) {
  const stats = useMemo(() => buildStats(tasks), [tasks])
  const cfg = EPIC_STATUS_CONFIG[epic.status]
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(epic.title)
  const [desc, setDesc] = useState(epic.description || '')
  const [status, setStatus] = useState<EpicStatus>(epic.status)

  const progressPct = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100)

  async function save() {
    setBusy(true)
    try {
      const r = await api.updateEpic(epic.id, {
        title: title.trim(),
        description: desc.trim() || undefined,
        status,
      })
      onUpdated(r.epic)
      setEditing(false)
    } catch (e) { console.error(e) }
    finally { setBusy(false) }
  }

  async function handleDelete() {
    if (!confirm(`Delete epic "${epic.title}"?\n\nTasks under this epic will be detached but not deleted.`)) return
    setBusy(true)
    try { await api.deleteEpic(epic.id); onDeleted(epic.id) }
    finally { setBusy(false) }
  }

  // Active stages (with at least one task in non-final status)
  const activeStages: TaskStage[] = ALL_STAGES.filter(s => (stats.byStage[s] || 0) > 0)

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden hover:border-border/60 transition-colors">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/30 flex items-start gap-3">
        <Layers className="h-4 w-4 text-purple-400/70 mt-0.5 shrink-0" />

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-input border border-border/50 rounded-md px-2 py-1 text-sm font-semibold focus:outline-none focus:border-primary/60"
              />
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full bg-input border border-border/50 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-primary/60 resize-none"
              />
              <div className="flex items-center gap-2">
                <Select value={status} onValueChange={(v) => setStatus(v as EpicStatus)}>
                  <SelectTrigger className="h-7 text-xs w-36">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full", EPIC_STATUS_CONFIG[status].dot)} />
                      {EPIC_STATUS_CONFIG[status].label}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EPIC_STATUS_CONFIG) as EpicStatus[]).map(s => (
                      <SelectItem key={s} value={s} className="text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className={cn("w-1.5 h-1.5 rounded-full", EPIC_STATUS_CONFIG[s].dot)} />
                          {EPIC_STATUS_CONFIG[s].label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setTitle(epic.title); setDesc(epic.description || ''); setStatus(epic.status); setEditing(false) }}>
                    Cancel
                  </Button>
                  <Button size="sm" className="h-6 text-xs" onClick={save} disabled={busy || !title.trim()}>
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground break-words">{epic.title}</h3>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", cfg.tone)}>
                  {cfg.label}
                </span>
              </div>
              {epic.description && (
                <p className="text-xs text-muted-foreground/90 mt-1 whitespace-pre-wrap break-words">{epic.description}</p>
              )}
            </>
          )}
        </div>

        {!editing && canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              title="Edit"
              className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              title="Delete"
              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Body — stats + progress */}
      <div className="px-4 py-3 space-y-3">
        {stats.total === 0 ? (
          <p className="text-xs text-muted-foreground italic">No tasks yet under this epic.</p>
        ) : (
          <>
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-muted-foreground/70">
                  {stats.done} of {stats.total} done
                </span>
                <span className="text-muted-foreground/70 font-mono">{progressPct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full bg-emerald-500/70 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Status breakdown chips */}
            <div className="flex items-center gap-2 flex-wrap">
              {stats.inProgress > 0 && (
                <StatChip icon={Clock} label={`${stats.inProgress} in progress`} tone="amber" />
              )}
              {stats.inReview > 0 && (
                <StatChip icon={Eye} label={`${stats.inReview} in review`} tone="purple" />
              )}
              {stats.blocked > 0 && (
                <StatChip icon={AlertCircle} label={`${stats.blocked} blocked`} tone="red" />
              )}
              {stats.todo > 0 && (
                <StatChip icon={ChevronRight} label={`${stats.todo} todo`} tone="blue" />
              )}
              {stats.backlog > 0 && (
                <StatChip icon={ChevronRight} label={`${stats.backlog} backlog`} tone="zinc" />
              )}
              {stats.done > 0 && (
                <StatChip icon={CheckCircle2} label={`${stats.done} done`} tone="emerald" />
              )}
            </div>

            {/* Stage breakdown (ADLC) */}
            {activeStages.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-border/20 mt-2">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mr-1">Stages:</span>
                {activeStages.map(s => (
                  <span
                    key={s}
                    className={cn(
                      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-medium",
                      STAGE_TONE[s]
                    )}
                  >
                    {STAGE_LABEL[s]} <span className="opacity-60">{stats.byStage[s]}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {/* Footer actions */}
        <div className="flex items-center pt-2 border-t border-border/20 -mx-4 px-4">
          <button
            onClick={onJumpToBoard}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            View on board <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function StatChip({
  icon: Icon, label, tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone: 'amber' | 'purple' | 'red' | 'blue' | 'zinc' | 'emerald'
}) {
  const cfg: Record<string, string> = {
    amber:   'text-amber-400 bg-amber-500/10 border-amber-500/20',
    purple:  'text-purple-400 bg-purple-500/10 border-purple-500/20',
    red:     'text-red-400 bg-red-500/10 border-red-500/20',
    blue:    'text-blue-400 bg-blue-500/10 border-blue-500/20',
    zinc:    'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium", cfg[tone])}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  )
}

// ── Create form ──────────────────────────────────────────────────────────

function CreateEpicForm({
  projectId, onCreated, onCancel,
}: {
  projectId: string
  onCreated: (epic: Epic) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return }
    setBusy(true); setError(null)
    try {
      const r = await api.createEpic(projectId, { title: title.trim(), description: desc.trim() || undefined })
      onCreated(r.epic)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">New epic</h3>
        <button onClick={onCancel} className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Epic title (e.g. 'Auth v1', 'Onboarding redesign')"
        className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary/60"
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="What's the outcome? (optional)"
        rows={2}
        className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-xs focus:outline-none focus:border-primary/60 resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={submit} disabled={busy || !title.trim()}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Create
        </Button>
      </div>
    </div>
  )
}
