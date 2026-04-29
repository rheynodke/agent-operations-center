// Custom edge that renders a polyline through ELK-computed waypoints.
// This is the key to avoiding edge-over-node overlap — ELK already figured
// out the correct path; we just need to draw through its bend points.

import { memo } from "react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react"

type ElkPoint = { x: number; y: number }

export type ElkPathEdgeData = {
  elkPath?: ElkPoint[]
}

// Build an SVG path with rounded corners through a polyline of bend points.
// Rounded corners (`radius` px) make it visually match React Flow's smoothstep.
function buildRoundedPolylinePath(points: ElkPoint[], radius = 8): string {
  if (points.length < 2) return ""
  if (points.length === 2) {
    const [a, b] = points
    return `M${a.x},${a.y} L${b.x},${b.y}`
  }
  const parts: string[] = [`M${points[0].x},${points[0].y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]
    // Vector from curr towards prev (for arc entry)
    const dx1 = prev.x - curr.x
    const dy1 = prev.y - curr.y
    const len1 = Math.hypot(dx1, dy1) || 1
    const r1 = Math.min(radius, len1 / 2)
    const entryX = curr.x + (dx1 / len1) * r1
    const entryY = curr.y + (dy1 / len1) * r1
    // Vector from curr towards next (for arc exit)
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y
    const len2 = Math.hypot(dx2, dy2) || 1
    const r2 = Math.min(radius, len2 / 2)
    const exitX = curr.x + (dx2 / len2) * r2
    const exitY = curr.y + (dy2 / len2) * r2
    parts.push(`L${entryX},${entryY}`)
    parts.push(`Q${curr.x},${curr.y} ${exitX},${exitY}`)
  }
  const last = points[points.length - 1]
  parts.push(`L${last.x},${last.y}`)
  return parts.join(" ")
}

export const ElkPathEdge = memo(function ElkPathEdge(props: EdgeProps) {
  const {
    id,
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    markerEnd, style, label, data,
  } = props

  const elkPath = (data as ElkPathEdgeData | undefined)?.elkPath

  let path: string
  let labelX: number
  let labelY: number
  if (elkPath && elkPath.length >= 2) {
    // ELK ports route from actual handle positions, so waypoints already
    // start/end at the right spot. Still override endpoints with React Flow's
    // sourceX/Y/targetX/Y in case of sub-pixel drift.
    const pts: ElkPoint[] = [
      { x: sourceX, y: sourceY },
      ...elkPath.slice(1, -1),
      { x: targetX, y: targetY },
    ]
    const dedup: ElkPoint[] = []
    for (const p of pts) {
      const prev = dedup[dedup.length - 1]
      if (!prev || prev.x !== p.x || prev.y !== p.y) dedup.push(p)
    }
    path = buildRoundedPolylinePath(dedup)
    const mid = dedup[Math.floor(dedup.length / 2)]
    labelX = mid.x
    labelY = mid.y
  } else {
    // Fallback to bezier if ELK didn't provide waypoints.
    const [bp, bx, by] = getBezierPath({
      sourceX, sourceY, sourcePosition,
      targetX, targetY, targetPosition,
    })
    path = bp
    labelX = bx
    labelY = by
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="absolute text-[10px] px-1.5 py-0.5 rounded bg-card border border-border pointer-events-auto"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

export const edgeTypes = {
  elkPath: ElkPathEdge,
} as const

// For convenience: Edge type with our custom edge data shape.
export type ElkPipelineEdge = Edge<ElkPathEdgeData>
