import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import { motion } from "framer-motion"
import { useAgentStore, useLiveFeedStore, useThemeStore } from "@/stores"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import type { Agent } from "@/types"
import { AgentWorld3D } from "./AgentWorld3D"

// ── Types ──────────────────────────────────────────────────────────────────────

type WorldState = "processing" | "working" | "idle" | "offline"
interface SceneDims { w: number; h: number }
interface PxPos { x: number; y: number }

// ── Layout constants ───────────────────────────────────────────────────────────

const SCENE_H         = 560
const CHAR_W          = 56
const CHAR_H          = 88
const WS_W            = 128
const WS_H            = 86
const WALL_H_PCT      = 9    // top wall strip %
const WS_CENTER_Y_PCT = 26   // workstation center Y
const CHAR_DESK_Y_PCT = 38   // character Y when at desk (below workstation)
const OFFLINE_Y_PCT   = -15  // off-screen

const WANDER = { xMin: 10, xMax: 87, yMin: 53, yMax: 83 }

// ── Helpers ────────────────────────────────────────────────────────────────────

function getAgentColor(agent: Agent): string {
  if (agent.avatarPresetId) {
    const p = AVATAR_PRESETS.find(p => p.id === agent.avatarPresetId)
    if (p) return p.color
  }
  return agent.color || "#6366f1"
}

function getWorldState(agent: Agent, processingIds: Set<string>): WorldState {
  if (agent.status === "terminated" || agent.status === "paused" || agent.status === "error")
    return "offline"
  if (processingIds.has(agent.id)) return "processing"
  if (agent.status === "active") return "working"
  return "idle"
}

function randomWander() {
  return {
    xPct: WANDER.xMin + Math.random() * (WANDER.xMax - WANDER.xMin),
    yPct: WANDER.yMin + Math.random() * (WANDER.yMax - WANDER.yMin),
  }
}

function pctToPx(xPct: number, yPct: number, dims: SceneDims): PxPos {
  return {
    x: (xPct / 100) * dims.w - CHAR_W / 2,
    y: (yPct / 100) * dims.h - CHAR_H / 2,
  }
}

function getDeskXPcts(count: number): number[] {
  if (count === 0) return []
  if (count === 1) return [50]
  const margin = 11
  const span = 100 - margin * 2
  return Array.from({ length: count }, (_, i) => margin + (i / (count - 1)) * span)
}

// ── Diamond floor (rotated checkerboard = diamonds) ────────────────────────────

