import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  MarkerType,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
  type OnSelectionChangeParams,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import "@/components/pipelines/flow.css"

import { usePipelineStore } from "@/stores/usePipelineStore"
import { useAgentStore } from "@/stores"
import { nodeTypes } from "@/components/pipelines/nodes"
import { edgeTypes } from "@/components/pipelines/edges"
import { elkLayout } from "@/lib/pipelines/elk-layout"
import { computeNodeLayout } from "@/lib/pipelines/handle-layout"
import { NodePalette } from "@/components/pipelines/NodePalette"
import { NodeConfigPanel } from "@/components/pipelines/NodeConfigPanel"
import { StepperEditor } from "@/components/pipelines/StepperEditor"
import { RepositorySection } from "@/components/pipelines/RepositorySection"
import { ROLE_CONTRACTS, nodeDataFromContract } from "@/lib/pipelines/role-contracts"
import type { AdlcRoleId } from "@/types/agentRoleTemplate"
import {
  EMPTY_STEPPER,
  graphToStepper,
  stepperToGraph,
  type StepperState,
} from "@/lib/pipelines/stepper"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ArrowLeft, Workflow, AlertCircle, Loader2, LayoutGrid,
  ArrowRight, ArrowDown, Pencil, Eye, Save, RotateCcw,
  List, Network,
} from "lucide-react"
import { api } from "@/lib/api"
import type {
  PipelineNode, PipelineEdge, PipelineNodeType, PipelineNodeData,
  PipelineValidationResult, PipelineGraph, Agent,
} from "@/types"

function toRfNodes(nodes: PipelineNode[]): Node[] {
  return nodes.map((n) => {
    const layout = computeNodeLayout({ type: n.type, data: n.data })
    return {
      id: n.id,
      type: n.type,
      position: n.position || { x: 0, y: 0 },
      data: n.data || {},
      width: layout.width,
      height: layout.height,
    }
  })
}

const MINIMAP_COLORS: Record<string, string> = {
  trigger: "#f59e0b",
  agent: "#a855f7",
  condition: "#06b6d4",
  human_approval: "#f97316",
  output: "#10b981",
}

const EDGE_PALETTE = [
  "#a78bfa", "#60a5fa", "#34d399", "#f472b6",
  "#fbbf24", "#22d3ee", "#f87171", "#a3e635",
]

function colorFromSource(source: string, allSources: string[]): string {
  const idx = allSources.indexOf(source)
  return EDGE_PALETTE[idx < 0 ? 0 : idx % EDGE_PALETTE.length]
}

function toRfEdges(edges: PipelineEdge[]): Edge[] {
  const allSources = Array.from(new Set(edges.map((e) => e.source)))
  return edges.map((e) => {
    const color = colorFromSource(e.source, allSources)
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
      data: e.data,
      type: "elkPath",
      animated: false,
      style: { strokeWidth: 1.75, stroke: color, opacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
    }
  })
}

function rfNodesToPipelineNodes(nodes: Node[]): PipelineNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: (n.type as PipelineNodeType) || "agent",
    position: n.position,
    data: (n.data as PipelineNodeData) || {},
  }))
}

function rfEdgesToPipelineEdges(edges: Edge[]): PipelineEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    label: typeof e.label === "string" ? e.label : undefined,
    data: (e.data as Record<string, unknown>) || undefined,
  }))
}

