import React from "react"
import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { MoreHorizontal, Pencil, Trash2, Activity } from "lucide-react"
import { cn } from "@/lib/utils"
import { Task } from "@/types"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500",
  high:   "border-l-orange-400",
  medium: "border-l-primary",
  low:    "border-l-muted-foreground/30",
}

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-500",
  high:   "bg-orange-400/15 text-orange-400",
  medium: "bg-primary/15 text-primary",
  low:    "bg-muted text-muted-foreground",
}

interface TaskCardProps {
  task: Task
  agentEmoji?: string
  agentName?: string
  isDragging?: boolean
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onClick: (task: Task) => void
}

export function TaskCard({ task, agentEmoji, agentName, isDragging, onEdit, onDelete, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id })

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  const priority = task.priority || "medium"

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onClick(task)}
      className={cn(
        "group relative bg-card border border-border rounded-lg p-3 cursor-pointer select-none",
        "border-l-4 transition-all hover:bg-accent/30",
        PRIORITY_BORDER[priority],
        isDragging && "opacity-50 shadow-xl"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        {(agentEmoji || agentName) && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            {agentEmoji && <span>{agentEmoji}</span>}
            {agentName && <span className="truncate max-w-[80px]">{agentName}</span>}
          </span>
        )}
        <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium ml-auto shrink-0", PRIORITY_BADGE[priority])}>
          {priority}
        </span>
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-foreground leading-snug line-clamp-2 mb-1">
        {task.title}
      </p>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{task.description}</p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-1 flex-wrap">
        {(task.tags || []).slice(0, 3).map((tag) => (
          <span key={tag} className="text-xs bg-secondary text-secondary-foreground rounded px-1.5 py-0.5">
            #{tag}
          </span>
        ))}
        {task.cost != null && (
          <span className="ml-auto text-xs text-muted-foreground">${task.cost.toFixed(2)}</span>
        )}
        {/* 3-dot menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <button className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent">
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onEdit(task)}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onClick(task)}>
              <Activity className="mr-2 h-3.5 w-3.5" /> View Activity
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(task)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
