import { useState, useEffect, useRef } from "react"
import { X, Radio, ScrollText, Zap, Trash2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { useThemeStore } from "@/stores/useThemeStore"
import { useLiveFeedStore, useGatewayLogStore } from "@/stores"
import { cn } from "@/lib/utils"
import {
  AgentFeedEntry,
  GatewayEventRow,
  GatewayLogRow,
} from "@/components/layout/LiveFeedPanel"

type Tab = "events" | "logs" | "feed"

export function MobileFeedSheet() {
  const { feedSheetOpen, setFeedSheetOpen } = useThemeStore()
  const { entries, clearFeed } = useLiveFeedStore()
  const { events, logs, clearEvents, clearLogs } = useGatewayLogStore()
  const [tab, setTab] = useState<Tab>("events")
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [
    feedSheetOpen,
    tab === "events" ? events.length : tab === "logs" ? logs.length : entries.length,
  ])

  if (!feedSheetOpen) return null

  const tabItems: { key: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    { key: "events", label: "Events",  count: events.length,  icon: <Radio className="w-3 h-3" /> },
    { key: "logs",   label: "Logs",    count: logs.length,    icon: <ScrollText className="w-3 h-3" /> },
    { key: "feed",   label: "Feed",    count: entries.length, icon: <Zap className="w-3 h-3" /> },
  ]

  function handleClear() {
    if (tab === "events") clearEvents()
    else if (tab === "logs") clearLogs()
    else clearFeed()
  }

  return (
    <div className="md:hidden">
      {/* Scrim */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={() => setFeedSheetOpen(false)}
      />
      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border rounded-t-xl flex flex-col" style={{ maxHeight: "60vh" }}>
        {/* Header with tabs */}
        <div className="flex items-center border-b border-border shrink-0">
          <div className="flex items-center overflow-x-auto">
            {tabItems.map(({ key, label, count, icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-all whitespace-nowrap",
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
          <div className="flex items-center gap-1 ml-auto px-2 shrink-0">
            <Button variant="ghost" size="icon-sm" onClick={handleClear} title="Clear">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setFeedSheetOpen(false)}>
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
    </div>
  )
}
