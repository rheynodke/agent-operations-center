import { useRoutingStore, useAgentStore } from "@/stores"
import { Radio, AlertTriangle, Link, Unlink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

function fmtRelative(ts?: string): string {
  if (!ts) return "—"
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  return `${Math.round(diff / 3600000)}h ago`
}

export function RoutingPage() {
  const routes = useRoutingStore((s) => s.routes)
  const agents = useAgentStore((s) => s.agents)

  // Agents without routes
  const routedAgentIds = new Set(routes.map((r) => r.agentId))
  const unroutedAgents = agents.filter((a) => !routedAgentIds.has(a.id))

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Summary */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Radio className="h-4 w-4 text-primary" />
          <span><span className="font-semibold text-foreground">{routes.length}</span> active routes</span>
        </div>
        {unroutedAgents.length > 0 && (
          <div className="flex items-center gap-1.5 text-[var(--status-paused-text)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-xs">{unroutedAgents.length} agents without channel</span>
          </div>
        )}
      </div>

      {/* Routes table */}
      <div className="bg-card rounded-xl ghost-border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-4 px-5 py-3 border-b border-border text-xs text-muted-foreground font-medium uppercase tracking-wide">
          <span className="w-6" />
          <span>Agent</span>
          <span>Channel</span>
          <span>Mode</span>
          <span>Status</span>
        </div>

        <ScrollArea className="max-h-[60vh]">
          {routes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Radio className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No channel routes configured</p>
            </div>
          ) : (
            <div>
              {routes.map((route) => (
                <div
                  key={route.id}
                  className="grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-4 px-5 py-3.5 border-b border-border/40 last:border-0 hover:bg-surface-high transition-colors"
                >
                  {/* Agent emoji */}
                  <span className="text-lg">{route.agentEmoji}</span>

                  {/* Agent name */}
                  <div>
                    <p className="text-sm font-medium text-foreground">{route.agentName}</p>
                    <p className="text-xs text-muted-foreground">{route.agentId}</p>
                  </div>

                  {/* Channel */}
                  <div>
                    <p className="text-sm text-foreground font-mono">
                      {route.channelUsername ? `@${route.channelUsername}` : route.channelId}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">{route.channelType}</p>
                  </div>

                  {/* Mode chip */}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                      route.mode === "direct" ? "bg-primary/10 text-primary" : "bg-accent/20 text-accent-foreground"
                    )}
                  >
                    {route.mode === "direct" ? <Link className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
                    {route.mode}
                  </span>

                  {/* Status */}
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        route.status === "live" && "status-active",
                        route.status === "idle" && "status-idle",
                        route.status === "error" && "status-error",
                        route.status === "none" && "status-paused",
                      )}
                    >
                      {route.status === "live" && <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-active-text)] pulse-dot" />}
                      {route.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Unrouted agents warning */}
      {unroutedAgents.length > 0 && (
        <div className="rounded-xl border border-[var(--status-paused-text)]/30 bg-[var(--status-paused-bg)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-[var(--status-paused-text)]" />
            <p className="text-sm font-medium text-[var(--status-paused-text)]">
              {unroutedAgents.length} agent{unroutedAgents.length > 1 ? "s" : ""} without channel route
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {unroutedAgents.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary text-sm">
                <span>{a.emoji}</span>
                <span className="text-foreground">{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
