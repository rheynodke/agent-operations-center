import { useEffect, useRef } from "react"
import { X, Zap, Trash2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { useLiveFeedStore } from "@/stores"
import { cn } from "@/lib/utils"
import type { LiveFeedEntry } from "@/types"

const typeColors = {
  message: "text-primary/80",
  tool_call: "text-[var(--status-paused-text)]",
  tool_result: "text-[var(--status-active-text)]",
  system: "text-muted-foreground",
  error: "text-[var(--status-error-text)]",
}

const typeLabels = {
  message: "MSG",
  tool_call: "TOOL",
  tool_result: "RSLT",
  system: "SYS",
  error: "ERR",
}

function FeedEntry({ entry }: { entry: LiveFeedEntry }) {
  return (
    <div className="flex gap-2 py-1.5 px-3 hover:bg-surface-high/50 transition-colors group text-xs font-mono">
      <span className="shrink-0 text-muted-foreground/60 tabular-nums w-16">
        {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className="shrink-0 text-sm">{entry.agentEmoji}</span>
      <span className={cn("shrink-0 font-bold w-8", typeColors[entry.type])}>
        {typeLabels[entry.type]}
      </span>
      <span className="text-on-surface-variant flex-1 truncate">{entry.content}</span>
      {entry.cost !== undefined && entry.cost > 0 && (
        <span className="shrink-0 text-muted-foreground/50">${entry.cost.toFixed(4)}</span>
      )}
    </div>
  )
}

export function LiveFeedPanel() {
  const { entries, isOpen, setOpen, clearFeed } = useLiveFeedStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [entries, isOpen])

  if (!isOpen) return null

  return (
    <div className="shrink-0 h-56 border-t border-border bg-surface-low flex flex-col animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold font-display text-foreground">Live Feed</span>
          <span className="text-[10px] text-muted-foreground">{entries.length} events</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={clearFeed} title="Clear feed">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Entries */}
      <ScrollArea className="flex-1">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Waiting for agent activity…
          </div>
        ) : (
          <div className="py-1">
            {[...entries].reverse().map((entry) => (
              <FeedEntry key={entry.id} entry={entry} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
