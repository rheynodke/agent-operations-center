import React, { useEffect } from "react"
import { cn } from "@/lib/utils"
import {
  X, ArrowRight,
  Inbox, ListTodo, Zap, ScanSearch, OctagonX, CircleCheckBig,
} from "lucide-react"
import { useTaskStore, TaskStatusChange } from "@/stores"
import { useAgentStore } from "@/stores"
import { AgentAvatar } from "@/components/agents/AgentAvatar"

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_META: Record<string, {
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
}> = {
  backlog:     { label: "Backlog",     icon: Inbox,          color: "text-muted-foreground", bg: "bg-muted/40" },
  todo:        { label: "Todo",        icon: ListTodo,       color: "text-blue-400",         bg: "bg-blue-500/10" },
  in_progress: { label: "In Progress", icon: Zap,            color: "text-amber-400",        bg: "bg-amber-500/10" },
  in_review:   { label: "In Review",   icon: ScanSearch,     color: "text-purple-400",       bg: "bg-purple-500/10" },
  blocked:     { label: "Blocked",     icon: OctagonX,       color: "text-red-400",          bg: "bg-red-500/10" },
  done:        { label: "Done",        icon: CircleCheckBig, color: "text-emerald-400",      bg: "bg-emerald-500/10" },
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, icon: Inbox, color: "text-muted-foreground", bg: "bg-muted/30" }
  const Icon = m.icon
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold", m.color, m.bg)}>
      <Icon className="h-3 w-3" />
      <span>{m.label}</span>
    </span>
  )
}

// ── Single ticker item ────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 5000

function TickerItem({ change, onDismiss }: { change: TaskStatusChange; onDismiss: () => void }) {
  const agents = useAgentStore(s => s.agents)
  const agent = change.agentId ? agents.find(a => a.id === change.agentId) : null

  // Auto-dismiss after timeout
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-xl",
        "bg-card/95 backdrop-blur border border-border/60 shadow-lg",
        "animate-in slide-in-from-bottom-2 fade-in duration-300",
        "max-w-xs w-full"
      )}
    >
      {/* Agent avatar */}
      <div className="shrink-0">
        <AgentAvatar
          avatarPresetId={agent?.avatarPresetId}
          emoji={agent?.emoji}
          size="w-7 h-7"
        />
      </div>

      {/* Task info */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-foreground truncate leading-tight">
          {change.title}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          <StatusBadge status={change.fromStatus} />
          <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
          <StatusBadge status={change.toStatus} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-xl overflow-hidden">
        <div
          className={cn(
            "h-full",
            STATUS_META[change.toStatus]?.color.replace("text-", "bg-") ?? "bg-primary",
            "animate-[shrink_5s_linear_forwards]"
          )}
          style={{ transformOrigin: "left" }}
        />
      </div>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="shrink-0 p-0.5 rounded hover:bg-muted/60 transition-colors"
      >
        <X className="h-3 w-3 text-muted-foreground/60" />
      </button>
    </div>
  )
}

// ── Ticker container ──────────────────────────────────────────────────────────

export function TaskStatusTicker() {
  const recentChanges = useTaskStore(s => s.recentChanges)
  const dismissChange = useTaskStore(s => s.dismissChange)

  if (recentChanges.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {recentChanges.map(change => (
        <div key={change.uid} className="pointer-events-auto relative">
          <TickerItem
            change={change}
            onDismiss={() => dismissChange(change.uid)}
          />
        </div>
      ))}
    </div>
  )
}
