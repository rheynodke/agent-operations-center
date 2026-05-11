import { useRef } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { QuickReply } from '@/types/embed';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const MAX_REPLIES = 5;

interface Props {
  value: QuickReply[];
  onChange: (next: QuickReply[]) => void;
}

export default function QuickReplyEditor({ value, onChange }: Props) {
  // Stable ids per row — regenerated only when value length grows from external source.
  // Using label/prompt as id would break if two rows share the same label or user edits one.
  const idsRef = useRef<string[]>([]);

  // Keep ids array in sync with value length
  while (idsRef.current.length < value.length) {
    idsRef.current.push(crypto.randomUUID());
  }
  while (idsRef.current.length > value.length) {
    idsRef.current.pop();
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = idsRef.current.indexOf(String(e.active.id));
    const newIdx = idsRef.current.indexOf(String(e.over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    // Move both arrays in lockstep so ids stay aligned with values
    idsRef.current = arrayMove(idsRef.current, oldIdx, newIdx);
    onChange(arrayMove(value, oldIdx, newIdx));
  }

  function update(i: number, patch: Partial<QuickReply>) {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }

  function remove(i: number) {
    idsRef.current.splice(i, 1);
    onChange(value.filter((_, idx) => idx !== i));
  }

  function add() {
    if (value.length >= MAX_REPLIES) return;
    idsRef.current.push(crypto.randomUUID());
    onChange([...value, { label: `Question ${value.length + 1}`, prompt: '' }]);
  }

  // Snapshot ids for SortableContext (must not mutate mid-render)
  const ids = idsRef.current.slice();

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {value.map((reply, i) => (
            <SortableRow key={ids[i]} id={ids[i]}>
              <Input
                value={reply.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Label (button text)"
                className="w-1/3"
              />
              <Input
                value={reply.prompt}
                onChange={(e) => update(i, { prompt: e.target.value })}
                placeholder="Prompt (sent to agent)"
                className="flex-1"
              />
              <Button variant="ghost" size="sm" onClick={() => remove(i)} aria-label="Remove">
                ×
              </Button>
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>

      <Button
        variant="outline"
        size="sm"
        onClick={add}
        disabled={value.length >= MAX_REPLIES}
      >
        + Add ({value.length}/{MAX_REPLIES})
      </Button>
    </div>
  );
}

interface SortableRowProps {
  id: string;
  children: React.ReactNode;
}

function SortableRow({ id, children }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-2 border border-border rounded bg-card"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground select-none px-1"
        aria-label="Drag to reorder"
      >
        ⋮⋮
      </button>
      {children}
    </div>
  );
}
