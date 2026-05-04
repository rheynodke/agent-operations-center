import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  Plus, Inbox, ListTodo, Zap, ScanSearch, OctagonX, CircleCheckBig,
  Sparkles, FolderGit2, Wrench, FlaskConical, Pencil, Cpu, ShieldCheck,
  FileText, Rocket, Compass, ListChecks as ListChecksIcon,
  LayoutGrid, List, MessageSquare
} from "lucide-react"
import { TaskListView } from "@/components/board/TaskListView"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { KanbanBoard, KanbanColumnDef } from "@/components/board/KanbanBoard"
import { TaskCard } from "@/components/board/TaskCard"
import { TaskFilterBar } from "@/components/board/TaskFilterBar"
import { TaskCreateModal } from "@/components/board/TaskCreateModal"
import { TaskPanel } from "@/components/board/TaskPanel"
import { TaskStatusTicker } from "@/components/board/TaskStatusTicker"
import { ProjectSwitcher } from "@/components/board/ProjectSwitcher"
import { ProjectSettingsPanel } from "@/components/board/ProjectSettingsPanel"
import { IntegrationWizard } from "@/components/board/IntegrationWizard"
import { ProjectCreateWizard } from "@/components/board/ProjectCreateWizard"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { useTaskStore, useAgentStore } from "@/stores"
import { useProjectStore } from "@/stores/useProjectStore"
import { api } from "@/lib/api"
import { Task, TaskStatus, ProjectIntegration } from "@/types"

const STATUS_COLUMNS: KanbanColumnDef[] = [
  { id: "backlog",     label: "Backlog",     icon: Inbox,          },
  { id: "todo",        label: "Todo",        icon: ListTodo,       },
  { id: "in_progress", label: "In Progress", icon: Zap,            },
  { id: "in_review",   label: "In Review",   icon: ScanSearch,     },
  { id: "blocked",     label: "Blocked",     icon: OctagonX,       collapsible: true },
  { id: "done",        label: "Done",        icon: CircleCheckBig, collapsible: true, defaultCollapsed: true },
]

// Stage view (Phase C.1) — used when project.kind === 'adlc' and the user
// toggles the board to "Stage" mode. Drag-drop here updates `task.stage`.
// Tasks without a stage land in a virtual "no-stage" column (id="__nostage__").
const STAGE_COLUMNS: KanbanColumnDef[] = [
  { id: "__nostage__",   label: "No stage",       icon: ListChecksIcon, collapsible: true, defaultCollapsed: true },
  { id: "discovery",     label: "Discovery",      icon: Compass },
  { id: "design",        label: "Design",         icon: Pencil },
  { id: "architecture",  label: "Architecture",   icon: Cpu },
  { id: "implementation",label: "Implementation", icon: Zap },
  { id: "qa",            label: "QA",             icon: ShieldCheck },
  { id: "docs",          label: "Docs",           icon: FileText },
  { id: "release",       label: "Release",        icon: Rocket },
  { id: "ops",           label: "Ops",            icon: Wrench, collapsible: true, defaultCollapsed: true },
]

interface BoardPageProps {
  /**
   * When provided, scopes the board to this project and hides the project
   * switcher in the header (project context comes from the URL instead).
   * Used by ProjectDetailPage to embed the board under /projects/:id/board.
   */
  projectId?: string
  /** Hide the page title block (when embedded under a parent header). */
  hideHeader?: boolean
  /**
   * When provided, the parent owns the "New Task" button placement and
   * receives a trigger via this ref. The board itself will not render its
   * own button row.
   */
  openCreateRef?: React.MutableRefObject<(() => void) | null>
}

