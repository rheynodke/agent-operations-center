// Custom React Flow node components for pipeline graph.
// Handle positions are computed from handle-layout.ts (shared with ELK) so
// rendered handles and ELK's port coordinates line up pixel-perfect. Nodes
// are fixed-size (width + height) so layout is deterministic.

import { memo } from "react"
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react"
import {
  Zap,
  Bot,
  GitBranch,
  Hand,
  FileOutput,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { PipelineNodeData, PipelineStepStatus } from "@/types"
import { computeNodeLayout } from "@/lib/pipelines/handle-layout"

function StatusDot({ status }: { status?: PipelineStepStatus }) {
  if (!status || status === "pending") return null
  const map: Record<PipelineStepStatus, { icon: React.ElementType; cls: string }> = {
    pending:   { icon: Clock,          cls: "text-muted-foreground" },
    queued:    { icon: Clock,          cls: "text-muted-foreground" },
    running:   { icon: Loader2,        cls: "text-blue-400 animate-spin" },
    done:      { icon: CheckCircle2,   cls: "text-emerald-400" },
    failed:    { icon: XCircle,        cls: "text-red-400" },
    skipped:   { icon: Clock,          cls: "text-yellow-400" },
    cancelled: { icon: XCircle,        cls: "text-muted-foreground" },
  }
  const { icon: Icon, cls } = map[status]
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", cls)} />
}

type NodeData = PipelineNodeData & { _stepStatus?: PipelineStepStatus }

// Renders prompt preview + handle label chips. Handles themselves are
// rendered directly by NodeFrame (at node-root level) so `top: h.y` is
// absolute from node top — matching ELK port positions exactly.
function NodeBodyLabels({
  nodeType,
  data,
}: {
  nodeType: string
  data: NodeData
}) {
  const layout = computeNodeLayout({ type: nodeType, data })
  const hasPrompt = nodeType === "agent" && typeof data.promptTemplate === "string" && data.promptTemplate.length > 0
  const promptPreview = hasPrompt
    ? (data.promptTemplate as string).slice(0, 90) + ((data.promptTemplate as string).length > 90 ? "…" : "")
    : null

  return (
    <>
      {hasPrompt && (
        <div
          className="absolute left-0 right-0 px-3 text-[11px] text-muted-foreground italic line-clamp-2 overflow-hidden"
          style={{
            top: layout.headerHeight,
            height: layout.promptHeight,
            paddingTop: 6,
          }}
        >
          {promptPreview}
        </div>
      )}
      {layout.handles.map((h) => (
        <div
          key={`label-${h.side}-${h.key}`}
          className={cn(
            "absolute flex items-center gap-1 text-[10px] text-muted-foreground pointer-events-none",
            h.side === "right" ? "right-4 flex-row-reverse" : "left-4",
          )}
          style={{
            top: h.y - layout.rowHeight / 2 + 2,
            height: layout.rowHeight - 4,
          }}
        >
          <span className="px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {h.key}
          </span>
        </div>
      ))}
    </>
  )
}

// Base node frame.
function NodeFrame({
  icon: Icon,
  title,
  subtitle,
  accentClass,
  nodeType,
  data,
  status,
  selected,
}: {
  icon: React.ElementType
  title: string
  subtitle?: string
  accentClass: string
  nodeType: string
  data: NodeData
  status?: PipelineStepStatus
  selected?: boolean
}) {
  const layout = computeNodeLayout({ type: nodeType, data })
  return (
    <div
      className={cn(
        "relative rounded-md border border-border bg-card text-card-foreground shadow-sm",
        "border-l-4",
        accentClass,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
      style={{ width: layout.width, height: layout.height }}
    >
      <div
        className="flex items-center gap-2 px-3 border-b border-border/60"
        style={{ height: layout.headerHeight }}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{title}</div>
          {subtitle && (
            <div className="text-[10px] text-muted-foreground truncate">{subtitle}</div>
          )}
        </div>
        <StatusDot status={status} />
      </div>
      <NodeBodyLabels nodeType={nodeType} data={data} />
      {/* Handles rendered at root so absolute `top: h.y` lines up with ELK. */}
      {layout.handles.map((h) => (
        <Handle
          key={`handle-${h.side}-${h.key}`}
          id={h.key}
          type={h.side === "left" ? "target" : "source"}
          position={h.side === "left" ? Position.Left : Position.Right}
          style={{
            top: h.y,
            background: "var(--primary)",
            width: 10,
            height: 10,
            border: "2px solid var(--background)",
          }}
        />
      ))}
    </div>
  )
}

// ── Per-node-type components ────────────────────────────────────────────────
export const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps) {
  const d = data as NodeData
  const kind = d.triggerKind || "manual"
  return (
    <NodeFrame
      icon={Zap}
      title={d.label || "Trigger"}
      subtitle={`${kind} trigger`}
      accentClass="border-l-amber-500"
      nodeType="trigger"
      data={d}
      status={d._stepStatus}
      selected={selected}
    />
  )
})

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const d = data as NodeData
  return (
    <NodeFrame
      icon={Bot}
      title={d.label || "Agent"}
      subtitle={d.agentId ? `agent: ${d.agentId}` : "no agent set"}
      accentClass="border-l-purple-500"
      nodeType="agent"
      data={d}
      status={d._stepStatus}
      selected={selected}
    />
  )
})

export const ConditionNode = memo(function ConditionNode({ data, selected }: NodeProps) {
  const d = data as NodeData
  return (
    <NodeFrame
      icon={GitBranch}
      title={d.label || "Condition"}
      subtitle="branch by expression"
      accentClass="border-l-cyan-500"
      nodeType="condition"
      data={d}
      status={d._stepStatus}
      selected={selected}
    />
  )
})

export const HumanApprovalNode = memo(function HumanApprovalNode({ data, selected }: NodeProps) {
  const d = data as NodeData
  return (
    <NodeFrame
      icon={Hand}
      title={d.label || "Approval Gate"}
      subtitle="human review required"
      accentClass="border-l-orange-500"
      nodeType="human_approval"
      data={d}
      status={d._stepStatus}
      selected={selected}
    />
  )
})

export const OutputNode = memo(function OutputNode({ data, selected }: NodeProps) {
  const d = data as NodeData
  return (
    <NodeFrame
      icon={FileOutput}
      title={d.label || "Output"}
      subtitle="bundle + notify"
      accentClass="border-l-emerald-500"
      nodeType="output"
      data={d}
      status={d._stepStatus}
      selected={selected}
    />
  )
})

export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  human_approval: HumanApprovalNode,
  output: OutputNode,
}
