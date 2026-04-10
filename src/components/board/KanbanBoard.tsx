import React from "react"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core"
import { KanbanColumn } from "./KanbanColumn"

export interface KanbanColumnDef {
  id: string
  label: string
  emoji: string
}

interface KanbanBoardProps<T extends { id: string }> {
  columns: KanbanColumnDef[]
  items: T[]
  getColumnId: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  renderDragOverlay?: (item: T) => React.ReactNode
  onItemMove?: (itemId: string, fromColumnId: string, toColumnId: string) => void
  activeId?: string | null
  onDragStart?: (id: string) => void
  onDragEnd?: (event: DragEndEvent) => void
}

export function KanbanBoard<T extends { id: string }>({
  columns,
  items,
  getColumnId,
  renderItem,
  renderDragOverlay,
  onItemMove,
  activeId,
  onDragStart,
  onDragEnd,
}: KanbanBoardProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    onDragEnd?.(event)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const item = items.find((i) => i.id === active.id)
    if (!item) return
    const fromCol = getColumnId(item)
    const toCol = String(over.id)
    if (fromCol !== toCol && columns.some((c) => c.id === toCol)) {
      onItemMove?.(String(active.id), fromCol, toCol)
    }
  }

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => onDragStart?.(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {columns.map((col) => {
          const colItems = items.filter((i) => getColumnId(i) === col.id)
          return (
            <KanbanColumn key={col.id} id={col.id} label={col.label} emoji={col.emoji} count={colItems.length}>
              {colItems.map((item) => renderItem(item))}
            </KanbanColumn>
          )
        })}
      </div>
      <DragOverlay>
        {activeItem ? (renderDragOverlay ? renderDragOverlay(activeItem) : renderItem(activeItem)) : null}
      </DragOverlay>
    </DndContext>
  )
}
