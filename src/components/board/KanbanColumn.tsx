import React from "react"
import { useDroppable } from "@dnd-kit/core"
import { cn } from "@/lib/utils"

interface KanbanColumnProps {
  id: string
  label: string
  emoji: string
  count: number
  children: React.ReactNode
}

export function KanbanColumn({ id, label, emoji, count, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center gap-2 px-1 mb-3">
        <span className="text-base">{emoji}</span>
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="ml-auto text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-medium">
          {count}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-2 min-h-24 rounded-lg p-2 transition-colors",
          isOver && "bg-accent/30 ring-1 ring-border"
        )}
      >
        {children}
      </div>
    </div>
  )
}
