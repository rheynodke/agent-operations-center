// Role-aware draggable node palette.
//
// Palette is split into two sections:
//  1. ADLC Roles — one card per role, auto-populated from agents that have that
//     role set in their profile. Dragging a role card creates a pre-configured
//     agent node with the role's input/output contract + prompt scaffold.
//  2. Primitives — trigger / condition / approval / output (unchanged).
//
// The goal is to eliminate the "drag generic Agent → pick agent → write prompt
// → manually create handles" ritual for the common ADLC path.

import { Zap, GitBranch, Hand, FileOutput, Bot } from "lucide-react"
import type { PipelineNodeType, Agent } from "@/types"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import { ROLE_CONTRACTS } from "@/lib/pipelines/role-contracts"

interface NodePaletteProps {
  agents: Agent[]
}

interface PrimitiveItem {
  type: PipelineNodeType
  label: string
  description: string
  icon: React.ElementType
  accent: string
}

const PRIMITIVES: PrimitiveItem[] = [
  {
    type: "trigger",
    label: "Trigger",
    description: "Start point: manual, webhook, cron",
    icon: Zap,
    accent: "border-l-amber-500",
  },
  {
    type: "condition",
    label: "Condition",
    description: "Branch based on expression",
    icon: GitBranch,
    accent: "border-l-cyan-500",
  },
  {
    type: "human_approval",
    label: "Approval Gate",
    description: "Pause for human review",
    icon: Hand,
    accent: "border-l-orange-500",
  },
  {
    type: "output",
    label: "Output",
    description: "Bundle + notify",
    icon: FileOutput,
    accent: "border-l-emerald-500",
  },
]

interface RoleInventoryEntry {
  roleId: AdlcRoleId
  count: number
}

function rolesAvailable(agents: Agent[]): RoleInventoryEntry[] {
  const counts = new Map<AdlcRoleId, number>()
  for (const a of agents) {
    const role = (a as Agent & { role?: string }).role as AdlcRoleId | undefined
    if (!role) continue
    if (!(role in ROLE_CONTRACTS)) continue
    counts.set(role, (counts.get(role) || 0) + 1)
  }
  // Sort by ADLC agent number for stable order.
  return Array.from(counts.entries())
    .map(([roleId, count]) => ({ roleId, count }))
    .sort((a, b) => {
      const order: AdlcRoleId[] = [
        "biz-analyst", "pm-analyst", "ux-designer", "em-architect",
        "swe", "qa-engineer", "doc-writer", "data-analyst",
      ]
      return order.indexOf(a.roleId) - order.indexOf(b.roleId)
    })
}

export function NodePalette({ agents }: NodePaletteProps) {
  const roles = rolesAvailable(agents)

  const onDragStartPrimitive = (e: React.DragEvent, nodeType: PipelineNodeType) => {
    e.dataTransfer.setData("application/reactflow-node-type", nodeType)
    e.dataTransfer.effectAllowed = "move"
  }

  const onDragStartRole = (e: React.DragEvent, roleId: AdlcRoleId) => {
    // Encode the role id so the canvas drop handler can build an agent node
    // pre-populated from the role contract.
    e.dataTransfer.setData("application/reactflow-node-type", "agent")
    e.dataTransfer.setData("application/reactflow-adlc-role", roleId)
    e.dataTransfer.effectAllowed = "move"
  }

  return (
    <div className="flex flex-col h-full border-r border-border bg-card/60 w-56 shrink-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* ADLC Roles section — shown only when roles are available, to reduce noise */}
        {roles.length > 0 && (
          <div className="px-3 py-2 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            ADLC Roles
          </div>
        )}
        <div className="p-2 space-y-1.5">{"" /* ADLC role cards appear below when available */}
          {roles.map(({ roleId, count }) => {
            const c = ROLE_CONTRACTS[roleId]
            return (
              <div
                key={roleId}
                draggable
                onDragStart={(e) => onDragStartRole(e, roleId)}
                className="group border border-border rounded-md bg-card border-l-4 border-l-purple-500 p-2 cursor-grab active:cursor-grabbing hover:border-primary/60 transition-colors"
                title={`Drag to canvas — creates an ${c.label} step with default inputs/outputs + prompt scaffold`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base shrink-0">{c.emoji}</span>
                    <div className="text-sm font-medium truncate">{c.label}</div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{count} agent{count > 1 ? "s" : ""}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                  {c.description}
                </div>
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {c.inputs.map((i) => (
                    <span key={`in-${i.key}`} className="text-[9px] px-1 rounded bg-muted/50 font-mono text-muted-foreground">
                      ← {i.key}
                    </span>
                  ))}
                  {c.outputs.map((o) => (
                    <span key={`out-${o.key}`} className="text-[9px] px-1 rounded bg-muted/50 font-mono text-muted-foreground">
                      {o.key} →
                    </span>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Generic agent fallback */}
          <div
            draggable
            onDragStart={(e) => onDragStartPrimitive(e, "agent")}
            className="group border border-dashed border-border rounded-md bg-card/50 border-l-4 border-l-purple-500/40 p-2 cursor-grab active:cursor-grabbing hover:border-primary/60 transition-colors"
            title="Blank agent — you'll need to pick agent + write prompt"
          >
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="text-sm font-medium">Generic Agent</div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Blank agent node — configure manually
            </div>
          </div>
        </div>

        {/* Primitives section */}
        <div className="px-3 py-2 border-t border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Primitives
        </div>
        <div className="p-2 space-y-1.5">
          {PRIMITIVES.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.type}
                draggable
                onDragStart={(e) => onDragStartPrimitive(e, item.type)}
                className={`group border border-border rounded-md bg-card border-l-4 ${item.accent} p-2 cursor-grab active:cursor-grabbing hover:border-primary/60 transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="text-sm font-medium">{item.label}</div>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                  {item.description}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground shrink-0">
        Drag to canvas. Connect by dragging between handle dots.
      </div>
    </div>
  )
}
