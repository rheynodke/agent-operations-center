import React, { useCallback, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { KanbanBoard, KanbanColumnDef } from "@/components/board/KanbanBoard"
import { TaskCard } from "@/components/board/TaskCard"
import { TaskFilterBar } from "@/components/board/TaskFilterBar"
import { TaskCreateModal } from "@/components/board/TaskCreateModal"
import { TaskDetailModal } from "@/components/board/TaskDetailModal"
import { TaskStatusTicker } from "@/components/board/TaskStatusTicker"
import { useTaskStore, useAgentStore } from "@/stores"
import { api } from "@/lib/api"
import { Task, TaskStatus } from "@/types"

const COLUMNS: KanbanColumnDef[] = [
  { id: "backlog",     label: "Backlog",     emoji: "📥" },
  { id: "todo",        label: "Todo",        emoji: "📋" },
  { id: "in_progress", label: "In Progress", emoji: "⚡" },
  { id: "in_review",   label: "In Review",   emoji: "🔍" },
  { id: "blocked",     label: "Blocked",     emoji: "🚫" },
  { id: "done",        label: "Done",        emoji: "✅" },
]

export default function BoardPage() {
  const { tasks, filters, setTasks, addTask, updateTask, removeTask, setFilters, clearFilters } = useTaskStore()
  const agents = useAgentStore((s) => s.agents)

  const [createOpen, setCreateOpen]   = useState(false)
  const [editTask, setEditTask]       = useState<Task | null>(null)
  const [detailTask, setDetailTask]   = useState<Task | null>(null)
  const [activeId, setActiveId]       = useState<string | null>(null)

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
    const res = await api.createTask(data as Parameters<typeof api.createTask>[0])
    addTask(res.task)
  }

  async function handleUpdate(id: string, patch: object) {
    const res = await api.updateTask(id, patch as Parameters<typeof api.updateTask>[1])
    updateTask(id, res.task)
    // If detail drawer is open for this task, update it too
    if (detailTask?.id === id) setDetailTask(res.task)
  }

  async function handleDelete(task: Task) {
    if (!confirm(`Delete "${task.title}"?`)) return
    await api.deleteTask(task.id)
    removeTask(task.id)
    if (detailTask?.id === task.id) setDetailTask(null)
  }

  const handleItemMove = useCallback(async (itemId: string, _from: string, toColumnId: string) => {
    // Optimistic update
    updateTask(itemId, { status: toColumnId as TaskStatus })
    try {
      await api.updateTask(itemId, { status: toColumnId as TaskStatus })
    } catch {
      // Rollback on error: reload all tasks
      const res = await api.getTasks()
      setTasks(res.tasks)
    }
  }, [updateTask, setTasks])

  return (
    <div className="flex flex-col h-full gap-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-2 shrink-0">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">
            Task Board
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Assign, dispatch, and track agent tasks in real-time
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New Ticket
        </button>
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
                onDelete={handleDelete}
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
    </div>
  )
}
