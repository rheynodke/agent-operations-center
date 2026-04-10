import React from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Agent, TaskPriority } from "@/types"

const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"]

interface TaskFilterBarProps {
  agents: Agent[]
  filterAgentId?: string
  filterPriority?: string
  filterTag?: string
  q?: string
  onFilterChange: (key: string, value: string | undefined) => void
  onQChange: (q: string) => void
  hasActiveFilters: boolean
  onClear: () => void
}

export function TaskFilterBar({
  agents, filterAgentId, filterPriority, filterTag, q,
  onFilterChange, onQChange, hasActiveFilters, onClear,
}: TaskFilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={q || ""}
          onChange={(e) => onQChange(e.target.value)}
          placeholder="Search..."
          className="pl-8 h-8 w-44 text-sm"
        />
      </div>

      {/* Agent filter */}
      <div className="flex items-center gap-1 flex-wrap">
        {agents.slice(0, 6).map((agent) => (
          <button
            key={agent.id}
            onClick={() => onFilterChange("agentId", filterAgentId === agent.id ? undefined : agent.id)}
            className={cn(
              "text-xs px-2 py-1 rounded-full border transition-colors",
              filterAgentId === agent.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            {agent.emoji || "🤖"} {agent.name || agent.id}
          </button>
        ))}
      </div>

      {/* Priority filter */}
      <div className="flex items-center gap-1">
        {PRIORITIES.map((p) => (
          <button
            key={p}
            onClick={() => onFilterChange("priority", filterPriority === p ? undefined : p)}
            className={cn(
              "text-xs px-2 py-1 rounded-full border transition-colors capitalize",
              filterPriority === p
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Clear */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
          <X className="h-3 w-3 mr-1" /> Clear
        </Button>
      )}
    </div>
  )
}
