// Single source of truth for handle positions within a pipeline node.
// Used by BOTH nodes.tsx (render) AND elk-layout.ts (port positions) so they
// agree pixel-perfect. Previous drift (percentage-based handles + content-sized
// nodes) caused diagonal edges because ELK's port Y and rendered handle Y
// didn't line up.

import type { PipelineNodeData } from "@/types"

export type HandleSide = "left" | "right"

export interface HandleLayoutEntry {
  key: string
  side: HandleSide
  y: number   // absolute pixels from node top, to handle center
}

export interface NodeLayout {
  width: number
  height: number
  handles: HandleLayoutEntry[]
  /** Y where handle rows start (for layout of the handle labels). */
  handlesStartY: number
  /** Per-row height used for both render and port calc. */
  rowHeight: number
  /** Header height (icon + title/subtitle + border). */
  headerHeight: number
  /** Prompt preview line height (0 if no prompt). */
  promptHeight: number
}

// Exact constants matching the CSS in nodes.tsx. If you change node padding /
// typography there, adjust here too. These compose to a deterministic node size.
const HEADER_HEIGHT = 56
const PROMPT_HEIGHT = 40
const ROW_HEIGHT = 24
const SECTION_PAD = 10
const BOTTOM_PAD = 10
const MIN_BODY_HEIGHT = 32

export interface NodeLike {
  type?: string
  data?: PipelineNodeData
}

function defaultsForNode(n: NodeLike): { inputs: Array<{ key: string }>; outputs: Array<{ key: string }> } {
  const t = n.type
  const data = n.data || {}
  if (t === "trigger") {
    return { inputs: [], outputs: data.outputs?.length ? data.outputs : [{ key: "payload", type: "json" } as { key: string }] }
  }
  if (t === "output") {
    return { inputs: data.inputs?.length ? data.inputs : [{ key: "result", type: "text" } as { key: string }], outputs: [] }
  }
  if (t === "condition") {
    return {
      inputs: [{ key: "value" }],
      outputs: data.outputs?.length ? data.outputs : [{ key: "true" }, { key: "false" }],
    }
  }
  if (t === "human_approval") {
    return {
      inputs: [{ key: "artifact" }],
      outputs: data.outputs?.length ? data.outputs : [{ key: "approved" }, { key: "rejected" }],
    }
  }
  // agent
  return {
    inputs: data.inputs || [],
    outputs: data.outputs || [],
  }
}

export function computeNodeLayout(n: NodeLike): NodeLayout {
  const t = n.type
  const { inputs, outputs } = defaultsForNode(n)

  const hasPrompt = t === "agent" && typeof n.data?.promptTemplate === "string" && n.data.promptTemplate.length > 0
  const promptHeight = hasPrompt ? PROMPT_HEIGHT : 0

  const handlesStartY = HEADER_HEIGHT + promptHeight + SECTION_PAD

  // Total rows = max(inputs, outputs) — same rows side-by-side.
  const rows = Math.max(inputs.length, outputs.length, 1)
  const bodyHeight = Math.max(rows * ROW_HEIGHT, MIN_BODY_HEIGHT)
  const totalHeight = handlesStartY + bodyHeight + BOTTOM_PAD

  const width = t === "trigger" || t === "output" ? 220 : 260

  // Each handle centered in its row: y = handlesStartY + (i + 0.5) * rowHeight
  const handles: HandleLayoutEntry[] = []
  inputs.forEach((h, i) => {
    handles.push({
      key: h.key,
      side: "left",
      y: handlesStartY + (i + 0.5) * ROW_HEIGHT,
    })
  })
  outputs.forEach((h, i) => {
    handles.push({
      key: h.key,
      side: "right",
      y: handlesStartY + (i + 0.5) * ROW_HEIGHT,
    })
  })

  return {
    width,
    height: totalHeight,
    handles,
    handlesStartY,
    rowHeight: ROW_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    promptHeight,
  }
}
