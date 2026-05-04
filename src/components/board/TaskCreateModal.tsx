import React, { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Task, TaskStatus, TaskPriority, TaskStage, TaskRole, Epic, ProjectKind, Agent } from "@/types"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { PriorityIndicator } from "./PriorityIndicator"
import { ALL_STAGES, ALL_ROLES, STAGE_LABEL, STAGE_TONE, ROLE_FULL_LABEL } from "@/lib/projectLabels"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { User, Paperclip, Upload, X } from "lucide-react"

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
  /** Project context — drives ADLC field visibility. */
  projectId?: string
  projectKind?: ProjectKind
  /** Returns the created task when creating (used to upload staged files). */
  onSave: (data: Partial<Task>) => Promise<Task | void>
  /** Upload files against a task id (called after create when pending files exist). */
  onUploadAttachments?: (taskId: string, files: File[], onProgress?: (pct: number) => void) => Promise<void>
  onClose: () => void
}

const NONE = "__none__"

export function TaskCreateModal({
  open, task, agents, defaultStatus = "backlog",
  projectId, projectKind, onSave, onUploadAttachments, onClose,
}: TaskCreateModalProps) {
  const [title, setTitle]         = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus]       = useState<TaskStatus>(defaultStatus)
  const [priority, setPriority]   = useState<TaskPriority>("medium")
  const [assignTo, setAssignTo]   = useState<string>("")
  const [tagsRaw, setTagsRaw]     = useState("")
  const [requestFrom, setRequestFrom] = useState("-")
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState("")

  // ADLC fields (Phase B) — only surfaced when project.kind === 'adlc'.
  const [stage, setStage] = useState<string>(NONE)
  const [role, setRole]   = useState<string>(NONE)
  const [epicId, setEpicId] = useState<string>(NONE)
  const [epics, setEpics] = useState<Epic[]>([])
  const isAdlc = projectKind === 'adlc'

  // Load epics when modal opens for an ADLC project.
  useEffect(() => {
    if (!open || !isAdlc || !projectId) { setEpics([]); return }
    let cancelled = false
    api.listEpics(projectId)
      .then(r => { if (!cancelled) setEpics(r.epics) })
      .catch(() => { if (!cancelled) setEpics([]) })
    return () => { cancelled = true }
  }, [open, isAdlc, projectId])

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description || "")
      setStatus(task.status)
      setPriority(task.priority || "medium")
      setAssignTo(task.agentId || "")
      setTagsRaw((task.tags || []).join(", "))
      setRequestFrom(task.requestFrom || "-")
      setStage(task.stage || NONE)
      setRole(task.role || NONE)
      setEpicId(task.epicId || NONE)
    } else {
      setTitle(""); setDescription(""); setStatus(defaultStatus)
      setPriority("medium"); setAssignTo(""); setTagsRaw(""); setRequestFrom("-")
      setStage(NONE); setRole(NONE); setEpicId(NONE)
    }
    setPendingFiles([])
    setError("")
  }, [task, open, defaultStatus])

  async function handleSave() {
    if (!title.trim()) { setError("Title is required"); return }
    setSaving(true)
    try {
      const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean)
      const result = await onSave({
        title: title.trim(), description: description.trim() || undefined,
        status, priority, agentId: assignTo || undefined, tags,
        requestFrom: requestFrom.trim() || '-',
        // ADLC fields — only included when project is ADLC; null clears.
        ...(isAdlc ? {
          stage:  stage  === NONE ? undefined : (stage  as TaskStage),
          role:   role   === NONE ? undefined : (role   as TaskRole),
          epicId: epicId === NONE ? undefined : epicId,
        } : {}),
        ...(task ? { assignTo: assignTo || undefined } : {}),
      })
      // After create: upload any staged attachments
      if (!task && pendingFiles.length && onUploadAttachments && result && typeof result === 'object' && 'id' in result) {
        try {
          setUploadProgress(0)
          await onUploadAttachments((result as Task).id, pendingFiles, (pct) => setUploadProgress(pct))
        } catch (upErr) {
          setError(`Task created, but attachment upload failed: ${(upErr as Error).message}`)
          setSaving(false)
          setUploadProgress(null)
          return
        } finally {
          setUploadProgress(null)
        }
      }
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  function handleFiles(fl: FileList | null) {
    if (!fl) return
    setPendingFiles(prev => [...prev, ...Array.from(fl)])
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Edit Task" : "New Task"}</DialogTitle>
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
                  <div className="flex items-center">
                    <PriorityIndicator priority={priority} showLabel />
                  </div>
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

          {/* ADLC fields — only when project is ADLC kind */}
          {isAdlc && (
            <div className="space-y-3 pt-2 border-t border-border/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">ADLC</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Stage</Label>
                  <Select value={stage} onValueChange={setStage}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="No stage" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE} className="text-xs">— No stage —</SelectItem>
                      {ALL_STAGES.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          <span className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium",
                            STAGE_TONE[s]
                          )}>
                            {STAGE_LABEL[s]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="No role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE} className="text-xs">— No role —</SelectItem>
                      {ALL_ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="text-xs">
                          {ROLE_FULL_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Epic (optional)</Label>
                <Select value={epicId} onValueChange={setEpicId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="No epic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} className="text-xs">— No epic —</SelectItem>
                    {epics.map((e) => (
                      <SelectItem key={e.id} value={e.id} className="text-xs">
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {epics.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/60">
                    No epics yet. Manage them from the project settings.
                  </p>
                )}
              </div>
            </div>
          )}

          {!task && (
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="h-3 w-3" /> Attachments (optional)
              </Label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border/50 hover:border-border cursor-pointer text-xs text-muted-foreground hover:text-foreground bg-muted/10">
                <Upload className="h-3.5 w-3.5" />
                <span>Click to add files (max 25MB each, 10 total)</span>
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => { handleFiles(e.target.files); e.target.value = "" }}
                />
              </label>
              {pendingFiles.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {pendingFiles.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-muted/30 border border-border/30">
                      <Paperclip className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1024 / 1024).toFixed(1)} MB`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                        className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {uploadProgress !== null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Uploading attachments…</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full bg-emerald-500/70 transition-all duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {uploadProgress !== null ? `Uploading ${uploadProgress}%…` : saving ? "Saving..." : task ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
