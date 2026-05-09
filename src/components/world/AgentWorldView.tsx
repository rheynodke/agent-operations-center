import { useEffect, useRef, useState, useMemo, useCallback, type ReactNode } from "react"
import { motion } from "framer-motion"
import { useAgentStore, useLiveFeedStore, useThemeStore, useOpenWorldStore, useFeedbackStore } from "@/stores"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import type { Agent, OpenWorldMaster } from "@/types"
import { AgentWorld3D } from "./AgentWorld3D"
import type * as React from "react"
import { api } from "@/lib/api"
import { computeAgentLevel } from "@/lib/agentLeveling"
import { chatApi, type ChatOutputFile } from "@/lib/chat-api"
import { useChatStore, gatewayMessagesToGroups, isSystemInjectedUserMessage, type ChatMessageGroup } from "@/stores/useChatStore"
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer"
import { FeedbackThumbs } from "@/components/feedback/FeedbackThumbs"
import { useNavigate } from "react-router-dom"

// ── Floating-pill chat session persistence ────────────────────────────────────
// We persist the resolved sessionKey per agent so reopening the pill always
// continues the same conversation, even when:
//   - a heartbeat run created a fresher session for the same agent (its
//     `updatedAt` would otherwise win the "latest" sort), or
//   - any other side process bumped a non-DM session.
// Cleared explicitly by the user via the pill's "reset" button.
const PILL_SESSION_LS_KEY = (agentId: string) => `aw:pillChatSession:${agentId}`
function loadPinnedSessionKey(agentId: string): string | null {
  try { return localStorage.getItem(PILL_SESSION_LS_KEY(agentId)) } catch { return null }
}
function savePinnedSessionKey(agentId: string, key: string) {
  try { localStorage.setItem(PILL_SESSION_LS_KEY(agentId), key) } catch { /* quota / privacy mode */ }
}
function clearPinnedSessionKey(agentId: string) {
  try { localStorage.removeItem(PILL_SESSION_LS_KEY(agentId)) } catch { /* ignore */ }
}
// Heartbeat session keys end with ":heartbeat" (e.g. `agent:migi:main:heartbeat`).
// Heartbeat runs every minute or so → updatedAt is nearly always the freshest,
// which is why the previous "pick latest" policy kept overwriting the user's
// real conversation.
function isHeartbeatSessionKey(key: string): boolean {
  return /:heartbeat$/.test(key)
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Outputs the chat panel knows how to render inline. Anything else (.pdf,
// .xlsx, .docx, images, archives, …) is download-only — the iframe-in-pill
// trick we'd need for those formats would either require external viewers,
// untrusted blob URLs, or office-suite plugins, none of which fit here.
type PreviewKind = "markdown" | "html" | "json" | "csv" | "text"
function classifyForPreview(ext: string): PreviewKind | null {
  switch (ext.toLowerCase()) {
    case ".md":
    case ".markdown":
      return "markdown"
    case ".html":
    case ".htm":
      return "html"
    case ".json":
      return "json"
    case ".csv":
      return "csv"
    case ".txt":
    case ".log":
      return "text"
    default:
      return null
  }
}
// Hard cap on inline preview size so a 50 MB CSV doesn't lock the panel.
const PREVIEW_MAX_BYTES = 512 * 1024
// Cap row count for CSV preview — wider tables stay readable; deeper ones
// are cropped with a "first N rows shown" notice.
const CSV_PREVIEW_MAX_ROWS = 200

// Tiny CSV parser tolerant of double-quoted cells with embedded commas /
// newlines. Doesn't try to be RFC-perfect — just enough to render an agent's
// machine-emitted CSV without surprises. Returns rows of strings.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let cell = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else inQuotes = false
      } else cell += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ",") { cur.push(cell); cell = "" }
      else if (ch === "\n") { cur.push(cell); rows.push(cur); cur = []; cell = "" }
      else if (ch === "\r") { /* ignore — newline normalisation */ }
      else cell += ch
    }
  }
  if (cell.length > 0 || cur.length > 0) { cur.push(cell); rows.push(cur) }
  return rows
}

