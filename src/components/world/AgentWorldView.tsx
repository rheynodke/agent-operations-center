import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import { motion } from "framer-motion"
import { useAgentStore, useLiveFeedStore, useThemeStore, useOpenWorldStore } from "@/stores"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import type { Agent, OpenWorldMaster } from "@/types"
import { AgentWorld3D } from "./AgentWorld3D"
import type * as React from "react"
import { api } from "@/lib/api"
import { computeAgentLevel } from "@/lib/agentLeveling"
import { chatApi, type GatewayMessage } from "@/lib/chat-api"
import { useNavigate } from "react-router-dom"

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
      {/* Right-side legend removed — the top pill bar already shows per-agent status dots,
          and the World toggle now occupies this space. */}
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

  const myAgents    = useAgentStore(s => s.agents)
  const feedEntries = useLiveFeedStore(s => s.entries)

  // World mode toggle: My World (own agents) vs Open World (all users' masters).
  const [worldMode, setWorldMode] = useState<"my" | "open">("my")
  const [openMasters, setOpenMasters] = useState<OpenWorldMaster[]>([])
  const [openLoading, setOpenLoading] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  // Refetch trigger — bumps when a master is provisioned/deleted anywhere.
  // The WS event `open-world:changed` calls useOpenWorldStore.bump(), which
  // changes lastChangeAt; this dep array refires the effect → live refetch
  // without polling. Initial fetch fires on `worldMode === 'open'` flip.
  const openWorldChangeAt = useOpenWorldStore(s => s.lastChangeAt)
  useEffect(() => {
    if (worldMode !== "open") return
    let cancelled = false
    // Show the loading pill only on the very first fetch — not on subsequent
    // refreshes triggered by spawn/delete events. Avoids a flicker every time
    // someone joins.
    if (openMasters.length === 0) setOpenLoading(true)
    setOpenError(null)
    api.getOpenWorldMasters()
      .then(({ masters }) => { if (!cancelled) setOpenMasters(masters) })
      .catch(err => { if (!cancelled) setOpenError(err?.message || "Failed to load Open World") })
      .finally(() => { if (!cancelled) setOpenLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldMode, openWorldChangeAt])

  // Map OpenWorldMaster → Agent so AgentWorld3D can render them unchanged.
  // Server-derived status drives the same idle/working/offline rendering as My World.
  const openWorldAgents = useMemo<Agent[]>(() => openMasters.map(m => {
    // server status → AgentStatus (used by getWorldState below)
    //   active → "active"  (renders as working)
    //   idle   → "idle"
    //   offline → "terminated" (renders as offline)
    const agentStatus: Agent["status"] =
      m.status === "active" ? "active" :
      m.status === "idle"   ? "idle"   :
      "terminated"
    return {
      id: m.id,
      name: m.name,
      emoji: "🤖",
      description: m.description || `Master agent of ${m.ownerDisplayName}`,
      status: agentStatus,
      type: "gateway",
      color: m.color,
      avatarPresetId: m.avatarPresetId,
      role: m.role,
      isMaster: true,
      provisionedBy: m.ownerUserId,
      lastActive: m.lastActiveAt,
      createdAt: m.provisionedAt || undefined,
      // Server now aggregates these per-master so leveling matches My World.
      sessionCount: m.sessionCount,
      totalTokens: m.totalTokens,
    }
  }), [openMasters])

  const agents = worldMode === "open" ? openWorldAgents : myAgents

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

  // ── Glassmorphism style helper ────────────────────────────────────────────
  const glass = useCallback((opts: { strong?: boolean; padded?: boolean } = {}) => {
    const { strong = false } = opts
    return {
      background: isLight
        ? `rgba(255, 255, 255, ${strong ? 0.72 : 0.55})`
        : `rgba(20, 22, 30, ${strong ? 0.72 : 0.55})`,
      backdropFilter: "blur(22px) saturate(180%)",
      WebkitBackdropFilter: "blur(22px) saturate(180%)",
      border: `1px solid ${isLight ? "rgba(255, 255, 255, 0.4)" : "rgba(255, 255, 255, 0.08)"}`,
      boxShadow: isLight
        ? "0 1px 0 rgba(255,255,255,0.6) inset, 0 8px 32px rgba(40, 60, 100, 0.12)"
        : "0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 32px rgba(0, 0, 0, 0.55)",
    } as React.CSSProperties
  }, [isLight])

  // ── Pill bar selection + chat popover state ───────────────────────────────
  type ChatBubble = { id: string; role: "user" | "assistant"; text: string; ts: number; pending?: boolean }
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState("")
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatSessionKey, setChatSessionKey] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatBubble[]>([])
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  )
  const selectedAgentState = useMemo<WorldState | null>(() => {
    if (!selectedAgentId) return null
    const idx = agents.findIndex(a => a.id === selectedAgentId)
    return idx >= 0 ? (agentStates[idx] as WorldState) : null
  }, [selectedAgentId, agents, agentStates])
  // Open World masters belong to other users → cannot send via this user's gateway.
  const isCrossTenant = useMemo(() => {
    if (!selectedAgent || worldMode !== "open") return false
    const m = openMasters.find(x => x.id === selectedAgent.id)
    return !!m && !m.isMine
  }, [selectedAgent, worldMode, openMasters])

  // Convert a raw GatewayMessage into a flat bubble (user/assistant text only).
  // Tool calls, thinking blocks, and system messages are filtered out for the
  // popover UX — Open Full Chat shows everything.
  const toBubble = useCallback((m: GatewayMessage, idx: number): ChatBubble | null => {
    if (m.role !== "user" && m.role !== "assistant") return null
    let text = ""
    if (typeof m.content === "string") text = m.content
    else if (Array.isArray(m.content)) {
      text = m.content
        .filter((b: { type?: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text || "")
        .join("\n")
    } else if (m.text) text = m.text
    if (!text.trim()) return null
    return {
      id: m.id || `m-${idx}-${m.timestamp || 0}`,
      role: m.role,
      text: text.trim(),
      ts: m.timestamp || Date.now(),
    }
  }, [])

  // Reset selection + chat when the agent list changes (e.g. mode toggle).
  useEffect(() => {
    setSelectedAgentId(null)
    setChatOpen(false)
    setChatDraft("")
    setChatError(null)
    setChatSessionKey(null)
    setChatMessages([])
  }, [worldMode])

  // Reset chat thread when switching agents.
  useEffect(() => {
    setChatSessionKey(null)
    setChatMessages([])
    setChatError(null)
  }, [selectedAgentId])

  // When chat is open + an own-agent is selected, ensure session exists and load history.
  useEffect(() => {
    if (!chatOpen || !selectedAgent || isCrossTenant) return
    let cancelled = false
    setChatHistoryLoading(true)
    setChatError(null)
    ;(async () => {
      try {
        const sessRes = await chatApi.createSession(selectedAgent.id)
        const key = sessRes.sessionKey || sessRes.key || sessRes.sessionId
        if (!key) throw new Error("No session key returned")
        if (cancelled) return
        setChatSessionKey(key)
        const histRes = await chatApi.getHistory(key, { maxChars: 40000 })
        if (cancelled) return
        const bubbles = (histRes.messages || [])
          .map(toBubble)
          .filter((b): b is ChatBubble => b != null)
        setChatMessages(bubbles)
      } catch (e) {
        if (!cancelled) setChatError((e as Error).message || "Failed to load chat")
      } finally {
        if (!cancelled) setChatHistoryLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [chatOpen, selectedAgent, isCrossTenant, toBubble])

  // Poll for new messages every 3s while chat is open with an active session.
  // Merge strategy: server history is truth, but ANY local bubble (id prefixed
  // with "local-") that hasn't yet appeared in server history is preserved so
  // the user's message stays on screen continuously — even after we've marked
  // the local bubble non-pending. Match by role+text within a 60s window.
  useEffect(() => {
    if (!chatOpen || !chatSessionKey || isCrossTenant) return
    const id = setInterval(async () => {
      try {
        const res = await chatApi.getHistory(chatSessionKey, { maxChars: 40000 })
        const bubbles = (res.messages || [])
          .map(toBubble)
          .filter((b): b is ChatBubble => b != null)
        setChatMessages(prev => {
          const localUnconfirmed = prev.filter(p =>
            p.id.startsWith("local-") &&
            !bubbles.some(b =>
              b.role === p.role &&
              b.text === p.text &&
              Math.abs((b.ts || 0) - p.ts) < 60_000
            )
          )
          // Preserve order: server bubbles first (chronological from server),
          // then any unconfirmed local bubbles appended at the end (newest).
          return [...bubbles, ...localUnconfirmed]
        })
      } catch { /* ignore transient poll errors */ }
    }, 3000)
    return () => clearInterval(id)
  }, [chatOpen, chatSessionKey, isCrossTenant, toBubble])

  // Auto-scroll to bottom when messages or send state changes.
  useEffect(() => {
    if (!chatScrollRef.current) return
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [chatMessages, chatSending, chatHistoryLoading])

  const handlePillClick = useCallback((agentId: string) => {
    setSelectedAgentId(prev => prev === agentId ? null : agentId)
    setChatError(null)
  }, [])

  const handleSendChat = useCallback(async () => {
    if (!selectedAgent || isCrossTenant || !chatDraft.trim()) return
    const text = chatDraft.trim()
    setChatSending(true)
    setChatError(null)
    // Optimistic local bubble
    const optimistic: ChatBubble = {
      id: `local-${Date.now()}`,
      role: "user",
      text,
      ts: Date.now(),
      pending: true,
    }
    setChatMessages(prev => [...prev, optimistic])
    setChatDraft("")
    try {
      let key = chatSessionKey
      if (!key) {
        const sessRes = await chatApi.createSession(selectedAgent.id)
        key = sessRes.sessionKey || sessRes.key || sessRes.sessionId || null
        if (!key) throw new Error("No session key returned")
        setChatSessionKey(key)
      }
      await chatApi.sendMessage(key, text, selectedAgent.id)
      // Mark optimistic bubble as confirmed; the next poll will replace it with server-truth.
      setChatMessages(prev => prev.map(m => m.id === optimistic.id ? { ...m, pending: false } : m))
    } catch (e) {
      setChatError((e as Error).message || "Failed to send")
      // Drop the optimistic bubble on error.
      setChatMessages(prev => prev.filter(m => m.id !== optimistic.id))
    } finally {
      setChatSending(false)
    }
  }, [selectedAgent, isCrossTenant, chatDraft, chatSessionKey])

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

      {/* ── Top control row: World toggle (right) — aligned with StatsBar row ── */}
      <div
        className="absolute z-20 flex items-center gap-2"
        style={{ top: 10, right: 14, pointerEvents: "auto" }}
      >
        <div
          className="flex items-center rounded-full"
          style={{ ...glass({ strong: true }), padding: 2 }}
        >
          {([
            { key: "my", label: "My World" },
            { key: "open", label: "Open World" },
          ] as const).map(opt => {
            const active = worldMode === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => setWorldMode(opt.key)}
                className="text-[11px] font-medium px-3 py-1 rounded-full transition-all"
                style={{
                  background: active ? "var(--primary)" : "transparent",
                  color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  boxShadow: active
                    ? "0 4px 14px rgba(124, 58, 237, 0.35), 0 1px 0 rgba(255,255,255,0.18) inset"
                    : "none",
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        {worldMode === "open" && (openLoading || openError) && (
          <div
            className="text-[10px] px-2 py-1 rounded-full"
            style={{
              ...glass({ strong: true }),
              color: openError ? "#fca5a5" : "var(--muted-foreground)",
            }}
          >
            {openError ? "Failed" : "Loading…"}
          </div>
        )}
      </div>

      {/* ── Top agent pill bar (glass, dense, with edge-fade for overflow) ── */}
      {agents.length > 0 && (
        <div
          className="absolute z-15 flex justify-center"
          style={{ top: 46, left: 0, right: 0, pointerEvents: "auto" }}
        >
          <div
            className="relative rounded-full"
            style={{
              ...glass({ strong: true }),
              padding: 4,
              maxWidth: "min(78%, 920px)",
            }}
          >
            {/* edge-fade masks for horizontal overflow (purely cosmetic, pointer-events none) */}
            <div
              className="absolute top-0 bottom-0 left-0 rounded-l-full pointer-events-none"
              style={{
                width: 24,
                background: `linear-gradient(90deg, ${isLight ? "rgba(255,255,255,0.6)" : "rgba(20,22,30,0.6)"} 0%, transparent 100%)`,
                zIndex: 1,
              }}
            />
            <div
              className="absolute top-0 bottom-0 right-0 rounded-r-full pointer-events-none"
              style={{
                width: 24,
                background: `linear-gradient(270deg, ${isLight ? "rgba(255,255,255,0.6)" : "rgba(20,22,30,0.6)"} 0%, transparent 100%)`,
                zIndex: 1,
              }}
            />
            <div
              className="flex items-center gap-1 overflow-x-auto"
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
                paddingLeft: 6,
                paddingRight: 6,
              }}
            >
              {agents.map((a, i) => {
                const ws = agentStates[i]
                // Status tick: green = online (working/idle), yellow = processing, red = offline.
                // Idle is "online but not working" — we still treat it as green online.
                const dotColor =
                  ws === "processing" ? "#facc15" :        // yellow
                  ws === "offline"    ? "#ef4444" :        // red
                  "#22c55e"                                 // green (working + idle)
                const isSelected = a.id === selectedAgentId
                return (
                  <button
                    key={a.id}
                    onClick={() => handlePillClick(a.id)}
                    className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-all"
                    style={{
                      background: isSelected
                        ? "var(--primary)"
                        : (isLight ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.06)"),
                      color: isSelected ? "var(--primary-foreground)" : "var(--foreground)",
                      border: isSelected
                        ? "1px solid rgba(255,255,255,0.2)"
                        : `1px solid ${isLight ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.06)"}`,
                      boxShadow: isSelected
                        ? "0 4px 14px rgba(124, 58, 237, 0.35), 0 1px 0 rgba(255,255,255,0.18) inset"
                        : "0 1px 0 rgba(255,255,255,0.08) inset",
                      flex: "0 0 auto",
                      maxWidth: 140,
                    }}
                    title={a.description || a.name}
                  >
                    {/* Avatar bubble with status-coloured outer ring (pulses on processing) */}
                    <span
                      className={`relative flex items-center justify-center rounded-full shrink-0 ${ws === "processing" ? "animate-pulse" : ""}`}
                      style={{
                        width: 18, height: 18,
                        background: dotColor,
                        padding: 1,
                        boxShadow: `0 0 4px ${dotColor}`,
                      }}
                    >
                      <span className="rounded-full overflow-hidden flex items-center justify-center" style={{ width: 16, height: 16, background: a.color || "var(--muted)" }}>
                        <AgentAvatar avatarPresetId={a.avatarPresetId} emoji={a.emoji} size="w-4 h-4" />
                      </span>
                    </span>
                    <span className="truncate">{a.name}</span>
                    {/* Level pill — tier-coloured (consistent across selected + idle) */}
                    {(() => {
                      const lvl = computeAgentLevel(a)
                      const lighten = (hex: string): string => {
                        const m = hex.replace('#', '')
                        const lc = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.35))
                        const r = lc(parseInt(m.slice(0, 2), 16))
                        const g = lc(parseInt(m.slice(2, 4), 16))
                        const b = lc(parseInt(m.slice(4, 6), 16))
                        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
                      }
                      const grad = `linear-gradient(135deg, ${lighten(lvl.tier.color)} 0%, ${lvl.tier.color} 100%)`
                      return (
                        <span
                          className="text-[9px] font-extrabold rounded-full shrink-0"
                          style={{
                            padding: "1px 5px",
                            background: grad,
                            color: "#0f0a1a",
                            letterSpacing: 0.4,
                            // Inset highlight + ring so the badge stays legible against
                            // the primary-coloured chip background when selected.
                            boxShadow: isSelected
                              ? "0 0 0 1.5px rgba(255,255,255,0.5), 0 0 0 1px rgba(255,255,255,0.25) inset"
                              : "0 0 0 1px rgba(255,255,255,0.18) inset",
                          }}
                          title={`${lvl.tier.label} · L${lvl.level}`}
                        >
                          L{lvl.level}
                        </span>
                      )
                    })()}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 3D canvas fills 100% of container ── */}
      <div ref={sceneRef} className="w-full h-full">
        <AgentWorld3D
          agents={agents}
          agentStates={agentStates as any}
          deskXPcts={deskXPcts}
          selectedAgentId={selectedAgentId}
        />
      </div>

      {/* ── Floating CHAT button (glass + primary glow) ── */}
      <button
        onClick={() => setChatOpen(o => !o)}
        className="absolute bottom-6 right-6 z-30 flex items-center gap-2 px-5 py-3 rounded-full text-xs font-semibold tracking-wide transition-transform hover:scale-105"
        style={{
          background: chatOpen
            ? (isLight ? "rgba(255,255,255,0.72)" : "rgba(20,22,30,0.72)")
            : "var(--primary)",
          color: chatOpen ? "var(--foreground)" : "var(--primary-foreground)",
          backdropFilter: chatOpen ? "blur(22px) saturate(180%)" : undefined,
          WebkitBackdropFilter: chatOpen ? "blur(22px) saturate(180%)" : undefined,
          border: `1px solid ${chatOpen
            ? (isLight ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.08)")
            : "rgba(255,255,255,0.18)"}`,
          boxShadow: chatOpen
            ? "0 8px 32px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.1) inset"
            : "0 8px 32px rgba(124, 58, 237, 0.45), 0 1px 0 rgba(255,255,255,0.2) inset",
          pointerEvents: "auto",
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "currentColor",
          opacity: 0.85,
          boxShadow: "0 0 6px currentColor",
        }} />
        {chatOpen ? "CLOSE CHAT" : "CHAT"}
      </button>

      {/* ── Floating bubble chat popover (glass) ── */}
      {chatOpen && (
        <div
          className="absolute bottom-24 right-6 z-30 rounded-2xl overflow-hidden flex flex-col"
          style={{
            width: 380,
            height: 520,
            ...glass({ strong: true }),
            // override box-shadow with deeper drop for popover
            boxShadow: isLight
              ? "0 1px 0 rgba(255,255,255,0.6) inset, 0 24px 64px rgba(40, 60, 100, 0.22)"
              : "0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 64px rgba(0, 0, 0, 0.7)",
            pointerEvents: "auto",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: `1px solid ${isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"}` }}
          >
            {selectedAgent ? (
              <>
                <div
                  className="rounded-full flex items-center justify-center overflow-hidden shrink-0"
                  style={{
                    width: 38, height: 38,
                    background: selectedAgent.color || "var(--primary)",
                    boxShadow: "0 0 0 2px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.25)",
                  }}
                >
                  <AgentAvatar
                    avatarPresetId={selectedAgent.avatarPresetId}
                    emoji={selectedAgent.emoji}
                    size="w-9 h-9"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
                    {selectedAgent.name}
                  </div>
                  {(() => {
                    // Map worldState → tick color + label.
                    const ws = selectedAgentState
                    const tick =
                      ws === "processing" ? { color: "#facc15", label: "Processing", pulse: true } :
                      ws === "offline"    ? { color: "#ef4444", label: "Offline",    pulse: false } :
                      ws === "working"    ? { color: "#22c55e", label: "Online",     pulse: false } :
                      ws === "idle"       ? { color: "#22c55e", label: "Online · idle", pulse: false } :
                                            { color: "#94a3b8", label: "—",          pulse: false }
                    return (
                      <div className="flex items-center gap-1.5 text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>
                        <span
                          className={`inline-block rounded-full ${tick.pulse ? "animate-pulse" : ""}`}
                          style={{
                            width: 8, height: 8,
                            background: tick.color,
                            boxShadow: `0 0 6px ${tick.color}`,
                          }}
                        />
                        <span>{selectedAgent.role || "Agent"} · {tick.label}</span>
                      </div>
                    )
                  })()}
                </div>
              </>
            ) : (
              <div className="text-sm flex-1" style={{ color: "var(--muted-foreground)" }}>
                Pick an agent from the top bar to start chatting
              </div>
            )}
            <button
              onClick={() => setChatOpen(false)}
              className="text-base rounded-full hover:bg-white/10"
              style={{ color: "var(--muted-foreground)", width: 28, height: 28, lineHeight: "28px", textAlign: "center" }}
              aria-label="Close chat"
            >✕</button>
          </div>

          {/* Body */}
          {selectedAgent ? (
            <>
              {/* Cross-tenant banner (Open World other-user master) */}
              {isCrossTenant && (
                <div
                  className="text-[11px] px-3 py-2 mx-3 mt-3 rounded-lg"
                  style={{
                    background: isLight ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.14)",
                    color: isLight ? "#b45309" : "#fcd34d",
                    border: `1px solid ${isLight ? "rgba(245, 158, 11, 0.35)" : "rgba(245, 158, 11, 0.28)"}`,
                  }}
                >
                  View only — this is another user's master agent. Cross-tenant messaging is coming soon.
                </div>
              )}

              {/* Messages */}
              <div
                ref={chatScrollRef}
                className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2"
              >
                {chatHistoryLoading && chatMessages.length === 0 && (
                  <div className="text-[11px] text-center py-4" style={{ color: "var(--muted-foreground)" }}>
                    Loading conversation…
                  </div>
                )}
                {!chatHistoryLoading && chatMessages.length === 0 && !isCrossTenant && (
                  <div className="text-[11px] text-center py-4" style={{ color: "var(--muted-foreground)" }}>
                    No messages yet. Say hi 👋
                  </div>
                )}
                {chatMessages.map(m => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className="rounded-2xl px-3 py-2 text-xs leading-relaxed"
                      style={{
                        maxWidth: "78%",
                        background: m.role === "user"
                          ? "var(--primary)"
                          : (isLight ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.06)"),
                        color: m.role === "user"
                          ? "var(--primary-foreground)"
                          : "var(--foreground)",
                        border: m.role === "user"
                          ? "1px solid rgba(255,255,255,0.18)"
                          : `1px solid ${isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"}`,
                        borderBottomRightRadius: m.role === "user" ? 6 : 18,
                        borderBottomLeftRadius:  m.role === "user" ? 18 : 6,
                        boxShadow: m.role === "user"
                          ? "0 4px 14px rgba(124, 58, 237, 0.25), 0 1px 0 rgba(255,255,255,0.18) inset"
                          : "0 1px 0 rgba(255,255,255,0.08) inset",
                        opacity: m.pending ? 0.7 : 1,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {chatError && (
                  <div className="text-[11px] text-center py-2" style={{ color: "#ef4444" }}>
                    {chatError}
                  </div>
                )}
              </div>

              {/* Composer */}
              {!isCrossTenant && (
                <div
                  className="px-3 py-3 flex items-end gap-2"
                  style={{ borderTop: `1px solid ${isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"}` }}
                >
                  <textarea
                    value={chatDraft}
                    onChange={e => setChatDraft(e.target.value)}
                    placeholder={`Message ${selectedAgent.name}…`}
                    rows={1}
                    disabled={chatSending}
                    className="flex-1 resize-none rounded-2xl text-xs px-3 py-2"
                    style={{
                      background: isLight ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.05)",
                      color: "var(--foreground)",
                      border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
                      outline: "none",
                      maxHeight: 100,
                      minHeight: 36,
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleSendChat()
                      }
                    }}
                  />
                  <button
                    onClick={handleSendChat}
                    disabled={chatSending || !chatDraft.trim()}
                    className="text-xs font-medium px-3 py-2 rounded-full transition-all"
                    style={{
                      background: chatSending || !chatDraft.trim()
                        ? (isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)")
                        : "var(--primary)",
                      color: chatSending || !chatDraft.trim()
                        ? "var(--muted-foreground)"
                        : "var(--primary-foreground)",
                      cursor: chatSending || !chatDraft.trim() ? "not-allowed" : "pointer",
                      boxShadow: chatSending || !chatDraft.trim()
                        ? "none"
                        : "0 4px 14px rgba(124, 58, 237, 0.35), 0 1px 0 rgba(255,255,255,0.18) inset",
                      minWidth: 56,
                    }}
                  >
                    {chatSending ? "…" : "Send"}
                  </button>
                </div>
              )}

              {/* Footer link */}
              <div
                className="px-4 py-2 text-[10px] flex justify-end"
                style={{
                  borderTop: `1px solid ${isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)"}`,
                  color: "var(--muted-foreground)",
                }}
              >
                <button
                  onClick={() => navigate(`/chat?agent=${encodeURIComponent(selectedAgent.id)}`)}
                  className="hover:underline"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Open full chat →
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center px-6 text-center text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Click an agent chip at the top to open their thread.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