export default function BoardPage({ projectId, hideHeader, openCreateRef }: BoardPageProps = {}) {
  const { tasks, filters, setTasks, addTask, updateTask, removeTask, setFilters, clearFilters } = useTaskStore()
  const agents = useAgentStore((s) => s.agents)
  const navigate = useNavigate()
  const activeProjectIdGlobal = useProjectStore((s) => s.activeProjectId)
  const activeProjectId = projectId ?? activeProjectIdGlobal
  const isEmbedded = !!projectId
  const projectsList = useProjectStore((s) => s.projects)
  const activeProject = useMemo(
    () => projectsList.find(p => p.id === activeProjectId) || null,
    [projectsList, activeProjectId]
  )

  // View mode (Phase C.1) — Status (default) vs Stage (ADLC pipeline view).
  // Persisted per-project in localStorage so a PM's preferred lens sticks.
  const isAdlcProject = activeProject?.kind === 'adlc'
  const viewModeKey = `aoc.board.viewMode.${activeProjectId}`
  const [viewMode, setViewModeRaw] = useState<'status' | 'stage'>(() => {
    if (typeof window === 'undefined') return 'status'
    const stored = window.localStorage.getItem(viewModeKey)
    return stored === 'stage' ? 'stage' : 'status'
  })
  const setViewMode = useCallback((mode: 'status' | 'stage') => {
    setViewModeRaw(mode)
    try { window.localStorage.setItem(viewModeKey, mode) } catch {}
  }, [viewModeKey])
  // If user switches to a non-ADLC project while in stage view, snap back.
  useEffect(() => {
    if (!isAdlcProject && viewMode === 'stage') setViewMode('status')
  }, [isAdlcProject, viewMode, setViewMode])

  // Layout mode: Kanban (default) vs List.
  const layoutModeKey = `aoc.board.layoutMode.${activeProjectId}`
  const [layoutMode, setLayoutModeRaw] = useState<'kanban' | 'list'>(() => {
    if (typeof window === 'undefined') return 'kanban'
    const stored = window.localStorage.getItem(layoutModeKey)
    return stored === 'list' ? 'list' : 'kanban'
  })
  const setLayoutMode = useCallback((mode: 'kanban' | 'list') => {
    setLayoutModeRaw(mode)
    try { window.localStorage.setItem(layoutModeKey, mode) } catch {}
  }, [layoutModeKey])

  const [createOpen, setCreateOpen]   = useState(false)
  const [editTask, setEditTask]       = useState<Task | null>(null)
  const [activeId, setActiveId]       = useState<string | null>(null)

  // ── Detail panel: open state lives in the URL (?task=<id>) so the open
  // task is bookmarkable, deep-linkable, and survives browser back/forward.
  // We derive `detailTask` from the URL + tasks store on each render.
  const [searchParams, setSearchParams] = useSearchParams()
  const detailTaskId = searchParams.get('task') || null
  const detailTask = useMemo(
    () => detailTaskId ? tasks.find(t => t.id === detailTaskId) || null : null,
    [tasks, detailTaskId]
  )
  const openTaskDetail = useCallback((task: Task) => {
    const next = new URLSearchParams(searchParams)
    next.set('task', task.id)
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])
  const closeTaskDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('task')
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])
  const setDetailTask = useCallback((t: Task | null) => {
    if (t) openTaskDetail(t); else closeTaskDetail()
  }, [openTaskDetail, closeTaskDetail])
  const [settingsOpen, setSettingsOpen]         = useState(false)
  const [wizardOpen, setWizardOpen]             = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [editingIntegration, setEditingIntegration] = useState<ProjectIntegration | null>(null)
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null)
  const [deletingTask, setDeletingTask]         = useState(false)

  // Dispatch prompt: intercept certain transitions to let user add context
  const [dispatchPrompt, setDispatchPrompt] = useState<{
    itemId: string; from: string; to: string; task: Task
  } | null>(null)
  const [dispatchNote, setDispatchNote] = useState('')
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false)

  // When embedded under /projects/:id, mirror the URL's projectId into the
  // global store so other consumers (e.g. ProjectSwitcher, integration sync)
  // see the same active project.
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  useEffect(() => {
    if (projectId && projectId !== activeProjectIdGlobal) setActiveProject(projectId)
  }, [projectId, activeProjectIdGlobal, setActiveProject])

  // Expose the create-modal trigger to a parent (when embedded). This lets
  // ProjectDetailPage place the "New Ticket" button next to the project
  // title instead of consuming a dedicated row above the kanban.
  useEffect(() => {
    if (!openCreateRef) return
    openCreateRef.current = () => setCreateOpen(true)
    return () => { openCreateRef.current = null }
  }, [openCreateRef])

  useEffect(() => {
    api.getTasks({ projectId: activeProjectId }).then(res => {
      setTasks(res.tasks)
    }).catch(console.error)
  }, [activeProjectId])

  // Epic list (ADLC projects) — used by filter dropdown + chip lookup on TaskCard.
  const [projectEpics, setProjectEpics] = useState<import("@/types").Epic[]>([])
  useEffect(() => {
    if (!activeProjectId || activeProjectId === 'general' || !isAdlcProject) { setProjectEpics([]); return }
    api.listEpics(activeProjectId).then(r => setProjectEpics(r.epics)).catch(() => setProjectEpics([]))
  }, [activeProjectId, isAdlcProject])

  // Bulk-fetch all dependency edges for the active project so we can render
  // a "blocked" indicator on TaskCards without N+1 fetches.
  const [projectDeps, setProjectDeps] = useState<import("@/types").TaskDependency[]>([])
  const refetchProjectDeps = useCallback(() => {
    if (!activeProjectId || activeProjectId === 'general') { setProjectDeps([]); return }
    api.listProjectDependencies(activeProjectId)
      .then(r => setProjectDeps(r.dependencies))
      .catch(() => setProjectDeps([]))
  }, [activeProjectId])
  useEffect(() => { refetchProjectDeps() }, [refetchProjectDeps])
  // Re-fetch when tasks change (status updates may resolve a blocker).
  useEffect(() => { refetchProjectDeps() }, [tasks.length, refetchProjectDeps])

  // Map of taskId → unmet blocker count for fast lookup in TaskCard.
  const unmetBlockerByTask = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of projectDeps) {
      if (d.kind && d.kind !== 'blocks') continue
      const blocker = tasks.find(t => t.id === d.blockerTaskId)
      if (!blocker) continue
      if (blocker.status === 'done' || blocker.status === 'cancelled') continue
      map.set(d.blockedTaskId, (map.get(d.blockedTaskId) || 0) + 1)
    }
    return map
  }, [projectDeps, tasks])

  // Enrich tasks with agent info from agents store
  const enrichedTasks = useMemo(() => tasks.map(t => ({
    ...t,
    agentEmoji: t.agentId ? agents.find(a => a.id === t.agentId)?.emoji : undefined,
    agentName:  t.agentId ? agents.find(a => a.id === t.agentId)?.name : undefined,
  })), [tasks, agents])

  // Apply client-side filters (server also filters, but this avoids re-fetching on every keystroke)
  const filteredTasks = useMemo(() => {
    let result = enrichedTasks
    if (filters.agentId)  result = result.filter(t => t.agentId === filters.agentId)
    if (filters.status)   result = result.filter(t => t.status === filters.status)
    if (filters.priority) result = result.filter(t => t.priority === filters.priority)
    if (filters.stage)    result = result.filter(t => t.stage === filters.stage)
    if (filters.epicId === '__none__') result = result.filter(t => !t.epicId)
    else if (filters.epicId)   result = result.filter(t => t.epicId === filters.epicId)
    if (filters.q)        result = result.filter(t => t.title.toLowerCase().includes(filters.q!.toLowerCase()))
    return result
  }, [enrichedTasks, filters])

  const hasActiveFilters = !!(filters.agentId || filters.status || filters.priority || filters.stage || filters.epicId || filters.q)

  async function handleCreate(data: Partial<Task>): Promise<Task> {
    const res = await api.createTask({ ...data, projectId: activeProjectId } as Parameters<typeof api.createTask>[0])
    addTask(res.task)
    return res.task
  }

  async function openProjectRoom() {
    if (!activeProjectId) return
    const res = await api.getProjectRoom(activeProjectId)
    navigate(`/chat?tab=rooms&roomId=${encodeURIComponent(res.room.id)}`)
  }

  async function handleUploadAttachments(taskId: string, files: File[], onProgress?: (p: number) => void) {
    const res = await api.uploadTaskAttachments(taskId, files, onProgress)
    updateTask(taskId, res.task)
    if (detailTask?.id === taskId) setDetailTask(res.task)
  }

  async function handleUpdate(id: string, patch: object) {
    const res = await api.updateTask(id, patch as Parameters<typeof api.updateTask>[1])
    updateTask(id, res.task)
    // If detail drawer is open for this task, update it too
    if (detailTask?.id === id) setDetailTask(res.task)
  }

  async function confirmDeleteTask() {
    if (!deleteTaskTarget) return
    setDeletingTask(true)
    try {
      await api.deleteTask(deleteTaskTarget.id)
      removeTask(deleteTaskTarget.id)
      if (detailTask?.id === deleteTaskTarget.id) setDetailTask(null)
    } finally {
      setDeletingTask(false)
      setDeleteTaskTarget(null)
    }
  }

  // Transitions that should show the prompt dialog (agent will be auto-dispatched)
  function needsDispatchPrompt(from: string, to: string, task: Task): boolean {
    if (!task.agentId) return false // no agent assigned — no dispatch will happen
    const isToTodo = to === 'todo' && from === 'backlog'
    const isBlockerResolved = from === 'blocked' && (to === 'in_progress' || to === 'todo')
    const isChangeRequest = from === 'in_review' && to === 'in_progress'
    return isToTodo || isBlockerResolved || isChangeRequest
  }

  async function executeMove(itemId: string, toColumnId: string, note?: string) {
    updateTask(itemId, { status: toColumnId as TaskStatus })
    try {
      await api.updateTask(itemId, { status: toColumnId as TaskStatus, note })
    } catch {
      const res = await api.getTasks({ projectId: activeProjectId })
      setTasks(res.tasks)
    }
  }

  async function handleDispatchConfirm() {
    if (!dispatchPrompt) return
    setDispatchSubmitting(true)
    try {
      await executeMove(dispatchPrompt.itemId, dispatchPrompt.to, dispatchNote || undefined)
    } finally {
      setDispatchSubmitting(false)
      setDispatchPrompt(null)
      setDispatchNote('')
    }
  }

  function handleDispatchSkip() {
    if (!dispatchPrompt) return
    executeMove(dispatchPrompt.itemId, dispatchPrompt.to)
    setDispatchPrompt(null)
    setDispatchNote('')
  }

  const handleItemMove = useCallback(async (itemId: string, fromCol: string, toColumnId: string) => {
    const task = tasks.find(t => t.id === itemId)
    if (task && needsDispatchPrompt(fromCol, toColumnId, task)) {
      // Show prompt dialog instead of moving immediately
      setDispatchPrompt({ itemId, from: fromCol, to: toColumnId, task })
      return
    }
    // No prompt needed — move directly
    await executeMove(itemId, toColumnId)
  }, [tasks, updateTask, setTasks, activeProjectId])

  // Stage-view drag-drop: changes task.stage instead of task.status. The
  // virtual "__nostage__" column maps to stage=null on the wire.
  const handleStageMove = useCallback(async (itemId: string, _fromCol: string, toColumnId: string) => {
    const targetStage = toColumnId === '__nostage__' ? null : toColumnId
    // Optimistic local update
    updateTask(itemId, { stage: targetStage as Task['stage'] })
    try {
      await api.updateTask(itemId, { stage: targetStage })
    } catch {
      const res = await api.getTasks({ projectId: activeProjectId })
      setTasks(res.tasks)
    }
  }, [updateTask, setTasks, activeProjectId])

  return (
    <div className={`flex flex-col h-full ${hideHeader ? 'gap-2' : 'gap-3 sm:gap-4'} animate-fade-in`}>
      {/* Header */}
      {!hideHeader && (
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 mb-2 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-3xl font-display font-bold tracking-tight text-foreground">
            Task Board
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 hidden sm:block">
            Assign, dispatch, and track agent tasks in real-time
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isEmbedded && (
            <ProjectSwitcher
              onSettingsOpen={() => setSettingsOpen(true)}
              onNewProject={() => setCreateProjectOpen(true)}
            />
          )}
          <button
            onClick={openProjectRoom}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg bg-muted/40 border border-border text-muted-foreground text-xs font-semibold hover:text-foreground hover:bg-muted transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Room
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New</span> Task
          </button>
        </div>
      </div>
      )}
      {hideHeader && !openCreateRef && (
        <div className="flex justify-end shrink-0">
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New</span> Task
          </button>
        </div>
      )}

      {/* Filter bar + view-mode toggle (ADLC only) */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <TaskFilterBar
            agents={agents}
            epics={projectEpics}
            filterAgentId={filters.agentId}
            filterPriority={filters.priority}
            filterStage={filters.stage}
            filterEpicId={filters.epicId}
            showStageFilter={isAdlcProject}
            showEpicFilter={isAdlcProject && projectEpics.length > 0}
            q={filters.q}
            onFilterChange={(k, v) => setFilters({ [k]: v })}
            onQChange={(q) => setFilters({ q: q || undefined })}
            hasActiveFilters={hasActiveFilters}
            onClear={clearFilters}
          />
        </div>
        {isAdlcProject && (
          <div className="inline-flex items-center rounded-md border border-border/50 p-0.5 shrink-0 bg-muted/20">
            <button
              type="button"
              onClick={() => setViewMode('status')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                viewMode === 'status'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Group by workflow status"
            >
              Status
            </button>
            <button
              type="button"
              onClick={() => setViewMode('stage')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                viewMode === 'stage'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Group by ADLC stage"
            >
              Stage
            </button>
          </div>
        )}
        
        {/* Layout Mode Toggle (Kanban/List) */}
        <div className="inline-flex items-center rounded-md border border-border/50 p-0.5 shrink-0 bg-muted/20 ml-auto sm:ml-0">
          <button
            type="button"
            onClick={() => setLayoutMode('kanban')}
            className={`px-2 py-1 rounded transition-colors ${
              layoutMode === 'kanban'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Kanban View"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setLayoutMode('list')}
            className={`px-2 py-1 rounded transition-colors ${
              layoutMode === 'list'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="List View"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Board / List */}
      <div className="flex-1 min-h-0">
        {layoutMode === 'list' ? (
          <TaskListView
            tasks={filteredTasks}
            agents={agents}
            projectKind={activeProject?.kind}
            columns={viewMode === 'stage' ? STAGE_COLUMNS : STATUS_COLUMNS}
            groupBy={viewMode === 'stage' ? 'stage' : 'status'}
            onEdit={(t) => { setEditTask(t); setCreateOpen(true) }}
            onDelete={setDeleteTaskTarget}
            onClick={setDetailTask}
          />
        ) : (
          <KanbanBoard
            columns={viewMode === 'stage' ? STAGE_COLUMNS : STATUS_COLUMNS}
            items={filteredTasks}
            getColumnId={(t) => viewMode === 'stage' ? (t.stage || '__nostage__') : t.status}
            activeId={activeId}
            onDragStart={setActiveId}
            onDragEnd={() => setActiveId(null)}
            onItemMove={viewMode === 'stage' ? handleStageMove : handleItemMove}
            renderItem={(task) => {
              const taskAgent = task.agentId ? agents.find(a => a.id === task.agentId) : null
              return (
                <TaskCard
                  key={task.id}
                  task={task}
                  agentEmoji={(task as typeof task & { agentEmoji?: string }).agentEmoji}
                  agentName={(task as typeof task & { agentName?: string }).agentName}
                  agentAvatarPresetId={taskAgent?.avatarPresetId}
                  epicName={task.epicId ? projectEpics.find(e => e.id === task.epicId)?.title : undefined}
                  unmetBlockerCount={unmetBlockerByTask.get(task.id) || 0}
                  isDragging={activeId === task.id}
                  onEdit={(t) => { setEditTask(t); setCreateOpen(true) }}
                  onDelete={setDeleteTaskTarget}
                  onClick={setDetailTask}
                />
              )
            }}
            renderDragOverlay={(task) => {
              const taskAgent = task.agentId ? agents.find(a => a.id === task.agentId) : null
              return (
                <TaskCard
                  task={task}
                  agentEmoji={(task as typeof task & { agentEmoji?: string }).agentEmoji}
                  agentName={(task as typeof task & { agentName?: string }).agentName}
                  agentAvatarPresetId={taskAgent?.avatarPresetId}
                  isDragging
                  onEdit={() => {}}
                  onDelete={() => {}}
                  onClick={() => {}}
                />
              )
            }}
          />
        )}
      </div>

      {/* Create/Edit Modal */}
      <TaskCreateModal
        open={createOpen}
        task={editTask}
        agents={agents}
        projectId={activeProjectId}
        projectKind={activeProject?.kind}
        onSave={editTask
          ? (data) => handleUpdate(editTask.id, data)
          : handleCreate
        }
        onUploadAttachments={handleUploadAttachments}
        onClose={() => { setCreateOpen(false); setEditTask(null) }}
      />

      {/* Detail Panel — slide-over (Jira-style), URL-driven open state. */}
      <TaskPanel
        task={detailTask}
        agents={agents}
        projectKind={activeProject?.kind}
        open={!!detailTask}
        onClose={closeTaskDetail}
        onUpdate={handleUpdate}
        onTaskReplace={(t) => { updateTask(t.id, t) }}
        onNavigateTask={(id) => {
          const next = new URLSearchParams(searchParams)
          next.set('task', id)
          setSearchParams(next, { replace: false })
        }}
      />

      {/* Realtime status change ticker */}
      <TaskStatusTicker />

      <ProjectSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAddIntegration={() => { setSettingsOpen(false); setWizardOpen(true) }}
        onEditIntegration={(i) => { setEditingIntegration(i); setSettingsOpen(false); setWizardOpen(true) }}
      />
      <ProjectCreateWizard
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
      />
      <IntegrationWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setEditingIntegration(null) }}
      />

      {deleteTaskTarget && (
        <ConfirmDialog
          title="Delete Task"
          description={`"${deleteTaskTarget.title}" will be permanently deleted and cannot be recovered.`}
          confirmLabel="Delete"
          destructive
          loading={deletingTask}
          onConfirm={confirmDeleteTask}
          onCancel={() => setDeleteTaskTarget(null)}
        />
      )}

      {/* Dispatch Prompt Dialog */}
      <Dialog open={!!dispatchPrompt} onOpenChange={o => { if (!o) { setDispatchPrompt(null); setDispatchNote('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {dispatchPrompt?.from === 'backlog' && dispatchPrompt?.to === 'todo'
                ? 'Dispatch to Agent'
                : dispatchPrompt?.from === 'blocked'
                ? 'Resume from Blocked'
                : 'Change Request'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground text-sm truncate">{dispatchPrompt?.task.title}</p>
              <p>
                {dispatchPrompt?.from === 'backlog'
                  ? 'Task akan di-dispatch ke agent. Tambahkan instruksi tambahan jika diperlukan.'
                  : dispatchPrompt?.from === 'blocked'
                  ? 'Jelaskan apa yang sudah diperbaiki agar agent bisa melanjutkan.'
                  : 'Berikan feedback untuk agent agar bisa memperbaiki hasilnya.'}
              </p>
            </div>

            <textarea
              value={dispatchNote}
              onChange={e => setDispatchNote(e.target.value)}
              placeholder={
                dispatchPrompt?.from === 'backlog'
                  ? 'e.g. Output ke Google Sheet ID xxx, tab "Report". Fokus data tahun 2025-2026.'
                  : dispatchPrompt?.from === 'blocked'
                  ? 'e.g. Skill gws-sheet sudah ditambahkan, silakan lanjut upload ke Google Sheets.'
                  : 'e.g. Format kolom tanggal harus dd/mm/yyyy, bukan ISO.'
              }
              rows={4}
              className="flex w-full rounded-md px-3 py-2 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              size="sm" variant="ghost" className="h-7 text-xs mr-auto"
              onClick={() => { setDispatchPrompt(null); setDispatchNote('') }}
            >
              Cancel
            </Button>
            <Button
              size="sm" variant="outline" className="h-7 text-xs"
              onClick={handleDispatchSkip}
            >
              Skip
            </Button>
            <Button
              size="sm" className="h-7 text-xs"
              onClick={handleDispatchConfirm}
              disabled={dispatchSubmitting}
            >
              {dispatchSubmitting ? 'Dispatching…' : dispatchNote ? 'Send & Dispatch' : 'Dispatch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