function DiamondFloor() {
  return (
    <div className="absolute inset-0" style={{ overflow: "hidden", background: "#091220" }}>
      {/* Rotated checkerboard → diamond tiles */}
      <div
        style={{
          position: "absolute",
          width: 2200,
          height: 2200,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) rotate(45deg)",
          backgroundImage:
            "repeating-conic-gradient(#091220 0% 25%, #0c1a2c 0% 50%)",
          backgroundSize: "38px 38px",
        }}
      />
      {/* Work zone highlight */}
      <div
        style={{
          position: "absolute",
          left: 0, right: 0, top: 0,
          height: "47%",
          background:
            "linear-gradient(180deg, rgba(15,35,80,0.35) 0%, rgba(15,35,80,0.1) 70%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Lounge zone tint */}
      <div
        style={{
          position: "absolute",
          left: 0, right: 0, bottom: 0,
          height: "28%",
          background:
            "linear-gradient(0deg, rgba(10,20,50,0.4) 0%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Center spotlight on meeting area */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "60%",
          transform: "translate(-50%, -50%)",
          width: 260,
          height: 200,
          background:
            "radial-gradient(ellipse, rgba(40,80,180,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
    </div>
  )
}

// ── Top wall strip ─────────────────────────────────────────────────────────────

function TopWall() {
  return (
    <>
      {/* Wall background */}
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: 0,
          height: `${WALL_H_PCT}%`,
          background: "linear-gradient(180deg, #060c18 0%, #081428 100%)",
          borderBottom: "2px solid rgba(30,60,130,0.55)",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        {/* LED light strips (3 evenly spaced) */}
        {[20, 50, 80].map((xPct, i) => (
          <div key={i} style={{ position: "absolute", left: `${xPct}%`, top: 0, transform: "translateX(-50%)" }}>
            {/* LED bar */}
            <div
              style={{
                width: 70, height: 4,
                background: "linear-gradient(90deg, transparent, rgba(100,160,255,0.8), rgba(140,180,255,1), rgba(100,160,255,0.8), transparent)",
                borderRadius: "0 0 4px 4px",
                boxShadow: "0 0 12px rgba(100,160,255,0.6), 0 0 24px rgba(80,140,255,0.3)",
              }}
            />
            {/* Light cone */}
            <div
              style={{
                position: "absolute",
                top: 4, left: "50%", transform: "translateX(-50%)",
                width: 180, height: 240,
                background: "radial-gradient(ellipse at 50% 0%, rgba(100,160,255,0.1) 0%, transparent 65%)",
                pointerEvents: "none",
              }}
            />
          </div>
        ))}
        {/* Room label */}
        <div
          style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: 8, fontWeight: 800, letterSpacing: "0.55em",
            color: "rgba(80,140,255,0.35)", textTransform: "uppercase",
          }}
        >
          AGENT OPS HQ
        </div>
      </div>
    </>
  )
}

// ── Room dividers ──────────────────────────────────────────────────────────────

function RoomDividers() {
  return (
    <>
      {/* Work zone / floor divider */}
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: "46%",
          height: 2,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(30,60,140,0.7) 10%, rgba(50,100,200,0.5) 50%, rgba(30,60,140,0.7) 90%, transparent 100%)",
          pointerEvents: "none", zIndex: 1,
        }}
      />
      {/* Zone label: workstations */}
      <div
        style={{
          position: "absolute", left: "1.5%", top: `${WALL_H_PCT + 1}%`,
          fontSize: 7, fontWeight: 700, letterSpacing: "0.22em",
          color: "rgba(60,120,255,0.45)", textTransform: "uppercase", zIndex: 3,
          pointerEvents: "none",
        }}
      >
        WORKSTATIONS
      </div>
      {/* Zone label: floor */}
      <div
        style={{
          position: "absolute", left: "1.5%", top: "49%",
          fontSize: 7, fontWeight: 700, letterSpacing: "0.22em",
          color: "rgba(60,120,255,0.3)", textTransform: "uppercase", zIndex: 3,
          pointerEvents: "none",
        }}
      >
        OPEN FLOOR
      </div>
    </>
  )
}

// ── Workstation (top-down view of a desk) ──────────────────────────────────────

