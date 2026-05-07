import React, { useEffect, useRef, useState } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Task, TaskActivity, TaskAnalysis, Agent } from "@/types"
import { api } from "@/lib/api"
import { useAuthStore, useTaskStore } from "@/stores"
import {
  Zap, X, Calendar, User, Clock,
  CheckCircle2, ArrowRight, ChevronDown,
  FileText, Bot, History, BarChart3,
  Search, AlertTriangle, Database, ListChecks, RefreshCw, Loader2, ShieldCheck, ShieldAlert, OctagonX, Briefcase, Map, Layers,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { confirmDialog } from "@/lib/dialogs"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { PriorityIndicator } from "./PriorityIndicator"
import { STAGE_LABEL, STAGE_TONE, ROLE_FULL_LABEL } from "@/lib/projectLabels"
import { InReviewBanner } from "./InReviewBanner"
import { AgentWorkSection } from "./AgentWorkSection"
import { ExecutionStats } from "./ExecutionStats"
import { AttachmentsSection } from "./AttachmentsSection"
import { OutputsSection } from "./OutputsSection"
import { CommentsThread } from "./CommentsThread"

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

// ── Pre-flight Analysis ──────────────────────────────────────────────────────

function AnalysisSection({ task, onUpdate }: { task: Task; onUpdate: (id: string, patch: object) => Promise<void> }) {
  const [analyzing, setAnalyzing] = useState(false)
  const analysis = task.analysis

  async function handleAnalyze() {
    setAnalyzing(true)
    try {
      const res = await api.analyzeTask(task.id)
      if (res.analysis) onUpdate(task.id, { analysis: res.analysis })
    } catch (e) {
      console.error('Analysis failed:', e)
    } finally {
      setAnalyzing(false)
    }
  }

  if (!analysis) {
    return (
      <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary/60" />
            <span className="text-sm font-medium text-foreground/80">Pre-flight Analysis</span>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !task.agentId}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {analyzing ? <><Loader2 className="h-3 w-3 animate-spin" /> Analyzing…</> : <><Search className="h-3 w-3" /> Analyze</>}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Agent akan menganalisa task ini sebelum eksekusi — identifikasi intent, data sources, dan readiness.
        </p>
      </div>
    )
  }

  const ready = analysis.readiness?.ready
  const hasMissing = (analysis.readiness?.missingSkills?.length || 0) + (analysis.readiness?.missingTools?.length || 0) > 0

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10">
        <Search className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-xs font-semibold text-foreground/80 tracking-wide">Pre-flight Analysis</span>
        <span className={cn(
          "ml-auto flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full",
          ready ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
        )}>
          {ready ? <><ShieldCheck className="h-3 w-3" /> Ready</> : <><ShieldAlert className="h-3 w-3" /> Not Ready</>}
        </span>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="text-muted-foreground/40 hover:text-foreground/60 transition-colors"
          title="Re-analyze"
        >
          <RefreshCw className={cn("h-3 w-3", analyzing && "animate-spin")} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Intent */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1">Business Intent</p>
          <p className="text-sm text-foreground/90 leading-relaxed">{analysis.intent}</p>
        </div>

        {/* Data Sources */}
        {analysis.dataSources?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Database className="h-3 w-3" /> Data Sources
            </p>
            <div className="flex flex-wrap gap-1.5">
              {analysis.dataSources.map((ds, i) => (
                <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400/90 border border-blue-500/15">
                  {ds}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Execution Plan */}
        {analysis.executionPlan?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <ListChecks className="h-3 w-3" /> Execution Plan
            </p>
            <ol className="space-y-1 pl-1">
              {analysis.executionPlan.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground/80 leading-relaxed">
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-muted/40 text-[9px] font-bold text-muted-foreground shrink-0 mt-0.5">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Estimated Output */}
        {analysis.estimatedOutput && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1">Expected Output</p>
            <p className="text-xs text-foreground/70 leading-relaxed">{analysis.estimatedOutput}</p>
          </div>
        )}

        {/* Potential Issues */}
        {analysis.potentialIssues?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-400/70 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Potential Issues
            </p>
            <ul className="space-y-1">
              {analysis.potentialIssues.map((issue, i) => (
                <li key={i} className="text-xs text-amber-300/70 flex items-start gap-1.5">
                  <span className="text-amber-500/50 shrink-0 mt-0.5">!</span>
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Readiness */}
        {analysis.readiness && (
          <div className={cn(
            "rounded-lg border p-3 space-y-2",
            ready ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"
          )}>
            {analysis.readiness.availableSkills?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] text-emerald-400/70 font-semibold uppercase w-full">Available Skills</span>
                {analysis.readiness.availableSkills.map((s, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/15 font-mono">{s}</span>
                ))}
              </div>
            )}
            {hasMissing && (
              <>
                {analysis.readiness.missingSkills?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-red-400/70 font-semibold uppercase w-full">Missing Skills</span>
                    {analysis.readiness.missingSkills.map((s, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-400/80 border border-red-500/15 font-mono">{s}</span>
                    ))}
                  </div>
                )}
                {analysis.readiness.missingTools?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-red-400/70 font-semibold uppercase w-full">Missing Tools</span>
                    {analysis.readiness.missingTools.map((s, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-400/80 border border-red-500/15 font-mono">{s}</span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface TaskPanelProps {
  task: Task | null
  agents: Agent[]
  open: boolean
  isActive?: boolean
  onClose: () => void
  onUpdate: (id: string, patch: object) => Promise<void>
  /** Called when attachments change — allows parent to sync its locally-held task copy. */
  onTaskReplace?: (task: Task) => void
  projectKind?: string
  /** Open another task in the panel (used by dependency rows). */
  onNavigateTask?: (taskId: string) => void
}

export function TaskPanel({ task, agents, open, isActive = true, onClose, onUpdate, onTaskReplace, projectKind, onNavigateTask }: TaskPanelProps) {
  const currentUser = useAuthStore(s => s.user)
  const allTasks = useTaskStore(s => s.tasks)
  const [activity, setActivity] = useState<TaskActivity[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [interrupting, setInterrupting] = useState(false)
  const [dispatchMsg, setDispatchMsg] = useState("")

  // ── Dependencies state lifted up ──
  // We need the unmet-blockers count to disable Dispatch + render a banner,
  // so the deps fetch lives here and is passed down to DependenciesSection.
  const [deps, setDeps] = useState<import("@/types").TaskDependency[]>([])
  const [depsLoading, setDepsLoading] = useState(false)
  const [depsError, setDepsError] = useState<string | null>(null)
  const loadDeps = React.useCallback(async () => {
    if (!task) return
    setDepsLoading(true); setDepsError(null)
    try {
      const r = await api.listTaskDependencies(task.id)
      setDeps(r.dependencies)
    } catch (e) { setDepsError((e as Error).message) }
    finally { setDepsLoading(false) }
  }, [task?.id])
  useEffect(() => { if (open && task) { loadDeps() } else { setDeps([]) } }, [task?.id, open, loadDeps])

  // Blockers (others blocking me) — separated by status.
  const blockerEdges = deps.filter(d => task && d.blockedTaskId === task.id)
  const unmetBlockers = blockerEdges
    .map(d => allTasks.find(t => t.id === d.blockerTaskId))
    .filter((t): t is Task => !!t && t.status !== 'done' && t.status !== 'cancelled')
  const isBlocked = unmetBlockers.length > 0

  // Epic list for the project (ADLC only) — used by editable Epic row.
  const [projectEpics, setProjectEpics] = useState<import("@/types").Epic[]>([])
  useEffect(() => {
    if (!task || projectKind !== 'adlc' || !task.projectId || task.projectId === 'general') {
      setProjectEpics([]); return
    }
    api.listEpics(task.projectId).then(r => setProjectEpics(r.epics)).catch(() => setProjectEpics([]))
  }, [task?.projectId, projectKind, open])
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const agentWorkRef = useRef<HTMLDivElement>(null)

  // Tab navigation — Conversation default (1 task = 1 session is the spine).
  type PanelTab = 'conversation' | 'files' | 'details'
  const [tab, setTab] = useState<PanelTab>('conversation')

  // Sticky composer — always visible across tabs. Cmd/Ctrl+Enter submits.
  const [composerDraft, setComposerDraft] = useState('')
  const [composerSubmitting, setComposerSubmitting] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  async function handleComposerSubmit() {
    const text = composerDraft.trim()
    if (!text || !task) return
    setComposerSubmitting(true)
    try {
      await api.postTaskComment(task.id, text)
      setComposerDraft('')
      // Auto-jump to Conversation so the user sees their new comment.
      setTab('conversation')
    } catch (e) {
      console.error('post comment failed', e)
    } finally {
      setComposerSubmitting(false)
    }
  }

  // Title inline-edit state.
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  async function handleTitleSave() {
    const next = titleDraft.trim()
    if (!task) { setEditingTitle(false); return }
    if (!next || next === task.title) { setEditingTitle(false); return }
    try { await onUpdate(task.id, { title: next }) }
    finally { setEditingTitle(false) }
  }

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

  // Reset tab + composer when switching tasks.
  useEffect(() => {
    if (!open) return
    setTab('conversation')
    setComposerDraft('')
  }, [task?.id, open])

  // Keyboard shortcuts (PM ergonomics):
  //   c               — focus composer
  //   e               — edit title
  //   Cmd/Ctrl+Enter  — submit composer (handled inside textarea)
  //   Esc             — close (handled by Radix Sheet)
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      // Skip when user is typing in an input/textarea/editable.
      const target = e.target as HTMLElement | null
      const inField = target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        (target as HTMLElement).isContentEditable
      )
      if (inField) return
      if (e.key === 'c') { e.preventDefault(); composerRef.current?.focus() }
      else if (e.key === 'e') {
        e.preventDefault()
        if (task) { setTitleDraft(task.title); setEditingTitle(true) }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, task?.id, task?.title])

  async function handleInterrupt() {
    if (!task) return
    if (!await confirmDialog({
      title: "Stop this agent?",
      description: "The gateway will abort the current generation. The session stays alive — you can re-dispatch later (Continue / Request Changes / Mark Blocked).",
      confirmLabel: "Stop",
      destructive: true,
    })) return
    setInterrupting(true)
    setDispatchMsg("")
    try {
      await api.interruptTask(task.id)
      setDispatchMsg("🛑 Agent interrupted — choose a next step")
      setTimeout(() => setDispatchMsg(""), 6000)
    } catch (e) {
      setDispatchMsg((e as Error).message || "Interrupt failed")
      setTimeout(() => setDispatchMsg(""), 6000)
    } finally {
      setInterrupting(false)
    }
  }

  async function handleDispatch() {
    if (!task) return
    if (isBlocked) {
      setDispatchMsg(`Cannot dispatch — blocked by ${unmetBlockers.length} unfinished task${unmetBlockers.length === 1 ? '' : 's'}`)
      setTimeout(() => setDispatchMsg(""), 6000)
      return
    }
    setDispatching(true)
    setDispatchMsg("")
    try {
      await api.dispatchTask(task.id)
      setDispatchMsg("Dispatched — agent is working")
      setTimeout(() => setDispatchMsg(""), 5000)
    } catch (e: unknown) {
      const err = e as Error & { code?: string; body?: { unmetBlockers?: Array<{ title: string }> } }
      if (err.code === 'TASK_BLOCKED' && err.body?.unmetBlockers?.length) {
        const titles = err.body.unmetBlockers.map(b => b.title).join(', ')
        setDispatchMsg(`Blocked by: ${titles}`)
        // Refresh deps so the banner appears even if state was stale.
        loadDeps()
      } else {
        setDispatchMsg(err.message || "Dispatch failed")
      }
      setTimeout(() => setDispatchMsg(""), 6000)
    } finally {
      setDispatching(false)
    }
  }

  async function handleApprove() {
    if (!task) return
    setReviewSubmitting(true)
    try {
      // Dedicated endpoint — emits "Task approved" lifecycle msg in room.
      const res = await api.approveTask(task.id)
      onTaskReplace?.(res.task)
    } finally { setReviewSubmitting(false) }
  }

  async function handleRequestChanges(note: string, targetStatus: "todo" | "in_progress", files?: File[]) {
    if (!task) return
    setReviewSubmitting(true)
    try {
      // Always upload attachments first (so they're visible to the next dispatch).
      if (files && files.length) {
        const uploadRes = await api.uploadTaskAttachments(task.id, files)
        onTaskReplace?.(uploadRes.task)
      }
      if (targetStatus === "in_progress") {
        // Use the dedicated request-change endpoint: append comment +
        // revert status + auto re-dispatch (continue) + lifecycle msg.
        const res = await api.requestTaskChange(task.id, note)
        onTaskReplace?.(res.task)
      } else {
        // "Reset to queue" (back to todo) is the rarer flow for batch
        // workflows — keep the generic PATCH path. No auto-dispatch.
        await onUpdate(task.id, { status: targetStatus, note })
      }
    } finally { setReviewSubmitting(false) }
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
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[720px] sm:w-[720px] h-full overflow-hidden flex flex-col gap-0 p-0 [&>button]:hidden border-l"
      >

        {/* ── Header ── */}
        <TaskPanelHeader
          task={task}
          agents={agents}
          assignedAgent={assignedAgent}
          statusCfg={statusCfg}
          isLive={isLive}
          dispatching={dispatching}
          interrupting={interrupting}
          dispatchMsg={dispatchMsg}
          projectKind={projectKind}
          isBlocked={isBlocked}
          unmetBlockerCount={unmetBlockers.length}
          projectEpics={projectEpics}
          editingTitle={editingTitle}
          setEditingTitle={setEditingTitle}
          titleDraft={titleDraft}
          setTitleDraft={setTitleDraft}
          onTitleSave={handleTitleSave}
          onUpdate={onUpdate}
          onClose={onClose}
          onDispatch={handleDispatch}
          onInterrupt={handleInterrupt}
        />

        {/* ── Tab strip ── */}
        <div className="shrink-0 border-b border-border/40 px-5">
          <div className="flex items-center gap-1">
            <TabButton active={tab === 'conversation'} onClick={() => setTab('conversation')}
              icon={Bot} label="Conversation" />
            <TabButton active={tab === 'files'} onClick={() => setTab('files')}
              icon={FileText} label="Files" />
            <TabButton active={tab === 'details'} onClick={() => setTab('details')}
              icon={History} label="Details" />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5 space-y-4">

          {tab === 'conversation' && (
            <>
              {/* Blocker banner — top priority. */}
              {isBlocked && (
                <BlockerBanner
                  blockers={unmetBlockers}
                  onNavigateTask={onNavigateTask}
                />
              )}

              {/* In-review approve/reject controls — always at top when relevant. */}
              {task.status === "in_review" && (
                <InReviewBanner
                  onApprove={handleApprove}
                  onRequestChanges={handleRequestChanges}
                  isSubmitting={reviewSubmitting}
                />
              )}

              {/* Pre-flight analysis (backlog + agent assigned, or analysis exists). */}
              {(task.analysis || (task.status === 'backlog' && task.agentId)) && (
                <AnalysisSection task={task} onUpdate={onUpdate} />
              )}

              {/* Agent Work — the spine of this view. 1 task = 1 session. */}
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
                        taskTitle={task.title}
                        agentId={task.agentId || undefined}
                        agentName={assignedAgent?.name || assignedAgent?.id || undefined}
                      />
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* Dependencies (Phase C.2) */}
              <DependenciesSection
                task={task}
                deps={deps}
                loading={depsLoading}
                error={depsError}
                onReload={loadDeps}
                onNavigateTask={onNavigateTask}
              />

              {/* User ↔ agent comments thread. */}
              <CommentsThread task={task} agents={agents} />
            </>
          )}

          {tab === 'files' && (
            <>
              <OutputsSection task={task} highlight={task.status === 'in_review'} />
              <AttachmentsSection
                task={task}
                onUpdated={(updated) => onTaskReplace?.(updated)}
              />
            </>
          )}

          {tab === 'details' && (
            <>
              {task.description && (
                <SectionCard icon={FileText} label="Description">
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {task.description}
                  </p>
                </SectionCard>
              )}

              {/* Execution Stats — collapsible. */}
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

              {/* Activity — collapsible. */}
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
                              {a.type === "created" && <span className="text-muted-foreground">created this task</span>}
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
            </>
          )}

        </div>

        {/* ── Sticky composer (always visible across tabs) ── */}
        <div className="shrink-0 border-t border-border/40 bg-card/80 px-4 py-3">
          <div className="flex items-end gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mb-0.5">
              <User className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <textarea
                ref={composerRef}
                value={composerDraft}
                onChange={(e) => setComposerDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    handleComposerSubmit()
                  }
                }}
                rows={composerDraft ? 3 : 1}
                placeholder="Add a comment… (press c to focus, Cmd+Enter to send)"
                className="w-full resize-none rounded-md bg-input border border-border/50 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60 transition-colors"
                disabled={composerSubmitting}
              />
            </div>
            <Button
              size="sm"
              className="h-8 text-xs gap-1 shrink-0 mb-0.5"
              onClick={handleComposerSubmit}
              disabled={!composerDraft.trim() || composerSubmitting}
              title="Send (Cmd+Enter)"
            >
              {composerSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
              Send
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Header (sub-component) ───────────────────────────────────────────────────
//
// Three rows:
//   1) external_id badge + state-pulse pill + last-update + cost ··· [×]
//   2) Editable title + primary actions (Stop / Continue / Dispatch)
//   3) Two-column metadata grid (status·priority·assignee | created·request·source)
//
// State pulse pill encodes the agent lifecycle so a PM can triage at a glance:
//   🟢 Live · 2m         (status=in_progress, agent generating)
//   🔵 Awaiting review   (status=in_review, deliverables ready)
//   🟡 Awaiting dispatch (status=todo + agentId)
//   ⚪ Idle              (everything else)

interface TaskPanelHeaderProps {
  task: Task
  agents: Agent[]
  assignedAgent: Agent | null | undefined
  statusCfg: { label: string; dot: string; text: string; bg: string; border: string; badge: string }
  isLive: boolean
  dispatching: boolean
  interrupting: boolean
  dispatchMsg: string
  projectKind?: string
  projectEpics?: import("@/types").Epic[]
  isBlocked?: boolean
  unmetBlockerCount?: number
  editingTitle: boolean
  setEditingTitle: (b: boolean) => void
  titleDraft: string
  setTitleDraft: (s: string) => void
  onTitleSave: () => Promise<void>
  onUpdate: (id: string, patch: object) => Promise<void>
  onClose: () => void
  onDispatch: () => Promise<void>
  onInterrupt: () => Promise<void>
}

function TaskPanelHeader({
  task, agents, assignedAgent, statusCfg, isLive,
  dispatching, interrupting, dispatchMsg, projectKind, projectEpics = [],
  isBlocked = false, unmetBlockerCount = 0,
  editingTitle, setEditingTitle, titleDraft, setTitleDraft, onTitleSave,
  onUpdate, onClose, onDispatch, onInterrupt,
}: TaskPanelHeaderProps) {
  // ── State pulse computation ──
  const stateInfo = (() => {
    if (isLive && task.sessionId) return { label: 'Live · running', tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400', pulse: true }
    if (task.status === 'in_review') return { label: 'Awaiting review', tone: 'bg-blue-500/15 text-blue-400 border-blue-500/30', dot: 'bg-blue-400', pulse: false }
    if (task.status === 'todo' && task.agentId) return { label: 'Awaiting dispatch', tone: 'bg-amber-500/15 text-amber-400 border-amber-500/30', dot: 'bg-amber-400', pulse: false }
    if (task.status === 'blocked') return { label: 'Blocked', tone: 'bg-red-500/15 text-red-400 border-red-500/30', dot: 'bg-red-400', pulse: false }
    if (task.status === 'done') return { label: 'Done', tone: 'bg-emerald-500/10 text-emerald-500/80 border-emerald-500/20', dot: 'bg-emerald-500/70', pulse: false }
    return { label: 'Idle', tone: 'bg-muted/30 text-muted-foreground border-border/40', dot: 'bg-muted-foreground/40', pulse: false }
  })()

  const lastUpdate = task.updatedAt
    ? formatRelative(new Date(task.updatedAt))
    : null

  return (
    <div className="shrink-0 border-b border-border/40 bg-card/50">
      {/* Row 1: badges + state pulse + close */}
      <div className="flex items-center gap-2 px-5 pt-3 pb-1">
        <span className={cn(
          "text-[10px] font-mono px-1.5 py-px rounded shrink-0",
          task.externalId
            ? "text-emerald-500/70 bg-emerald-500/10"
            : "text-muted-foreground/40 bg-muted/40"
        )}>
          {task.externalId ?? `#${task.id.slice(0, 6)}`}
        </span>

        <span className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-medium shrink-0",
          stateInfo.tone
        )}>
          <span className={cn(
            "h-1.5 w-1.5 rounded-full",
            stateInfo.dot,
            stateInfo.pulse && "pulse-dot"
          )} />
          {stateInfo.label}
        </span>

        {lastUpdate && (
          <span className="text-[10px] text-muted-foreground/50">
            updated {lastUpdate}
          </span>
        )}

        {task.cost != null && (
          <span className="ml-auto text-[10px] text-muted-foreground/50 font-mono">
            ${task.cost.toFixed(2)}
          </span>
        )}

        <button
          onClick={onClose}
          className={cn(
            task.cost == null && "ml-auto",
            "h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
          )}
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Row 2: title + primary actions */}
      <div className="flex items-start gap-3 px-5 pb-3">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={onTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onTitleSave() }
                if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false) }
              }}
              className="w-full bg-transparent border border-primary/40 rounded-md px-2 py-1 text-lg font-semibold text-foreground focus:outline-none focus:border-primary"
            />
          ) : (
            <h1
              className="text-lg font-semibold text-foreground leading-snug tracking-tight cursor-text hover:bg-muted/30 rounded-md px-2 py-1 -mx-2 transition-colors"
              onClick={() => { setTitleDraft(task.title); setEditingTitle(true) }}
              title="Click to edit title"
            >
              {task.title}
            </h1>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          {isLive && task.sessionId && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1.5 px-3 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={onInterrupt} disabled={interrupting}
              title="Abort the current generation. Session stays alive."
            >
              <OctagonX className="h-3 w-3" />
              {interrupting ? "Stopping…" : "Stop"}
            </Button>
          )}
          {task.agentId && (
            <Button
              size="sm" variant={isLive ? "outline" : "default"}
              className="h-7 text-xs gap-1.5 px-3"
              onClick={onDispatch}
              disabled={dispatching || isBlocked}
              title={isBlocked
                ? `Blocked by ${unmetBlockerCount} unfinished task${unmetBlockerCount === 1 ? '' : 's'}. Resolve blockers to dispatch.`
                : undefined}
            >
              {isBlocked ? <OctagonX className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
              {isBlocked ? "Blocked" : (dispatching ? "Dispatching…" : task.sessionId ? "Continue" : "Dispatch")}
            </Button>
          )}
        </div>
      </div>

      {/* Row 3: 2-col metadata grid (Jira-style key/value rows) */}
      <div className="px-5 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {/* Status — interactive */}
        <MetaRow label="Status">
          <Select value={task.status} onValueChange={v => onUpdate(task.id, { status: v })}>
            <SelectTrigger className={cn(
              "h-6 text-[11px] font-medium rounded-md border px-2 gap-1.5 w-auto min-w-[120px] focus:ring-0 focus:ring-offset-0",
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
        </MetaRow>

        {/* Created */}
        <MetaRow label="Created">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground/70">
            <Calendar className="h-3 w-3 text-muted-foreground/50" />
            {new Date(task.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </MetaRow>

        <MetaRow label="Priority">
          <Select value={task.priority || "medium"} onValueChange={v => onUpdate(task.id, { priority: v })}>
            <SelectTrigger className="h-6 text-[11px] font-medium rounded-md border border-border/40 px-2 gap-1.5 w-auto min-w-[100px] focus:ring-0 focus:ring-offset-0 bg-muted/20">
              <div className="flex items-center">
                <PriorityIndicator priority={task.priority || "medium"} showLabel />
              </div>
            </SelectTrigger>
            <SelectContent>
              {["urgent", "high", "medium", "low"].map(v => (
                <SelectItem key={v} value={v} className="text-xs">
                  <PriorityIndicator priority={v} showLabel />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MetaRow>

        {/* Request from */}
        <MetaRow label="Request">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground/70 truncate" title={task.requestFrom || '—'}>
            <User className="h-3 w-3 text-muted-foreground/50" />
            <span className="truncate">{task.requestFrom || '—'}</span>
          </span>
        </MetaRow>

        {/* Assignee — interactive */}
        <MetaRow label="Assignee">
          <Select
            value={task.agentId || "__none__"}
            onValueChange={v => onUpdate(task.id, { assignTo: v === "__none__" ? null : v })}
          >
            <SelectTrigger className="h-6 text-[11px] w-auto min-w-[120px] px-2 border-border/40 focus:ring-0 focus:ring-offset-0 gap-1.5 bg-muted/20 hover:bg-muted/40 transition-colors rounded-md">
              {assignedAgent ? (
                <>
                  <AgentAvatar
                    avatarPresetId={assignedAgent.avatarPresetId}
                    emoji={assignedAgent.emoji}
                    size="w-3.5 h-3.5"
                    className="rounded-sm shrink-0"
                  />
                  <span className="font-medium text-foreground/90 truncate">
                    {assignedAgent.name || assignedAgent.id}
                  </span>
                </>
              ) : (
                <>
                  <User className="h-3 w-3 text-muted-foreground/50 shrink-0" />
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
        </MetaRow>

        {/* Stage (ADLC pipeline) — only render when set and ADLC */}
        {projectKind === 'adlc' && task.stage && (
          <MetaRow label="Stage">
            <span className={cn(
              "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md border text-[10px] font-medium",
              STAGE_TONE[task.stage]
            )}>
              <Map className="h-3 w-3 shrink-0" />
              {STAGE_LABEL[task.stage]}
            </span>
          </MetaRow>
        )}

        {/* Role (ADLC) — only render when set and ADLC */}
        {projectKind === 'adlc' && task.role && (
          <MetaRow label="Role">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground/70" title={ROLE_FULL_LABEL[task.role]}>
              <Briefcase className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              {ROLE_FULL_LABEL[task.role]}
            </span>
          </MetaRow>
        )}

        {/* Epic (ADLC) — editable. Always show on ADLC so PM can assign/move. */}
        {projectKind === 'adlc' && (
          <MetaRow label="Epic">
            <Select
              value={task.epicId || '__none__'}
              onValueChange={v => onUpdate(task.id, { epicId: v === '__none__' ? null : v })}
            >
              <SelectTrigger className="h-6 text-[11px] rounded-md border border-border/50 px-2 gap-1.5 w-auto min-w-[160px] focus:ring-0 focus:ring-offset-0">
                <span className="inline-flex items-center gap-1.5 truncate">
                  <Layers className="h-3 w-3 text-purple-400/70 shrink-0" />
                  <span className="truncate">
                    {task.epicId
                      ? (projectEpics.find(e => e.id === task.epicId)?.title || '(unknown epic)')
                      : 'No epic'}
                  </span>
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs italic text-muted-foreground">No epic</SelectItem>
                {projectEpics.map(e => (
                  <SelectItem key={e.id} value={e.id} className="text-xs">{e.title}</SelectItem>
                ))}
                {projectEpics.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground italic">No epics yet — create from Plan tab</div>
                )}
              </SelectContent>
            </Select>
          </MetaRow>
        )}

        {/* Source */}
        {task.externalSource && (
          <MetaRow label="Source">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-500/80">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
              </svg>
              {task.externalSource === 'google_sheets' ? 'Google Sheets' : task.externalSource}
              {task.externalId && <span className="font-mono opacity-60">· {task.externalId}</span>}
            </span>
          </MetaRow>
        )}

        {/* Tags */}
        {(task.tags?.length ?? 0) > 0 && (
          <MetaRow label="Tags" wide>
            <div className="flex items-center gap-1 flex-wrap">
              {(task.tags || []).map(tag => (
                <Badge key={tag} variant="outline" className="h-5 text-[10px] px-1.5 rounded font-normal border-border/40 text-muted-foreground/70">
                  #{tag}
                </Badge>
              ))}
            </div>
          </MetaRow>
        )}

        {task.completedAt && (
          <MetaRow label="Completed">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400/80">
              <CheckCircle2 className="h-3 w-3" />
              {new Date(task.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </MetaRow>
        )}
      </div>

      {/* Dispatch feedback toast */}
      {dispatchMsg && (
        <div className="px-5 pb-3 -mt-1">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            {dispatchMsg}
          </p>
        </div>
      )}
    </div>
  )
}

// Tab strip button — sits below the header, switches body content.
function TabButton({
  active, onClick, icon: Icon, label,
}: { active: boolean; onClick: () => void; icon: typeof Bot; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

// Simple key/value row used by the metadata grid.
function MetaRow({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 min-w-0", wide && "sm:col-span-2")}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 w-16 shrink-0">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function formatRelative(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60); if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24); if (d < 30) return `${d}d ago`
  return date.toLocaleDateString()
}

// ── Blocker banner — surfaces unfinished blockers above the fold ──────────
//
// Shown when the current task has one or more "blocked by" edges pointing to
// tasks that aren't done/cancelled. Each row clicks to navigate to that task
// so the user can resolve the chain.

function BlockerBanner({
  blockers,
  onNavigateTask,
}: {
  blockers: Task[]
  onNavigateTask?: (id: string) => void
}) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/8 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-red-500/20 bg-red-500/5">
        <OctagonX className="h-3.5 w-3.5 text-red-400 shrink-0" />
        <span className="text-xs font-semibold text-red-400">
          Blocked by {blockers.length} unfinished task{blockers.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto text-[10px] text-red-400/60">
          Resolve to dispatch
        </span>
      </div>
      <ul className="divide-y divide-red-500/10">
        {blockers.map(b => {
          const cfg = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.backlog
          return (
            <li key={b.id}>
              <button
                onClick={() => onNavigateTask?.(b.id)}
                disabled={!onNavigateTask}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-red-500/5 transition-colors disabled:cursor-default"
              >
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
                <span className="flex-1 min-w-0 truncate text-xs text-foreground/90" title={b.title}>
                  {b.title}
                </span>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded border shrink-0", cfg.bg, cfg.border, cfg.text)}>
                  {cfg.label}
                </span>
                {onNavigateTask && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Dependencies (Phase C.2 + enforcement v2) ───────────────────────────────
//
// Two lists per task: "Blocked by" (tasks that must finish before this can
// start) and "Blocks" (tasks waiting on this one). Status-colored pills,
// click row to navigate, search-friendly picker, cycle prevention via
// transitive descendant filter.

function DependenciesSection({
  task, deps, loading, error, onReload, onNavigateTask,
}: {
  task: Task
  deps: import("@/types").TaskDependency[]
  loading: boolean
  error: string | null
  onReload: () => Promise<void>
  onNavigateTask?: (id: string) => void
}) {
  const tasks = useTaskStore((s) => s.tasks)
  const [adding, setAdding] = useState<'blocker' | 'blocked' | null>(null)
  const [pickerQuery, setPickerQuery] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const blockers = deps.filter(d => d.blockedTaskId === task.id)
  const blocking = deps.filter(d => d.blockerTaskId === task.id)

  // Tasks I already block (transitively) — adding them as a blocker would
  // create a cycle. Server validates too, but filter the picker for UX.
  const myDescendants = React.useMemo(() => {
    const out = new Set<string>()
    const queue = [task.id]
    while (queue.length) {
      const cur = queue.shift()!
      for (const d of deps) {
        if (d.blockerTaskId === cur && !out.has(d.blockedTaskId)) {
          out.add(d.blockedTaskId); queue.push(d.blockedTaskId)
        }
      }
    }
    return out
  }, [deps, task.id])

  const existingBlockerIds = new Set(blockers.map(d => d.blockerTaskId))
  const existingBlockingIds = new Set(blocking.map(d => d.blockedTaskId))

  const candidates = tasks.filter(t => {
    if (t.id === task.id) return false
    if (t.projectId !== task.projectId) return false
    if (adding === 'blocker') {
      if (existingBlockerIds.has(t.id)) return false
      if (myDescendants.has(t.id)) return false
    } else if (adding === 'blocked') {
      if (existingBlockingIds.has(t.id)) return false
    }
    if (pickerQuery.trim()) {
      const q = pickerQuery.trim().toLowerCase()
      return t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
    }
    return true
  }).slice(0, 50)

  async function handleAdd(otherId: string) {
    if (!otherId) return
    setLocalError(null)
    try {
      const body = adding === 'blocker' ? { blockerTaskId: otherId } : { blockedTaskId: otherId }
      await api.addTaskDependency(task.id, body)
      setAdding(null); setPickerQuery("")
      await onReload()
    } catch (e) {
      const err = e as Error & { code?: string }
      setLocalError(err.code === 'DEP_CYCLE' ? 'Cannot add — that would create a cycle.' : err.message)
    }
  }

  async function handleRemove(depId: string) {
    setLocalError(null)
    try { await api.removeTaskDependency(task.id, depId); await onReload() }
    catch (e) { setLocalError((e as Error).message) }
  }

  function DepRow({ depId, otherId, isBlockerOfMe }: { depId: string; otherId: string; isBlockerOfMe: boolean }) {
    const other = tasks.find(t => t.id === otherId)
    const cfg = other ? (STATUS_CONFIG[other.status] ?? STATUS_CONFIG.backlog) : STATUS_CONFIG.backlog
    const isUnmet = isBlockerOfMe && other && other.status !== 'done' && other.status !== 'cancelled'
    return (
      <li className={cn(
        "group flex items-center gap-2 text-xs rounded-md transition-colors",
        isUnmet ? "bg-red-500/8 hover:bg-red-500/12" : "bg-muted/20 hover:bg-muted/30"
      )}>
        <button
          onClick={() => other && onNavigateTask?.(other.id)}
          disabled={!other || !onNavigateTask}
          className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left disabled:cursor-default"
        >
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
          <span className="flex-1 min-w-0 truncate" title={other?.title || otherId}>
            {other?.title || <span className="italic text-muted-foreground/60">missing task {otherId.slice(0, 6)}</span>}
          </span>
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border shrink-0", cfg.bg, cfg.border, cfg.text)}>
            {cfg.label}
          </span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleRemove(depId) }}
          className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove dependency"
        >
          <X className="h-3 w-3" />
        </button>
      </li>
    )
  }

  return (
    <SectionCard icon={ListChecks} label="Dependencies">
      {(error || localError) && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive mb-2">
          {error || localError}
        </div>
      )}

      {/* Blocked by */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
            Blocked by
          </span>
          {blockers.length > 0 && (
            <span className="text-[10px] text-muted-foreground/50">{blockers.length}</span>
          )}
          <button
            onClick={() => { setAdding(adding === 'blocker' ? null : 'blocker'); setPickerQuery("") }}
            className="ml-auto text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            {adding === 'blocker' ? 'Cancel' : '+ Add'}
          </button>
        </div>
        {adding === 'blocker' && (
          <DepPicker
            query={pickerQuery} setQuery={setPickerQuery}
            candidates={candidates} onPick={handleAdd}
            emptyHint="No matching tasks (cycle-creating tasks are hidden)."
          />
        )}
        {blockers.length === 0 && adding !== 'blocker' && !loading && (
          <p className="text-[11px] text-muted-foreground/60 italic px-2">Nothing blocking this task.</p>
        )}
        {blockers.length > 0 && (
          <ul className="space-y-1">
            {blockers.map(d => <DepRow key={d.id} depId={d.id} otherId={d.blockerTaskId} isBlockerOfMe />)}
          </ul>
        )}
      </div>

      {/* Blocks */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
            Blocks
          </span>
          {blocking.length > 0 && (
            <span className="text-[10px] text-muted-foreground/50">{blocking.length}</span>
          )}
          <button
            onClick={() => { setAdding(adding === 'blocked' ? null : 'blocked'); setPickerQuery("") }}
            className="ml-auto text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            {adding === 'blocked' ? 'Cancel' : '+ Add'}
          </button>
        </div>
        {adding === 'blocked' && (
          <DepPicker
            query={pickerQuery} setQuery={setPickerQuery}
            candidates={candidates} onPick={handleAdd}
            emptyHint="No matching tasks."
          />
        )}
        {blocking.length === 0 && adding !== 'blocked' && !loading && (
          <p className="text-[11px] text-muted-foreground/60 italic px-2">This task isn't blocking anything.</p>
        )}
        {blocking.length > 0 && (
          <ul className="space-y-1">
            {blocking.map(d => <DepRow key={d.id} depId={d.id} otherId={d.blockedTaskId} isBlockerOfMe={false} />)}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}

// Searchable task picker for adding dependencies.
function DepPicker({
  query, setQuery, candidates, onPick, emptyHint,
}: {
  query: string
  setQuery: (s: string) => void
  candidates: Task[]
  onPick: (id: string) => void
  emptyHint: string
}) {
  return (
    <div className="rounded-md border border-border/50 bg-card/50 mb-2 overflow-hidden">
      <div className="relative border-b border-border/40">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks…"
          className="w-full bg-transparent pl-7 pr-2 py-1.5 text-xs focus:outline-none"
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {candidates.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60 italic px-3 py-2">{emptyHint}</p>
        ) : (
          <ul>
            {candidates.map(t => {
              const cfg = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.backlog
              return (
                <li key={t.id}>
                  <button
                    onClick={() => onPick(t.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                    <span className="text-[10px] text-muted-foreground/50 shrink-0">{cfg.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
