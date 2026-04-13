import React, { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Task, TaskStatus, TaskPriority, Agent } from "@/types"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { PriorityIndicator } from "./PriorityIndicator"
import { User } from "lucide-react"

const STATUSES: { value: TaskStatus; label: string; dot: string; disabled?: boolean }[] = [
  { value: "backlog",     label: "Backlog",     dot: "bg-zinc-500" },
  { value: "todo",        label: "Todo",        dot: "bg-blue-400" },
  { value: "in_progress", label: "In Progress", dot: "bg-amber-400" },
  { value: "in_review",   label: "In Review",   dot: "bg-purple-400" },
  { value: "blocked",     label: "Blocked",     dot: "bg-red-500",     disabled: true },
  { value: "done",        label: "Done",        dot: "bg-emerald-500" },
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
  const [requestFrom, setRequestFrom] = useState("-")
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
      setRequestFrom(task.requestFrom || "-")
    } else {
      setTitle(""); setDescription(""); setStatus(defaultStatus)
      setPriority("medium"); setAssignTo(""); setTagsRaw(""); setRequestFrom("-")
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
        requestFrom: requestFrom.trim() || '-',
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
            {/* Status — locked to Backlog on create */}
            <div className="space-y-1">
              <Label>Status</Label>
              <div className="h-8 flex items-center gap-2 px-3 rounded-md border border-border/40 bg-muted/20 cursor-not-allowed select-none">
                <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" />
                <span className="text-sm text-muted-foreground/70">Backlog</span>
                <span className="ml-auto text-[10px] text-muted-foreground/35 font-medium uppercase tracking-wide">locked</span>
              </div>
            </div>

            {/* Priority with level indicator */}
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="h-8 gap-2">
                  <PriorityIndicator priority={priority} showLabel />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => (
                    <SelectItem key={p.value} value={p.value}>
                      <PriorityIndicator priority={p.value} showLabel />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Assign to Agent</Label>
            {(() => {
              const selectedAgent = agents.find(a => a.id === assignTo)
              return (
                <Select value={assignTo || "__none__"} onValueChange={(v) => setAssignTo(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 flex items-center gap-2 px-3">
                    {selectedAgent ? (
                      <>
                        <AgentAvatar
                          avatarPresetId={selectedAgent.avatarPresetId}
                          emoji={selectedAgent.emoji}
                          size="w-5 h-5"
                          className="rounded-sm shrink-0"
                        />
                        <span className="truncate text-sm">{selectedAgent.name || selectedAgent.id}</span>
                      </>
                    ) : (
                      <>
                        <User className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                        <span className="text-sm text-muted-foreground/60">Unassigned</span>
                      </>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-3.5 w-3.5" /> Unassigned
                      </span>
                    </SelectItem>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="flex items-center gap-2">
                          <AgentAvatar
                            avatarPresetId={a.avatarPresetId}
                            emoji={a.emoji}
                            size="w-5 h-5"
                            className="rounded-sm"
                          />
                          {a.name || a.id}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            })()}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tags (comma separated)</Label>
              <Input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="auth, frontend, bug" />
            </div>
            <div className="space-y-1">
              <Label>Request From</Label>
              <Input value={requestFrom} onChange={(e) => setRequestFrom(e.target.value)} placeholder="-" />
            </div>
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