// ── Pill ↔ side-panel layout toggle ──────────────────────────────────────────
// "pill" = the original 380×520 floating popover at bottom-right.
// "panel" = a full-height right-side dock with a draggable left edge so the
// user can give chat more horizontal room (great for tables / code blocks).
// Both choices persist across sessions; resetting localStorage falls back to
// the original pill layout.
type ChatLayout = "pill" | "panel"
const CHAT_LAYOUT_LS_KEY = "aw:chatLayout"
const CHAT_PANEL_WIDTH_LS_KEY = "aw:chatPanelWidth"
const PANEL_MIN_WIDTH = 320
const PANEL_DEFAULT_WIDTH = 460
function loadChatLayout(): ChatLayout {
  try { return (localStorage.getItem(CHAT_LAYOUT_LS_KEY) as ChatLayout) === "panel" ? "panel" : "pill" }
  catch { return "pill" }
}
function saveChatLayout(v: ChatLayout) {
  try { localStorage.setItem(CHAT_LAYOUT_LS_KEY, v) } catch { /* ignore */ }
}
function loadPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(CHAT_PANEL_WIDTH_LS_KEY))
    if (Number.isFinite(raw) && raw >= PANEL_MIN_WIDTH) return raw
  } catch { /* ignore */ }
  return PANEL_DEFAULT_WIDTH
}
function savePanelWidth(px: number) {
  try { localStorage.setItem(CHAT_PANEL_WIDTH_LS_KEY, String(Math.round(px))) } catch { /* ignore */ }
}

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
  // Bubble shape used by the floating pill chat. Built from the shared
  // `useChatStore.messages[sessionKey]` so the WebSocket gateway events that
  // power ChatPage also drive realtime updates here — no polling, no local
  // truth that drifts from the canonical store.
  type ChatBubble = { id: string; role: "user" | "assistant"; text: string; ts: number; pending?: boolean }
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState("")
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatSessionKey, setChatSessionKey] = useState<string | null>(null)
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Tabbed surface inside the chat panel: "chat" (the message thread) and
  // "outputs" (artifacts produced during this session, surfaced from the
  // server's `/api/chat/outputs` endpoint).
  const [chatTab, setChatTab] = useState<"chat" | "outputs">("chat")
  const [outputs, setOutputs] = useState<ChatOutputFile[]>([])
  const [outputsLoading, setOutputsLoading] = useState(false)
  const [outputsError, setOutputsError] = useState<string | null>(null)
  const [outputsTruncated, setOutputsTruncated] = useState(false)

  // Inline preview state. `preview.file` is the entry being previewed; the
  // content is fetched as text on demand (binary types never reach this
  // path — they get download-only treatment).
  const [preview, setPreview] = useState<
    | { file: ChatOutputFile; kind: PreviewKind; content: string; truncated: boolean }
    | null
  >(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const navigate = useNavigate()

  // Layout toggle (pill vs side-panel) + draggable panel width. Both persist
  // across reloads via localStorage helpers above.
  const [chatLayout, setChatLayout] = useState<ChatLayout>(() => loadChatLayout())
  const [panelWidth, setPanelWidth] = useState<number>(() => loadPanelWidth())
  const [panelDragging, setPanelDragging] = useState(false)
  // Re-clamp on viewport resize so the panel never exceeds 70% of the window
  // (a desktop user might shrink their window after dragging).
  useEffect(() => {
    if (chatLayout !== "panel") return
    const onResize = () => {
      setPanelWidth((w) => {
        const max = Math.max(PANEL_MIN_WIDTH, Math.floor(window.innerWidth * 0.7))
        return Math.min(w, max)
      })
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [chatLayout])

  // Drag handle on the panel's LEFT edge: mousedown sets dragging=true, then
  // window-level mousemove updates width = (viewport.right - clientX). We use
  // window listeners (not the handle's own onMouseMove) so the drag doesn't
  // get lost when the cursor outruns the 4px-wide handle.
  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setPanelDragging(true)
  }, [])
  useEffect(() => {
    if (!panelDragging) return
    const onMove = (ev: MouseEvent) => {
      const max = Math.max(PANEL_MIN_WIDTH, Math.floor(window.innerWidth * 0.7))
      const next = Math.min(max, Math.max(PANEL_MIN_WIDTH, window.innerWidth - ev.clientX))
      setPanelWidth(next)
    }
    const onUp = () => {
      setPanelDragging(false)
      // Persist on release (don't thrash localStorage during the drag).
      setPanelWidth((w) => { savePanelWidth(w); return w })
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    // Lock the cursor + suppress text selection while dragging.
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = "ew-resize"
    document.body.style.userSelect = "none"
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
    }
  }, [panelDragging])

  const toggleChatLayout = useCallback(() => {
    setChatLayout((prev) => {
      const next: ChatLayout = prev === "pill" ? "panel" : "pill"
      saveChatLayout(next)
      return next
    })
  }, [])

  // Subscribe to the shared chat store. The WebSocket handler in
  // `useWebSocket.ts` writes gateway events into `messages[sessionKey]` —
  // selecting it here gives us realtime user echo + agent streaming updates
  // for free, with the same dedup behavior as the full ChatPage.
  const storeMessagesAll = useChatStore((s) => s.messages)
  const storeGroups: ChatMessageGroup[] = useMemo(
    () => (chatSessionKey ? (storeMessagesAll[chatSessionKey] ?? []) : []),
    [chatSessionKey, storeMessagesAll],
  )
  const isAgentRunning = useChatStore((s) => (chatSessionKey ? !!s.agentRunning[chatSessionKey] : false))

  // Project rich `ChatMessageGroup`s down to flat bubbles for the pill UI.
  // Skip system-injected metadata frames (e.g. "Conversation info" envelopes)
  // — those are noise for the lightweight floating chat. The Open Full Chat
  // route still sees everything via ChatPage.
  const chatMessages: ChatBubble[] = useMemo(() => {
    const out: ChatBubble[] = []
    for (const g of storeGroups) {
      if (g.role === "user") {
        const text = (g.userText || "").trim()
        if (!text) continue
        if (isSystemInjectedUserMessage(text)) continue
        out.push({
          id: g.id,
          role: "user",
          text,
          ts: g.timestamp || Date.now(),
          pending: g.isStreaming === true && !g.responseDone,
        })
      } else if (g.role === "agent") {
        const text = (g.responseText || "").trim()
        // Show the agent bubble as soon as the placeholder is appended so the
        // user sees something happening (otherwise the pill chat looks dead
        // for the entire thinking/tool phase, which can be 5-30s on real
        // sessions). Once `responseText` streams in, this bubble's text is
        // updated in place by the WS handler — same group id, no re-mount,
        // no flicker. Skip only if the run is FULLY DONE with no text (a
        // legitimate empty assistant turn, e.g. tool-only) so we don't leave
        // a permanent ellipsis bubble in history.
        const isStreamingPlaceholder = g.isStreaming === true && !g.responseDone
        if (!text && !isStreamingPlaceholder) continue
        out.push({
          id: g.id,
          role: "assistant",
          text: text || "…",
          ts: g.timestamp || Date.now(),
          pending: isStreamingPlaceholder,
        })
      }
    }
    return out
  }, [storeGroups])

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

  // Reset selection + chat when the agent list changes (e.g. mode toggle).
  // We only reset the local UI scaffolding here — the shared chat store keeps
  // history per sessionKey, so reopening the same agent later reuses the live
  // gateway-fed messages with no flicker.
  useEffect(() => {
    setSelectedAgentId(null)
    setChatOpen(false)
    setChatDraft("")
    setChatError(null)
    setChatSessionKey(null)
  }, [worldMode])

  // Reset session key when switching agents — the new agent's session will be
  // resolved on chat open.
  useEffect(() => {
    setChatSessionKey(null)
    setChatError(null)
  }, [selectedAgentId])

  // Hydrate feedback ratings for the resolved pill session so <FeedbackThumbs>
  // shows existing 👍/👎 state. Deduped + cached by useFeedbackStore.
  const loadFeedbackForSession = useFeedbackStore((s) => s.loadForSession)
  useEffect(() => {
    if (chatSessionKey) void loadFeedbackForSession(chatSessionKey)
  }, [chatSessionKey, loadFeedbackForSession])

  // When chat is open + an own-agent is selected, resolve a session key for
  // the floating chat. Resolution order ("stay on this conversation" policy):
  //   1. Pinned: read `localStorage[PILL_SESSION_LS_KEY(agentId)]`. If that
  //      key still exists in the agent's session list AND isn't a heartbeat
  //      session, reuse it. This is the path taken on every reopen so the
  //      pill never silently switches to a heartbeat-bumped session or any
  //      other "freshest by updatedAt" winner.
  //   2. Latest non-heartbeat DM: filter heartbeat keys out of the list, pick
  //      the freshest remaining. Used the first time we see this agent, or
  //      after the user explicitly resets.
  //   3. Create new: only when (1) and (2) yield nothing.
  // Whichever branch wins, the resolved key is written back to localStorage
  // so subsequent opens skip straight to (1).
  useEffect(() => {
    if (!chatOpen || !selectedAgent || isCrossTenant) return
    let cancelled = false
    setChatHistoryLoading(true)
    setChatError(null)
    ;(async () => {
      try {
        let key: string | null = null
        const pinned = loadPinnedSessionKey(selectedAgent.id)
        let serverKeys: Set<string> | null = null
        try {
          const listRes = await chatApi.getSessions(selectedAgent.id)
          const dmSessions = (listRes.sessions || [])
            .filter((s) => {
              const sAgentId = s.agentId
              if (sAgentId && sAgentId !== selectedAgent.id) return false
              const sKey = s.sessionKey || s.key || ""
              return !!sKey && !isHeartbeatSessionKey(sKey)
            })
          serverKeys = new Set(dmSessions.map((s) => s.sessionKey || s.key || ""))
          // 1. Pinned key still valid?
          if (pinned && serverKeys.has(pinned) && !isHeartbeatSessionKey(pinned)) {
            key = pinned
          } else {
            // 2. Latest non-heartbeat DM.
            dmSessions.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
            const fresh = dmSessions[0]
            if (fresh) key = fresh.sessionKey || fresh.key || null
          }
        } catch {
          // List failure is non-fatal. If a pinned key exists from a prior
          // successful session, trust it — gateway will reject if truly gone.
          if (pinned && !isHeartbeatSessionKey(pinned)) key = pinned
        }
        // 3. Nothing found → create.
        if (!key) {
          const sessRes = await chatApi.createSession(selectedAgent.id)
          key = sessRes.sessionKey || sessRes.key || sessRes.sessionId || null
          if (!key) throw new Error("No session key returned")
        }
        if (cancelled) return
        setChatSessionKey(key)
        savePinnedSessionKey(selectedAgent.id, key)
        // Subscribe so the gateway-ws starts streaming events for this key.
        // Idempotent on the server side.
        chatApi.subscribe(key).catch(() => {})
        // Only load history from API if the store doesn't already have it —
        // otherwise we'd race with live WS updates and clobber streaming
        // bubbles. The full ChatPage uses the same gating pattern.
        const existing = useChatStore.getState().messages[key]
        if (!existing || existing.length === 0) {
          const histRes = await chatApi.getHistory(key, { maxChars: 40000 })
          if (cancelled) return
          const groups = gatewayMessagesToGroups(histRes.messages || [])
          useChatStore.getState().setMessages(key, groups)
        }
      } catch (e) {
        if (!cancelled) setChatError((e as Error).message || "Failed to load chat")
      } finally {
        if (!cancelled) setChatHistoryLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [chatOpen, selectedAgent, isCrossTenant])

  // Auto-scroll to bottom when messages or send state changes.
  useEffect(() => {
    if (!chatScrollRef.current) return
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [chatMessages, chatSending, chatHistoryLoading])

  const handlePillClick = useCallback((agentId: string) => {
    setSelectedAgentId(prev => prev === agentId ? null : agentId)
    setChatError(null)
  }, [])

  // Fetch the artifact list for the active session. Cheap to call — server
  // walks `<workspace>/outputs/` (capped at 200 files) plus any legacy
  // top-level dir an older agent run might have used. We expose this both
  // for tab opening and for the post-run auto-refresh below.
  const refreshOutputs = useCallback(async () => {
    if (!chatSessionKey) { setOutputs([]); return }
    setOutputsLoading(true)
    setOutputsError(null)
    try {
      const res = await chatApi.getOutputs(chatSessionKey)
      setOutputs(res.files || [])
      setOutputsTruncated(!!res.truncated)
    } catch (e) {
      setOutputsError((e as Error).message || "Failed to load outputs")
    } finally {
      setOutputsLoading(false)
    }
  }, [chatSessionKey])

  // Auto-fetch when the user opens the Outputs tab AND when the session key
  // changes (different session = different artifact set). Don't poll — we
  // refresh again on agent-done below, which covers the "agent just wrote a
  // file" case without a constant-polling tax.
  useEffect(() => {
    if (chatTab !== "outputs") return
    refreshOutputs()
  }, [chatTab, chatSessionKey, refreshOutputs])

  // Drop any open preview when switching tabs or sessions — stale content
  // would otherwise hang there until the user manually closed it.
  useEffect(() => {
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }, [chatTab, chatSessionKey])

  // Refresh outputs when the agent just FINISHED a turn — that's when new
  // artifacts typically land on disk. Tracks the running→idle transition so
  // we don't re-fetch on every isAgentRunning toggle.
  const wasAgentRunning = useRef(false)
  useEffect(() => {
    const prev = wasAgentRunning.current
    wasAgentRunning.current = isAgentRunning
    if (prev && !isAgentRunning && chatTab === "outputs") {
      // Slight delay so the file system has settled (some agents write the
      // file as one of the last steps, after the lifecycle event).
      const t = setTimeout(refreshOutputs, 1200)
      return () => clearTimeout(t)
    }
  }, [isAgentRunning, chatTab, refreshOutputs])

  // Trigger a real file download via a temporary `<a download>`. Bearer-
  // authed fetch first → object URL → click → revoke. Avoids leaking the
  // JWT into the browser URL bar.
  const downloadOutput = useCallback(async (file: ChatOutputFile) => {
    if (!chatSessionKey) return
    setOutputsError(null)
    try {
      const blob = await chatApi.fetchOutputBlob(chatSessionKey, file.relPath)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setOutputsError((e as Error).message || "Failed to download file")
    }
  }, [chatSessionKey])

  // Open an inline preview for text-y formats (md, json, csv, txt, log).
  // HTML is special-cased: the chat panel/pill is too narrow to render a
  // designed page comfortably, so we pop HTML out into a real browser tab
  // (the file streams from the server with the actual `text/html` MIME, so
  // the browser renders it natively). Binary formats — pdf, xlsx, docx,
  // images — never reach this path; the row hides the Preview button and
  // the row click falls back to download.
  const previewOutput = useCallback(async (file: ChatOutputFile) => {
    if (!chatSessionKey) return
    const kind = classifyForPreview(file.ext)
    if (!kind) { void downloadOutput(file); return }
    setOutputsError(null)

    // HTML → fetch with auth, hand to a new tab via blob URL. Avoids leaking
    // the bearer token in the address bar AND respects the file's real
    // content-type so the page renders instead of being treated as text.
    if (kind === "html") {
      try {
        const blob = await chatApi.fetchOutputBlob(chatSessionKey, file.relPath)
        // Force `text/html` even if the server returned octet-stream for
        // some pathological MIME mapping; otherwise the new tab would
        // download instead of render.
        const htmlBlob = blob.type.startsWith("text/html") ? blob : new Blob([blob], { type: "text/html" })
        const url = URL.createObjectURL(htmlBlob)
        // `noopener` so the popped page can't reach back into our window.
        const win = window.open(url, "_blank", "noopener,noreferrer")
        // If popup was blocked, fall back to inline iframe rather than
        // silently failing — better degraded UX than nothing.
        if (!win) {
          URL.revokeObjectURL(url)
          setPreview(null)
          setPreviewLoading(true)
          try {
            const text = await htmlBlob.text()
            setPreview({ file, kind: "html", content: text, truncated: blob.size > PREVIEW_MAX_BYTES })
          } finally {
            setPreviewLoading(false)
          }
          return
        }
        // Revoke after the new tab has had time to load — same TTL we use
        // for downloads. Browser keeps the doc once it's parsed.
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } catch (e) {
        setOutputsError((e as Error).message || "Failed to open HTML preview")
      }
      return
    }

    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(true)
    try {
      const blob = await chatApi.fetchOutputBlob(chatSessionKey, file.relPath)
      // Cap text we read so a runaway file can't pin the main thread.
      const sliced = blob.size > PREVIEW_MAX_BYTES ? blob.slice(0, PREVIEW_MAX_BYTES) : blob
      const text = await sliced.text()
      setPreview({
        file,
        kind,
        content: text,
        truncated: blob.size > PREVIEW_MAX_BYTES,
      })
    } catch (e) {
      setPreviewError((e as Error).message || "Failed to load preview")
    } finally {
      setPreviewLoading(false)
    }
  }, [chatSessionKey, downloadOutput])

  // Drop the pinned session and start a fresh one on demand. Used by the
  // pill's "reset" button — the only way the floating chat ever switches
  // away from its current conversation.
  const handleResetChat = useCallback(async () => {
    if (!selectedAgent || isCrossTenant) return
    setChatError(null)
    setChatSending(true)
    const oldKey = chatSessionKey
    try {
      clearPinnedSessionKey(selectedAgent.id)
      const sessRes = await chatApi.createSession(selectedAgent.id)
      const newKey = sessRes.sessionKey || sessRes.key || sessRes.sessionId || null
      if (!newKey) throw new Error("No session key returned")
      // Clear the old bucket from the store so we don't keep stale streams
      // around. The new session has no history yet → empty array is correct.
      if (oldKey && oldKey !== newKey) {
        useChatStore.getState().setMessages(oldKey, [])
      }
      useChatStore.getState().setMessages(newKey, [])
      useChatStore.getState().setAgentRunning(newKey, false)
      setChatSessionKey(newKey)
      savePinnedSessionKey(selectedAgent.id, newKey)
      chatApi.subscribe(newKey).catch(() => {})
    } catch (e) {
      setChatError((e as Error).message || "Failed to reset chat")
    } finally {
      setChatSending(false)
    }
  }, [selectedAgent, isCrossTenant, chatSessionKey])

  const handleSendChat = useCallback(async () => {
    if (!selectedAgent || isCrossTenant || !chatDraft.trim()) return
    const text = chatDraft.trim()
    setChatSending(true)
    setChatError(null)
    setChatDraft("")

    // Mirror ChatPage.handleSend: write user + agent placeholder into the
    // shared store, mark agent as running, mark this text as "sent" so the
    // gateway WS echo of our own user message gets suppressed. The WS
    // handler will fill in `responseText` for the agent group as the model
    // streams, and flip `isStreaming` / `responseDone` when the run ends.
    const store = useChatStore.getState()
    try {
      let key = chatSessionKey
      if (!key) {
        // Same resolution policy as the open-chat effect above: pinned →
        // latest non-heartbeat DM → create. Covers the case where the user
        // types and presses send before the async session-resolve effect
        // has populated `chatSessionKey`.
        const pinned = loadPinnedSessionKey(selectedAgent.id)
        try {
          const listRes = await chatApi.getSessions(selectedAgent.id)
          const dmSessions = (listRes.sessions || [])
            .filter((s) => {
              if (s.agentId && s.agentId !== selectedAgent.id) return false
              const sKey = s.sessionKey || s.key || ""
              return !!sKey && !isHeartbeatSessionKey(sKey)
            })
          const serverKeys = new Set(dmSessions.map((s) => s.sessionKey || s.key || ""))
          if (pinned && serverKeys.has(pinned) && !isHeartbeatSessionKey(pinned)) {
            key = pinned
          } else {
            dmSessions.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
            const fresh = dmSessions[0]
            if (fresh) key = fresh.sessionKey || fresh.key || null
          }
        } catch {
          if (pinned && !isHeartbeatSessionKey(pinned)) key = pinned
        }
        if (!key) {
          const sessRes = await chatApi.createSession(selectedAgent.id)
          key = sessRes.sessionKey || sessRes.key || sessRes.sessionId || null
          if (!key) throw new Error("No session key returned")
        }
        setChatSessionKey(key)
        savePinnedSessionKey(selectedAgent.id, key)
        chatApi.subscribe(key).catch(() => {})
      }
      // Refuse double-send while a run is still in flight on this session.
      if (store.agentRunning[key]) {
        setChatSending(false)
        return
      }
      store.markSent(key, text)
      const userMsg: ChatMessageGroup = {
        id: `user-${Math.random().toString(36).slice(2, 10)}`,
        role: "user",
        userText: text,
        timestamp: Date.now(),
      }
      store.appendMessage(key, userMsg)
      const agentMsg: ChatMessageGroup = {
        id: `agent-${Math.random().toString(36).slice(2, 10)}`,
        role: "agent",
        agentId: selectedAgent.id,
        toolCalls: [],
        isStreaming: true,
        responseDone: false,
        timestamp: Date.now(),
      }
      store.appendMessage(key, agentMsg)
      store.setAgentRunning(key, true)

      await chatApi.sendMessage(key, text, selectedAgent.id)
      // Auto-clear the markSent flag after 10s in case the WS echo never
      // arrived — same safety net ChatPage uses.
      setTimeout(() => useChatStore.getState().clearSent(key as string, text), 10_000)
    } catch (e) {
      setChatError((e as Error).message || "Failed to send")
      // Surface the error inside the agent placeholder bubble + stop the
      // running indicator. Don't yank the user bubble — the user wants to
      // see what they tried to send (matches ChatPage behaviour).
      const key = chatSessionKey
      if (key) {
        useChatStore.getState().clearSent(key, text)
        useChatStore.getState().updateLastAgentMessage(key, (m) => ({
          ...m,
          responseText: `❌ Failed to send: ${(e as Error).message || "Unknown error"}`,
          responseDone: true,
          isStreaming: false,
        }))
        useChatStore.getState().setAgentRunning(key, false)
      }
    } finally {
      setChatSending(false)
    }
  }, [selectedAgent, isCrossTenant, chatDraft, chatSessionKey])

  // When the docked side panel is active we lay scene + panel out as flex
  // siblings so chat takes real horizontal space (instead of overlaying the
  // 3D world). Pill mode keeps the original single-container layout.
  const isSidePanelMode = chatOpen && chatLayout === "panel"
  const sceneShellShadow = isLight
    ? "0 0 0 1px rgba(100,140,200,0.35), 0 8px 40px rgba(80,120,200,0.12)"
    : "0 0 0 1px rgba(30,60,160,0.4), 0 0 40px rgba(0,0,255,0.05), 0 12px 60px rgba(0,0,0,0.8)"

  // Chat surface JSX, defined once and rendered into either the pill overlay
  // (inside the scene shell) or the docked sibling wrapper (outside the
  // scene shell). The container's positioning / size is mode-aware: pill =
  // absolute bottom-right; panel = relative+full so it fills the docked
  // wrapper that lives next to the scene as a flex sibling.
  const chatPanelEl: ReactNode = chatOpen ? (
    <div
      className={
        chatLayout === "panel"
          ? "relative w-full h-full overflow-hidden flex flex-col"
          : "absolute bottom-24 right-6 z-30 rounded-2xl overflow-hidden flex flex-col"
      }
      style={{
        width: chatLayout === "panel" ? "100%" : 380,
        height: chatLayout === "panel" ? "100%" : 520,
        borderRadius: chatLayout === "panel" ? 12 : 16,
        ...glass({ strong: true }),
        boxShadow: isLight
          ? "0 1px 0 rgba(255,255,255,0.6) inset, 0 24px 64px rgba(40, 60, 100, 0.22)"
          : "0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 64px rgba(0, 0, 0, 0.7)",
        pointerEvents: "auto",
      }}
    >
      {/* Resize handle — only in panel mode. Window-level mousemove takes
          over while dragging (see useEffect above) so the cursor can outrun
          this strip. */}
      {chatLayout === "panel" && (
        <div
          onMouseDown={startPanelResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
          style={{
            position: "absolute",
            top: 0, bottom: 0, left: 0,
            width: 6,
            cursor: "ew-resize",
            background: panelDragging
              ? "linear-gradient(90deg, hsl(var(--primary) / 0.5), transparent)"
              : "transparent",
            zIndex: 40,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            if (!panelDragging) {
              (e.currentTarget as HTMLDivElement).style.background =
                "linear-gradient(90deg, hsl(var(--primary) / 0.25), transparent)"
            }
          }}
          onMouseLeave={(e) => {
            if (!panelDragging) {
              (e.currentTarget as HTMLDivElement).style.background = "transparent"
            }
          }}
        />
      )}
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
          onClick={toggleChatLayout}
          className="text-sm rounded-full hover:bg-white/10"
          style={{
            color: "var(--muted-foreground)",
            width: 28, height: 28, lineHeight: "28px", textAlign: "center",
          }}
          aria-label={chatLayout === "panel" ? "Switch to floating chat" : "Dock chat to right side"}
          title={chatLayout === "panel" ? "Switch to floating pill" : "Dock to right side"}
        >
          {chatLayout === "panel" ? "⊟" : "⊡"}
        </button>
        {selectedAgent && !isCrossTenant && (
          <button
            onClick={handleResetChat}
            disabled={chatSending || isAgentRunning}
            className="text-sm rounded-full hover:bg-white/10 transition-opacity"
            style={{
              color: "var(--muted-foreground)",
              width: 28, height: 28, lineHeight: "28px", textAlign: "center",
              opacity: chatSending || isAgentRunning ? 0.4 : 1,
              cursor: chatSending || isAgentRunning ? "not-allowed" : "pointer",
            }}
            aria-label="Reset chat (start a new session)"
            title="Start a new session"
          >↻</button>
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

          {/* Tab strip — Chat / Outputs. Hidden for cross-tenant agents (no
              outputs route there yet). The Outputs count is intentionally
              unlabeled when zero so the tab doesn't shout an empty number. */}
          {!isCrossTenant && (
            <div className="px-3 pt-3 flex gap-1">
              {(["chat", "outputs"] as const).map((tab) => {
                const active = chatTab === tab
                const label = tab === "chat"
                  ? "Chat"
                  : `Outputs${outputs.length > 0 ? ` · ${outputs.length}` : ""}`
                return (
                  <button
                    key={tab}
                    onClick={() => setChatTab(tab)}
                    className="text-[11px] font-medium px-3 py-1 rounded-full transition-all"
                    style={{
                      background: active
                        ? "var(--primary)"
                        : (isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.05)"),
                      color: active
                        ? "var(--primary-foreground)"
                        : "var(--muted-foreground)",
                      border: active
                        ? "1px solid rgba(255,255,255,0.18)"
                        : `1px solid ${isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          {chatTab === "chat" && (
          <>
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
                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`pill-chat-bubble rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.role === "user" ? "is-user" : "is-assistant"}`}
                  style={{
                    maxWidth: m.role === "user" ? "78%" : "92%",
                    minWidth: 0,
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
                    wordBreak: "break-word",
                  }}
                >
                  {m.role === "assistant" && m.text !== "…" ? (
                    <div className="pill-md text-xs">
                      <MarkdownRenderer content={m.text} />
                    </div>
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
                  )}
                </div>
                {/* Feedback thumbs for assistant bubbles — only when fully
                    streamed AND we have both a resolved session + agent. */}
                {m.role === "assistant" && !m.pending && m.text !== "…" && chatSessionKey && selectedAgent && (
                  <FeedbackThumbs
                    messageId={m.id}
                    sessionId={chatSessionKey}
                    agentId={selectedAgent.id}
                    className="mt-1 ml-1 opacity-60 hover:opacity-100 transition-opacity"
                  />
                )}
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
                placeholder={isAgentRunning ? `${selectedAgent.name} is thinking…` : `Message ${selectedAgent.name}…`}
                rows={1}
                disabled={chatSending || isAgentRunning}
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
                disabled={chatSending || isAgentRunning || !chatDraft.trim()}
                className="text-xs font-medium px-3 py-2 rounded-full transition-all"
                style={{
                  background: chatSending || isAgentRunning || !chatDraft.trim()
                    ? (isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)")
                    : "var(--primary)",
                  color: chatSending || isAgentRunning || !chatDraft.trim()
                    ? "var(--muted-foreground)"
                    : "var(--primary-foreground)",
                  cursor: chatSending || isAgentRunning || !chatDraft.trim() ? "not-allowed" : "pointer",
                  boxShadow: chatSending || isAgentRunning || !chatDraft.trim()
                    ? "none"
                    : "0 4px 14px rgba(124, 58, 237, 0.35), 0 1px 0 rgba(255,255,255,0.18) inset",
                  minWidth: 56,
                }}
              >
                {chatSending || isAgentRunning ? "…" : "Send"}
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
          )}

          {chatTab === "outputs" && (
            // `relative` so the inline preview overlay (`absolute inset-0`)
            // positions against THIS container, not the panel root.
            <div className="flex-1 overflow-y-auto px-3 py-3 relative">
              {/* Header row: refresh + truncated hint */}
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  {outputsLoading
                    ? "Loading…"
                    : outputs.length === 0
                      ? "No artifacts yet"
                      : `${outputs.length} file${outputs.length === 1 ? "" : "s"}`}
                  {outputsTruncated && " (capped at 200)"}
                </div>
                <button
                  onClick={refreshOutputs}
                  disabled={outputsLoading}
                  className="text-[11px] hover:underline"
                  style={{ color: "var(--muted-foreground)" }}
                  title="Refresh outputs list"
                >↻ Refresh</button>
              </div>

              {outputsError && (
                <div className="text-[11px] mb-2" style={{ color: "#ef4444" }}>{outputsError}</div>
              )}

              {/* "Out of convention" banner — surfaces the agents-misbehaving
                  case so the user (and the agent next session) knows it's a
                  pollution problem to fix in AGENTS.md, not a missing-file
                  one. Only renders when at least one legacy file is in view. */}
              {outputs.some((f) => f.outOfConvention) && (
                <div
                  className="text-[10px] px-2 py-1.5 mb-2 rounded-md"
                  style={{
                    background: isLight ? "rgba(245, 158, 11, 0.12)" : "rgba(245, 158, 11, 0.10)",
                    color: isLight ? "#b45309" : "#fcd34d",
                    border: `1px solid ${isLight ? "rgba(245, 158, 11, 0.3)" : "rgba(245, 158, 11, 0.25)"}`,
                  }}
                >
                  Some files were saved outside <code>outputs/</code>. The agent
                  should write artifacts under that folder going forward (see
                  AGENTS.md → "Saving Outputs").
                </div>
              )}

              {/* File list. Each row has an icon-only Download button on the
                  right; previewable rows also surface a Preview button. The
                  bare row click does the natural thing per type: open inline
                  preview for text (md/html/json/csv/txt/log), trigger
                  download for binary (pdf/xlsx/docx/anything else). */}
              <div className="flex flex-col gap-1">
                {outputs.map((f) => {
                  const kind = classifyForPreview(f.ext)
                  const previewable = kind != null
                  return (
                    <div
                      key={f.relPath}
                      className="rounded-lg px-3 py-2 transition-colors"
                      style={{
                        background: isLight ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${
                          f.outOfConvention
                            ? (isLight ? "rgba(245, 158, 11, 0.35)" : "rgba(245, 158, 11, 0.25)")
                            : (isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)")
                        }`,
                      }}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <button
                          onClick={() => previewable ? previewOutput(f) : downloadOutput(f)}
                          className="flex-1 text-left min-w-0"
                          title={previewable ? "Open preview" : "Download (no inline preview for this format)"}
                        >
                          <div className="flex items-baseline justify-between gap-2 min-w-0">
                            <div className="text-[12px] font-medium truncate" style={{ color: "var(--foreground)" }}>
                              {f.name}
                            </div>
                            <div className="text-[10px] shrink-0" style={{ color: "var(--muted-foreground)" }}>
                              {formatFileSize(f.size)}
                            </div>
                          </div>
                          <div className="text-[10px] truncate mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                            {f.relPath}
                          </div>
                          <div className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                            {new Date(f.mtime).toLocaleString()} · {f.mimeType}
                            {f.outOfConvention && (
                              <span style={{ color: isLight ? "#b45309" : "#fcd34d" }}> · ⚠ out of convention</span>
                            )}
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {previewable && (
                            <button
                              onClick={(e) => { e.stopPropagation(); previewOutput(f) }}
                              className="text-[10px] px-2 py-1 rounded-full hover:bg-white/10"
                              style={{
                                color: "var(--muted-foreground)",
                                border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
                              }}
                              title="Preview inline"
                            >👁</button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadOutput(f) }}
                            className="text-[10px] px-2 py-1 rounded-full hover:bg-white/10"
                            style={{
                              color: "var(--muted-foreground)",
                              border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
                            }}
                            title="Download"
                          >⬇</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {!outputsLoading && outputs.length === 0 && !outputsError && (
                  <div className="text-[11px] text-center py-6" style={{ color: "var(--muted-foreground)" }}>
                    Files the agent writes during this session show up here.
                  </div>
                )}
              </div>

              {/* ── Inline preview overlay ─────────────────────────────────
                  Sits on top of the file list so the user keeps the panel's
                  position/scroll context. Click outside (the backdrop) or
                  the close button dismisses. */}
              {(preview || previewLoading || previewError) && (
                <div
                  className="absolute inset-0 flex flex-col"
                  style={{
                    background: isLight ? "rgba(245, 247, 252, 0.96)" : "rgba(15, 23, 42, 0.96)",
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    zIndex: 5,
                  }}
                  onClick={(e) => {
                    // Only the backdrop closes; clicks inside the body bubble up here too,
                    // so guard with currentTarget identity check.
                    if (e.target === e.currentTarget) {
                      setPreview(null); setPreviewError(null)
                    }
                  }}
                >
                  {/* Preview header: filename + download + close */}
                  <div
                    className="flex items-center gap-2 px-3 py-2"
                    style={{
                      borderBottom: `1px solid ${isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate" style={{ color: "var(--foreground)" }}>
                        {preview?.file.name ?? "Loading…"}
                      </div>
                      {preview && (
                        <div className="text-[10px] truncate" style={{ color: "var(--muted-foreground)" }}>
                          {preview.file.relPath} · {formatFileSize(preview.file.size)}
                          {preview.truncated && ` · preview truncated to ${formatFileSize(PREVIEW_MAX_BYTES)}`}
                        </div>
                      )}
                    </div>
                    {preview && (
                      <button
                        onClick={() => downloadOutput(preview.file)}
                        className="text-[10px] px-2 py-1 rounded-full hover:bg-white/10"
                        style={{
                          color: "var(--muted-foreground)",
                          border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
                        }}
                        title="Download original"
                      >⬇ Download</button>
                    )}
                    <button
                      onClick={() => { setPreview(null); setPreviewError(null) }}
                      className="text-base rounded-full hover:bg-white/10"
                      style={{
                        color: "var(--muted-foreground)",
                        width: 28, height: 28, lineHeight: "28px", textAlign: "center",
                      }}
                      aria-label="Close preview"
                    >✕</button>
                  </div>

                  {/* Preview body — renderer per type. */}
                  <div className="flex-1 overflow-auto px-3 py-3 min-h-0">
                    {previewLoading && (
                      <div className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                        Loading preview…
                      </div>
                    )}
                    {previewError && (
                      <div className="text-[11px]" style={{ color: "#ef4444" }}>{previewError}</div>
                    )}
                    {preview && preview.kind === "markdown" && (
                      // Reuse the same renderer the chat thread uses so tables /
                      // code blocks behave identically.
                      <div className="pill-md text-xs">
                        <MarkdownRenderer content={preview.content} />
                      </div>
                    )}
                    {preview && preview.kind === "html" && (
                      // Sandboxed iframe — the agent's HTML can include scripts
                      // and external resources; we strip both so a malicious
                      // artifact can't pop modals or beacon out. `allow-same-origin`
                      // is intentionally OFF.
                      <iframe
                        title={preview.file.name}
                        sandbox=""
                        srcDoc={preview.content}
                        style={{
                          width: "100%",
                          height: "100%",
                          minHeight: 260,
                          border: "none",
                          background: "white",
                          borderRadius: 6,
                        }}
                      />
                    )}
                    {preview && preview.kind === "json" && (
                      // Try to pretty-print; fall back to raw text if the file
                      // isn't valid JSON (agents do occasionally emit
                      // jsonl-with-trailing-newline or hand-edited drafts).
                      <pre
                        className="text-[11px] leading-relaxed whitespace-pre-wrap"
                        style={{
                          color: "var(--foreground)",
                          background: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)",
                          padding: 10,
                          borderRadius: 6,
                          overflowX: "auto",
                        }}
                      >{(() => {
                        try { return JSON.stringify(JSON.parse(preview.content), null, 2) }
                        catch { return preview.content }
                      })()}</pre>
                    )}
                    {preview && preview.kind === "csv" && (() => {
                      const rows = parseCsv(preview.content)
                      const shown = rows.slice(0, CSV_PREVIEW_MAX_ROWS)
                      const hidden = rows.length - shown.length
                      const head = shown[0] ?? []
                      const body = shown.slice(1)
                      return (
                        <div className="text-[11px]" style={{ color: "var(--foreground)" }}>
                          <div className="overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
                            <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                              <thead>
                                <tr>
                                  {head.map((cell, i) => (
                                    <th
                                      key={i}
                                      style={{
                                        textAlign: "left",
                                        padding: "4px 8px",
                                        whiteSpace: "nowrap",
                                        background: isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.05)",
                                        border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
                                        fontWeight: 600,
                                      }}
                                    >{cell}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {body.map((row, ri) => (
                                  <tr key={ri}>
                                    {row.map((cell, ci) => (
                                      <td
                                        key={ci}
                                        style={{
                                          padding: "4px 8px",
                                          whiteSpace: "nowrap",
                                          border: `1px solid ${isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"}`,
                                        }}
                                      >{cell}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {hidden > 0 && (
                            <div className="text-[10px] mt-2" style={{ color: "var(--muted-foreground)" }}>
                              First {CSV_PREVIEW_MAX_ROWS} of {rows.length} rows shown — download for the full file.
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    {preview && preview.kind === "text" && (
                      <pre
                        className="text-[11px] leading-relaxed whitespace-pre-wrap"
                        style={{
                          color: "var(--foreground)",
                          background: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)",
                          padding: 10,
                          borderRadius: 6,
                          overflowX: "auto",
                        }}
                      >{preview.content}</pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center px-6 text-center text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          Click an agent chip at the top to open their thread.
        </div>
      )}
    </div>
  ) : null

  return (
    <div
      className={isSidePanelMode ? "flex w-full" : "relative w-full"}
      style={{
        height: "calc(100vh - 104px)",
        minHeight: 500,
        gap: isSidePanelMode ? 8 : 0,
        // Pill-mode keeps the rounded-shadowed shell on the root itself; in
        // panel mode the shell moves to the inner scene wrapper (so the side
        // panel can sit OUTSIDE that shell as its own framed dock).
        borderRadius: isSidePanelMode ? undefined : 12,
        overflow: isSidePanelMode ? undefined : "hidden",
        boxShadow: isSidePanelMode ? undefined : sceneShellShadow,
      }}
    >
      {/* ── Scene shell — contains everything except the docked side panel.
            In pill mode this is effectively the same as the old root (the
            wrapper above is a no-op flex). In panel mode this is `flex-1` so
            the scene takes the remaining horizontal room next to the dock. */}
      <div
        className={isSidePanelMode ? "relative flex-1 min-w-0" : "relative w-full h-full"}
        style={isSidePanelMode ? {
          height: "100%",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: sceneShellShadow,
        } : undefined}
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

      {/* In pill mode the chat surface lives INSIDE the scene shell as an
          overlay; in panel mode it's hoisted to a flex sibling below so the
          3D world actually shrinks horizontally next to the dock. */}
      {chatLayout === "pill" && chatPanelEl}
      </div>
      {/* ── Side dock — chat as a flex sibling, OUTSIDE the scene shell ── */}
      {isSidePanelMode && (
        <div
          className="relative shrink-0"
          style={{
            width: panelWidth,
            height: "100%",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: sceneShellShadow,
          }}
        >
          {chatPanelEl}
        </div>
      )}

    </div>
  )
}

