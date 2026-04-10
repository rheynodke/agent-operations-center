import React, { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Task, TaskStatus, TaskPriority, Agent } from "@/types"

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "backlog",     label: "Backlog" },
  { value: "todo",        label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked",     label: "🚫 Blocked" },
  { value: "done",        label: "Done" },
]

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high",   label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low" },
]

interface TaskCreateModalProps {
  open: boolean
  task?: Task | null       // if set, editing mode
  agents: Agent[]
  defaultStatus?: TaskStatus
  onSave: (data: Partial<Task>) => Promise<void>
  onClose: () => void
}

export function TaskCreateModal({ open, task, agents, defaultStatus = "backlog", onSave, onClose }: TaskCreateModalProps) {
  const [title, setTitle]         = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus]       = useState<TaskStatus>(defaultStatus)
  const [priority, setPriority]   = useState<TaskPriority>("medium")
  const [assignTo, setAssignTo]   = useState<string>("")
  const [tagsRaw, setTagsRaw]     = useState("")
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState("")

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description || "")
      setStatus(task.status)
      setPriority(task.priority || "medium")
      setAssignTo(task.agentId || "")
      setTagsRaw((task.tags || []).join(", "))
    } else {
      setTitle(""); setDescription(""); setStatus(defaultStatus)
      setPriority("medium"); setAssignTo(""); setTagsRaw("")
    }
    setError("")
  }, [task, open])

  async function handleSave() {
    if (!title.trim()) { setError("Title is required"); return }
    setSaving(true)
    try {
      const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean)
      await onSave({
        title: title.trim(), description: description.trim() || undefined,
        status, priority, agentId: assignTo || undefined, tags,
        ...(task ? { assignTo: assignTo || undefined } : {}),
      })
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Edit Ticket" : "New Ticket"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details..." rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Assign to Agent</Label>
            <Select value={assignTo || "__none__"} onValueChange={(v) => setAssignTo(v === "__none__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.emoji || "🤖"} {a.name || a.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Tags (comma separated)</Label>
            <Input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="auth, frontend, bug" />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : task ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
