import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Inbox, ListTodo, Zap, ScanSearch, OctagonX, CircleCheckBig } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { KanbanBoard, KanbanColumnDef } from "@/components/board/KanbanBoard"
import { TaskCard } from "@/components/board/TaskCard"
import { TaskFilterBar } from "@/components/board/TaskFilterBar"
import { TaskCreateModal } from "@/components/board/TaskCreateModal"
import { TaskDetailModal } from "@/components/board/TaskDetailModal"
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

const COLUMNS: KanbanColumnDef[] = [
  { id: "backlog",     label: "Backlog",     icon: Inbox,          },
  { id: "todo",        label: "Todo",        icon: ListTodo,       },
  { id: "in_progress", label: "In Progress", icon: Zap,            },
  { id: "in_review",   label: "In Review",   icon: ScanSearch,     },
  { id: "blocked",     label: "Blocked",     icon: OctagonX,       collapsible: true },
  { id: "done",        label: "Done",        icon: CircleCheckBig, collapsible: true, defaultCollapsed: true },
]

export default function BoardPage() {
  const { tasks, filters, setTasks, addTask, updateTask, removeTask, setFilters, clearFilters } = useTaskStore()
  const agents = useAgentStore((s) => s.agents)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)

  const [createOpen, setCreateOpen]   = useState(false)
  const [editTask, setEditTask]       = useState<Task | null>(null)
  const [detailTask, setDetailTask]   = useState<Task | null>(null)
  const [activeId, setActiveId]       = useState<string | null>(null)
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

  useEffect(() => {
    api.getTasks({ projectId: activeProjectId }).then(res => {
      setTasks(res.tasks)
    }).catch(console.error)
  }, [activeProjectId])

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
    if (filters.q)        result = result.filter(t => t.title.toLowerCase().includes(filters.q!.toLowerCase()))
    return result
  }, [enrichedTasks, filters])

  const hasActiveFilters = !!(filters.agentId || filters.status || filters.priority || filters.q)

  async function handleCreate(data: Partial<Task>) {
    const res = await api.createTask({ ...data, projectId: activeProjectId } as Parameters<typeof api.createTask>[0])
    addTask(res.task)
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

  return (
    <div className="flex flex-col h-full gap-3 sm:gap-4 animate-fade-in">
      {/* Header */}
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
          <ProjectSwitcher
            onSettingsOpen={() => setSettingsOpen(true)}
            onNewProject={() => setCreateProjectOpen(true)}
          />
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New</span> Ticket
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <TaskFilterBar
        agents={agents}
        filterAgentId={filters.agentId}
        filterPriority={filters.priority}
        q={filters.q}
        onFilterChange={(k, v) => setFilters({ [k]: v })}
        onQChange={(q) => setFilters({ q: q || undefined })}
        hasActiveFilters={hasActiveFilters}
        onClear={clearFilters}
      />

      {/* Kanban Board */}
      <div className="flex-1 min-h-0">
        <KanbanBoard
          columns={COLUMNS}
          items={filteredTasks}
          getColumnId={(t) => t.status}
          activeId={activeId}
          onDragStart={setActiveId}
          onDragEnd={() => setActiveId(null)}
          onItemMove={handleItemMove}
          renderItem={(task) => {
            const taskAgent = task.agentId ? agents.find(a => a.id === task.agentId) : null
            return (
              <TaskCard
                key={task.id}
                task={task}
                agentEmoji={(task as typeof task & { agentEmoji?: string }).agentEmoji}
                agentName={(task as typeof task & { agentName?: string }).agentName}
                agentAvatarPresetId={taskAgent?.avatarPresetId}
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
      </div>

      {/* Create/Edit Modal */}
      <TaskCreateModal
        open={createOpen}
        task={editTask}
        agents={agents}
        onSave={editTask
          ? (data) => handleUpdate(editTask.id, data)
          : handleCreate
        }
        onClose={() => { setCreateOpen(false); setEditTask(null) }}
      />

      {/* Detail Modal */}
      <TaskDetailModal
        task={detailTask}
        agents={agents}
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        onUpdate={handleUpdate}
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
          title="Delete Ticket"
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
                  ? 'Ticket akan di-dispatch ke agent. Tambahkan instruksi tambahan jika diperlukan.'
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
