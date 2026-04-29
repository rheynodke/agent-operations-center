// Auto-layout pipeline graphs using dagre. Produces clean left-to-right DAG
// positions so users don't have to hand-place nodes.
//
// Usage:
//   const { nodes, edges } = autoLayout(graph, { direction: 'LR' })

import dagre from "dagre"
import type { Node, Edge } from "@xyflow/react"

export interface LayoutOptions {
  direction?: "LR" | "TB"
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number
  nodeSep?: number
  ranker?: "network-simplex" | "tight-tree" | "longest-path"
}

const DEFAULTS: Required<LayoutOptions> = {
  direction: "LR",
  nodeWidth: 240,
  nodeHeight: 140,
  rankSep: 140, // horizontal gap between ranks — more room for bezier curves
  nodeSep: 50,  // vertical gap between siblings in same rank
  // tight-tree keeps cross-rank edges short (matters for fan-in to Doc).
  ranker: "tight-tree",
}

export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  opts: LayoutOptions = {},
): { nodes: Node[]; edges: Edge[] } {
  const o = { ...DEFAULTS, ...opts }
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: o.direction,
    ranksep: o.rankSep,
    nodesep: o.nodeSep,
    ranker: o.ranker,
    marginx: 20,
    marginy: 20,
    // align 'UL' snaps nodes up-left so parallel siblings line up horizontally
    // (cleaner for ADLC-style DAGs with fan-out/fan-in).
    align: o.direction === "LR" ? "UL" : undefined,
  })

  for (const n of nodes) {
    g.setNode(n.id, {
      width: (n.width ?? o.nodeWidth),
      height: (n.height ?? o.nodeHeight),
    })
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  const laidOutNodes = nodes.map((n) => {
    const pos = g.node(n.id)
    if (!pos) return n
    // dagre returns center coordinates; React Flow expects top-left.
    return {
      ...n,
      position: {
        x: pos.x - (n.width ?? o.nodeWidth) / 2,
        y: pos.y - (n.height ?? o.nodeHeight) / 2,
      },
    }
  })

  return { nodes: laidOutNodes, edges }
}
