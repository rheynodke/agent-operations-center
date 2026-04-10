import React, { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Task, TaskActivity, Agent } from "@/types"
import { api } from "@/lib/api"
import { Zap } from "lucide-react"
import { InReviewBanner } from "./InReviewBanner"
import { AgentWorkSection } from "./AgentWorkSection"

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "🔍 In Review",
  blocked: "🚫 Blocked",
  done: "Done",
}

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">{label}</span>
      <div className="h-px flex-1 bg-border/30" />
    </div>
  )
}

interface TaskDetailModalProps {
  task: Task | null
  agents: Agent[]
  open: boolean
  isActive?: boolean
  onClose: () => void
  onUpdate: (id: string, patch: object) => Promise<void>
}

export function TaskDetailModal({ task, agents, open, isActive = true, onClose, onUpdate }: TaskDetailModalProps) {
  const [activity, setActivity] = useState<TaskActivity[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [dispatchMsg, setDispatchMsg] = useState("")
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  useEffect(() => {
    if (!task || !open) return
    setLoadingActivity(true)
    api.getTaskActivity(task.id)
      .then(r => setActivity(r.activity))
      .catch(() => setActivity([]))
      .finally(() => setLoadingActivity(false))
  }, [task?.id, open])

  async function handleDispatch() {
    if (!task) return
    setDispatching(true)
    setDispatchMsg("")
    try {
      await api.dispatchTask(task.id)
      setDispatchMsg("✓ Dispatched — agent is working")
      setTimeout(() => setDispatchMsg(""), 5000)
    } catch (e: unknown) {
      setDispatchMsg(`❌ ${(e as Error).message || "Dispatch failed"}`)
      setTimeout(() => setDispatchMsg(""), 5000)
    } finally {
      setDispatching(false)
    }
  }

  async function handleApprove() {
    if (!task) return
    setReviewSubmitting(true)
    try {
      await onUpdate(task.id, { status: "done", note: "Approved" })
    } finally {
      setReviewSubmitting(false)
    }
  }

  async function handleRequestChanges(note: string, targetStatus: "todo" | "in_progress") {
    if (!task) return
    setReviewSubmitting(true)
    try {
      await onUpdate(task.id, { status: targetStatus, note })
    } finally {
      setReviewSubmitting(false)
    }
  }

  if (!task) return null

  // Completion note fallback: when sessionId is null but task has a completion note in activity
  const completionNote = !task.sessionId && (task.status === "done" || task.status === "in_review")
    ? activity.find(a => a.type === "status_change" && (a.toValue === "done" || a.toValue === "in_review") && a.note)?.note
    : undefined

  const hasAgentWork = !!task.sessionId || !!completionNote

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl w-full max-h-[90vh] overflow-y-auto flex flex-col gap-0 p-0">

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40 sticky top-0 bg-background z-10">
          <div className="flex items-start justify-between gap-4 pr-6">
            <DialogTitle className="text-lg font-semibold leading-snug flex-1">
              {task.title}
            </DialogTitle>
            {task.agentId && (
              <Button
                size="sm"
                variant={task.status === "in_progress" ? "outline" : "default"}
                className="h-7 text-xs gap-1 shrink-0"
                onClick={handleDispatch}
                disabled={dispatching}
              >
                <Zap className="h-3 w-3" />
                {dispatching ? "Dispatching…" : task.sessionId ? "Re-dispatch" : "Dispatch to Agent"}
              </Button>
            )}
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <Select value={task.status} onValueChange={v => onUpdate(task.id, { status: v })}>
              <SelectTrigger className="h-6 text-xs w-36 px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {task.priority && (
              <Select value={task.priority} onValueChange={v => onUpdate(task.id, { priority: v })}>
                <SelectTrigger className="h-6 text-xs w-28 px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select
              value={task.agentId || "__none__"}
              onValueChange={v => onUpdate(task.id, { assignTo: v === "__none__" ? null : v })}
            >
              <SelectTrigger className="h-6 text-xs w-36 px-2">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {agents.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.emoji || "🤖"} {a.name || a.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(task.tags || []).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs h-6">#{tag}</Badge>
            ))}
          </div>

          {/* Meta line */}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground/50">
            <span>Created {new Date(task.createdAt).toLocaleDateString()}</span>
            {task.completedAt && <span>· Completed {new Date(task.completedAt).toLocaleDateString()}</span>}
            {task.cost != null && <span>· ${task.cost.toFixed(2)}</span>}
          </div>

          {dispatchMsg && <p className="text-xs mt-1.5 text-muted-foreground">{dispatchMsg}</p>}
        </DialogHeader>

        {/* ── Body ── */}
        <div className="px-6 py-5 space-y-6 flex-1 min-h-0">

          {/* In Review Banner */}
          {task.status === "in_review" && (
            <InReviewBanner
              onApprove={handleApprove}
              onRequestChanges={handleRequestChanges}
              isSubmitting={reviewSubmitting}
            />
          )}

          {/* Description */}
          {task.description && (
            <section>
              <SectionHeader label="Description" />
              <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                {task.description}
              </p>
            </section>
          )}

          {/* Agent Work */}
          <section>
            <SectionHeader label={
              task.status === "in_progress" && task.sessionId
                ? "Agent Work · Live"
                : "Agent Work"
            } />
            {!hasAgentWork ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-muted-foreground">Agent belum mulai bekerja pada ticket ini.</p>
                {task.agentId && (
                  <p className="text-xs text-muted-foreground/60">Klik "Dispatch to Agent" untuk mulai.</p>
                )}
              </div>
            ) : (
              <AgentWorkSection
                sessionKey={task.sessionId || ""}
                isActive={isActive && open}
                taskStatus={task.status}
                completionNoteFallback={completionNote}
              />
            )}
          </section>

          {/* Activity */}
          <section>
            <SectionHeader label="Activity" />
            {loadingActivity ? (
              <p className="text-xs text-muted-foreground/60 text-center py-4">Loading…</p>
            ) : activity.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 text-center py-4">No activity yet.</p>
            ) : (
              <div className="space-y-0">
                {activity.map((a, idx) => (
                  <div key={a.id} className="flex gap-3 text-xs">
                    <div className="flex flex-col items-center shrink-0 pt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-border/60 shrink-0" />
                      {idx < activity.length - 1 && <div className="w-px flex-1 bg-border/30 mt-1" />}
                    </div>
                    <div className="flex-1 min-w-0 pb-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-medium">
                          {a.actor === "user" ? "👤 User" : `🤖 ${a.actor}`}
                        </span>
                        {a.type === "status_change" && (
                          <span className="text-muted-foreground">
                            moved{" "}
                            <span className="font-mono bg-muted/40 px-1 rounded">{a.fromValue}</span>
                            {" → "}
                            <span className="font-mono bg-muted/40 px-1 rounded">{a.toValue}</span>
                          </span>
                        )}
                        {a.type === "assignment" && (
                          <span className="text-muted-foreground">
                            assigned to <span className="font-medium">{a.toValue || "nobody"}</span>
                          </span>
                        )}
                        {a.type === "created" && <span className="text-muted-foreground">created ticket</span>}
                        {a.type === "comment" && <span className="text-muted-foreground">commented</span>}
                        <span className="ml-auto text-muted-foreground/50 shrink-0 tabular-nums">
                          {new Date(a.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {a.note && (
                        <p className="text-muted-foreground mt-0.5 italic text-[11px] leading-snug">
                          "{a.note}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </DialogContent>
    </Dialog>
  )
}