function Workstation({
  x, y, color, occupied, processing, agentName,
}: {
  x: number; y: number
  color: string; occupied: boolean; processing: boolean
  agentName?: string
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x - WS_W / 2,
        top: y - WS_H / 2,
        width: WS_W,
        height: WS_H,
        background: occupied
          ? `linear-gradient(155deg, ${color}22 0%, #0b1830 60%, #0a1528 100%)`
          : "linear-gradient(155deg, #0e1d38 0%, #091525 100%)",
        border: `2.5px solid ${occupied ? color + "85" : "#1a3268"}`,
        borderRadius: 14,
        boxShadow: occupied
          ? `0 0 36px ${color}40, 0 0 12px ${color}20, inset 0 1px 0 rgba(255,255,255,0.08)`
          : "inset 0 1px 0 rgba(255,255,255,0.04)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 10px 7px",
        gap: 5,
        transition: "all 0.55s ease",
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      {/* Monitor bezel */}
      <div
        style={{
          width: "78%", height: 38,
          background: "#040810",
          border: `2px solid ${occupied ? color + "90" : "#1a3268"}`,
          borderRadius: 7,
          overflow: "hidden",
          position: "relative",
          boxShadow: occupied ? `inset 0 0 12px ${color}40` : "none",
          transition: "border-color 0.55s, box-shadow 0.55s",
          flexShrink: 0,
        }}
      >
        {occupied && (
          <>
            <motion.div
              style={{
                position: "absolute", inset: 0,
                background: `radial-gradient(ellipse at 50% 25%, ${color}70 0%, ${color}20 55%, transparent)`,
              }}
              animate={processing ? { opacity: [0.25, 1, 0.25] } : { opacity: [0.35, 0.65, 0.35] }}
              transition={{ repeat: Infinity, duration: processing ? 0.48 : 2.4, ease: "easeInOut" }}
            />
            {/* Scanlines */}
            <div
              style={{
                position: "absolute", inset: 0,
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(0,0,0,0.2) 0px, rgba(0,0,0,0.2) 1px, transparent 1px, transparent 4px)",
                pointerEvents: "none",
              }}
            />
          </>
        )}
        {/* Screen off state */}
        {!occupied && (
          <div
            style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(circle, rgba(30,50,100,0.1), transparent)",
            }}
          />
        )}
      </div>

      {/* Keyboard row */}
      <div
        style={{
          width: "60%", height: 9,
          background: occupied ? `${color}18` : "rgba(20,40,80,0.4)",
          border: `1px solid ${occupied ? color + "35" : "rgba(30,60,130,0.4)"}`,
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          transition: "all 0.55s",
          flexShrink: 0,
        }}
      >
        {Array.from({ length: 6 }).map((_, ki) => (
          <div
            key={ki}
            style={{
              width: ki === 2 ? 12 : 6,
              height: 5,
              background: occupied ? `${color}35` : "rgba(60,100,180,0.15)",
              borderRadius: 1.5,
              transition: "background 0.55s",
            }}
          />
        ))}
      </div>

      {/* Label */}
      <div
        style={{
          fontSize: 8, fontWeight: 800, letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: occupied ? color : "rgba(60,100,180,0.4)",
          transition: "color 0.55s",
          lineHeight: 1,
        }}
      >
        {occupied && agentName ? agentName.slice(0, 10) : "— IDLE —"}
      </div>
    </div>
  )
}

// ── Central meeting table ──────────────────────────────────────────────────────

