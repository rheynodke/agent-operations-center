// ELK-based auto-layout for pipeline graphs. Much smarter than dagre:
// does real edge routing (avoids node overlaps, handles orthogonal/spline
// routing natively, uses Brandes-Köpf node placement for aesthetic ranks).
//
// Async — ELK runs layout in a web worker under the hood.
//
// Usage:
//   const { nodes, edges } = await elkLayout(rfNodes, rfEdges, { direction: 'LR' })

import ELK, { type ElkNode, type ElkExtendedEdge, type ElkPort } from "elkjs/lib/elk.bundled.js"
import type { Node, Edge } from "@xyflow/react"
import { computeNodeLayout, type HandleSide } from "./handle-layout"

function sideToElkSide(side: HandleSide): "WEST" | "EAST" {
  return side === "left" ? "WEST" : "EAST"
}

const elk = new ELK()

export interface ElkLayoutOptions {
  direction?: "LR" | "TB"
  nodeWidth?: number
  nodeHeight?: number
  /** Orthogonal = straight L-shaped edges. Splines = smooth curves. */
  edgeRouting?: "ORTHOGONAL" | "SPLINES" | "POLYLINE"
}

const DEFAULTS: Required<ElkLayoutOptions> = {
  direction: "LR",
  nodeWidth: 240,
  nodeHeight: 140,
  edgeRouting: "ORTHOGONAL",
}

export async function elkLayout(
  nodes: Node[],
  edges: Edge[],
  opts: ElkLayoutOptions = {},
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const o = { ...DEFAULTS, ...opts }
  const elkDirection = o.direction === "LR" ? "RIGHT" : "DOWN"

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": elkDirection,
      // Spacing — generous gaps so routed edges have breathing room.
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.spacing.edgeNode": "30",
      "elk.spacing.edgeEdge": "20",
      // Quality tuning
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      // Orthogonal routing produces waypoints that avoid node overlap.
      "elk.edgeRouting": o.edgeRouting,
      "elk.layered.unnecessaryBendpoints": "true",
      "elk.layered.thoroughness": "10",
      "elk.layered.mergeEdges": "false",
      // Emit port-to-port routing (we'll consume waypoints in custom edge).
      "elk.layered.edgeRouting.selfLoopDistribution": "EQUALLY",
    },
    children: nodes.map((n) => {
      // Use shared computeNodeLayout — same helper nodes.tsx uses to render
      // so ELK port positions match rendered handle positions exactly.
      const layout = computeNodeLayout({ type: n.type, data: n.data as never })
      const ports: ElkPort[] = layout.handles.map((hm) => ({
        id: `${n.id}__${hm.key}`,
        x: hm.side === "left" ? 0 : layout.width,
        y: hm.y,
        width: 1,
        height: 1,
        layoutOptions: {
          "port.side": sideToElkSide(hm.side),
        },
      }))
      return {
        id: n.id,
        width: layout.width,
        height: layout.height,
        ports,
        layoutOptions: {
          "portConstraints": "FIXED_POS",
        },
      }
    }),
    edges: edges.map<ElkExtendedEdge>((e) => {
      // If edge specifies a handle, route through the corresponding port;
      // otherwise use the node itself (ELK will pick a boundary attach point).
      const srcPort = e.sourceHandle ? `${e.source}__${e.sourceHandle}` : undefined
      const tgtPort = e.targetHandle ? `${e.target}__${e.targetHandle}` : undefined
      return {
        id: e.id,
        sources: [srcPort ?? e.source],
        targets: [tgtPort ?? e.target],
      }
    }),
  }

  const laid = await elk.layout(graph)
  const nodeById = new Map<string, ElkNode>()
  for (const c of laid.children || []) nodeById.set(c.id, c)

  const laidNodes = nodes.map((n) => {
    const e = nodeById.get(n.id)
    if (!e) return n
    return {
      ...n,
      position: { x: e.x ?? 0, y: e.y ?? 0 },
    }
  })

  // Extract ELK waypoints per edge and stash them in edge.data.elkPath.
  // Custom edge renderer consumes this. Fallback to default routing if ELK
  // didn't produce sections for some reason.
  const laidEdgesById = new Map<string, ElkExtendedEdge>()
  for (const e of laid.edges || []) laidEdgesById.set(e.id, e)

  const laidEdges = edges.map((e) => {
    const le = laidEdgesById.get(e.id)
    const section = le?.sections?.[0]
    if (!section) return e
    const points: Array<{ x: number; y: number }> = [
      section.startPoint,
      ...(section.bendPoints || []),
      section.endPoint,
    ].filter(Boolean) as Array<{ x: number; y: number }>
    return {
      ...e,
      type: "elkPath",
      data: { ...(e.data || {}), elkPath: points },
    }
  })

  return { nodes: laidNodes, edges: laidEdges }
}