function defaultDataForType(type: PipelineNodeType): PipelineNodeData {
  if (type === "trigger") {
    return { label: "Trigger", triggerKind: "manual", outputs: [{ key: "payload", type: "json" }] }
  }
  if (type === "agent") {
    return {
      label: "Agent Step",
      agentId: "",
      promptTemplate: "",
      inputs: [{ key: "input", type: "text" }],
      outputs: [{ key: "output", type: "text" }],
      failurePolicy: "halt",
    }
  }
  if (type === "condition") {
    return {
      label: "Condition",
      outputs: [{ key: "true", type: "text" }, { key: "false", type: "text" }],
    }
  }
  if (type === "human_approval") {
    return {
      label: "Approval",
      outputs: [{ key: "approved", type: "approval" }, { key: "rejected", type: "approval" }],
      approvalMessage: "Please review and approve.",
    }
  }
  return { label: "Output", inputs: [{ key: "result", type: "text" }] }
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

// ─── Inner editor — needs ReactFlowProvider context ──────────────────────────
interface EditorProps {
  rfNodes: Node[]
  rfEdges: Edge[]
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: OnConnect
  onSelectionChange: (params: OnSelectionChangeParams) => void
  onDrop: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  editMode: boolean
}

function GraphCanvas({
  rfNodes, rfEdges, onNodesChange, onEdgesChange,
  onConnect, onSelectionChange, onDrop, onDragOver, editMode,
}: EditorProps) {
  return (
    <ReactFlow
      className="rf-pipeline"
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onSelectionChange={onSelectionChange}
      onDrop={onDrop}
      onDragOver={onDragOver}
      fitView
      fitViewOptions={{ padding: 0.15, duration: 400, minZoom: 0.3, maxZoom: 1.5 }}
      minZoom={0.2}
      maxZoom={2}
      defaultEdgeOptions={{ type: "elkPath" }}
      nodesDraggable={editMode}
      nodesConnectable={editMode}
      edgesFocusable={editMode}
      elementsSelectable={true}
      deleteKeyCode={editMode ? ["Backspace", "Delete"] : []}
      panOnDrag
      zoomOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        nodeColor={(n) => MINIMAP_COLORS[n.type || "agent"] || "var(--muted-foreground)"}
        nodeStrokeWidth={0}
        maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
        style={{ width: 180, height: 120 }}
      />
    </ReactFlow>
  )
}

// Wrapper so we can use useReactFlow() hook.
function InnerEditor({ children }: { children: (api: ReturnType<typeof useReactFlow>) => React.ReactNode }) {
  const api = useReactFlow()
  return <>{children(api)}</>
}

// ─── Main page ───────────────────────────────────────────────────────────────
export function PlaybookEditorPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { selected, loading, error, fetchOne, clear, updatePipeline } = usePipelineStore()
  const agents = useAgentStore((s) => s.agents)
  const setAgents = useAgentStore((s) => s.setAgents)

  // Fetch pipeline + agents
  useEffect(() => {
    if (id) fetchOne(id)
    return () => clear()
  }, [id, fetchOne, clear])

  useEffect(() => {
    if (agents.length === 0) {
      api.getAgents().then(setAgents).catch(console.error)
    }
  }, [agents.length, setAgents])

  // Layout state
  const [direction, setDirection] = useState<"LR" | "TB">("LR")
  const [layoutTick, setLayoutTick] = useState(0)
  const [rfNodes, setRfNodes] = useState<Node[]>([])
  const [rfEdges, setRfEdges] = useState<Edge[]>([])
  const [layouting, setLayouting] = useState(false)

  // Edit state
  const [editMode, setEditMode] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [validation, setValidation] = useState<PipelineValidationResult | null>(null)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const rfInstanceRef = useRef<ReturnType<typeof useReactFlow> | null>(null)

  // Stepper vs Graph authoring mode (edit only — view mode always renders the graph).
  const [graphMode, setGraphMode] = useState<"stepper" | "graph">("stepper")
  const [stepperState, setStepperState] = useState<StepperState>(EMPTY_STEPPER)
  /** If stepper conversion failed, graph is non-linear so stepper is locked. */
  const [stepperLocked, setStepperLocked] = useState(false)
  const [stepperLockReason, setStepperLockReason] = useState<string | null>(null)

  // Repository configuration — persisted inside graph.metadata.repo. Drives
  // git worktree creation per mission so agents get real codebase context.
  const [repoConfig, setRepoConfig] = useState<{
    path: string; url: string; baseBranch: string; autoBranch: boolean
  }>({ path: "", url: "", baseBranch: "", autoBranch: true })

  // Derive stepper state + repo config from loaded graph.
  useEffect(() => {
    if (!selected) return
    const graph = selected.graph || { nodes: [], edges: [] }
    const result = graphToStepper(graph)
    if (result.ok && result.state) {
      setStepperState(result.state)
      setStepperLocked(false)
      setStepperLockReason(null)
      setGraphMode("stepper")
    } else {
      setStepperState(EMPTY_STEPPER)
      setStepperLocked(true)
      setStepperLockReason(result.reason || "Graph is not linear-compatible.")
      setGraphMode("graph")
    }
    const repo = graph.metadata?.repo
    setRepoConfig({
      path: repo?.path || "",
      url: repo?.url || "",
      baseBranch: repo?.baseBranch || "",
      autoBranch: repo?.autoBranch !== false,
    })
  }, [selected])

  // Load graph on mount / pipeline change / re-layout request.
  useEffect(() => {
    const rawNodes = toRfNodes(selected?.graph?.nodes || [])
    const rawEdges = toRfEdges(selected?.graph?.edges || [])
    if (rawNodes.length === 0) {
      setRfNodes([])
      setRfEdges([])
      setDirty(false)
      return
    }
    let cancelled = false
    setLayouting(true)
    elkLayout(rawNodes, rawEdges, { direction, edgeRouting: "ORTHOGONAL" })
      .then(({ nodes, edges }) => {
        if (cancelled) return
        setRfNodes(nodes)
        setRfEdges(edges)
        setDirty(false)
      })
      .catch((err) => {
        console.error("[pipeline] ELK layout failed:", err)
        if (!cancelled) {
          setRfNodes(rawNodes)
          setRfEdges(rawEdges)
        }
      })
      .finally(() => {
        if (!cancelled) setLayouting(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, direction, layoutTick])

  // ── Editor handlers ─────────────────────────────────────────────────────
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((ns) => applyNodeChanges(changes, ns))
      if (changes.some((c) => c.type !== "select")) setDirty(true)
    },
    [],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((es) => applyEdgeChanges(changes, es))
      if (changes.some((c) => c.type !== "select")) setDirty(true)
    },
    [],
  )

  const onConnect = useCallback<OnConnect>(
    (connection: Connection) => {
      setRfEdges((es) => {
        const color = colorFromSource(
          connection.source!,
          Array.from(new Set([...es.map((e) => e.source), connection.source!])),
        )
        return addEdge(
          {
            ...connection,
            id: uid("edge"),
            type: "elkPath",
            style: { strokeWidth: 1.75, stroke: color, opacity: 0.85 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          },
          es,
        )
      })
      setDirty(true)
    },
    [],
  )

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedNodeId(params.nodes[0]?.id ?? null)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData("application/reactflow-node-type") as PipelineNodeType
    if (!type) return
    const rfApi = rfInstanceRef.current
    if (!rfApi) return
    const position = rfApi.screenToFlowPosition({ x: e.clientX, y: e.clientY })

    // Role-aware path: if drag carried an ADLC role, instantiate from contract
    // and auto-resolve agentId when only one agent has that role.
    let data: PipelineNodeData
    let nodeIdPrefix = type
    if (type === "agent") {
      const roleId = e.dataTransfer.getData("application/reactflow-adlc-role") as AdlcRoleId
      const contract = roleId && ROLE_CONTRACTS[roleId]
      if (contract) {
        const matches = agents.filter(
          (a) => (a as Agent & { role?: string }).role === roleId,
        )
        const autoAgentId = matches.length === 1 ? matches[0].id : ""
        data = nodeDataFromContract(contract, autoAgentId)
        nodeIdPrefix = roleId.replace(/-/g, "_")
      } else {
        data = defaultDataForType(type)
      }
    } else {
      data = defaultDataForType(type)
    }

    const id = uid(nodeIdPrefix)
    const layout = computeNodeLayout({ type, data })
    const newNode: Node = {
      id, type, position, data,
      width: layout.width, height: layout.height,
    }
    setRfNodes((ns) => [...ns, newNode])
    setSelectedNodeId(id)
    setDirty(true)
  }, [agents])

  const updateSelectedNode = useCallback(
    (patch: Partial<PipelineNodeData>) => {
      if (!selectedNodeId) return
      setRfNodes((ns) =>
        ns.map((n) => {
          if (n.id !== selectedNodeId) return n
          const nextData = { ...(n.data as PipelineNodeData), ...patch }
          // Re-measure node size if inputs/outputs changed.
          const layout = computeNodeLayout({ type: n.type, data: nextData })
          return { ...n, data: nextData, width: layout.width, height: layout.height }
        }),
      )
      setDirty(true)
    },
    [selectedNodeId],
  )

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return
    setRfNodes((ns) => ns.filter((n) => n.id !== selectedNodeId))
    setRfEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId))
    setSelectedNodeId(null)
    setDirty(true)
  }, [selectedNodeId])

  const discardChanges = useCallback(() => {
    // Reload from server state.
    if (id) fetchOne(id)
    setDirty(false)
  }, [id, fetchOne])

  const save = useCallback(async () => {
    if (!id) return
    setSaving(true)
    setSaveError(null)
    setValidation(null)
    try {
      // Source of truth depends on active authoring mode.
      const baseGraph: PipelineGraph = graphMode === "stepper"
        ? stepperToGraph(stepperState)
        : {
            nodes: rfNodesToPipelineNodes(rfNodes),
            edges: rfEdgesToPipelineEdges(rfEdges),
          }
      // Merge repo metadata so git worktree settings persist alongside the graph.
      const graph: PipelineGraph = {
        ...baseGraph,
        metadata: {
          ...(baseGraph.metadata || {}),
          repo: repoConfig.path.trim()
            ? {
                path: repoConfig.path.trim(),
                url: repoConfig.url.trim() || undefined,
                baseBranch: repoConfig.baseBranch.trim() || undefined,
                autoBranch: repoConfig.autoBranch,
              }
            : undefined,
        },
      }
      // Validate first for immediate feedback (server will re-validate on save).
      const v = await api.validatePipeline(id, graph)
      setValidation(v)
      if (!v.valid) {
        setSaving(false)
        setSaveError(`Validation failed: ${v.errors.map((e) => e.message).join("; ")}`)
        return
      }
      await updatePipeline(id, { graph })
      setDirty(false)
    } catch (err) {
      const e = err as Error & { body?: { details?: PipelineValidationResult } }
      if (e.body?.details) setValidation(e.body.details)
      setSaveError(e.message || "Save failed")
    } finally {
      setSaving(false)
    }
  }, [id, rfNodes, rfEdges, updatePipeline, graphMode, stepperState, repoConfig])

  // Prompt before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      return (e.returnValue = "")
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  const selectedNode = useMemo(
    () => (selectedNodeId ? rfNodes.find((n) => n.id === selectedNodeId) : null) || null,
    [rfNodes, selectedNodeId],
  )

  if (loading && !selected) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading pipeline…
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => nav("/missions/playbooks")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <div className="flex items-center gap-2 p-3 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      </div>
    )
  }
  if (!selected) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => nav("/missions/playbooks")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <div className="text-muted-foreground">Template not found.</div>
      </div>
    )
  }

  const nodeCount = rfNodes.length
  const edgeCount = rfEdges.length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => nav("/missions/playbooks")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Workflow className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-base font-semibold truncate">{selected.name}</div>
            {selected.description && (
              <div className="text-xs text-muted-foreground truncate">{selected.description}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {nodeCount > 0 && (graphMode === "graph" || !editMode) && (
            <div className="flex items-center rounded-md border border-border overflow-hidden">
              <button
                title="Horizontal layout"
                onClick={() => setDirection("LR")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors",
                  direction === "LR"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                <ArrowRight className="h-3.5 w-3.5" /> LR
              </button>
              <button
                title="Vertical layout"
                onClick={() => setDirection("TB")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-l border-border transition-colors",
                  direction === "TB"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                <ArrowDown className="h-3.5 w-3.5" /> TB
              </button>
              <button
                title="Re-apply auto-layout"
                onClick={() => setLayoutTick((x) => x + 1)}
                disabled={layouting}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-l border-border bg-card text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                {layouting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LayoutGrid className="h-3.5 w-3.5" />
                )}
                {layouting ? "Laying out…" : "Re-layout"}
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{nodeCount} nodes</span>
            <span>{edgeCount} edges</span>
          </div>

          {/* Edit mode toggle */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setEditMode(false)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors",
                !editMode
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              <Eye className="h-3.5 w-3.5" /> View
            </button>
            <button
              onClick={() => setEditMode(true)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-l border-border transition-colors",
                editMode
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          </div>

          {/* Advanced: switch to Graph (DAG) mode — for power users only.
              Hidden behind an overflow button so it doesn't clutter the primary UI. */}
          {editMode && !stepperLocked && graphMode === "stepper" && (
            <button
              onClick={() => {
                const g = stepperToGraph(stepperState)
                setRfNodes(toRfNodes(g.nodes))
                setRfEdges(toRfEdges(g.edges))
                setGraphMode("graph")
                setLayoutTick((x) => x + 1)
              }}
              title="Advanced: switch to DAG graph editor"
              className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
            >
              <Network className="h-4 w-4" />
            </button>
          )}
          {editMode && graphMode === "graph" && !stepperLocked && (
            <button
              onClick={() => {
                const current: PipelineGraph = {
                  nodes: rfNodesToPipelineNodes(rfNodes),
                  edges: rfEdgesToPipelineEdges(rfEdges),
                }
                const r = graphToStepper(current)
                if (r.ok && r.state) {
                  setStepperState(r.state)
                  setGraphMode("stepper")
                } else {
                  setStepperLocked(true)
                  setStepperLockReason(r.reason || "Graph is not linear-compatible.")
                }
              }}
              title="Back to stepper mode"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <List className="h-3.5 w-3.5" /> Stepper
            </button>
          )}
          {editMode && (
            <>
              {dirty && (
                <span className="text-[11px] text-amber-400 font-medium">● Unsaved</span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={discardChanges}
                disabled={!dirty || saving}
                title="Discard changes"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Discard
              </Button>
              <Button size="sm" onClick={save} disabled={!dirty || saving}>
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stepper-locked notice — surfaces reason when graph is non-linear */}
      {editMode && stepperLocked && stepperLockReason && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/30 text-blue-400 text-xs flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Stepper mode unavailable for this template — {stepperLockReason} You can still edit in Graph mode.</span>
        </div>
      )}

      {/* Validation/save feedback bar */}
      {saveError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {saveError}
        </div>
      )}
      {validation && validation.warnings.length > 0 && !saveError && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-xs">
          {validation.warnings.length} warning(s): {validation.warnings.map((w) => w.message).join("; ")}
        </div>
      )}

      {/* Main canvas + palette + config */}
      <div className="flex-1 flex overflow-hidden">
        {/* Stepper mode — full-width vertical editor, no palette/config panel needed */}
        {editMode && graphMode === "stepper" ? (
          <div className="flex-1 overflow-y-auto bg-background">
            <RepositorySection
              value={repoConfig}
              readOnly={!editMode}
              onChange={(next) => { setRepoConfig(next); setDirty(true) }}
            />
            <StepperEditor
              state={stepperState}
              agents={agents}
              onChange={(next) => {
                setStepperState(next)
                setDirty(true)
              }}
            />
          </div>
        ) : (
          <>
            {editMode && <NodePalette agents={agents} />}
            <div className="flex-1 relative" ref={canvasWrapRef}>
              {nodeCount === 0 && !editMode ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <Workflow className="h-12 w-12 opacity-30 mb-3" />
                  <div className="text-base font-medium mb-1">Empty template</div>
                  <div className="text-sm">Switch to Edit mode to start building.</div>
                </div>
              ) : (
                <ReactFlowProvider>
                  <InnerEditor>
                    {(rfApi) => {
                      rfInstanceRef.current = rfApi
                      return (
                        <GraphCanvas
                          rfNodes={rfNodes}
                          rfEdges={rfEdges}
                          onNodesChange={onNodesChange}
                          onEdgesChange={onEdgesChange}
                          onConnect={onConnect}
                          onSelectionChange={onSelectionChange}
                          onDrop={onDrop}
                          onDragOver={onDragOver}
                          editMode={editMode}
                        />
                      )
                    }}
                  </InnerEditor>
                </ReactFlowProvider>
              )}
            </div>
            {editMode && selectedNode && (
              <NodeConfigPanel
                node={selectedNode as unknown as PipelineNode}
                agents={agents}
                onChange={updateSelectedNode}
                onDelete={deleteSelectedNode}
                onClose={() => setSelectedNodeId(null)}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
