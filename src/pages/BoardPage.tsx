import { useMemo } from "react"
import { useTaskStore } from "@/stores"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { Task, TaskStatus } from "@/types"

const COLUMNS: { status: TaskStatus; label: string; emoji: string }[] = [
  { status: "backlog", label: "Backlog", emoji: "📋" },
  { status: "todo", label: "To Do", emoji: "📌" },
  { status: "in_progress", label: "In Progress", emoji: "⚡" },
  { status: "done", label: "Done", emoji: "✅" },
]

const priorityColors = {
  urgent: "border-l-[var(--status-error-text)]",
  high: "border-l-[var(--status-paused-text)]",
  medium: "border-l-primary/60",
  low: "border-l-muted-foreground/30",
}

function TaskCard({ task }: { task: Task }) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg bg-card ghost-border hover:bg-surface-high transition-all cursor-default",
        "border-l-2",
        task.priority ? priorityColors[task.priority] : "border-l-transparent"
      )}
    >
      {/* Agent */}
      {task.agentEmoji && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-sm">{task.agentEmoji}</span>
          <span className="text-xs text-muted-foreground truncate">{task.agentName}</span>
        </div>
      )}

      <p className="text-sm text-foreground leading-snug">{task.title}</p>

      {task.description && (
        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{task.description}</p>
      )}

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/40">
        {task.priority && (
          <span
            className={cn(
              "text-[10px] font-medium capitalize",
              task.priority === "urgent" && "text-[var(--status-error-text)]",
              task.priority === "high" && "text-[var(--status-paused-text)]",
              task.priority === "medium" && "text-primary/70",
              task.priority === "low" && "text-muted-foreground/50"
            )}
          >
            {task.priority}
          </span>
        )}
        {task.cost && (
          <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
            ${task.cost.toFixed(3)}
          </span>
        )}
      </div>
    </div>
  )
}

function KanbanColumn({
  status, label, emoji, tasks,
}: {
  status: TaskStatus
  label: string
  emoji: string
  tasks: Task[]
}) {
  return (
    <div className="flex flex-col gap-3 min-w-[240px] flex-1">
      {/* Column header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span>{emoji}</span>
          <h3 className="font-display text-sm font-semibold text-foreground">{label}</h3>
        </div>
        <span className="flex items-center justify-center h-5 min-w-5 rounded-full bg-secondary text-[11px] text-muted-foreground font-medium px-1.5">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <ScrollArea className="h-[calc(100vh-260px)]">
        <div className="flex flex-col gap-2.5 pr-1 pb-2">
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center h-24 rounded-xl bg-secondary/50 text-xs text-muted-foreground border border-dashed border-border/50">
              No tasks
            </div>
          ) : (
            tasks.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export function BoardPage() {
  const tasks = useTaskStore((s) => s.tasks)

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      backlog: [], todo: [], in_progress: [], done: [],
    }
    for (const task of tasks) {
      if (map[task.status]) map[task.status].push(task)
    }
    return map
  }, [tasks])

  return (
    <div className="animate-fade-in">
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map(({ status, label, emoji }) => (
          <KanbanColumn
            key={status}
            status={status}
            label={label}
            emoji={emoji}
            tasks={grouped[status]}
          />
        ))}
      </div>
    </div>
  )
}
