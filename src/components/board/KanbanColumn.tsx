import React, { useState } from "react"
import { useDroppable } from "@dnd-kit/core"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const COLUMN_ACCENT: Record<string, string> = {
  backlog:     "text-muted-foreground",
  todo:        "text-blue-400",
  in_progress: "text-amber-400",
  in_review:   "text-violet-400",
  blocked:     "text-red-400",
  done:        "text-emerald-400",
}

const COLUMN_COUNT_BG: Record<string, string> = {
  backlog:     "bg-muted/60 text-muted-foreground",
  todo:        "bg-blue-500/10 text-blue-400",
  in_progress: "bg-amber-500/10 text-amber-400",
  in_review:   "bg-violet-500/10 text-violet-400",
  blocked:     "bg-red-500/10 text-red-400",
  done:        "bg-emerald-500/10 text-emerald-400",
}

interface KanbanColumnProps {
  id: string
  label: string
  emoji?: string
  icon?: React.ComponentType<{ className?: string }>
  count: number
  collapsible?: boolean
  defaultCollapsed?: boolean
  children: React.ReactNode
}

export function KanbanColumn({
  id, label, emoji, icon: Icon, count, children,
  collapsible = false,
  defaultCollapsed = false,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const accentClass = COLUMN_ACCENT[id] || "text-muted-foreground"
  const countBgClass = COLUMN_COUNT_BG[id] || "bg-muted/60 text-muted-foreground"

  return (
    <div className={cn("flex flex-col shrink-0 transition-all duration-200", collapsed ? "w-14" : "w-[272px]")}>
      {/* Column header */}
      <div
        className={cn(
          "flex items-center gap-2 px-1 mb-3",
          collapsed && "flex-col gap-1.5 px-0"
        )}
      >
        {collapsed ? (
          // Vertical collapsed header
          <button
            onClick={() => setCollapsed(false)}
            className="flex flex-col items-center gap-2 w-full py-2 rounded-lg hover:bg-muted/30 transition-colors"
          >
            {Icon
              ? <Icon className={cn("h-4 w-4", accentClass)} />
              : <span className="text-sm">{emoji}</span>
            }
            <span
              className={cn(
                "text-xs font-semibold writing-mode-vertical rotate-180 select-none",
                accentClass
              )}
              style={{ writingMode: "vertical-rl" }}
            >
              {label}
            </span>
            <span className={cn("text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-5 text-center", countBgClass)}>
              {count}
            </span>
          </button>
        ) : (
          // Normal horizontal header
          <>
            {Icon
              ? <Icon className={cn("h-4 w-4 shrink-0", accentClass)} />
              : <span className="text-sm">{emoji}</span>
            }
            <span className={cn("text-sm font-semibold", accentClass)}>{label}</span>
            <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 tabular-nums", countBgClass)}>
              {count}
            </span>
            {collapsible && (
              <button
                onClick={() => setCollapsed(true)}
                className="ml-auto p-0.5 rounded hover:bg-muted/40 transition-colors text-muted-foreground/50 hover:text-muted-foreground"
                title={`Collapse ${label}`}
              >
                <ChevronDown className="h-3.5 w-3.5 rotate-90" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Drop zone + cards */}
      {!collapsed && (
        <div
          ref={setNodeRef}
          className={cn(
            "flex flex-col gap-2 min-h-24 rounded-xl p-2 transition-colors",
            isOver && "bg-primary/5 ring-1 ring-primary/20"
          )}
        >
          {children}

          {/* Empty state */}
          {count === 0 && (
            <div className="flex items-center justify-center h-16 rounded-lg border border-dashed border-border/40">
              <span className="text-xs text-muted-foreground/40">Drop here</span>
            </div>
          )}
        </div>
      )}

      {/* Collapsed drop zone (still droppable) */}
      {collapsed && (
        <div
          ref={setNodeRef}
          className={cn(
            "flex-1 rounded-xl min-h-24 transition-colors border border-dashed border-transparent",
            isOver && "border-primary/30 bg-primary/5"
          )}
        />
      )}
    </div>
  )
}
