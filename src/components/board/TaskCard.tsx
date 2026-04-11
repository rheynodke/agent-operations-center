import React from "react"
import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { MoreHorizontal, Pencil, Trash2, Activity, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { Task } from "@/types"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AgentAvatar } from "@/components/agents/AgentAvatar"

// ── Priority config ────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  urgent: { label: "Urgent", dot: "bg-red-500",              text: "text-red-400" },
  high:   { label: "High",   dot: "bg-orange-400",           text: "text-orange-400" },
  medium: { label: "Medium", dot: "bg-blue-500",             text: "text-blue-400" },
  low:    { label: "Low",    dot: "bg-muted-foreground/40",  text: "text-muted-foreground/60" },
}

// ── Relative time ──────────────────────────────────────────────────────────────

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

// ── Props ──────────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: Task
  agentEmoji?: string
  agentName?: string
  agentAvatarPresetId?: string | null
  isDragging?: boolean
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onClick: (task: Task) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TaskCard({ task, agentEmoji, agentName, agentAvatarPresetId, isDragging, onEdit, onDelete, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id })

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined
  const priority = task.priority || "medium"
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium
  const tags = task.tags || []
  const hasCost = task.cost != null
  const hasAgent = !!(agentEmoji || agentName || agentAvatarPresetId)
  const isSynced = !!task.externalSource
  const taskCode = task.externalId ?? `#${task.id.slice(0, 6)}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onClick(task)}
      className={cn(
        "group relative bg-card rounded-xl border border-border/50 overflow-hidden",
        "cursor-pointer select-none transition-all duration-150",
        "hover:border-border hover:shadow-md hover:-translate-y-px",
        isDragging && "opacity-40 shadow-2xl scale-[0.98]"
      )}
    >
      <div className="p-3">
      {/* Top row: priority dot + label + synced + menu */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
        <span className={cn("text-[10px] font-medium", cfg.text)}>{cfg.label}</span>

        <span className={cn(
          "text-[10px] font-mono px-1 py-0.5 rounded",
          task.externalId
            ? "text-emerald-500/70 bg-emerald-500/10"
            : "text-muted-foreground/40 bg-muted/40"
        )}>
          {taskCode}
        </span>

        {isSynced && (
          <span className="flex items-center gap-0.5 text-[10px] text-emerald-500/60">
            <ExternalLink className="h-2.5 w-2.5" />
          </span>
        )}

        {/* Menu */}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <button className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted">
                <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
        </div>
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2 mb-1.5 pr-1">
        {task.title}
      </p>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-muted-foreground/80 line-clamp-1 mb-2.5 leading-relaxed">
          {task.description}
        </p>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2.5">
          {tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="text-[10px] bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5 font-medium"
            >
              {tag}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground/60">+{tags.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer: agent + time + cost */}
      <div className="flex items-center gap-2 pt-2 border-t border-border/30">
        {hasAgent ? (
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <AgentAvatar
              avatarPresetId={agentAvatarPresetId}
              emoji={agentEmoji}
              size="w-4 h-4"
              className="rounded-md shrink-0"
            />
            {agentName && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[80px] font-medium">
                {agentName}
              </span>
            )}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex items-center gap-2 shrink-0">
          {hasCost && (
            <span className="text-[10px] text-muted-foreground/60 font-mono">
              ${task.cost!.toFixed(2)}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50">
            {relativeTime(task.updatedAt || task.createdAt)}
          </span>
        </div>
      </div>
      </div>{/* end p-3 */}
    </div>
  )
}
