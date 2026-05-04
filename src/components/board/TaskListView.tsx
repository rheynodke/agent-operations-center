import React from "react"
import { Task, Agent } from "@/types"
import { MoreHorizontal, Pencil, Trash2, Activity, ExternalLink, ShieldCheck, ShieldAlert, Paperclip, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { STAGE_LABEL, STAGE_TONE, ROLE_LABEL } from "@/lib/projectLabels"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PriorityIndicator } from "./PriorityIndicator"

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  backlog:     { label: "Backlog",     dot: "bg-zinc-500",    text: "text-zinc-400",    bg: "bg-zinc-500/10",    border: "border-zinc-500/20" },
  todo:        { label: "Todo",        dot: "bg-blue-400",    text: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  in_progress: { label: "In Progress", dot: "bg-amber-400",   text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20" },
  in_review:   { label: "In Review",   dot: "bg-purple-400",  text: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/20" },
  blocked:     { label: "Blocked",     dot: "bg-red-500",     text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20" },
  done:        { label: "Done",        dot: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })
}

import { KanbanColumnDef } from "@/components/board/KanbanBoard"
import { useState } from "react"

interface TaskListViewProps {
  tasks: Task[]
  agents: Agent[]
  projectKind?: string | null
  columns: KanbanColumnDef[]
  groupBy: 'status' | 'stage'
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onClick: (task: Task) => void
}

export function TaskListView({ tasks, agents, projectKind, columns, groupBy, onEdit, onDelete, onClick }: TaskListViewProps) {
  const isAdlc = projectKind === "adlc"
  
  const [isGrouped, setIsGrouped] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('aoc.board.listGrouped') !== 'false'
  })

  function toggleGrouped() {
    setIsGrouped(prev => {
      const next = !prev
      try { window.localStorage.setItem('aoc.board.listGrouped', String(next)) } catch {}
      return next
    })
  }

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No tasks match your filters.
      </div>
    )
  }

  const renderTaskRow = (task: Task) => {
    const taskAgent = task.agentId ? agents.find(a => a.id === task.agentId) : null
    const taskCode = task.externalId ?? `#${task.id.slice(0, 6)}`
    const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.backlog
    const tags = task.tags || []
    const attachmentCount = (task.attachments || []).length

    return (
      <tr 
        key={task.id}
        onClick={() => onClick(task)}
        className="group hover:bg-muted/30 transition-colors cursor-pointer"
      >
        {/* Task Details */}
        <td className="px-4 py-3">
          <div className="flex flex-col gap-1.5 min-w-0 max-w-[400px]">
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[10px] font-mono px-1 py-0.5 rounded shrink-0",
                task.externalId ? "text-emerald-500/70 bg-emerald-500/10" : "text-muted-foreground/40 bg-muted/40"
              )}>
                {taskCode}
              </span>
              <span className="text-sm font-semibold text-foreground truncate">
                {task.title}
              </span>
              {task.externalSource && <ExternalLink className="h-3 w-3 text-emerald-500/60 shrink-0" />}
            </div>
            {task.description && (
              <span className="text-xs text-muted-foreground/80 truncate">
                {task.description}
              </span>
            )}
            <div className="flex flex-wrap gap-1 mt-0.5">
              {tags.slice(0, 3).map(tag => (
                <span key={tag} className="text-[9px] bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5 font-medium">
                  {tag}
                </span>
              ))}
              {tags.length > 3 && (
                <span className="text-[9px] text-muted-foreground/60">+{tags.length - 3}</span>
              )}
              {attachmentCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70 ml-2" title={`${attachmentCount} attachment(s)`}>
                  <Paperclip className="h-2.5 w-2.5" /> {attachmentCount}
                </span>
              )}
            </div>
          </div>
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium",
            cfg.bg, cfg.border, cfg.text
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
            {cfg.label}
          </span>
        </td>

        {/* Stage / Role (ADLC only) */}
        {isAdlc && (
          <td className="px-4 py-3">
            <div className="flex flex-col gap-1 items-start">
              {task.stage ? (
                <span className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded-md border text-[9px] font-medium uppercase tracking-wide",
                  STAGE_TONE[task.stage]
                )}>
                  {STAGE_LABEL[task.stage]}
                </span>
              ) : (
                <span className="text-muted-foreground/40 text-xs">—</span>
              )}
              {task.role && (
                <span className="text-[9px] uppercase tracking-wide bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5 font-medium">
                  {ROLE_LABEL[task.role]}
                </span>
              )}
            </div>
          </td>
        )}

        {/* Priority */}
        <td className="px-4 py-3">
          <div className="flex items-center">
            <PriorityIndicator priority={task.priority || "medium"} showLabel />
          </div>
        </td>

        {/* Assignee */}
        <td className="px-4 py-3">
          {taskAgent ? (
            <div className="flex items-center gap-2">
              <AgentAvatar
                avatarPresetId={taskAgent.avatarPresetId}
                emoji={taskAgent.emoji}
                size="w-5 h-5"
                className="rounded-md shrink-0"
              />
              <span className="text-xs font-medium text-foreground/90 truncate max-w-[100px]">
                {taskAgent.name || taskAgent.id}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/60 flex items-center gap-1.5">
              <User className="h-3 w-3" /> Unassigned
            </span>
          )}
        </td>

        {/* Updated */}
        <td className="px-4 py-3 text-right">
          <span className="text-[11px] text-muted-foreground/60">
            {relativeTime(task.updatedAt || task.createdAt)}
          </span>
        </td>

        {/* Actions */}
        <td className="px-4 py-3 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted">
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => onClick(task)}>
                <Activity className="mr-2 h-3.5 w-3.5" /> View Detail
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(task)}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(task)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
    )
  }

  return (
    <div className="w-full flex flex-col min-h-0 h-full overflow-hidden rounded-xl border border-border/50 bg-card/50 shadow-sm">
      {/* List Header / Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/10 shrink-0">
        <span className="text-xs text-muted-foreground font-medium">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
        <label className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer font-medium hover:text-foreground transition-colors select-none">
          <input 
            type="checkbox" 
            checked={isGrouped} 
            onChange={toggleGrouped}
            className="rounded border-border/50 bg-muted/20 text-primary focus:ring-primary h-3.5 w-3.5"
          />
          Group by {groupBy === 'stage' ? 'Stage' : 'Status'}
        </label>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur-md">
            <tr className="border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider shadow-sm">
              <th className="px-4 py-3 w-[45%]">Task</th>
              <th className="px-4 py-3 w-[15%]">Status</th>
              {isAdlc && <th className="px-4 py-3 w-[10%]">Stage/Role</th>}
              <th className="px-4 py-3 w-[10%]">Priority</th>
              <th className="px-4 py-3 w-[15%]">Assignee</th>
              <th className="px-4 py-3 w-[5%] text-right">Updated</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {isGrouped ? (
              columns.map(col => {
                const groupTasks = tasks.filter(t => (groupBy === 'stage' ? (t.stage || '__nostage__') : t.status) === col.id)
                if (groupTasks.length === 0) return null

                return (
                  <React.Fragment key={col.id}>
                    <tr className="bg-muted/30 border-b border-border/30">
                      <td colSpan={100} className="px-4 py-2.5 text-xs font-semibold text-foreground/90">
                        <div className="flex items-center gap-2">
                          {col.icon && <col.icon className="h-4 w-4 text-muted-foreground/60" />}
                          {col.label}
                          <span className="text-[10px] bg-muted/40 text-muted-foreground/80 px-1.5 py-0.5 rounded font-mono">
                            {groupTasks.length}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {groupTasks.map(task => renderTaskRow(task))}
                  </React.Fragment>
                )
              })
            ) : (
              tasks.map(task => renderTaskRow(task))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
