import React, { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Task, TaskActivity, Agent } from "@/types"
import { api } from "@/lib/api"
import { useAuthStore } from "@/stores"
import {
  Zap, X, Calendar, User, Clock,
  CheckCircle2, ArrowRight, ChevronDown,
  FileText, Bot, History, BarChart3
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { PriorityIndicator } from "./PriorityIndicator"
import { InReviewBanner } from "./InReviewBanner"
import { AgentWorkSection } from "./AgentWorkSection"
import { ExecutionStats } from "./ExecutionStats"

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; bg: string; border: string; badge: string }> = {
  backlog:     { label: "Backlog",     dot: "bg-zinc-500",    text: "text-zinc-400",    bg: "bg-zinc-500/10",    border: "border-zinc-500/20",    badge: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
  todo:        { label: "Todo",        dot: "bg-blue-400",    text: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20",    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  in_progress: { label: "In Progress", dot: "bg-amber-400",   text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20",   badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  in_review:   { label: "In Review",   dot: "bg-purple-400",  text: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/20",  badge: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  blocked:     { label: "Blocked",     dot: "bg-red-500",     text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20",     badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  done:        { label: "Done",        dot: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
}

const PRIORITY_CONFIG: Record<string, { label: string; icon: string; text: string; bg: string; border: string }> = {
  urgent: { label: "Urgent", icon: "↑↑", text: "text-red-400",              bg: "bg-red-500/10",    border: "border-red-500/20" },
  high:   { label: "High",   icon: "↑",  text: "text-orange-400",           bg: "bg-orange-500/10", border: "border-orange-500/20" },
  medium: { label: "Medium", icon: "–",  text: "text-muted-foreground",     bg: "bg-muted/40",      border: "border-border/50" },
  low:    { label: "Low",    icon: "↓",  text: "text-muted-foreground/60",  bg: "bg-muted/20",      border: "border-border/30" },
}

// ── Prop chip — shows a labeled property, click to open Select ───────────────

function PropChip({
  label, children, className,
}: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-0.5">
        {label}
      </span>
      {children}
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress",
  in_review: "In Review", blocked: "Blocked", done: "Done",
}

// ── Section wrapper — each section is a bordered card ────────────────────────

function SectionCard({
  icon: Icon,
  label,
  live,
  children,
  noPadBody,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  live?: boolean
  children: React.ReactNode
  noPadBody?: boolean
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-xs font-semibold text-foreground/80 tracking-wide">
          {label}
        </span>
        {live && (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
        )}
      </div>
      {/* Body */}
      <div className={noPadBody ? "" : "p-4"}>
        {children}
      </div>
    </div>
  )
}

// ── (ActivityIcon removed — unused) ──────────────────────────────────────────

// ── Main component ────────────────────────────────────────────────────────────

interface TaskDetailModalProps {
  task: Task | null
  agents: Agent[]
  open: boolean
  isActive?: boolean
  onClose: () => void
  onUpdate: (id: string, patch: object) => Promise<void>
}

export function TaskDetailModal({ task, agents, open, isActive = true, onClose, onUpdate }: TaskDetailModalProps) {
  const currentUser = useAuthStore(s => s.user)
  const [activity, setActivity] = useState<TaskActivity[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [dispatchMsg, setDispatchMsg] = useState("")
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const agentWorkRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!task || !open) return
    setLoadingActivity(true)
    api.getTaskActivity(task.id)
      .then(r => setActivity(r.activity))
      .catch(() => setActivity([]))
      .finally(() => setLoadingActivity(false))
  }, [task?.id, open])

  // Auto-focus Agent Work section when ticket opens (if session exists)
  useEffect(() => {
    if (!open || !task?.sessionId) return
    const t = setTimeout(() => {
      agentWorkRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 180)
    return () => clearTimeout(t)
  }, [open, task?.id])

  async function handleDispatch() {
    if (!task) return
    setDispatching(true)
    setDispatchMsg("")
    try {
      await api.dispatchTask(task.id)
      setDispatchMsg("Dispatched — agent is working")
      setTimeout(() => setDispatchMsg(""), 5000)
    } catch (e: unknown) {
      setDispatchMsg((e as Error).message || "Dispatch failed")
      setTimeout(() => setDispatchMsg(""), 5000)
    } finally {
      setDispatching(false)
    }
  }

  async function handleApprove() {
    if (!task) return
    setReviewSubmitting(true)
    try { await onUpdate(task.id, { status: "done", note: "Approved" }) }
    finally { setReviewSubmitting(false) }
  }

  async function handleRequestChanges(note: string, targetStatus: "todo" | "in_progress") {
    if (!task) return
    setReviewSubmitting(true)
    try { await onUpdate(task.id, { status: targetStatus, note }) }
    finally { setReviewSubmitting(false) }
  }

  if (!task) return null

  const assignedAgent = task.agentId ? agents.find(a => a.id === task.agentId) : null
  const statusCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.backlog
  const isLive = task.status === "in_progress"

  const completionNote = !task.sessionId && (task.status === "done" || task.status === "in_review")
    ? activity.find(a => a.type === "status_change" && (a.toValue === "done" || a.toValue === "in_review") && a.note)?.note
    : undefined

  const hasAgentWork = !!task.sessionId || !!completionNote

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0 [&>button]:hidden">

        {/* ── Header ── */}
        <div className="shrink-0 border-b border-border/40 bg-card/50">

          {/* Header: code / title / actions */}
          <div className="px-5 pt-3 pb-0">
            {/* Row 1: code */}
            <span className={cn(
              "text-[10px] font-mono px-1 py-px rounded",
              task.externalId
                ? "text-emerald-500/70 bg-emerald-500/10"
                : "text-muted-foreground/35 bg-muted/40"
            )}>
              {task.externalId ?? `#${task.id.slice(0, 6)}`}
            </span>
            {/* Row 2: title + actions */}
            <div className="flex items-start gap-3 mt-0.5">
              <h1 className="flex-1 min-w-0 text-lg font-semibold text-foreground leading-snug tracking-tight">
                {task.title}
              </h1>
              <div className="flex items-center gap-2 shrink-0">
                {task.agentId && (
                  <Button
                    size="sm"
                    variant={isLive ? "outline" : "default"}
                    className="h-7 text-xs gap-1.5 px-3"
                    onClick={handleDispatch}
                    disabled={dispatching}
                  >
                    <Zap className="h-3 w-3" />
                    {dispatching ? "Dispatching…" : task.sessionId ? "Continue" : "Dispatch"}
                  </Button>
                )}
                <button
                  onClick={onClose}
                  className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 pt-3 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 p-3 rounded-xl bg-muted/10 border border-border/30">

              {/* Status */}
              <PropChip label="Status">
                <Select value={task.status} onValueChange={v => onUpdate(task.id, { status: v })}>
                  <SelectTrigger className={cn(
                    "h-7 text-xs font-medium rounded-md border px-2.5 gap-1.5 w-full focus:ring-0 focus:ring-offset-0",
                    statusCfg.bg, statusCfg.border, statusCfg.text
                  )}>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusCfg.dot)} />
                    <span>{statusCfg.label}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CONFIG).map(([v, cfg]) => (
                      <SelectItem key={v} value={v} className="text-xs">
                        <span className="flex items-center gap-2">
                          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
                          {cfg.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropChip>

              {/* Priority */}
              <PropChip label="Priority">
                <Select value={task.priority || "medium"} onValueChange={v => onUpdate(task.id, { priority: v })}>
                  <SelectTrigger className="h-7 text-xs font-medium rounded-md border border-border/40 px-2.5 gap-2 w-full focus:ring-0 focus:ring-offset-0 bg-muted/20">
                    <PriorityIndicator priority={task.priority || "medium"} showLabel />
                  </SelectTrigger>
                  <SelectContent>
                    {["urgent", "high", "medium", "low"].map(v => (
                      <SelectItem key={v} value={v} className="text-xs">
                        <PriorityIndicator priority={v} showLabel />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropChip>

              {/* Assignee */}
              <PropChip label="Assignee">
                <Select
                  value={task.agentId || "__none__"}
                  onValueChange={v => onUpdate(task.id, { assignTo: v === "__none__" ? null : v })}
                >
                  <SelectTrigger className="h-7 text-xs w-full px-2 border-border/40 focus:ring-0 focus:ring-offset-0 gap-1.5 bg-muted/20 hover:bg-muted/40 transition-colors rounded-md">
                    {assignedAgent ? (
                      <>
                        <AgentAvatar
                          avatarPresetId={assignedAgent.avatarPresetId}
                          emoji={assignedAgent.emoji}
                          size="w-4 h-4"
                          className="rounded-sm shrink-0"
                        />
                        <span className="font-medium text-foreground/90 truncate">
                          {assignedAgent.name || assignedAgent.id}
                        </span>
                      </>
                    ) : (
                      <>
                        <User className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                        <span className="text-muted-foreground/60">Unassigned</span>
                      </>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-3.5 w-3.5" /> Unassigned
                      </span>
                    </SelectItem>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        <span className="flex items-center gap-2">
                          <AgentAvatar avatarPresetId={a.avatarPresetId} emoji={a.emoji} size="w-4 h-4" className="rounded-sm" />
                          {a.name || a.id}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PropChip>

              {/* Created date */}
              <PropChip label="Created">
                <div className="h-7 flex items-center gap-1.5 px-2.5 rounded-md border border-border/30 bg-muted/10 text-xs text-muted-foreground/70">
                  <Calendar className="h-3 w-3 shrink-0" />
                  {new Date(task.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </div>
              </PropChip>

            </div>

            {/* Secondary meta: tags, completion, cost */}
            {((task.tags?.length ?? 0) > 0 || task.completedAt || task.cost != null) && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {(task.tags || []).map(tag => (
                  <Badge key={tag} variant="outline" className="h-5 text-[10px] px-1.5 rounded font-normal border-border/40 text-muted-foreground/70">
                    #{tag}
                  </Badge>
                ))}
                {task.completedAt && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400/80 ml-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Completed {new Date(task.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
                {task.cost != null && (
                  <span className="text-[11px] text-muted-foreground/50 ml-auto font-mono">
                    ${task.cost.toFixed(2)}
                  </span>
                )}
              </div>
            )}

            {/* Sync source badge */}
            {task.externalSource && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded px-2 py-1 w-fit mt-3">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-400 shrink-0">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
                <span>Synced from {task.externalSource === 'google_sheets' ? 'Google Sheets' : task.externalSource}</span>
                {task.externalId && <span className="font-mono opacity-60">· {task.externalId}</span>}
              </div>
            )}

            {/* Dispatch feedback */}
            {dispatchMsg && (
              <p className="text-xs mt-2 text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {dispatchMsg}
              </p>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5 space-y-4">

          {/* In Review Banner */}
          {task.status === "in_review" && (
            <InReviewBanner
              onApprove={handleApprove}
              onRequestChanges={handleRequestChanges}
              isSubmitting={reviewSubmitting}
            />
          )}

          {/* Execution Stats — collapsible */}
          {(task.sessionId || task.inputTokens != null || task.cost != null) && (
            <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
              <button
                onClick={() => setStatsOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors"
              >
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                <span className="text-xs font-semibold text-foreground/80 tracking-wide">
                  Execution Stats
                </span>
                <ChevronDown className={cn(
                  "h-3 w-3 text-muted-foreground/40 transition-transform ml-auto shrink-0",
                  statsOpen && "rotate-180"
                )} />
              </button>
              {statsOpen && (
                <div className="p-4">
                  <ExecutionStats task={task} activity={activity} />
                </div>
              )}
            </div>
          )}

          {/* Description */}
          {task.description && (
            <SectionCard icon={FileText} label="Description">
              <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                {task.description}
              </p>
            </SectionCard>
          )}

          {/* Agent Work */}
          <div ref={agentWorkRef}>
          <SectionCard icon={Bot} label="Agent Work" live={isLive && !!task.sessionId} noPadBody>
            {!hasAgentWork ? (
              <div className="py-10 text-center space-y-2">
                <div className="w-8 h-8 rounded-full bg-muted/30 flex items-center justify-center mx-auto mb-3">
                  <Zap className="h-4 w-4 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">No agent work yet</p>
                {task.agentId ? (
                  <p className="text-xs text-muted-foreground/50">Click Dispatch to start the agent</p>
                ) : (
                  <p className="text-xs text-muted-foreground/50">Assign an agent first</p>
                )}
              </div>
            ) : (
              <div className="p-4">
                <AgentWorkSection
                  sessionKey={task.sessionId || ""}
                  taskId={task.id}
                  isActive={isActive && open}
                  taskStatus={task.status}
                  completionNoteFallback={completionNote}
                />
              </div>
            )}
          </SectionCard>
          </div>

          {/* Activity — collapsed by default */}
          <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
            <button
              onClick={() => setActivityOpen(o => !o)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors"
            >
              <History className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="text-xs font-semibold text-foreground/80 tracking-wide">Activity</span>
              {activity.length > 0 && (
                <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">{activity.length}</span>
              )}
              <ChevronDown className={cn(
                "h-3 w-3 text-muted-foreground/40 transition-transform ml-auto shrink-0",
                activityOpen && "rotate-180"
              )} />
            </button>
            {activityOpen && (
              <div className="p-4">
            {loadingActivity ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/50 py-4 justify-center">
                <Clock className="h-3.5 w-3.5 animate-pulse" />
                Loading activity…
              </div>
            ) : activity.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 text-center py-4">No activity yet.</p>
            ) : (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border/30" />
                <div className="space-y-0">
                  {activity.map((a, idx) => {
                    const isLast = idx === activity.length - 1
                    const actorIsUser = a.actor === "user"
                    const actorAgent = !actorIsUser ? agents.find(ag => ag.id === a.actor) : null

                    return (
                      <div key={a.id} className={cn("flex gap-4 text-xs", !isLast && "pb-4")}>
                        {/* Icon */}
                        <div className="relative z-10 shrink-0 w-3 h-3 mt-0.5 rounded-full bg-background border border-border/60 flex items-center justify-center">
                          <div className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Actor */}
                              {actorIsUser ? (
                                <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                                  <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                    <User className="h-2.5 w-2.5 text-primary" />
                                  </div>
                                  {currentUser?.displayName ?? "User"}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                                  <AgentAvatar
                                    avatarPresetId={actorAgent?.avatarPresetId}
                                    emoji={actorAgent?.emoji ?? "🤖"}
                                    size="w-4 h-4"
                                    className="rounded-sm"
                                  />
                                  {actorAgent?.name ?? a.actor}
                                </span>
                              )}

                              {/* Event description */}
                              {a.type === "status_change" && (
                                <span className="text-muted-foreground flex items-center gap-1">
                                  moved
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                                    STATUS_CONFIG[a.fromValue ?? ""]?.badge ?? "bg-muted/40 text-muted-foreground border-border/40"
                                  )}>
                                    {STATUS_LABELS[a.fromValue ?? ""] ?? a.fromValue}
                                  </span>
                                  <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50" />
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                                    STATUS_CONFIG[a.toValue ?? ""]?.badge ?? "bg-muted/40 text-muted-foreground border-border/40"
                                  )}>
                                    {STATUS_LABELS[a.toValue ?? ""] ?? a.toValue}
                                  </span>
                                </span>
                              )}
                              {a.type === "assignment" && (
                                <span className="text-muted-foreground">
                                  assigned to <span className="font-medium text-foreground/70">{a.toValue || "nobody"}</span>
                                </span>
                              )}
                              {a.type === "created" && <span className="text-muted-foreground">created this ticket</span>}
                              {a.type === "comment" && <span className="text-muted-foreground">left a comment</span>}
                            </div>

                            {/* Timestamp */}
                            <time className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0 mt-0.5">
                              {new Date(a.createdAt).toLocaleString("en-US", {
                                month: "short", day: "numeric",
                                hour: "2-digit", minute: "2-digit"
                              })}
                            </time>
                          </div>

                          {/* Note */}
                          {a.note && (
                            <div className="mt-1.5 px-3 py-2 rounded-md bg-muted/20 border border-border/30 text-muted-foreground/80 text-[11px] leading-relaxed">
                              {a.note}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
              </div>
            )}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}
