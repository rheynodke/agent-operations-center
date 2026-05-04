import { Search, X, ChevronDown, Users as UsersIcon, Flag, GitBranch, Layers } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Agent, Epic, TaskPriority, TaskStage } from "@/types"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { PriorityIndicator } from "@/components/board/PriorityIndicator"
import { ALL_STAGES, STAGE_LABEL, STAGE_TONE } from "@/lib/projectLabels"

const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"]

interface TaskFilterBarProps {
  agents: Agent[]
  epics?: Epic[]
  filterAgentId?: string
  filterPriority?: string
  filterTag?: string
  filterStage?: string
  filterEpicId?: string
  q?: string
  /** When true, render the Stage selector (ADLC projects only). */
  showStageFilter?: boolean
  /** When true, render the Epic selector (ADLC projects with at least one epic). */
  showEpicFilter?: boolean
  onFilterChange: (key: string, value: string | undefined) => void
  onQChange: (q: string) => void
  hasActiveFilters: boolean
  onClear: () => void
}

export function TaskFilterBar({
  agents, epics = [], filterAgentId, filterPriority, filterStage, filterEpicId, q,
  showStageFilter, showEpicFilter, onFilterChange, onQChange, hasActiveFilters, onClear,
}: TaskFilterBarProps) {
  const selectedAgent = filterAgentId ? agents.find((a) => a.id === filterAgentId) : null
  const selectedPriority = filterPriority as TaskPriority | undefined
  const selectedStage = filterStage as TaskStage | undefined

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative shrink-0 flex-1 sm:flex-none">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={q || ""}
          onChange={(e) => onQChange(e.target.value)}
          placeholder="Search tasks..."
          className="pl-8 h-8 w-full sm:w-56 text-sm"
        />
      </div>

      {/* Agent selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs transition-colors shrink-0",
              selectedAgent
                ? "bg-primary/10 border-primary/30 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            {selectedAgent ? (
              <AgentAvatar
                avatarPresetId={selectedAgent.avatarPresetId}
                emoji={selectedAgent.emoji}
                size="w-4 h-4"
                className="rounded-full"
              />
            ) : (
              <UsersIcon className="h-3.5 w-3.5" />
            )}
            <span className="max-w-[110px] truncate">
              {selectedAgent ? (selectedAgent.name || selectedAgent.id) : "All agents"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52 max-h-[60vh] overflow-y-auto">
          <DropdownMenuItem
            onClick={() => onFilterChange("agentId", undefined)}
            className={cn("gap-2 text-xs", !filterAgentId && "bg-accent")}
          >
            <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">All agents</span>
            {!filterAgentId && <span className="text-primary">✓</span>}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {agents.map((agent) => {
            const isActive = filterAgentId === agent.id
            return (
              <DropdownMenuItem
                key={agent.id}
                onClick={() => onFilterChange("agentId", isActive ? undefined : agent.id)}
                className={cn("gap-2 text-xs", isActive && "bg-accent")}
              >
                <AgentAvatar
                  avatarPresetId={agent.avatarPresetId}
                  emoji={agent.emoji}
                  size="w-4 h-4"
                  className="rounded-full"
                />
                <span className="flex-1 truncate">{agent.name || agent.id}</span>
                {isActive && <span className="text-primary">✓</span>}
              </DropdownMenuItem>
            )
          })}
          {agents.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No agents</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Priority selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs transition-colors shrink-0",
              selectedPriority
                ? "bg-primary/10 border-primary/30 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            {selectedPriority ? (
              <PriorityIndicator priority={selectedPriority} />
            ) : (
              <Flag className="h-3.5 w-3.5" />
            )}
            <span className="capitalize">
              {selectedPriority ? selectedPriority : "All priorities"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem
            onClick={() => onFilterChange("priority", undefined)}
            className={cn("gap-2 text-xs", !filterPriority && "bg-accent")}
          >
            <Flag className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">All priorities</span>
            {!filterPriority && <span className="text-primary">✓</span>}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {PRIORITIES.map((p) => {
            const isActive = filterPriority === p
            return (
              <DropdownMenuItem
                key={p}
                onClick={() => onFilterChange("priority", isActive ? undefined : p)}
                className={cn("gap-2 text-xs capitalize", isActive && "bg-accent")}
              >
                <PriorityIndicator priority={p} />
                <span className="flex-1">{p}</span>
                {isActive && <span className="text-primary">✓</span>}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Stage selector — ADLC projects only */}
      {showStageFilter && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs transition-colors shrink-0",
                selectedStage
                  ? "bg-primary/10 border-primary/30 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>{selectedStage ? STAGE_LABEL[selectedStage] : "All stages"}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem
              onClick={() => onFilterChange("stage", undefined)}
              className={cn("gap-2 text-xs", !filterStage && "bg-accent")}
            >
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">All stages</span>
              {!filterStage && <span className="text-primary">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {ALL_STAGES.map((s) => {
              const isActive = filterStage === s
              return (
                <DropdownMenuItem
                  key={s}
                  onClick={() => onFilterChange("stage", isActive ? undefined : s)}
                  className={cn("gap-2 text-xs", isActive && "bg-accent")}
                >
                  <span className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium",
                    STAGE_TONE[s]
                  )}>
                    {STAGE_LABEL[s]}
                  </span>
                  <span className="flex-1" />
                  {isActive && <span className="text-primary">✓</span>}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Epic selector — ADLC projects with at least one epic */}
      {showEpicFilter && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs transition-colors shrink-0",
                filterEpicId
                  ? "bg-primary/10 border-primary/30 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="max-w-[140px] truncate">
                {filterEpicId
                  ? (epics.find(e => e.id === filterEpicId)?.title || "Epic")
                  : "All epics"}
              </span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-[60vh] overflow-y-auto">
            <DropdownMenuItem
              onClick={() => onFilterChange("epicId", undefined)}
              className={cn("gap-2 text-xs", !filterEpicId && "bg-accent")}
            >
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">All epics</span>
              {!filterEpicId && <span className="text-primary">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onFilterChange("epicId", filterEpicId === '__none__' ? undefined : '__none__')}
              className={cn("gap-2 text-xs italic text-muted-foreground", filterEpicId === '__none__' && "bg-accent")}
            >
              <span className="flex-1">No epic</span>
              {filterEpicId === '__none__' && <span className="text-primary">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {epics.map((e) => {
              const isActive = filterEpicId === e.id
              return (
                <DropdownMenuItem
                  key={e.id}
                  onClick={() => onFilterChange("epicId", isActive ? undefined : e.id)}
                  className={cn("gap-2 text-xs", isActive && "bg-accent")}
                >
                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{e.title}</span>
                  {isActive && <span className="text-primary">✓</span>}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Clear */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-8 text-xs shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3 mr-1" /> Clear
        </Button>
      )}
    </div>
  )
}
