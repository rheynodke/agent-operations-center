import { useEffect, useRef, useState } from "react"
import { X, Zap, Trash2, Radio, ScrollText } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { useLiveFeedStore, useGatewayLogStore } from "@/stores"
import type { GatewayEventEntry, GatewayLogEntry } from "@/stores"
import { cn } from "@/lib/utils"
import type { LiveFeedEntry } from "@/types"

// ─── Agent Live Feed ──────────────────────────────────────────────────────────

export const typeColors = {
  message: "text-primary/80",
  tool_call: "text-[var(--status-paused-text)]",
  tool_result: "text-[var(--status-active-text)]",
  system: "text-muted-foreground",
  error: "text-[var(--status-error-text)]",
}
export const typeLabels = {
  message: "MSG",
  tool_call: "TOOL",
  tool_result: "RSLT",
  system: "SYS",
  error: "ERR",
}

export function AgentFeedEntry({ entry }: { entry: LiveFeedEntry }) {
  return (
    <div className="flex gap-2 py-1 px-3 hover:bg-foreground/3 transition-colors text-xs font-mono">
      <span className="shrink-0 text-muted-foreground/50 tabular-nums w-16">
        {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className="shrink-0 text-sm leading-none mt-px">{entry.agentEmoji}</span>
      <span className={cn("shrink-0 font-bold w-8", typeColors[entry.type])}>
        {typeLabels[entry.type]}
      </span>
      <span className="text-foreground/60 flex-1 truncate">{entry.content}</span>
      {entry.cost !== undefined && entry.cost > 0 && (
        <span className="shrink-0 text-muted-foreground/40">${entry.cost.toFixed(4)}</span>
      )}
    </div>
  )
}

// ─── Gateway Event Log ────────────────────────────────────────────────────────

export const EVENT_COLORS: Record<string, string> = {
  health: "text-emerald-500",
  tick: "text-muted-foreground/30",
  "session.message": "text-primary/80",
  "session.tool": "text-amber-500",
  "session.done": "text-emerald-400",
  "sessions.changed": "text-sky-400",
  agent: "text-violet-400",
  chat: "text-sky-400",
}

export function eventColor(evt: string) {
  return EVENT_COLORS[evt] ?? "text-foreground/60"
}

export function GatewayEventRow({ entry }: { entry: GatewayEventEntry }) {
  const [expanded, setExpanded] = useState(false)
  const dataStr = JSON.stringify(entry.data)
  const preview = dataStr.length > 120 ? dataStr.slice(0, 120) + "…" : dataStr

  return (
    <div
      className="py-1 px-3 hover:bg-foreground/3 transition-colors text-xs font-mono cursor-pointer"
      onClick={() => setExpanded(v => !v)}
    >
      <div className="flex gap-2 items-baseline">
        <span className="shrink-0 text-muted-foreground/40 tabular-nums w-16">
          {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
        <span className={cn("shrink-0 font-bold min-w-24", eventColor(entry.event))}>
          {entry.event}
        </span>
        {!expanded && (
          <span className="text-muted-foreground/40 truncate flex-1">{preview}</span>
        )}
      </div>
      {expanded && (
        <div className="ml-16 mt-1 mb-1 text-muted-foreground/60 whitespace-pre-wrap break-all leading-relaxed">
          {JSON.stringify(entry.data, null, 2)}
        </div>
      )}
    </div>
  )
}

// ─── Gateway Raw Log ─────────────────────────────────────────────────────────

export function GatewayLogRow({ entry }: { entry: GatewayLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const preview = entry.line.length > 140 ? entry.line.slice(0, 140) + "…" : entry.line

  // Try to parse for pretty display
  let parsed: Record<string, unknown> | null = null
  try { parsed = JSON.parse(entry.line) } catch { /* raw string */ }

  const isOut = entry.direction === "out"

  return (
    <div
      className="py-1 px-3 hover:bg-foreground/3 transition-colors text-xs font-mono cursor-pointer"
      onClick={() => setExpanded(v => !v)}
    >
      <div className="flex gap-2 items-baseline">
        <span className="shrink-0 text-muted-foreground/40 tabular-nums w-16">
          {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
        <span className={cn("shrink-0 font-bold w-3", isOut ? "text-sky-500" : "text-foreground/40")}>
          {isOut ? "›" : "‹"}
        </span>
        {!expanded && (
          <span className="text-muted-foreground/50 truncate flex-1">{preview}</span>
        )}
      </div>
      {expanded && (
        <div className="ml-19 mt-1 mb-1 text-muted-foreground/60 whitespace-pre-wrap break-all leading-relaxed">
          {parsed ? JSON.stringify(parsed, null, 2) : entry.line}
        </div>
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

type Tab = "events" | "logs" | "feed"

export function LiveFeedPanel() {
  const { entries, isOpen, setOpen, clearFeed } = useLiveFeedStore()
  const { events, logs, clearEvents, clearLogs } = useGatewayLogStore()
  const [tab, setTab] = useState<Tab>("events")
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [
    isOpen,
    tab === "events" ? events.length : tab === "logs" ? logs.length : entries.length,
  ])

  if (!isOpen) return null

  const tabItems: { key: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    { key: "events", label: "Event Log",    count: events.length,  icon: <Radio className="w-3 h-3" /> },
    { key: "logs",   label: "Gateway Logs", count: logs.length,    icon: <ScrollText className="w-3 h-3" /> },
    { key: "feed",   label: "Live Feed",    count: entries.length, icon: <Zap className="w-3 h-3" /> },
  ]

  function handleClear() {
    if (tab === "events") clearEvents()
    else if (tab === "logs") clearLogs()
    else clearFeed()
  }

  return (
    <div className="hidden md:flex shrink-0 h-64 border-t border-border bg-background flex-col animate-slide-in">
      {/* Header */}
      <div className="flex items-center border-b border-border shrink-0">
        {/* Tabs */}
        <div className="flex items-center">
          {tabItems.map(({ key, label, count, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold border-b-2 transition-all",
                tab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {icon}
              {label}
              <span className={cn(
                "text-[9px] px-1 py-px rounded-full tabular-nums",
                tab === key ? "bg-primary/15 text-primary" : "bg-foreground/8 text-muted-foreground/60"
              )}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 ml-auto px-2">
          <Button variant="ghost" size="icon-sm" onClick={handleClear} title="Clear">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {tab === "events" && (
          events.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/40 font-mono">
              Waiting for gateway events…
            </div>
          ) : (
            <div className="py-1">
              <div ref={topRef} />
              {events.map(e => <GatewayEventRow key={e.id} entry={e} />)}
            </div>
          )
        )}

        {tab === "logs" && (
          logs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/40 font-mono">
              Waiting for gateway traffic…
            </div>
          ) : (
            <div className="py-1">
              <div ref={topRef} />
              {logs.map(e => <GatewayLogRow key={e.id} entry={e} />)}
            </div>
          )
        )}

        {tab === "feed" && (
          entries.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/40 font-mono">
              Waiting for agent activity…
            </div>
          ) : (
            <div className="py-1">
              <div ref={topRef} />
              {[...entries].map(e => <AgentFeedEntry key={e.id} entry={e} />)}
            </div>
          )
        )}
      </ScrollArea>
    </div>
  )
}