function MeetingTable({ cx, cy }: { cx: number; cy: number }) {
  const R = 52
  return (
    <div
      style={{
        position: "absolute",
        left: cx - R, top: cy - R,
        width: R * 2, height: R * 2,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 40% 35%, #0f2248, #0a1830)",
        border: "3px solid #1e3a7a",
        boxShadow:
          "0 0 28px rgba(30,58,140,0.3), 0 4px 20px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      {/* Inner concentric ring */}
      <div
        style={{
          position: "absolute",
          inset: 9,
          borderRadius: "50%",
          border: "1.5px solid rgba(50,100,200,0.35)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 19,
          borderRadius: "50%",
          border: "1px solid rgba(50,100,200,0.18)",
        }}
      />
      <span style={{ fontSize: 18, lineHeight: 1, zIndex: 1 }}>📋</span>
      <span
        style={{
          fontSize: 7, fontWeight: 800, letterSpacing: "0.2em",
          color: "rgba(80,140,255,0.5)", textTransform: "uppercase", zIndex: 1,
        }}
      >
        BRIEFING
      </span>
    </div>
  )
}

// ── Corner station (reusable) ──────────────────────────────────────────────────

function CornerStation({
  left, right, bottom, icon, label, color = "#1a3268",
}: {
  left?: string; right?: string; bottom?: string; icon: string; label: string; color?: string
}) {
  return (
    <div
      style={{
        position: "absolute",
        left, right, bottom,
        width: 82, height: 62,
        background: "linear-gradient(145deg, #0e1d38, #091525)",
        border: `2px solid ${color}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        zIndex: 4,
        pointerEvents: "none",
        userSelect: "none",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span
        style={{
          fontSize: 7, fontWeight: 800, letterSpacing: "0.15em",
          color: "rgba(80,140,255,0.45)", textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  )
}

// ── Side decorations ───────────────────────────────────────────────────────────

function SideDecorations() {
  return (
    <>
      {/* Server rack — right wall */}
      <div
        style={{
          position: "absolute",
          right: "1.5%", top: `${WALL_H_PCT + 2}%`,
          width: 26, height: 68,
          background: "linear-gradient(180deg, #0a1830, #0e1e38)",
          border: "1.5px solid #1a3268",
          borderRadius: 5,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-evenly",
          padding: "4px 0",
          zIndex: 4, pointerEvents: "none",
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div
            key={i}
            style={{
              width: 12, height: 3,
              background: i % 3 === 0 ? "#22c55e" : i % 3 === 1 ? "#6366f1" : "#1a3268",
              borderRadius: 1.5,
            }}
            animate={i % 2 === 0 ? { opacity: [1, 0.4, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1.2 + i * 0.3, ease: "easeInOut" }}
          />
        ))}
      </div>

      {/* Plant — left mid */}
      <div
        style={{
          position: "absolute",
          left: "2%", top: "50%",
          fontSize: 22, zIndex: 4,
          pointerEvents: "none", userSelect: "none",
          opacity: 0.65,
        }}
      >
        🪴
      </div>

      {/* Corner stations */}
      <CornerStation left="2%" bottom="4%" icon="☕" label="Coffee" />
      <CornerStation left="50%" bottom="4%" icon="🛋️" label="Lounge" color="#1e2f60" />
      <CornerStation right="2%" bottom="4%" icon="🎮" label="Break" color="#1a2d5a" />
    </>
  )
}

// ── Agent Character ────────────────────────────────────────────────────────────

function AgentCharacter({
  agent, worldState, deskXPct, dims,
}: {
  agent: Agent; worldState: WorldState; deskXPct: number; dims: SceneDims
}) {
  const color = getAgentColor(agent)
  const [wander, setWander] = useState(randomWander)

  useEffect(() => {
    if (worldState !== "idle") return
    const id = setInterval(() => setWander(randomWander()), 3600 + Math.random() * 2400)
    return () => clearInterval(id)
  }, [worldState])

  const { xPct, yPct } = useMemo(() => {
    if (worldState === "offline")                               return { xPct: deskXPct, yPct: OFFLINE_Y_PCT }
    if (worldState === "working" || worldState === "processing") return { xPct: deskXPct, yPct: CHAR_DESK_Y_PCT }
    return wander
  }, [worldState, deskXPct, wander])

  const pos = useMemo(() => pctToPx(xPct, yPct, dims), [xPct, yPct, dims])

  const isWorking    = worldState === "working" || worldState === "processing"
  const isProcessing = worldState === "processing"
  const isOffline    = worldState === "offline"
  const isIdle       = worldState === "idle"

  return (
    <motion.div
      style={{
        position: "absolute",
        width: CHAR_W,
        zIndex: Math.round(yPct) + 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
      animate={{ x: pos.x, y: pos.y, opacity: isOffline ? 0 : 1 }}
      transition={{ type: "spring", stiffness: 42, damping: 17, mass: 1.1 }}
    >
      {/* Thinking dots */}
      <div style={{ height: 16, display: "flex", alignItems: "center", gap: 3 }}>
        {isProcessing && [0, 1, 2].map(i => (
          <motion.div
            key={i}
            style={{ width: 5, height: 5, borderRadius: "50%", background: color }}
            animate={{ y: [0, -6, 0], opacity: [0.3, 1, 0.3] }}
            transition={{ repeat: Infinity, duration: 0.58, delay: i * 0.13, ease: "easeInOut" }}
          />
        ))}
      </div>

      {/* Avatar with glow */}
      <motion.div
        style={{ position: "relative" }}
        animate={
          isProcessing ? { y: [0, -5, 0] }
          : isWorking  ? { y: [0, -2, 0] }
          : isIdle     ? { y: [0, -7, 0] }
          : {}
        }
        transition={
          !isOffline
            ? { repeat: Infinity, duration: isProcessing ? 0.65 : isWorking ? 1.8 : 3.6, ease: "easeInOut" }
            : undefined
        }
      >
        {/* Ambient glow behind avatar */}
        {!isOffline && (
          <motion.div
            style={{
              position: "absolute", inset: -10, borderRadius: "50%",
              background: `radial-gradient(circle, ${color}50 0%, transparent 65%)`,
            }}
            animate={isProcessing ? { opacity: [0.3, 1, 0.3], scale: [0.9, 1.15, 0.9] } : { opacity: 0.6 }}
            transition={isProcessing ? { repeat: Infinity, duration: 0.65, ease: "easeInOut" } : undefined}
          />
        )}

        {/* Avatar image */}
        <div style={{ filter: isOffline ? "grayscale(1) brightness(0.25)" : "none", transition: "filter 0.4s" }}>
          <AgentAvatar
            avatarPresetId={agent.avatarPresetId}
            emoji={agent.emoji}
            size="w-12 h-12"
          />
        </div>

        {/* Status dot */}
        {!isOffline && (
          <span
            style={{
              position: "absolute", bottom: 0, right: -1,
              width: 11, height: 11, borderRadius: "50%",
              border: "2px solid #091220",
              background: isProcessing ? color : isWorking ? "#22c55e" : "#475569",
              transition: "background 0.3s",
              boxShadow: isWorking ? `0 0 6px ${isProcessing ? color : "#22c55e"}` : "none",
            }}
          />
        )}
      </motion.div>

      {/* Laptop */}
      {isWorking && (
        <motion.span
          style={{ fontSize: 13, lineHeight: 1, marginTop: 2 }}
          animate={{ opacity: isProcessing ? [0.5, 1, 0.5] : 0.8 }}
          transition={isProcessing ? { repeat: Infinity, duration: 0.48 } : undefined}
        >
          💻
        </motion.span>
      )}

      {/* Name tag */}
      <div
        style={{
          marginTop: 4,
          padding: "2px 8px",
          borderRadius: 6,
          fontSize: 9, fontWeight: 700, letterSpacing: "0.03em",
          whiteSpace: "nowrap",
          maxWidth: 80,
          overflow: "hidden",
          textOverflow: "ellipsis",
          textAlign: "center",
          background: "rgba(6,10,24,0.88)",
          color: "rgba(255,255,255,0.92)",
          border: `1px solid ${color}55`,
          backdropFilter: "blur(6px)",
          boxShadow: `0 2px 12px rgba(0,0,0,0.5), 0 0 8px ${color}25`,
        }}
      >
        {agent.name}
      </div>

      {/* Floor shadow */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%", transform: "translateX(-50%)",
          width: 44, height: 8,
          background: `radial-gradient(ellipse, ${color}40 0%, transparent 70%)`,
          borderRadius: "50%",
          filter: "blur(3px)",
        }}
      />
    </motion.div>
  )
}

// ── Stats bar ──────────────────────────────────────────────────────────────────

function StatsBar({
  total, processing, working, idle,
}: {
  total: number; processing: number; working: number; idle: number
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-5">
        <span className="text-sm font-semibold text-foreground">
          {total} Agent{total !== 1 ? "s" : ""}
        </span>
        {processing > 0 && (
          <div className="flex items-center gap-1.5">
            <motion.span
              className="w-2 h-2 rounded-full bg-purple-500 inline-block"
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
              transition={{ repeat: Infinity, duration: 0.9 }}
            />
            <span className="text-xs text-muted-foreground">{processing} processing</span>
          </div>
        )}
        {working > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            <span className="text-xs text-muted-foreground">{working} at desk</span>
          </div>
        )}
        {idle > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-500 inline-block" />
            <span className="text-xs text-muted-foreground">{idle} wandering</span>
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-4">
        {[
          { color: "#a855f7", label: "Processing", pulse: true },
          { color: "#22c55e", label: "Working",    pulse: false },
          { color: "#64748b", label: "Idle",       pulse: false },
        ].map(({ color, label, pulse }) => (
          <div key={label} className="flex items-center gap-1.5">
            <motion.span
              className="w-1.5 h-1.5 rounded-full inline-block"
              style={{ background: color }}
              animate={pulse ? { scale: [1, 1.5, 1] } : {}}
              transition={pulse ? { repeat: Infinity, duration: 0.9 } : undefined}
            />
            <span className="text-[11px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function AgentWorldView() {
  const sceneRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<SceneDims>({ w: 900, h: SCENE_H })

  useEffect(() => {
    const obs = new ResizeObserver(es =>
      setDims({ w: es[0].contentRect.width, h: SCENE_H })
    )
    if (sceneRef.current) obs.observe(sceneRef.current)
    return () => obs.disconnect()
  }, [])

  const agents      = useAgentStore(s => s.agents)
  const feedEntries = useLiveFeedStore(s => s.entries)

  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())

  const updateProcessing = useCallback(() => {
    const cutoff = Date.now() - 20_000
    const ids = new Set<string>()
    for (const e of feedEntries) {
      if (new Date(e.timestamp).getTime() > cutoff) ids.add(e.agentId)
    }
    setProcessingIds(ids)
  }, [feedEntries])

  useEffect(() => { updateProcessing() }, [updateProcessing])
  useEffect(() => {
    const id = setInterval(updateProcessing, 5000)
    return () => clearInterval(id)
  }, [updateProcessing])

  const deskXPcts   = useMemo(() => getDeskXPcts(agents.length), [agents.length])
  const agentStates = useMemo(
    () => agents.map(a => getWorldState(a, processingIds)),
    [agents, processingIds]
  )

  const processingCount = agentStates.filter(s => s === "processing").length
  const workingCount    = agentStates.filter(s => s === "working" || s === "processing").length
  const idleCount       = agentStates.filter(s => s === "idle").length

  const meetingCx = dims.w * 0.5
  const meetingCy = dims.h * 0.65

  const theme = useThemeStore(s => s.theme)
  const isLight = theme === "light"

  return (
    <div
      className="relative w-full"
      style={{
        height: "calc(100vh - 104px)",
        minHeight: 500,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: isLight
          ? "0 0 0 1px rgba(100,140,200,0.35), 0 8px 40px rgba(80,120,200,0.12)"
          : "0 0 0 1px rgba(30,60,160,0.4), 0 0 40px rgba(0,0,255,0.05), 0 12px 60px rgba(0,0,0,0.8)",
      }}
    >
      {/* ── Stats bar — frosted overlay at top ── */}
      <div
        className="absolute top-0 left-0 right-0 z-10"
        style={{
          padding: "10px 16px",
          background: isLight
            ? "linear-gradient(180deg, rgba(220,232,245,0.96) 0%, rgba(220,232,245,0.65) 55%, transparent 100%)"
            : "linear-gradient(180deg, rgba(8,14,28,0.95) 0%, rgba(8,14,28,0.6) 60%, transparent 100%)",
          pointerEvents: "none",
        }}
      >
        <StatsBar
          total={agents.length}
          processing={processingCount}
          working={workingCount}
          idle={idleCount}
        />
      </div>

      {/* ── 3D canvas fills 100% of container ── */}
      <div ref={sceneRef} className="w-full h-full">
        <AgentWorld3D agents={agents} agentStates={agentStates as any} deskXPcts={deskXPcts} />
      </div>
    </div>
  )
}

