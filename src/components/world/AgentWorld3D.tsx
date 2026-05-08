import React, { useMemo, useRef, useState, useEffect, useCallback } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrthographicCamera, Grid, Box, Cylinder, Sphere, OrbitControls, Text, Html, Environment } from "@react-three/drei"
import * as THREE from "three"
import type { Agent } from "@/types"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import { useThemeStore, useSessionStore } from "@/stores"
import { computeAgentLevel, type AgentTier } from "@/lib/agentLeveling"

// Build a CSS linear-gradient string for a tier-coloured level pill.
// Brightens the base hex by ~30% on the high end so the pill reads as a
// luminous chip, regardless of which tier hue we get.
function tierGradient(hex: string): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  const lighten = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.35))
  const lr = lighten(r), lg = lighten(g), lb = lighten(b)
  const lightHex = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`
  return `linear-gradient(135deg, ${lightHex} 0%, ${hex} 100%)`
}
import { AgentAvatar } from "@/components/agents/AgentAvatar"

// ── THEME PALETTES ────────────────────────────────────────────────────────────
type ThemeMode = "dark" | "light"
const SCENE_THEME = {
  dark: {
    canvasBg:    "#0f172a",
    floorColor:  "#f0f4f8",
    wallColor:   "#cbd5e1",
    gridCell:    "#d1d5db",
    gridSection: "#9ca3af",
    ambientIntensity:  1.8,
    ambientColor:      "#f8fafc",
    sunIntensity:      2.0,
    sunColor:          "#fff9ee",
    fillIntensity:     0.7,
    fillColor:         "#dbeafe",
    skirterColor:      "#22d3ee",
    skirterIntensity:  2.0,
  },
  light: {
    canvasBg:    "#dce8f5",
    floorColor:  "#f8fafd",
    wallColor:   "#e2eaf4",
    gridCell:    "#c5d2e0",
    gridSection: "#8fa3bf",
    ambientIntensity:  2.8,
    ambientColor:      "#ffffff",
    sunIntensity:      1.2,
    sunColor:          "#ffffff",
    fillIntensity:     0.4,
    fillColor:         "#bfdbfe",
    skirterColor:      "#0ea5e9",
    skirterIntensity:  1.2,
  },
} as const

// ── DASHBOARD THEME TOKEN BRIDGE ─────────────────────────────────────────────
// Reads the dashboard's CSS variables (defined in src/index.css) and exposes
// them as plain hex strings the 3D materials can consume. Recomputes when the
// theme mode flips (dark/light). The fallback `|| '#888'` keeps the scene
// rendering even if a token is missing during HMR.
export type SceneTokens = {
  wall: string
  wallTrim: string
  floor: string
  floorAccent: string
  accent: string
  accentSoft: string
  foreground: string
  ambient: string
  canvasBg: string
}

function useThemeTokens(): SceneTokens {
  const mode = useThemeStore(s => s.theme)
  return useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        wall: '#1f2020', wallTrim: '#131313', floor: '#191a1a', floorAccent: '#2a2b2b',
        accent: '#d0bcff', accentSoft: '#5516be', foreground: '#e7e5e4',
        ambient: '#acabaa', canvasBg: '#0e0e0e',
      }
    }
    const cs = getComputedStyle(document.documentElement)
    const v = (k: string) => (cs.getPropertyValue(k).trim() || '#888')
    return {
      wall:        v('--surface-low'),       // darker — recedes
      wallTrim:    v('--card'),
      floor:       v('--surface-bright'),    // lighter — catches light, distinct from wall
      floorAccent: v('--surface-highest'),   // wood-grain plank line tone
      accent:      v('--primary'),
      accentSoft:  v('--accent'),
      foreground:  v('--foreground'),
      ambient:     v('--muted-foreground'),
      canvasBg:    v('--background'),
    }
    // mode is intentionally a dep: when theme toggles, CSS vars change and
    // we need the memo to invalidate even though we don't read mode itself.
  }, [mode])
}

type WorldState = "processing" | "working" | "idle" | "offline"

interface AgentWorld3DProps {
  agents: Agent[]
  agentStates: WorldState[]
  deskXPcts: number[]
  /** Optional — if set, camera glides to this agent and a highlight ring renders under them. */
  selectedAgentId?: string | null
}

// ── NAVIGATION HIGHWAY NODES (verified clear of all furniture) ──────────────
// Main horizontal spine at z=7; vertical stem at x=-4 for arcade access
const HL: [number, number] = [-22,  7]   // highway left entrance
const HC: [number, number] = [ -4,  7]   // highway centre
const HR: [number, number] = [ 12,  7]   // highway right (meeting room entry)
const VS: [number, number] = [ -4, -8]   // vertical stem mid (arcade descent)

interface Waypoint {
  via:    [number, number][]  // intermediate corridor nodes walked in order
  dest:   [number, number]   // final [x, z] position
  facing: number             // rotation.y at destination (0 = south/cam)
}

const WAYPOINTS: Waypoint[] = [
  // ── LOUNGE ─ verified clear of all sofa bounds ───────────────────────────
  // Sofa NORTH centre=[-18,0,13], E-arm edge x=-15.5, Z-front=11.85
  // Sofa EAST  centre=[-10,0,20], W-arm edge x=-11.6, Z span [17.5,22.5]
  { via: [HL, [-15, 7]], dest: [-15, 11], facing: 0 },          // SE of Sofa NORTH
  { via: [HL, [-22, 7]], dest: [-22, 11], facing: Math.PI },     // SW of Sofa NORTH
  { via: [HL, [-15, 7]], dest: [-15, 25], facing: 0 },           // east corridor (x>-11.6)
  { via: [HL, [-22, 7]], dest: [-22, 26], facing: Math.PI },     // west of Sofa WEST (z>22.5)

  // ── COFFEE BAR ─ approach from east (x=-20 clears counter east edge) ─────
  { via: [HL, [-20, 2]],       dest: [-25, 0],  facing: -Math.PI / 2 },
  { via: [HL, [-20, 0]],       dest: [-22, 0],  facing: -Math.PI / 2 },
  { via: [HL, [-20, 0]],       dest: [-22, -3], facing: -Math.PI / 2 },

  // ── ARCADE ─ walkway in front of screens (z≈-24) ─────────────────────────
  { via: [HC, VS, [-4, -17], [-4, -24]], dest: [-13, -24], facing: 0 },
  { via: [HC, VS, [-4, -17], [-4, -24]], dest: [-17, -24], facing: 0 },
  { via: [HC, VS, [-4, -17], [-4, -24]], dest: [-21, -24], facing: 0 },
  { via: [HC, VS, [-4, -17], [-4, -24]], dest: [-25, -24], facing: 0 },

  // ── MEETING ROOM ─ SOUTH of table ────────────────────────────────────────
  // Table centre [16,20], chairs reach z=15.8 (radius 4.2 from centre).
  // Stand at z=13: 7 units from centre, 2.8 clear of south chairs.
  { via: [HR, [10,  7]], dest: [10, 13], facing:  Math.PI / 4 },
  { via: [HR, [22,  7]], dest: [22, 13], facing: -Math.PI / 4 },

  // ── TRANSIT FLOOR ─ verified clear of hologram [0,0,8] (keep dist > 3) ───
  { via: [],      dest: [-12,  7], facing: 0 },
  { via: [],      dest: [ -4,  4], facing: 0 },   // 4 units south of hologram centre
  { via: [HL],    dest: [ -8, 12], facing: 0 },
  { via: [HC],    dest: [  6, 10], facing: 0 },

  // ── LOUNGE 2 ─ new sofa cluster centre [-2,0,17] + armchair [-5,0,14] ────
  // Sofa front edge at z=16.2; armchair extent x=[-6, -4] z=[13.2, 14.8].
  { via: [HC],    dest: [-2, 11], facing: 0 },             // south of sofa, facing camera
  { via: [HC],    dest: [-7,  7], facing: -Math.PI / 4 },  // south-west of armchair, angled

  // ── MEETING NOOK ─ rug centre [4,0,4], chairs at z=2.4 and z=5.6 ─────────
  { via: [HC],    dest: [ 4, 0.5], facing: Math.PI },      // south of nook, facing north into it
  { via: [HC, [6, 4]], dest: [7, 4], facing: -Math.PI / 2 }, // east of nook, facing west into it
]

// ── Shared agent position registry + movement constants ──────────────────────
// Module-level Map updated every useFrame so all agents can read each other's
// current XZ. Used for idle separation (prevents overlapping).
const AGENT_WORLD_POSITIONS = new Map<string, [number, number]>()
const WALK_SPEED      = 4   // idle wander speed (world-units/sec)
const DESK_WALK_SPEED = 15.0   // sprint speed when heading to desk (working/processing)
const SEP_RADIUS = 2.0   // minimum inter-agent gap
const SEP_FORCE  = 4.0   // repulsion strength (units/sec at zero distance)

// ── Zone-based bridge helper ───────────────────────────────────────────────────
// When an agent is in a "deep" zone (lounge, meeting room, arcade), walking
// directly to waypoint via[0] can cut through furniture diagonally.  This
// function returns 0-1 intermediate highway nodes that bring the agent safely
// back to the open corridor before following the selected waypoint path.
function getBridgeNodes(fromX: number, fromZ: number): [number, number][] {
  // Already on or near the highway spine (z = 2..10) → no bridge needed
  if (fromZ >= 2 && fromZ <= 10) return []
  // Deep in meeting room area (north-east) → cut back via HR junction
  if (fromX > 8 && fromZ > 10) return [[10, 7]]
  // Deep in lounge area (west side) → cut south to HC then let waypoint take over
  if (fromX < -4 && fromZ > 10) return [HC]
  // Arcade / coffee zone (south of highway) → up to HC
  if (fromZ < -2) return [HC]
  return []
}

// ── Corridor-routed path to a workspace desk slot ────────────────────────────
// Strategy: main highway at z=7 → align to desk's X column → march north into workspace.
// This avoids all furniture: lounge (z>6, x<-4), coffee bar, arcade, meeting room.
function buildDeskPath(fromX: number, fromZ: number, deskSlot: [number, number, number]): [number, number][] {
  const [dx, , dz] = deskSlot
  const standZ = dz + 3.5              // standing spot (viewer-facing side of desk)
  const nodes: [number, number][] = []

  // Already inside workspace?  just walk to the standing position.
  if (fromZ < -2 && fromX > 2) {
    nodes.push([dx, standZ])
    return nodes
  }

  // Phase 1: get to main highway junction if in lounge quadrant or far west
  if (fromX < 2 || fromZ > 8) {
    nodes.push(HC)                // (-4, 7) safe highway junction
  }

  // Phase 2: walk east along the highway to the desk's column
  const colX = Math.max(6, dx)   // stay well east of meeting-room shoulder
  nodes.push([colX, 7])          // aligned with desk column on highway

  // Phase 3: march north into workspace — two-step so agent clears boundary cleanly
  const entryZ = -1              // just inside workspace south boundary
  nodes.push([dx, entryZ])       // cross boundary
  nodes.push([dx, standZ])       // final standing position

  return nodes
}

function getAgentColor(agent: Agent): string {
  if (agent.avatarPresetId) {
    const p = AVATAR_PRESETS.find(p => p.id === agent.avatarPresetId)
    if (p) return p.color
  }
  return agent.color || "#6366f1"
}

// ---------------------- PROP COMPONENTS ----------------------

function Wall({ position, size }: { position: [number, number, number], size: [number, number, number] }) {
  return (
    <Box args={size} position={position} castShadow receiveShadow>
      <meshStandardMaterial color="#e8ecf0" roughness={0.8} />
    </Box>
  )
}

function SkirterLight({ position, size, axis }: { position: [number, number, number], size: [number, number, number], axis: "x" | "z" }) {
  return (
    <Box args={size} position={position}>
      <meshStandardMaterial color="#7dd3fc" emissive="#7dd3fc" emissiveIntensity={0.8} toneMapped={false} />
    </Box>
  )
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Cylinder args={[0.6, 0.5, 1.2]} position={[0, 0.6, 0]} castShadow>
        <meshStandardMaterial color="#b0bec5" roughness={0.9} />
      </Cylinder>
      <Sphere args={[1.0]} position={[0, 1.9, 0]} castShadow>
        <meshStandardMaterial color="#10b981" roughness={0.8} />
      </Sphere>
      <Sphere args={[0.7]} position={[0.6, 2.1, 0.3]} castShadow>
        <meshStandardMaterial color="#34d399" roughness={0.8} />
      </Sphere>
      <Sphere args={[0.75]} position={[-0.5, 2.0, -0.3]} castShadow>
        <meshStandardMaterial color="#059669" roughness={0.8} />
      </Sphere>
    </group>
  )
}

function CoffeeCounter() {
  const tokens = useThemeTokens()
  // Upscale coffee bar against left wall
  return (
    <group position={[-25, 0, -5]}>
      {/* === BACK BAR SHELVING === */}
      {/* Wall backing panel */}
      <Box args={[8, 8, 0.3]} position={[0, 4, -2.8]} castShadow receiveShadow>
        <meshStandardMaterial color="#292524" roughness={0.9} />
      </Box>
      {/* Shelf 1 */}
      <Box args={[7.2, 0.15, 0.8]} position={[0, 5.5, -2.4]}>
        <meshStandardMaterial color="#57534e" roughness={0.6} />
      </Box>
      {/* Shelf 2 */}
      <Box args={[7.2, 0.15, 0.8]} position={[0, 7.5, -2.4]}>
        <meshStandardMaterial color="#57534e" roughness={0.6} />
      </Box>
      {/* Bottles on shelf 1 */}
      {[[-2.5, 5.7, -2.2], [-1.5, 5.7, -2.2], [-0.5, 5.7, -2.2], [0.5, 5.7, -2.2], [1.5, 5.7, -2.2]].map(([bx, by, bz], i) => (
        <group key={i} position={[bx, by, bz]}>
          <Cylinder args={[0.18, 0.15, 0.7]} castShadow>
            <meshStandardMaterial color={["#7c3aed","#1d4ed8","#0f766e","#b45309","#be123c"][i]} />
          </Cylinder>
        </group>
      ))}
      {/* Glowing menu board */}
      <Box args={[5.5, 2.5, 0.12]} position={[0, 8.5, -2.65]} castShadow>
        <meshStandardMaterial color="#0f172a" emissive="#0f172a" emissiveIntensity={1} />
      </Box>
      <Box args={[5.2, 2.2, 0.11]} position={[0, 8.5, -2.6]}>
        <meshStandardMaterial color="#0c4a6e" emissive="#0369a1" emissiveIntensity={0.4} toneMapped={false} />
      </Box>
      <Text position={[0, 9.0, -2.5]} fontSize={0.38} color="#fbbf24" anchorX="center" anchorY="middle" fontWeight="bold">
        ☕  COFFEE MENU
      </Text>
      <Text position={[0, 8.5, -2.5]} fontSize={0.22} color="#f1f5f9" anchorX="center" anchorY="middle">
        Espresso  •  Latte  •  Mocha
      </Text>
      <Text position={[0, 8.1, -2.5]} fontSize={0.22} color="#94a3b8" anchorX="center" anchorY="middle">
        Cold Brew  •  Matcha  •  Tea
      </Text>

      {/* === COUNTER BASE === */}
      <Box args={[7, 2.5, 3.5]} position={[0, 1.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#44403c" roughness={0.8} />
      </Box>
      {/* Marble counter top */}
      <Box args={[7.3, 0.2, 3.7]} position={[0, 2.6, 0]} castShadow>
        <meshStandardMaterial color="#f0fdf4" roughness={0.1} metalness={0.05} />
      </Box>
      {/* Counter front accent strip */}
      <Box args={[7, 0.15, 0.1]} position={[0, 2.0, 1.8]}>
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={1} toneMapped={false} />
      </Box>

      {/* === ESPRESSO MACHINE === */}
      <group position={[-2, 2.7, -0.5]}>
        {/* Machine body */}
        <Box args={[2.5, 3.5, 2]} position={[0, 1.75, 0]} castShadow>
          <meshStandardMaterial color="#1c1917" metalness={0.4} roughness={0.3} />
        </Box>
        {/* Machine glow (brew area) */}
        <Box args={[2.2, 0.12, 1.6]} position={[0, 0.12, 0]}>
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={2} toneMapped={false} />
        </Box>
        {/* Screen */}
        <Box args={[1.4, 1.0, 0.1]} position={[0, 2.8, 1.02]}>
          <meshStandardMaterial color={tokens.accent} emissive={tokens.accent} emissiveIntensity={0.7} toneMapped={false} />
        </Box>
        {/* Steam wand */}
        <Cylinder args={[0.06, 0.06, 1.5]} position={[1.0, 1.5, 0.9]} rotation={[0.4, 0, 0.3]} castShadow>
          <meshStandardMaterial color="#94a3b8" metalness={0.8} />
        </Cylinder>
      </group>

      {/* === BREW STATION (right side of counter) === */}
      <group position={[2, 2.7, -0.5]}>
        <Box args={[1.5, 2, 1.5]} position={[0, 1, 0]} castShadow>
          <meshStandardMaterial color="#292524" roughness={0.6} />
        </Box>
        <Cylinder args={[0.4, 0.35, 1.2]} position={[0, 2.8, 0]} castShadow>
          <meshStandardMaterial color="#0c4a6e" metalness={0.3} roughness={0.4} />
        </Cylinder>
        <Box args={[1.2, 0.1, 1.2]} position={[0, 2.3, 0]}>
          <meshStandardMaterial color="#64748b" />
        </Box>
      </group>

      {/* === BAR STOOLS (in front of counter) === */}
      {[[-2.5, 0, 2.8], [0, 0, 2.8], [2.5, 0, 2.8]].map(([sx, sy, sz], i) => (
        <group key={i} position={[sx, sy, sz]}>
          {/* Seat */}
          <Cylinder args={[0.5, 0.45, 0.15]} position={[0, 2.5, 0]} castShadow>
            <meshStandardMaterial color="#1e293b" />
          </Cylinder>
          {/* Leg */}
          <Cylinder args={[0.06, 0.08, 2.5]} position={[0, 1.25, 0]} castShadow>
            <meshStandardMaterial color="#94a3b8" metalness={0.7} />
          </Cylinder>
          {/* Foot ring */}
          <Cylinder args={[0.35, 0.35, 0.06]} position={[0, 0.8, 0]}>
            <meshStandardMaterial color="#94a3b8" metalness={0.7} />
          </Cylinder>
        </group>
      ))}

      {/* === PENDANT LIGHTS === */}
      {[[-2.5, 0, 0], [0, 0, 0], [2.5, 0, 0]].map(([lx, _, lz], i) => (
        <group key={i} position={[lx, 10, lz]}>
          <Cylinder args={[0.04, 0.04, 1.5]} position={[0, 0, 0]}>
            <meshStandardMaterial color="#64748b" />
          </Cylinder>
          <Cylinder args={[0.5, 0.3, 0.5]} position={[0, -1, 0]} castShadow>
            <meshStandardMaterial color="#292524" />
          </Cylinder>
          <Sphere args={[0.2]} position={[0, -1.1, 0]}>
            <meshStandardMaterial color="#fef3c7" emissive="#fef3c7" emissiveIntensity={3} toneMapped={false} />
          </Sphere>
          <pointLight position={[0, -1.2, 0]} intensity={1.2} distance={10} color="#fbbf24" decay={2} />
        </group>
      ))}
    </group>
  )
}

function ArcadeArea() {
  const tokens = useThemeTokens()
  return (
    <group position={[-28, 0, -30]}>
      {/* Floor carpet */}
      <Box args={[18, 0.06, 14]} position={[9, 0.03, 7]} receiveShadow>
        <meshStandardMaterial color="#1a0533" roughness={1} />
      </Box>
      {/* Grid border lines */}
      <Box args={[18, 0.04, 0.12]} position={[9, 0.07, 1]}>
        <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={1.2} toneMapped={false} />
      </Box>
      <Box args={[18, 0.04, 0.12]} position={[9, 0.07, 13]}>
        <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={1.2} toneMapped={false} />
      </Box>

      {/* Back wall */}
      <Box args={[18, 9, 0.4]} position={[9, 4.5, 0.2]} receiveShadow>
        <meshStandardMaterial color="#0f0520" />
      </Box>
      {/* Wall neon strips */}
      <Box args={[18, 0.12, 0.1]} position={[9, 1.5, 0.35]}>
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={2.5} toneMapped={false} />
      </Box>
      <Box args={[18, 0.12, 0.1]} position={[9, 3.5, 0.35]}>
        <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={2.5} toneMapped={false} />
      </Box>

      {/* Entrance arch */}
      {/* <Box args={[0.5, 7, 0.5]} position={[1.5, 3.5, 13.5]}>
        <meshStandardMaterial color="#1e1030" />
      </Box>
      <Box args={[0.5, 7, 0.5]} position={[16.5, 3.5, 13.5]}>
        <meshStandardMaterial color="#1e1030" />
      </Box>
      <Box args={[15.5, 0.5, 0.5]} position={[9, 7.25, 13.5]}>
        <meshStandardMaterial color="#1e1030" />
      </Box> */}
      {/* Arch neon */}
      {/* <Box args={[14, 0.2, 0.15]} position={[9, 6.8, 13.6]}>
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={3} toneMapped={false} />
      </Box>
      <Text position={[9, 8.2, 13.7]} fontSize={0.9} color="#fbbf24" anchorX="center" anchorY="middle">
        🕹  ARCADE
      </Text> */}

      {/* Floor edge strip */}
      <Box args={[18, 0.06, 0.15]} position={[9, 0.08, 13]}>
        <meshStandardMaterial color={tokens.accent} emissive={tokens.accent} emissiveIntensity={1.2} toneMapped={false} />
      </Box>

      {/* Holographic floor grid */}
      {[2, 5, 8, 11, 14].map((xg, i) => (
        <Box key={`gx${i}`} args={[0.04, 0.02, 14]} position={[xg, 0.07, 7]}>
          <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.6} toneMapped={false} transparent opacity={0.5} />
        </Box>
      ))}
      {[3, 6, 9].map((zg, i) => (
        <Box key={`gz${i}`} args={[18, 0.02, 0.04]} position={[9, 0.07, zg]}>
          <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.6} toneMapped={false} transparent opacity={0.5} />
        </Box>
      ))}


      {/* ── 4 GAME STATION CABINETS ── */}
      {([
        { x: 3,  bodyCol: "#12082a", accentCol: "#ff2d55", screenCol: "#ff2d55", screenCol2: "#ff8fa3", btnCols: ["#ff2d55","#ff9f0a","#30d158","#0a84ff"], label: "COMBAT X" },
        { x: 7,  bodyCol: "#0a0a20", accentCol: "#8b5cf6", screenCol: "#8b5cf6", screenCol2: "#c4b5fd", btnCols: ["#8b5cf6","#ec4899","#fde047","#34d399"], label: "NEBULA" },
        { x: 11, bodyCol: "#001a2a", accentCol: "#06b6d4", screenCol: "#06b6d4", screenCol2: "#67e8f9", btnCols: ["#06b6d4","#38bdf8","#fbbf24","#a3e635"], label: "CYBERRUN" },
        { x: 15, bodyCol: "#001a12", accentCol: "#10b981", screenCol: "#10b981", screenCol2: "#6ee7b7", btnCols: ["#10b981","#f472b6","#fb923c","#a78bfa"], label: "QUANTUM Z" },
      ]).map(({ x, bodyCol, accentCol, screenCol, screenCol2, btnCols, label }, ci) => (
        <group key={ci} position={[x, 0, 2]}>

          {/* Toekick riser */}
          <Box args={[2.6, 0.35, 2.1]} position={[0, 0.18, 0]} castShadow>
            <meshStandardMaterial color="#0a0a14" roughness={0.9} />
          </Box>
          <Box args={[2.5, 0.06, 0.06]} position={[0, 0.06, 1.05]}>
            <meshStandardMaterial color={accentCol} emissive={accentCol} emissiveIntensity={3} toneMapped={false} />
          </Box>

          {/* Lower cabinet body */}
          <Box args={[2.6, 2.2, 2.1]} position={[0, 1.45, 0]} castShadow receiveShadow>
            <meshStandardMaterial color={bodyCol} roughness={0.55} metalness={0.25} />
          </Box>
          <Box args={[2.55, 2.15, 0.08]} position={[0, 1.45, 1.06]}>
            <meshStandardMaterial color="#050510" roughness={0.8} />
          </Box>

          {/* Control panel deck */}
          <Box args={[2.6, 0.12, 1.6]} position={[0, 2.62, 0.65]} rotation={[-0.45, 0, 0]} castShadow>
            <meshStandardMaterial color="#0d0d22" roughness={0.3} metalness={0.5} />
          </Box>
          <Box args={[2.3, 0.06, 1.3]} position={[0, 2.72, 0.6]} rotation={[-0.45, 0, 0]}>
            <meshStandardMaterial color="#1a1a3e" roughness={0.2} metalness={0.7} />
          </Box>

          {/* Joystick */}
          <Box args={[0.38, 0.1, 0.38]} position={[-0.6, 2.92, 0.72]} rotation={[-0.45, 0, 0]}>
            <meshStandardMaterial color="#222244" roughness={0.4} metalness={0.5} />
          </Box>
          <Cylinder args={[0.06, 0.07, 0.45, 8]} position={[-0.6, 3.22, 0.45]} rotation={[0.45, 0, 0]}>
            <meshStandardMaterial color="#e2e8f0" roughness={0.3} metalness={0.7} />
          </Cylinder>
          <Sphere args={[0.11, 10, 8]} position={[-0.6, 3.42, 0.3]}>
            <meshStandardMaterial color={accentCol} roughness={0.15} metalness={0.3} />
          </Sphere>

          {/* Action buttons */}
          {([
            { ox: 0.2, oz: 0.75, col: btnCols[0] },
            { ox: 0.6, oz: 0.62, col: btnCols[1] },
            { ox: 1.0, oz: 0.75, col: btnCols[2] },
            { ox: 0.6, oz: 0.9,  col: btnCols[3] },
          ]).map(({ ox, oz, col }, bi) => (
            <group key={bi} position={[ox, 2.78 + oz * 0.12, oz * 0.68]} rotation={[-0.45, 0, 0]}>
              <Cylinder args={[0.095, 0.095, 0.06, 12]} rotation={[Math.PI / 2, 0, 0]}>
                <meshStandardMaterial color="#111122" roughness={0.5} />
              </Cylinder>
              <Cylinder args={[0.075, 0.075, 0.07, 12]} position={[0, 0, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
                <meshStandardMaterial color={col} emissive={col} emissiveIntensity={2.2} toneMapped={false} roughness={0.1} />
              </Cylinder>
            </group>
          ))}

          {/* Upper cabinet body */}
          <Box args={[2.6, 3.0, 1.2]} position={[0, 4.25, -0.05]} castShadow receiveShadow>
            <meshStandardMaterial color={bodyCol} roughness={0.5} metalness={0.28} />
          </Box>
          <Box args={[2.6, 3.0, 0.08]} position={[0, 4.25, 0.61]}>
            <meshStandardMaterial color="#08060f" roughness={0.7} />
          </Box>

          {/* Monitor bezel */}
          <Box args={[2.3, 2.4, 0.12]} position={[0, 4.5, 0.66]} castShadow>
            <meshStandardMaterial color="#0a0814" roughness={0.4} metalness={0.4} />
          </Box>
          <Box args={[2.32, 2.42, 0.05]} position={[0, 4.5, 0.6]}>
            <meshStandardMaterial color={accentCol} emissive={accentCol} emissiveIntensity={0.6} toneMapped={false} transparent opacity={0.7} />
          </Box>

          {/* Screen bloom */}
          <Box args={[1.95, 2.0, 0.04]} position={[0, 4.5, 0.72]}>
            <meshStandardMaterial color={screenCol} emissive={screenCol} emissiveIntensity={0.6} toneMapped={false} transparent opacity={0.35} />
          </Box>
          {/* Main screen */}
          <Box args={[1.82, 1.88, 0.05]} position={[0, 4.5, 0.76]}>
            <meshStandardMaterial color={screenCol2} emissive={screenCol2} emissiveIntensity={2.8} toneMapped={false} />
          </Box>
          {/* Scanlines */}
          {[4.0, 4.7, 5.1].map((sy, si) => (
            <Box key={si} args={[1.82, 0.04, 0.04]} position={[0, sy, 0.78]}>
              <meshStandardMaterial color="#000000" transparent opacity={0.3} />
            </Box>
          ))}

          {/* Speaker grilles */}
          {([-0.95, 0.95] as const).map((sx, si) => (
            <group key={si} position={[sx, 4.5, 0.63]}>
              {[-0.55, -0.25, 0.05, 0.35].map((sy, sli) => (
                <Box key={sli} args={[0.12, 0.03, 0.06]} position={[0, sy, 0]}>
                  <meshStandardMaterial color="#1a1a2e" roughness={0.8} />
                </Box>
              ))}
            </group>
          ))}

          {/* Side neon stripes */}
          <Box args={[0.06, 4.8, 2.15]} position={[-1.32, 2.9, 0]}>
            <meshStandardMaterial color={accentCol} emissive={accentCol} emissiveIntensity={1.8} toneMapped={false} />
          </Box>
          <Box args={[0.06, 4.8, 2.15]} position={[1.32, 2.9, 0]}>
            <meshStandardMaterial color={accentCol} emissive={accentCol} emissiveIntensity={1.8} toneMapped={false} />
          </Box>
          <Box args={[0.05, 4.8, 0.06]} position={[-1.28, 2.9, 1.08]}>
            <meshStandardMaterial color={accentCol} emissive={accentCol} emissiveIntensity={1.2} toneMapped={false} />
          </Box>
          <Box args={[0.05, 4.8, 0.06]} position={[1.28, 2.9, 1.08]}>
            <meshStandardMaterial color={accentCol} emissive={accentCol} emissiveIntensity={1.2} toneMapped={false} />
          </Box>

          {/* Marquee header */}
          <Box args={[2.6, 0.8, 1.2]} position={[0, 6.1, -0.05]} castShadow>
            <meshStandardMaterial color="#08060f" roughness={0.6} />
          </Box>
          <Box args={[2.3, 0.55, 0.06]} position={[0, 6.1, 0.61]}>
            <meshStandardMaterial color={screenCol} emissive={screenCol} emissiveIntensity={1.5} toneMapped={false} transparent opacity={0.88} />
          </Box>
          <Text
            position={[0, 6.1, 0.68]}
            fontSize={0.24}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
            outlineWidth={0.02}
            outlineColor={accentCol}
          >
            {label}
          </Text>

          {/* Coin slot */}
          <Box args={[0.5, 0.18, 0.08]} position={[0.7, 2.06, 1.07]}>
            <meshStandardMaterial color="#1a1a2e" roughness={0.5} />
          </Box>
          <Box args={[0.26, 0.05, 0.1]} position={[0.7, 2.06, 1.09]}>
            <meshStandardMaterial color="#050508" roughness={1} />
          </Box>
          {/* Card reader */}
          <Box args={[0.4, 0.08, 0.06]} position={[-0.7, 2.06, 1.07]}>
            <meshStandardMaterial color={accentCol} emissive={accentCol} emissiveIntensity={0.8} toneMapped={false} />
          </Box>

        </group>
      ))}

      {/* Zone lights */}
      <pointLight position={[9, 5, 5]} intensity={2.5} distance={22} color="#a855f7" />
      <pointLight position={[9, 3, 12]} intensity={1.5} distance={15} color="#ec4899" />
      <pointLight position={[9, 7, 2]} intensity={1.0} distance={20} color={tokens.accent} />

    </group>
  )
}

function Sofa({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[5, 0.9, 2.2]} position={[0, 0.45, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#d97706" roughness={0.85} />
      </Box>
      <Box args={[5, 2, 0.7]} position={[0, 1.4, -0.75]} castShadow receiveShadow>
        <meshStandardMaterial color="#d97706" roughness={0.85} />
      </Box>
      <Box args={[0.7, 1.6, 2.2]} position={[-2.15, 0.8, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#d97706" roughness={0.85} />
      </Box>
      <Box args={[0.7, 1.6, 2.2]} position={[2.15, 0.8, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#d97706" roughness={0.85} />
      </Box>
    </group>
  )
}

function CoffeeTbl({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Box args={[2.5, 0.15, 2]} position={[0, 1.2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#f1f5f9" roughness={0.3} />
      </Box>
      <Cylinder args={[0.08, 0.08, 1.2]} position={[0, 0.6, 0]} castShadow>
        <meshStandardMaterial color="#94a3b8" metalness={0.5} />
      </Cylinder>
      <Box args={[0.6, 0.08, 0.6]} position={[0, 0.04, 0]} castShadow>
        <meshStandardMaterial color="#64748b" />
      </Box>
    </group>
  )
}

// Floating zone label sign tilted toward isometric camera
function ZoneLabel({
  position, label, accent = "#6366f1"
}: {
  position: [number, number, number]
  label: string
  accent?: string
}) {
  const w = Math.max(label.length * 0.42 + 0.8, 3)
  return (
    <group position={position} rotation={[-Math.PI / 4.5, 0, 0]}>
      {/* Sign panel */}
      <Box args={[w, 0.85, 0.08]} castShadow>
        <meshStandardMaterial color="#0f172a" />
      </Box>
      {/* Accent bottom stripe */}
      <Box args={[w, 0.1, 0.09]} position={[0, -0.42, 0]}>
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.5} toneMapped={false} />
      </Box>
      {/* Label text */}
      <Text
        position={[0, 0.05, 0.06]}
        fontSize={0.38}
        color="#f8fafc"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        {label}
      </Text>
    </group>
  )
}

function HologramMeetingTable() {
  const tokens = useThemeTokens()
  return (
    <group position={[16, 0, 20]}>
      {/* Circular rug */}
      <Cylinder args={[5.5, 5.5, 0.05]} position={[0, 0.05, 0]} receiveShadow>
        <meshStandardMaterial color="#3b82f6" transparent opacity={0.25} roughness={1} />
      </Cylinder>
      {/* Table pedestal */}
      <Cylinder args={[1, 1, 1.2]} position={[0, 0.6, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#1e293b" />
      </Cylinder>
      {/* Table Top */}
      <Cylinder args={[3, 3, 0.18]} position={[0, 1.3, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#f8fafc" roughness={0.2} />
      </Cylinder>
      {/* Hologram emitter on table */}
      <Cylinder args={[0.7, 0.8, 0.15]} position={[0, 1.42, 0]}>
        <meshStandardMaterial color={tokens.accent} emissive={tokens.accent} emissiveIntensity={1.0} toneMapped={false} />
      </Cylinder>
      {/* Hologram Globe */}
      <Sphere args={[1.2]} position={[0, 3.2, 0]}>
        <meshStandardMaterial color={tokens.accent} emissive={tokens.accent} emissiveIntensity={0.8} wireframe transparent opacity={0.7} toneMapped={false} />
      </Sphere>
      <pointLight position={[0, 3, 0]} intensity={1.5} distance={12} color={tokens.accent} decay={2} />
      {/* Chairs */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((rot, i) => (
        <group key={i} rotation={[0, rot, 0]}>
          <Box args={[1.2, 0.3, 1.2]} position={[0, 1.1, 4.2]} castShadow>
            <meshStandardMaterial color="#94a3b8" />
          </Box>
          <Box args={[1.2, 1.2, 0.25]} position={[0, 1.8, 4.75]} castShadow>
            <meshStandardMaterial color="#94a3b8" />
          </Box>
        </group>
      ))}
    </group>
  )
}

// ── FloatingParticles ─────────────────────────────────────────────────────────
// 50 glowing dust motes using instancedMesh (zero per-frame React overhead)
function FloatingParticles({ theme }: { theme: ThemeMode }) {
  const COUNT = 50
  const meshRef  = useRef<THREE.InstancedMesh>(null)
  const dummy    = useMemo(() => new THREE.Object3D(), [])
  const particles = useMemo(() =>
    Array.from({ length: COUNT }, () => ({
      x:      (Math.random() - 0.5) * 52,
      y:      1.5 + Math.random() * 10,
      z:      (Math.random() - 0.5) * 52,
      speed:  0.18 + Math.random() * 0.28,
      offset: Math.random() * Math.PI * 2,
      scale:  0.06 + Math.random() * 0.08,
      col:    Math.random(),   // 0–1: maps to cyan / violet / rose palette
    }))
  , [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    particles.forEach((p, i) => {
      dummy.position.set(
        p.x + Math.sin(t * p.speed        + p.offset) * 1.2,
        p.y + Math.sin(t * p.speed * 1.5  + p.offset) * 0.9,
        p.z + Math.cos(t * p.speed * 0.8  + p.offset) * 1.2,
      )
      dummy.scale.setScalar(p.scale + Math.sin(t * p.speed * 2 + p.offset) * 0.02)
      dummy.updateMatrix()
      meshRef.current?.setMatrixAt(i, dummy.matrix)
    })
    if (meshRef.current) meshRef.current.instanceMatrix.needsUpdate = true
  })

  const color = theme === "dark" ? "#38bdf8" : "#60a5fa"
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]}>
      <sphereGeometry args={[1, 5, 5]} />
      <meshStandardMaterial
        color={color} emissive={color} emissiveIntensity={2.2}
        toneMapped={false} transparent opacity={0.55}
      />
    </instancedMesh>
  )
}

// ── CityBackdrop ──────────────────────────────────────────────────────────────
// Glowing city-window panels on back + left walls, plus neon "AGENT HQ" sign
function CityBackdrop({ theme: _theme }: { theme: ThemeMode }) {
  const tokens = useThemeTokens()
  const wallCol = tokens.wall

  return (
    <group>
      {/* ── Back wall skin (on top of existing wall) ── */}
      <Box args={[58, 12, 0.3]} position={[0, 6, -29.6]}>
        <meshStandardMaterial color={wallCol} roughness={0.9} />
      </Box>

      {/* ── Left wall skin ── */}
      <Box args={[0.3, 12, 58]} position={[-29.6, 6, 0]}>
        <meshStandardMaterial color={wallCol} roughness={0.9} />
      </Box>

      {/* ── "AGENT HQ" wordmark on back wall — minimalist, no backplate/glow ── */}
      <group position={[-8, 10.2, -29.3]}>
        <Text
          position={[0, 0, 0.12]}
          fontSize={1.1} letterSpacing={0.12}
          color={tokens.accent} anchorX="center" anchorY="middle"
          outlineWidth={0.02} outlineColor={tokens.accentSoft}
        >AGENT HQ</Text>
      </group>
    </group>
  )
}

// ── CeilingLights ─────────────────────────────────────────────────────────────
// Pendant light fixtures hanging from an implied ceiling, with gentle warmth
function CeilingLights({ theme }: { theme: ThemeMode }) {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const positions: [number, number, number][] = [
    // Lounge area
    [-18, 11, 20], [-10, 11, 18], [-18, 11, 10],
    // Workspace area
    [ 10, 11, -8], [ 18, 11,-8], [ 10, 11,-16], [ 18, 11,-16],
    // Center corridor
    [  0, 11,  0], [  0, 11, 10],
  ]

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    refs.current.forEach((m, i) => {
      if (!m) return
      const mat = m.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.75 + Math.sin(t * 0.4 + i * 0.9) * 0.08
    })
  })

  const cableColor = theme === "dark" ? "#1e293b" : "#94a3b8"
  return (
    <group>
      {positions.map((pos, i) => (
        <group key={i} position={pos}>
          {/* Hanging cable */}
          <Cylinder args={[0.03, 0.03, 1.5, 4]} position={[0, 0.75, 0]}>
            <meshStandardMaterial color={cableColor} />
          </Cylinder>
          {/* Shade cone */}
          <Cylinder args={[0.05, 0.45, 0.6, 8]} position={[0, 0.05, 0]}>
            <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.3} />
          </Cylinder>
          {/* Warm bulb */}
          <mesh ref={el => { refs.current[i] = el }}>
            <sphereGeometry args={[0.22, 8, 8]} />
            <meshStandardMaterial
              color="#fef3c7" emissive="#fef3c7" emissiveIntensity={0.8}
              toneMapped={false} transparent opacity={0.95}
            />
          </mesh>
          {/* Light cone (transparent warm cone below bulb) */}
          <Cylinder args={[0.22, 2.2, 3, 16, 1, true]} position={[0, -1.8, 0]}>
            <meshStandardMaterial
              color="#fef3c7" emissive="#fef3c7" emissiveIntensity={0.12}
              side={THREE.BackSide} transparent opacity={0.06} toneMapped={false}
            />
          </Cylinder>
        </group>
      ))}
    </group>
  )
}

// ── HologramSphere ────────────────────────────────────────────────────────────
// Rotating orbital ring display in the open lobby area — like a network globe
function HologramSphere({ theme }: { theme: ThemeMode }) {
  const tokens = useThemeTokens()
  const groupRef  = useRef<THREE.Group>(null)
  const ring1Ref  = useRef<THREE.Mesh>(null)
  const ring2Ref  = useRef<THREE.Mesh>(null)
  const ring3Ref  = useRef<THREE.Mesh>(null)
  const coreRef   = useRef<THREE.Mesh>(null)
  const baseRef   = useRef<THREE.Mesh>(null)
  const beamRef   = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (groupRef.current)  groupRef.current.rotation.y  = t * 0.22
    if (ring1Ref.current)  ring1Ref.current.rotation.z  = t * 0.6
    if (ring2Ref.current)  ring2Ref.current.rotation.x  = t * 0.45
    if (ring3Ref.current)  ring3Ref.current.rotation.z  = -t * 0.35
    if (coreRef.current) {
      const m = coreRef.current.material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 0.35 + Math.sin(t * 1.8) * 0.15
    }
    if (beamRef.current) {
      const m = beamRef.current.material as THREE.MeshStandardMaterial
      m.opacity = 0.04 + Math.sin(t * 1.2) * 0.02
    }
    // Gentle hover bob for entire hologram
    if (groupRef.current) groupRef.current.position.y = 4 + Math.sin(t * 0.9) * 0.18
  })

  return (
    <group position={[0, 0, 8]}>
      {/* Pedestal */}
      <Cylinder args={[0.5, 0.8, 0.25, 16]} position={[0, 0.13, 0]}>
        <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
      </Cylinder>
      <Cylinder args={[0.15, 0.5, 3.7, 8]} position={[0, 2.0, 0]}>
        <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.2} />
      </Cylinder>
      {/* Base ring glow */}
      <mesh ref={baseRef} position={[0, 0.26, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.75, 0.06, 8, 32]} />
        <meshStandardMaterial color={tokens.accent} emissive={tokens.accent} emissiveIntensity={1.0} toneMapped={false} />
      </mesh>

      {/* Rotating orbital group */}
      <group ref={groupRef} position={[0, 4, 0]}>
        {/* Orbit ring 1 — primary horizontal */}
        <mesh ref={ring1Ref}>
          <torusGeometry args={[1.8, 0.055, 8, 40]} />
          <meshStandardMaterial color={tokens.accent} emissive={tokens.accent} emissiveIntensity={1.2} toneMapped={false} transparent opacity={0.85} />
        </mesh>
        {/* Orbit ring 2 — violet tilted */}
        <mesh ref={ring2Ref} rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[1.8, 0.045, 8, 40]} />
          <meshStandardMaterial color="#818cf8" emissive="#818cf8" emissiveIntensity={2.2} toneMapped={false} transparent opacity={0.75} />
        </mesh>
        {/* Orbit ring 3 — rose tilted */}
        <mesh ref={ring3Ref} rotation={[Math.PI / 1.5, Math.PI / 4, 0]}>
          <torusGeometry args={[1.8, 0.04, 8, 40]} />
          <meshStandardMaterial color="#f472b6" emissive="#f472b6" emissiveIntensity={2} toneMapped={false} transparent opacity={0.65} />
        </mesh>
        {/* Core wireframe sphere */}
        <mesh ref={coreRef}>
          <sphereGeometry args={[1.05, 12, 12]} />
          <meshStandardMaterial
            color={tokens.accent} emissive={tokens.accentSoft} emissiveIntensity={0.35}
            wireframe transparent opacity={0.45} toneMapped={false}
          />
        </mesh>
      </group>

      {/* Vertical light beam pillar */}
      <mesh ref={beamRef} position={[0, 5, 0]}>
        <cylinderGeometry args={[0.06, 1.6, 10, 16, 1, true]} />
        <meshStandardMaterial
          color={tokens.accent} emissive={tokens.accent} emissiveIntensity={0.2}
          side={THREE.BackSide} transparent opacity={0.05} toneMapped={false}
        />
      </mesh>
    </group>
  )
}

// ── LOUNGE SOFA CLUSTER + MEETING NOOK ──────────────────────────────────────
// Procedural box geometry, palette-bound to dashboard tokens. Soft furniture
// to fill the open floor zone next to the workspace booth and turn the
// existing hologram pedestal into a proper meeting nook.
function MeetingNookFurniture({ tokens }: { tokens: SceneTokens }) {
  return (
    <group>
      {/* ── Sofa cluster anchor rug ───────────────────────────────────────── */}
      {/* Spans the sofa+coffee-table+armchair zone so the cluster reads as a  */}
      {/* defined lounge pocket, not floating on the open floor.               */}
      <Box args={[10, 0.04, 7]} position={[-3, 0.022, 15]} receiveShadow>
        <meshStandardMaterial color={tokens.wallTrim} roughness={0.95} transparent opacity={0.55} />
      </Box>

      {/* ── Sofa cluster, centred near [-2, 0, 16] ────────────────────────── */}
      {/* Long sofa, facing south */}
      <group position={[-2, 0, 17]}>
        <Box args={[5, 0.6, 1.6]} position={[0, 0.6, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
        </Box>
        <Box args={[5, 1.4, 0.4]} position={[0, 1.5, 0.6]} castShadow>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
        </Box>
        <Box args={[4.6, 0.2, 1.3]} position={[0, 1.0, -0.05]}>
          <meshStandardMaterial color={tokens.floorAccent} roughness={0.85} />
        </Box>
        <Box args={[0.3, 1.1, 1.6]} position={[-2.5, 1.1, 0]}>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
        </Box>
        <Box args={[0.3, 1.1, 1.6]} position={[2.5, 1.1, 0]}>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
        </Box>
      </group>
      {/* Coffee table in front of sofa */}
      <group position={[-2, 0, 14]}>
        <Box args={[1.8, 0.4, 1.1]} position={[0, 0.4, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.5} />
        </Box>
        {[[-0.8, -0.45], [0.8, -0.45], [-0.8, 0.45], [0.8, 0.45]].map(([lx, lz], i) => (
          <Box key={i} args={[0.1, 0.4, 0.1]} position={[lx, 0.2, lz]}>
            <meshStandardMaterial color={tokens.foreground} roughness={0.5} />
          </Box>
        ))}
      </group>
      {/* Single armchair, slight angle, west of coffee table */}
      <group position={[-5, 0, 14]} rotation={[0, Math.PI / 5, 0]}>
        <Box args={[1.6, 0.6, 1.5]} position={[0, 0.6, 0]} castShadow>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
        </Box>
        <Box args={[1.6, 1.2, 0.3]} position={[0, 1.4, 0.55]}>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
        </Box>
        <Box args={[0.25, 0.9, 1.5]} position={[-0.7, 1.0, 0]}>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
        </Box>
        <Box args={[0.25, 0.9, 1.5]} position={[0.7, 1.0, 0]}>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
        </Box>
      </group>

      {/* ── Two potted plants flanking the sofa cluster ───────────────────── */}
      {[[-7, 18], [3, 18]].map(([px, pz]) => (
        <group key={`plant-${px}-${pz}`} position={[px, 0, pz]}>
          <Cylinder args={[0.45, 0.35, 0.7, 16]} position={[0, 0.35, 0]} castShadow>
            <meshStandardMaterial color={tokens.wallTrim} roughness={0.6} />
          </Cylinder>
          <Cylinder args={[0.42, 0.42, 0.05, 16]} position={[0, 0.72, 0]}>
            <meshStandardMaterial color="#3a2a1f" roughness={1} />
          </Cylinder>
          <Sphere args={[0.6, 16, 12]} position={[0, 1.3, 0]} castShadow>
            <meshStandardMaterial color="#7a9b6e" roughness={0.85} />
          </Sphere>
          <Sphere args={[0.45, 12, 10]} position={[0.25, 1.55, -0.1]} castShadow>
            <meshStandardMaterial color="#8aab7c" roughness={0.85} />
          </Sphere>
          <Sphere args={[0.4, 12, 10]} position={[-0.3, 1.6, 0.1]} castShadow>
            <meshStandardMaterial color="#6b8c5e" roughness={0.85} />
          </Sphere>
        </group>
      ))}

      {/* ── Framed art row on back wall (lounge side, not blocked by platform) */}
      {[
        { x: -22, w: 3.0, h: 2.2 },
        { x: -16, w: 3.0, h: 2.2 },
        { x: -10, w: 3.0, h: 2.2 },
        { x:  -4, w: 3.0, h: 2.2 },
      ].map((art, i) => (
        <group key={`art-${i}`} position={[art.x, 6.5, -29.2]}>
          <Box args={[art.w + 0.2, art.h + 0.2, 0.1]} position={[0, 0, 0]}>
            <meshStandardMaterial color={tokens.wallTrim} roughness={0.5} />
          </Box>
          <Box args={[art.w, art.h, 0.05]} position={[0, 0, 0.06]}>
            <meshStandardMaterial color={tokens.accentSoft} emissive={tokens.accentSoft} emissiveIntensity={0.05} roughness={0.6} />
          </Box>
        </group>
      ))}

      {/* ── Meeting nook anchor rug (circular) ────────────────────────────── */}
      {/* Defines the nook as an intentional zone with a soft floor mat.       */}
      <Cylinder args={[2.4, 2.4, 0.04, 32]} position={[4, 0.022, 4]} receiveShadow>
        <meshStandardMaterial color={tokens.accentSoft} roughness={0.95} transparent opacity={0.35} />
      </Cylinder>

      {/* ── Meeting nook: round table + 2 chairs adjacent to hologram pedestal */}
      {/* Hologram lives near [0, 0, 8]. Place table at [4, 0, 4] — south-east */}
      {/* of hologram, 4 units clear, on transit floor.                        */}
      <group position={[4, 0, 4]}>
        <Cylinder args={[1.1, 1.1, 0.1, 24]} position={[0, 0.95, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={tokens.wallTrim} roughness={0.5} />
        </Cylinder>
        <Cylinder args={[0.15, 0.25, 0.95, 12]} position={[0, 0.475, 0]}>
          <meshStandardMaterial color={tokens.foreground} roughness={0.5} />
        </Cylinder>
        <Cylinder args={[0.5, 0.5, 0.08, 16]} position={[0, 0.04, 0]}>
          <meshStandardMaterial color={tokens.foreground} roughness={0.5} />
        </Cylinder>
        {([[0, -1.6, 0], [0, 1.6, Math.PI]] as Array<[number, number, number]>).map(([cx, cz, rot], i) => (
          <group key={`chair-${i}`} position={[cx, 0, cz]} rotation={[0, rot, 0]}>
            <Box args={[0.9, 0.12, 0.9]} position={[0, 0.55, 0]} castShadow>
              <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
            </Box>
            <Box args={[0.9, 0.9, 0.1]} position={[0, 1.05, -0.4]}>
              <meshStandardMaterial color={tokens.wallTrim} roughness={0.7} />
            </Box>
            {[[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].map(([lx, lz], j) => (
              <Box key={j} args={[0.06, 0.55, 0.06]} position={[lx, 0.275, lz]}>
                <meshStandardMaterial color={tokens.foreground} roughness={0.5} />
              </Box>
            ))}
          </group>
        ))}
      </group>
    </group>
  )
}

function SceneRoom({ theme = "dark" }: { theme?: ThemeMode }) {
  const t = SCENE_THEME[theme]
  const tokens = useThemeTokens()
  return (
    <group>
      {/* ==================== FLOOR ==================== */}
      {/* Main floor slab — subdivided plane with Lambert shading for soft matte feel */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60, 24, 14]} />
        <meshLambertMaterial color={tokens.floor} />
      </mesh>
      {/* Wood-grain plank divisions — subtle horizontal strips, opacity 0.15 */}
      {[-26, -22, -18, -14, -10, -6, -2, 2, 6, 10, 14, 18, 22, 26].map((zPos) => (
        <Box key={`plank-${zPos}`} args={[60, 0.002, 0.04]} position={[0, 0.005, zPos]}>
          <meshBasicMaterial color={tokens.floorAccent} transparent opacity={0.15} />
        </Box>
      ))}
      {/* Main floor grid — kept as a faint guide overlay (lower opacity than before) */}
      <Grid
        position={[0, 0.011, 0]}
        args={[60, 60]}
        cellSize={2}
        cellThickness={0.6}
        cellColor={t.gridCell}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={t.gridSection}
        fadeDistance={80}
        fadeStrength={2}
      />

      {/* ===================== WALLS ===================== */}
      {/* Left wall (at x = -30) */}
      <Box args={[1, 12, 60]} position={[-30, 6, 0]} receiveShadow>
        <meshStandardMaterial color={tokens.wall} roughness={0.55} />
      </Box>
      {/* Back wall (at z = -30) */}
      <Box args={[60, 12, 1]} position={[0, 6, -30]} receiveShadow>
        <meshStandardMaterial color={tokens.wall} roughness={0.55} />
      </Box>
      {/* Wall trim molding — top edge of left wall */}
      <Box args={[0.4, 0.25, 60]} position={[-29.8, 11.9, 0]}>
        <meshStandardMaterial color={tokens.wallTrim} roughness={0.5} />
      </Box>
      {/* Wall trim molding — top edge of back wall */}
      <Box args={[60, 0.25, 0.4]} position={[0, 11.9, -29.8]}>
        <meshStandardMaterial color={tokens.wallTrim} roughness={0.5} />
      </Box>

      {/* Skirter LED Left Wall — dashboard accent (purple) */}
      <Box args={[0.2, 0.3, 60]} position={[-29.4, 0.3, 0]}>
        <meshStandardMaterial color={tokens.accent} emissive={tokens.accent} emissiveIntensity={0.6} toneMapped={false} />
      </Box>
      {/* Skirter LED Back Wall — dashboard accent (purple) */}
      <Box args={[60, 0.3, 0.2]} position={[0, 0.3, -29.4]}>
        <meshStandardMaterial color={tokens.accent} emissive={tokens.accent} emissiveIntensity={0.6} toneMapped={false} />
      </Box>

      {/* ============= WORKSPACE RAISED PLATFORM ============= */}
      {/* Elevated workspace area: X [2..28], Z [-28..-2] */}
      <Box args={[26, 0.6, 26]} position={[15, 0.3, -15]} receiveShadow castShadow>
        <meshStandardMaterial color="#dbeafe" roughness={0.4} />
      </Box>
      {/* Platform tile grid */}
      <Grid
        position={[15, 0.61, -15]}
        args={[26, 26]}
        cellSize={2}
        cellThickness={1}
        cellColor="#93c5fd"
        sectionSize={10}
        sectionThickness={1.5}
        sectionColor="#6366f1"
        fadeDistance={40}
      />
      {/* Purple glow edge strip around platform */}
      <Box args={[26.2, 0.15, 26.2]} position={[15, 0.62, -15]}>
        <meshStandardMaterial color="#6366f1" emissive="#6366f1" emissiveIntensity={0.6} toneMapped={false} />
      </Box>

      {/* Workspace ceiling lights — decorative only, 1 zone fill (no per-pendant pointLight) */}
      {[[8, -22], [15, -22], [22, -22], [8, -10], [15, -10], [22, -10]].map(([px, pz], i) => (
        <group key={i} position={[px, 10, pz]}>
          <Cylinder args={[0.15, 0.15, 2]} position={[0, 0, 0]}>
            <meshStandardMaterial color="#64748b" />
          </Cylinder>
          <Box args={[1.5, 0.2, 1.5]} position={[0, -1.1, 0]}>
            <meshStandardMaterial color="#fefce8" emissive="#fefce8" emissiveIntensity={2} toneMapped={false} />
          </Box>
        </group>
      ))}
      {/* 2 zone fills replace 6 pendant pointLights */}
      <pointLight position={[15, 7, -16]} intensity={1.2} distance={22} color="#fef3c7" />
      <pointLight position={[15, 7, -6]} intensity={1.0} distance={22} color="#fef3c7" />

      {/* New procedural lounge furniture (token-bound) */}
      <MeetingNookFurniture tokens={tokens} />

      {/* ============= BREAK / LOUNGE ZONE ============= */}
      {/* Lounge rug — centered between both sofas */}
      <Box args={[10, 0.05, 16]} position={[-18, 0.04, 20]} receiveShadow>
        <meshStandardMaterial color="#fde68a" transparent opacity={0.4} roughness={1} />
      </Box>

      {/* Props in lounge area */}
      <CoffeeCounter />
      <ArcadeArea />

      {/* Plants at corners */}
      <Plant position={[-27, 0, 5]} />
      <Plant position={[-27, 0, 27]} />
      <Plant position={[0, 0, 27]} />
      <Plant position={[-5, 0, 27]} />

      {/* ======= LOUNGE SEATING AREA — 4-Sofa Square Formation ======= */}
      {/*
        4 sofas forming a square lounge arrangement:
          Sofa N (north — back to wall, faces south) at z=13
          Sofa S (south — back to front wall, faces north) at z=27
          Sofa W (west — back to left wall, faces east) at x=-26
          Sofa E (east — faces west, closes the square) at x=-10
          Coffee table at the exact center
      */}
      {/* Square-outline rug */}
      <Box args={[18, 0.05, 16]} position={[-18, 0.04, 20]} receiveShadow>
        <meshStandardMaterial color="#fde68a" transparent opacity={0.35} roughness={1} />
      </Box>
      {/* Sofa NORTH — seat faces south (toward camera) */}
      <Sofa position={[-18, 0, 13]} rotation={[0, 0, 0]} />
      {/* Sofa SOUTH — seat faces north (toward interior) */}
      <Sofa position={[-18, 0, 27]} rotation={[0, Math.PI, 0]} />
      {/* Sofa WEST — seat faces east (+x) */}
      <Sofa position={[-26, 0, 20]} rotation={[0, Math.PI / 2, 0]} />
      {/* Sofa EAST — seat faces west (-x) */}
      <Sofa position={[-10, 0, 20]} rotation={[0, -Math.PI / 2, 0]} />
      {/* Coffee table dead-center of the square */}
      <CoffeeTbl position={[-18, 0, 20]} />
      {/* Floor lamp — far corner */}
      <group position={[-28, 0, 28]}>
        <Cylinder args={[0.08, 0.08, 5]} position={[0, 2.5, 0]} castShadow>
          <meshStandardMaterial color="#94a3b8" metalness={0.5} />
        </Cylinder>
        <Sphere args={[0.55]} position={[0, 5.4, 0]}>
          <meshStandardMaterial color="#fef3c7" emissive="#fef3c7" emissiveIntensity={2} toneMapped={false} />
          <pointLight intensity={1.5} distance={14} color="#fef3c7" decay={2} />
        </Sphere>
      </group>

      {/* ======= HOLOGRAM MEETING TABLE — aligned with lounge row ======= */}
      <HologramMeetingTable />

      {/* ======= ZONE LABELS ======= */}
      {/* WORKSPACE label */}
      <ZoneLabel position={[15, 7, -2]} label="💻  WORKSPACE" accent="#6366f1" />
      {/* COFFEE BAR label */}
      <ZoneLabel position={[-25, 7, -10]} label="☕  COFFEE BAR" accent="#f59e0b" />
      {/* LOUNGE label */}
      <ZoneLabel position={[-18, 6, 10]} label="🛋  LOUNGE" accent="#10b981" />
      {/* MEETING ROOM label */}
      <ZoneLabel position={[16, 6, 14]} label="🔵  MEETING ROOM" accent="#3b82f6" />
      {/* ARCADE label */}
      <ZoneLabel position={[-22, 7, -26]} label="🕹  ARCADE" accent="#a855f7" />
    </group>
  )
}

function Workstation3D({
  position,
  color,
  processing,
}: {
  position: [number, number, number]
  color: string
  processing: boolean
}) {
  const [x, y, z] = position
  return (
    <group position={[x, y, z]}>
      {/* 
        Cubicle faces SOUTH (toward +z / toward camera in iso view).
        Back wall at z = -2.5, side walls at x ± 3.
      */}
      {/* Back partition */}
      <Box args={[6, 4.5, 0.35]} position={[0, 2.25, -2.5]} castShadow receiveShadow>
        <meshStandardMaterial color="#cbd5e1" roughness={0.7} />
      </Box>
      {/* Left partition */}
      <Box args={[0.35, 4.5, 5]} position={[-3, 2.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#e2e8f0" roughness={0.7} />
      </Box>
      {/* Right partition */}
      <Box args={[0.35, 4.5, 5]} position={[3, 2.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#e2e8f0" roughness={0.7} />
      </Box>

      {/* Desk (wood top) */}
      <Box args={[5.5, 0.2, 2.8]} position={[0, 1.6, -0.8]} castShadow receiveShadow>
        <meshStandardMaterial color="#d4a574" roughness={0.6} />
      </Box>
      {/* Desk support panel */}
      <Box args={[5.5, 1.6, 0.15]} position={[0, 0.8, -2.1]} castShadow>
        <meshStandardMaterial color="#94a3b8" roughness={0.8} />
      </Box>

      {/* Monitor base */}
      <Box args={[0.5, 0.6, 0.4]} position={[0, 2, -1.8]} castShadow>
        <meshStandardMaterial color="#1e293b" />
      </Box>
      {/* Monitor frame */}
      <Box args={[3.2, 2, 0.18]} position={[0, 3, -2.2]} castShadow>
        <meshStandardMaterial color="#0f172a" />
      </Box>
      {/* Screen glow */}
      <Box args={[3, 1.8, 0.05]} position={[0, 3, -2.1]}>
        <meshStandardMaterial
          color={processing ? color : "#1e293b"}
          emissive={processing ? color : "#0d1117"}
          emissiveIntensity={processing ? 1.2 : 0.1}
          toneMapped={false}
        />
      </Box>

      {/* Overhead LED strip */}
      <Box args={[5.5, 0.1, 0.3]} position={[0, 4.4, -2.3]}>
        <meshStandardMaterial color="#ffffff" emissive="#fffbeb" emissiveIntensity={1.5} toneMapped={false} />
      </Box>

      {processing && <pointLight position={[0, 3, -1.5]} intensity={0.6} distance={6} color={color} decay={2} />}
    </group>
  )
}

// State status sign above workstation
function StatusSign({ position, state }: { position: [number, number, number], state: WorldState }) {
  const stateColor = state === "processing" ? "#f59e0b" : state === "working" ? "#22c55e" : "#94a3b8"
  const stateLabel = state === "processing" ? "BUSY" : state === "working" ? "WORKING" : "IDLE"
  return (
    <group position={position}>
      <Box args={[2.5, 0.8, 0.1]}>
        <meshStandardMaterial color="#1e293b" />
      </Box>
      <Box args={[2.3, 0.6, 0.05]} position={[0, 0, 0.06]}>
        <meshStandardMaterial color={stateColor} emissive={stateColor} emissiveIntensity={1} toneMapped={false} />
      </Box>
      <Text
        position={[0, 0, 0.12]}
        fontSize={0.32}
        color="#1e293b"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        {stateLabel}
      </Text>
    </group>
  )
}

// ── Agent hover profile card (rendered as HTML in 3D space) ──────────────────
function AgentProfileCard({ agent, state, color }: { agent: Agent; state: WorldState; color: string }) {
  const tokens = useThemeTokens()
  const preset = AVATAR_PRESETS.find(p => p.id === agent.avatarPresetId) ?? null
  const accentColor = preset?.color ?? color

  // ── Derive stats — prefer the Agent's lifetime totals so this card stays in
  //    lockstep with the nametag + pill bar (which read those same fields).
  //    Fall back to summing the in-memory session store only if the Agent
  //    object hasn't been hydrated with totals yet.
  const sessions = useSessionStore(s => s.sessions)
  const agentSessions = useMemo(
    () => sessions.filter(s => s.agentId === agent.id),
    [sessions, agent.id]
  )
  const sessionCount  = agent.sessionCount ?? agentSessions.length
  const totalCost     = agent.totalCost ?? agentSessions.reduce((sum, s) => sum + (s.totalCost ?? 0), 0)
  const totalTokens   = agent.totalTokens ?? agentSessions.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0)
  const totalTokensK  = totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}k` : "—"

  const statusMeta: Record<WorldState, { label: string; bg: string; dot: string }> = {
    processing: { label: "Processing",  bg: "rgba(251,146,60,0.18)",  dot: "#fb923c" },
    working:    { label: "Working",     bg: "rgba(52,211,153,0.18)",  dot: "#34d399" },
    idle:       { label: "Wandering",   bg: "rgba(148,163,184,0.14)", dot: "#94a3b8" },
    offline:    { label: "Offline",     bg: "rgba(100,116,139,0.12)", dot: "#64748b" },
  }
  const sm = statusMeta[state]

  // Format helpers
  const fmtCost = (n: number) => n === 0 ? "—" : `$${n.toFixed(4)}`
  const fmtNum  = (n: number) => n === 0 ? "—" : n.toLocaleString()

  // Shared leveling formula (memory + session + age)
  const lvl = computeAgentLevel({
    sessionCount,
    totalTokens,
    createdAt: agent.createdAt,
  })
  const expLevel = lvl.level
  const expPct   = lvl.pct
  const sessionPct = Math.min(100, Math.round(lvl.breakdown.session / 1.5))
  const tokenPct   = Math.min(100, Math.round(lvl.breakdown.memory / 1.5))

  return (
    <div style={{
      width: 220,
      background: "rgba(10,16,32,0.94)",
      backdropFilter: "blur(16px)",
      borderRadius: 14,
      border: `1.5px solid ${accentColor}55`,
      boxShadow: `0 0 0 1px ${accentColor}22, 0 8px 40px rgba(0,0,0,0.7), 0 0 24px ${accentColor}33`,
      fontFamily: "'Inter', system-ui, sans-serif",
      overflow: "hidden",
      pointerEvents: "none",
      transform: "translateX(-50%)",
      userSelect: "none",
    }}>
      {/* Header stripe */}
      <div style={{
        background: `linear-gradient(135deg, ${accentColor}cc 0%, ${accentColor}44 100%)`,
        padding: "12px 14px 10px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderBottom: `1px solid ${accentColor}33`,
      }}>
        {/* Avatar */}
        <div style={{
          width: 44, height: 44,
          borderRadius: 10,
          border: `2px solid ${accentColor}99`,
          overflow: "hidden",
          background: "rgba(0,0,0,0.3)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
        }}>
          {preset ? (
            <img src={preset.file} alt={preset.name}
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span>{agent.emoji}</span>
          )}
        </div>
        {/* Name + preset */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: "#f8fafc",
            lineHeight: 1.2, letterSpacing: 0.2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {agent.emoji} {agent.name}
          </div>
          {preset && (
            <div style={{ fontSize: 10, color: accentColor, fontWeight: 600, marginTop: 2, letterSpacing: 0.5 }}>
              {preset.name.toUpperCase()} · {preset.vibe}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "10px 14px 12px" }}>
        {/* Status badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            background: sm.bg, borderRadius: 6,
            padding: "3px 8px",
            border: `1px solid ${sm.dot}33`,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: sm.dot,
              boxShadow: `0 0 6px ${sm.dot}`,
              animation: state === "processing" ? "pulse 1s infinite" : "none",
            }} />
            <span style={{ fontSize: 10, color: sm.dot, fontWeight: 700, letterSpacing: 0.6 }}>
              {sm.label.toUpperCase()}
            </span>
          </div>
          {agent.type && (
            <div style={{
              fontSize: 9, color: "#64748b", fontWeight: 600,
              background: "rgba(100,116,139,0.12)", borderRadius: 4,
              padding: "2px 6px", border: "1px solid rgba(100,116,139,0.2)",
              letterSpacing: 0.5,
            }}>
              {agent.type.toUpperCase()}
            </div>
          )}
        </div>

        {/* Stats row */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          gap: "6px 10px", marginBottom: 10,
        }}>
          {([
            { label: "Sessions", value: fmtNum(sessionCount) },
            { label: "Cost",     value: fmtCost(totalCost) },
            { label: "Tokens",   value: totalTokensK },
            { label: "Status",   value: sm.label },
          ] as const).map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 9, color: "#475569", fontWeight: 600, letterSpacing: 0.5, marginBottom: 1 }}>
                {label.toUpperCase()}
              </div>
              <div style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>


        {/* Model pill */}
        {agent.model && (
          <div style={{
            fontSize: 9, color: "#94a3b8",
            background: "rgba(148,163,184,0.08)",
            border: "1px solid rgba(148,163,184,0.15)",
            borderRadius: 5, padding: "3px 7px", marginBottom: 10,
            fontFamily: "monospace", letterSpacing: 0.3,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            ⚙ {agent.model}
          </div>
        )}

        {/* EXP bar — composite sessions + tokens */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 9, color: "#475569", fontWeight: 600, letterSpacing: 0.5 }}>EXP</span>
              <div style={{
                fontSize: 8, fontWeight: 800, color: accentColor,
                background: `${accentColor}22`,
                border: `1px solid ${accentColor}44`,
                borderRadius: 3, padding: "1px 5px", letterSpacing: 0.4,
              }}>L{expLevel}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: 1, background: tokens.accent, display: "inline-block" }} />
                <span style={{ fontSize: 8, color: "#64748b" }}>Sessions</span>
                <span style={{ width: 6, height: 6, borderRadius: 1, background: accentColor, display: "inline-block", marginLeft: 4 }} />
                <span style={{ fontSize: 8, color: "#64748b" }}>Tokens</span>
              </div>
            </div>
            <span style={{ fontSize: 9, color: accentColor, fontWeight: 700 }}>{expPct}%</span>
          </div>
          {/* Segmented bar: cyan = sessions, accent = tokens */}
          <div style={{
            height: 5, borderRadius: 3,
            background: "rgba(255,255,255,0.07)",
            overflow: "hidden",
            display: "flex",
          }}>
            <div style={{
              height: "100%",
              width: `${sessionPct / 2}%`,
              background: `linear-gradient(90deg, ${tokens.accentSoft}, ${tokens.accent})`,
              boxShadow: `0 0 6px ${tokens.accent}88`,
              borderRadius: "3px 0 0 3px",
              transition: "width 0.4s ease",
            }} />
            <div style={{
              height: "100%",
              width: `${tokenPct / 2}%`,
              background: `linear-gradient(90deg, ${accentColor}88, ${accentColor})`,
              boxShadow: `0 0 6px ${accentColor}88`,
              borderRadius: tokenPct > 0 ? "0 3px 3px 0" : 0,
              transition: "width 0.4s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
            <span style={{ fontSize: 8, color: "#334155" }}>{sessionPct}% sessions</span>
            <span style={{ fontSize: 8, color: "#334155" }}>{tokenPct}% tokens</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Pulsing floor aura shown when working / processing ───────────────────────
function WorkingAura({ color, processing }: { color: string; processing: boolean }) {
  const innerRef = useRef<THREE.Mesh>(null)
  const outerRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const speed = processing ? 5 : 2.8

    if (innerRef.current) {
      const mat = innerRef.current.material as THREE.MeshStandardMaterial
      const pulse = 0.5 + Math.sin(t * speed) * 0.35
      mat.emissiveIntensity = pulse
      const s = 1 + Math.sin(t * speed) * 0.1
      innerRef.current.scale.set(s, 1, s)
    }
    if (outerRef.current) {
      const mat = outerRef.current.material as THREE.MeshStandardMaterial
      const pulse = 0.2 + Math.sin(t * speed + Math.PI) * 0.15
      mat.emissiveIntensity = pulse
      const s = 1 + Math.sin(t * speed + Math.PI) * 0.14
      outerRef.current.scale.set(s, 1, s)
    }
  })

  return (
    <group position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Inner ring */}
      <mesh ref={innerRef}>
        <torusGeometry args={[1.0, 0.055, 8, 48]} />
        <meshStandardMaterial
          color={color} emissive={color} emissiveIntensity={0.6}
          transparent opacity={0.8} toneMapped={false}
        />
      </mesh>
      {/* Outer ring — offset phase for ripple effect */}
      <mesh ref={outerRef}>
        <torusGeometry args={[processing ? 1.6 : 1.35, 0.03, 8, 48]} />
        <meshStandardMaterial
          color={color} emissive={color} emissiveIntensity={0.3}
          transparent opacity={0.45} toneMapped={false}
        />
      </mesh>
    </group>
  )
}

// ── Tiered LevelAura ────────────────────────────────────────────────────────
// Renders progressively richer visuals around an agent based on their level
// tier. T1 (L1-19) renders nothing; T2 adds a subtle ring; T3+ animate; T4+
// add a vertical light beam; T5+ add orbital particles; T6 (L100) is the most
// pronounced. The aura sits at the agent's feet and follows them via the
// parent group transform.
function LevelAura({ tier }: { tier: AgentTier }) {
  const ringRef    = useRef<THREE.Mesh>(null)
  const orbitsRef  = useRef<THREE.Group>(null)
  const beamRef    = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (tier.animated && ringRef.current) {
      ringRef.current.scale.setScalar(1 + Math.sin(t * 1.6) * 0.06)
    }
    if (tier.particles && orbitsRef.current) {
      orbitsRef.current.rotation.y = t * 0.6
    }
    if (tier.beam && beamRef.current) {
      const m = beamRef.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.10 + Math.sin(t * 1.2) * 0.04
    }
  })

  if (tier.index === 1) return null

  return (
    <group>
      {/* Ground ring */}
      <mesh ref={ringRef} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.95, 1.15, 48]} />
        <meshBasicMaterial
          color={tier.color}
          transparent
          opacity={Math.min(1, 0.45 + tier.intensity * 0.4)}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Soft inner glow disc — stronger for higher tiers */}
      <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0, 0.95, 48]} />
        <meshBasicMaterial
          color={tier.color}
          transparent
          opacity={0.06 + tier.intensity * 0.08}
          toneMapped={false}
        />
      </mesh>
      {/* Vertical light beam — Master tier and above */}
      {tier.beam && (
        <mesh ref={beamRef} position={[0, 4, 0]}>
          <cylinderGeometry args={[0.08, 0.7, 8, 16, 1, true]} />
          <meshBasicMaterial
            color={tier.color}
            transparent
            opacity={0.12}
            toneMapped={false}
            side={THREE.BackSide}
          />
        </mesh>
      )}
      {/* Orbital particles — Legend / Mythic tiers */}
      {tier.particles && (
        <group ref={orbitsRef} position={[0, 1.2, 0]}>
          {[0, 1, 2, 3, 4].map(i => {
            const angle = (i / 5) * Math.PI * 2
            return (
              <mesh key={i} position={[Math.cos(angle) * 1.3, Math.sin(i * 1.7) * 0.25, Math.sin(angle) * 1.3]}>
                <sphereGeometry args={[0.06, 8, 6]} />
                <meshBasicMaterial color={tier.color} transparent opacity={0.9} toneMapped={false} />
              </mesh>
            )
          })}
        </group>
      )}
    </group>
  )
}

// Floating nametag above each agent's head — glass background, level pill,
// avatar preset thumbnail. Renders inside an `<Html>` so we get real CSS.
function AgentNameTag({ agent }: { agent: Agent }) {
  const lvl = useMemo(() => computeAgentLevel({
    sessionCount: agent.sessionCount,
    totalTokens: agent.totalTokens,
    createdAt: agent.createdAt,
  }), [agent.sessionCount, agent.totalTokens, agent.createdAt])
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px 3px 3px",
        borderRadius: 999,
        background: "rgba(20, 22, 30, 0.62)",
        backdropFilter: "blur(14px) saturate(180%)",
        WebkitBackdropFilter: "blur(14px) saturate(180%)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.08) inset, 0 6px 18px rgba(0,0,0,0.45)",
        whiteSpace: "nowrap",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* Avatar preset thumbnail */}
      <span
        style={{
          width: 22, height: 22,
          borderRadius: 999,
          overflow: "hidden",
          background: agent.color || "#6366f1",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.18)",
        }}
      >
        <AgentAvatar avatarPresetId={agent.avatarPresetId} emoji={agent.emoji} size="w-5 h-5" />
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9", letterSpacing: 0.1 }}>
        {agent.name}
      </span>
      {/* Level pill — coloured by tier */}
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.4,
          padding: "2px 7px",
          borderRadius: 999,
          background: tierGradient(lvl.tier.color),
          color: "#0f0a1a",
          textShadow: "0 1px 0 rgba(255,255,255,0.25)",
          boxShadow: `0 0 0 1px rgba(255,255,255,0.18) inset, 0 2px 6px ${lvl.tier.color}66`,
        }}
        title={`${lvl.tier.label} · XP ${lvl.xp.toLocaleString()}${lvl.level < 100 ? ` · ${lvl.pct}% to L${lvl.level + 1}` : " · MAX"} · age ${Math.floor(lvl.ageDays)}d · sessions ${agent.sessionCount || 0} · tokens ${(agent.totalTokens || 0).toLocaleString()}`}
      >
        L{lvl.level}
      </span>
    </div>
  )
}

function AgentAvatar3D({
  agent,
  state,
  deskPos,
  color,
}: {
  agent: Agent
  state: WorldState
  deskPos: [number, number, number]
  color: string
}) {
  const tokens = useThemeTokens()
  // ── Unique per-agent hash for deterministic initial spread ──────────────
  const agentIdHash = useMemo(() =>
    agent.id.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffff, 0)
  , [agent.id])

  // ── Path-following refs (never trigger re-renders, driven in useFrame) ───
  const pathRef          = useRef<[number, number][]>([])
  const currentTargetRef = useRef<[number, number]>([0, 0])
  const destFacingRef    = useRef<number>(0)
  const arrivedAtDestRef = useRef<boolean>(false)
  const lastWpIdxRef     = useRef<number>(agentIdHash % WAYPOINTS.length)
  // Mode tracking for desk-approach corridor routing
  const modeRef          = useRef<'wander' | 'desk-approach' | 'at-desk'>('wander')
  const pathReadyRef     = useRef<boolean>(false)

  // Mesh refs for live material animation (no re-renders)
  const bodyRef     = useRef<THREE.Mesh>(null)
  const eyeRef      = useRef<THREE.Mesh>(null)
  const eyeRef2     = useRef<THREE.Mesh>(null)

  // Limb refs for walk animation (pivot groups — rotate about X for gait)
  const hipLRef      = useRef<THREE.Group>(null)
  const hipRRef      = useRef<THREE.Group>(null)
  const kneeLRef     = useRef<THREE.Group>(null)
  const kneeRRef     = useRef<THREE.Group>(null)
  const shoulderLRef = useRef<THREE.Group>(null)
  const shoulderRRef = useRef<THREE.Group>(null)
  const elbowLRef    = useRef<THREE.Group>(null)
  const elbowRRef    = useRef<THREE.Group>(null)

  // Gait phase accumulator — advances while walking, decays at rest
  const gaitRef     = useRef<number>(0)
  const prevXRef    = useRef<number>(0)
  const prevZRef    = useRef<number>(0)
  const darkerColor = useMemo(() => {
    const c = new THREE.Color(color)
    c.multiplyScalar(0.65)
    return '#' + c.getHexString()
  }, [color])

  const pickAndStartPath = useCallback(() => {
    const g  = groupRef.current
    const cx = g ? g.position.x : 0
    const cz = g ? g.position.z : 0

    const n    = WAYPOINTS.length
    const jump = 3 + Math.floor(Math.random() * (n - 3))
    const idx  = (lastWpIdxRef.current + jump) % n
    lastWpIdxRef.current = idx
    const wp = WAYPOINTS[idx]

    // Prepend safe zone-exit nodes so agents never cut diagonally through furniture
    const bridge = getBridgeNodes(cx, cz)
    const nodes: [number, number][] = [...bridge, ...wp.via, wp.dest]
    destFacingRef.current    = wp.facing
    arrivedAtDestRef.current = false
    if (nodes.length > 0) {
      pathRef.current          = nodes.slice(1)
      currentTargetRef.current = nodes[0]
    }
  }, [])

  useEffect(() => {
    if (state !== "idle" && state !== "offline") return
    const stagger = (agentIdHash % 80) * 100
    let intervalId: ReturnType<typeof setInterval> | null = null
    const timeoutId = setTimeout(() => {
      pickAndStartPath()
      intervalId = setInterval(() => {
        pickAndStartPath()
      }, 9000 + Math.random() * 6000)
    }, stagger)
    return () => {
      clearTimeout(timeoutId)
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [state, agentIdHash, pickAndStartPath])

  // Trigger desk-path routing when entering working/processing state
  useEffect(() => {
    if (state === 'working' || state === 'processing') {
      modeRef.current      = 'desk-approach'
      pathReadyRef.current = false   // Let useFrame build path lazily from live position
    } else {
      modeRef.current = 'wander'
    }
  }, [state, deskPos])

  const groupRef = useRef<THREE.Group>(null)

  useFrame((ctx, delta) => {
    const g = groupRef.current
    if (!g) return
    const t = ctx.clock.elapsedTime

    // ── Working / Processing: corridor-route to desk, then animate ─────────
    if (state === "working" || state === "processing") {
      // Lazy path build from live position on first frame of this state
      if (!pathReadyRef.current) {
        const deskPath = buildDeskPath(g.position.x, g.position.z, deskPos)
        if (deskPath.length > 0) {
          currentTargetRef.current = deskPath[0]
          pathRef.current          = deskPath.slice(1)
          arrivedAtDestRef.current = false
        } else {
          modeRef.current = 'at-desk'
        }
        pathReadyRef.current = true
      }

      // ── Desk-approach: follow corridor waypoints ────────────────────────
      if (modeRef.current === 'desk-approach') {
        const [tx, tz] = currentTargetRef.current
        const ddx  = tx - g.position.x
        const ddz  = tz - g.position.z
        const dist = Math.sqrt(ddx * ddx + ddz * ddz)   // Euclidean

        if (dist > 0.25) {
          // Fixed-speed approach — no exponential creep, always arrives
          const step = Math.min(DESK_WALK_SPEED * delta, dist)
          g.position.x += (ddx / dist) * step
          g.position.z += (ddz / dist) * step
          g.position.y  = THREE.MathUtils.lerp(g.position.y, deskPos[1], delta * 4)
          g.rotation.x  = THREE.MathUtils.lerp(g.rotation.x, 0, delta * 4)
          const walkAngle = Math.atan2(ddx, ddz)
          const dRot = ((walkAngle - g.rotation.y + Math.PI) % (2 * Math.PI)) - Math.PI
          g.rotation.y += dRot * Math.min(delta * 8, 1)
        } else {
          g.position.x = tx; g.position.z = tz   // snap to avoid float drift
          if (pathRef.current.length > 0) {
            currentTargetRef.current = pathRef.current.shift()!
          } else {
            modeRef.current = 'at-desk'
          }
        }
        return
      }

      // ── At desk: typing + emissive animation ───────────────────────────
      const targetX  = deskPos[0]
      const targetY  = deskPos[1]
      const targetZ  = deskPos[2] + 3.5
      const speed    = state === "processing" ? 8 : 5
      const bobAmt   = state === "processing" ? 0.10 : 0.06
      const leanAmt  = state === "processing" ? 0.07 : 0.04
      const bob  = Math.sin(t * speed) * bobAmt
      const lean = Math.sin(t * speed * 0.65) * leanAmt

      g.position.x = THREE.MathUtils.lerp(g.position.x, targetX,       delta * 6)
      g.position.y = THREE.MathUtils.lerp(g.position.y, targetY + bob,  delta * 14)
      g.position.z = THREE.MathUtils.lerp(g.position.z, targetZ,       delta * 6)
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, Math.PI,       delta * 6)
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, lean,          delta * 10)

      const eyeIntensity = state === "processing"
        ? 3 + Math.sin(t * 9) * 2
        : 2 + Math.sin(t * 4) * 0.8
      ;[eyeRef, eyeRef2].forEach(r => {
        if (r.current) (r.current.material as THREE.MeshStandardMaterial).emissiveIntensity = eyeIntensity
      })
      if (bodyRef.current) {
        const mat = bodyRef.current.material as THREE.MeshStandardMaterial
        mat.emissiveIntensity = state === "processing"
          ? 0.15 + Math.sin(t * 7) * 0.12
          : 0.05 + Math.sin(t * 3) * 0.04
      }
      return
    }

    // ── Idle / offline: path-follow ─────────────────────────────────────────
    // Reset lean and body glow
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, 0, delta * 3)
    if (bodyRef.current) {
      const mat = bodyRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, 0, delta * 3)
    }
    ;[eyeRef, eyeRef2].forEach(r => {
      if (r.current) {
        const mat = r.current.material as THREE.MeshStandardMaterial
        mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, 2, delta * 3)
      }
    })

    // ── Fixed-speed walk (constant WALK_SPEED units/sec, always arrives cleanly) ──
    const [tx, tz] = currentTargetRef.current
    const ddx  = tx - g.position.x
    const ddz  = tz - g.position.z
    const dist = Math.sqrt(ddx * ddx + ddz * ddz)

    if (dist > 0.25) {
      const step = Math.min(WALK_SPEED * delta, dist)
      g.position.x += (ddx / dist) * step
      g.position.z += (ddz / dist) * step
      g.position.y  = THREE.MathUtils.lerp(g.position.y, 0, delta * 5)
      // Rotate smoothly toward direction of travel
      const targetAngle = Math.atan2(ddx, ddz)
      const diff = ((targetAngle - g.rotation.y + Math.PI) % (2 * Math.PI)) - Math.PI
      g.rotation.y += diff * Math.min(delta * 8, 1)
    } else {
      g.position.x = tx; g.position.z = tz   // snap to remove drift
      if (pathRef.current.length > 0) {
        currentTargetRef.current = pathRef.current.shift()!
      } else if (!arrivedAtDestRef.current) {
        arrivedAtDestRef.current = true
        const faceDiff = ((destFacingRef.current - g.rotation.y + Math.PI) % (2 * Math.PI)) - Math.PI
        g.rotation.y += faceDiff * delta * 6
      } else {
        const faceDiff = ((destFacingRef.current - g.rotation.y + Math.PI) % (2 * Math.PI)) - Math.PI
        g.rotation.y += faceDiff * delta * 3
      }
    }

    // ── Agent separation: gentle repulsion so agents never fully overlap ──────
    AGENT_WORLD_POSITIONS.set(agent.id, [g.position.x, g.position.z])
    let sepX = 0, sepZ = 0
    AGENT_WORLD_POSITIONS.forEach((pos, id) => {
      if (id === agent.id) return
      const dx = g.position.x - pos[0]
      const dz = g.position.z - pos[1]
      const d  = Math.sqrt(dx * dx + dz * dz)
      if (d < SEP_RADIUS && d > 0.01) {
        const force = (SEP_RADIUS - d) / SEP_RADIUS * SEP_FORCE * delta
        sepX += (dx / d) * force
        sepZ += (dz / d) * force
      }
    })
    g.position.x += sepX
    g.position.z += sepZ

    // ── Walking / arm-swing gait animation ──────────────────────────────────
    const dx2 = g.position.x - prevXRef.current
    const dz2 = g.position.z - prevZRef.current
    const speed = Math.sqrt(dx2 * dx2 + dz2 * dz2) / Math.max(delta, 1/120)
    prevXRef.current = g.position.x
    prevZRef.current = g.position.z
    const moving = speed > 0.5
    // Advance gait when moving (frequency scales with speed)
    if (moving) {
      const freq = THREE.MathUtils.clamp(speed * 0.6, 5, 14)
      gaitRef.current += delta * freq
    }
    const gait = gaitRef.current
    const swing = moving ? 0.45 : 0
    const kneeBend = moving ? 0.55 : 0
    const armSwing = moving ? 0.40 : 0

    const lerp = (cur: number, target: number) => THREE.MathUtils.lerp(cur, target, Math.min(delta * 12, 1))

    if (hipLRef.current) hipLRef.current.rotation.x = lerp(hipLRef.current.rotation.x,  Math.sin(gait)     * swing)
    if (hipRRef.current) hipRRef.current.rotation.x = lerp(hipRRef.current.rotation.x, -Math.sin(gait)     * swing)
    if (kneeLRef.current) kneeLRef.current.rotation.x = lerp(kneeLRef.current.rotation.x, Math.max(0, Math.sin(gait + Math.PI)) * kneeBend)
    if (kneeRRef.current) kneeRRef.current.rotation.x = lerp(kneeRRef.current.rotation.x, Math.max(0, Math.sin(gait))           * kneeBend)
    if (shoulderLRef.current) shoulderLRef.current.rotation.x = lerp(shoulderLRef.current.rotation.x, -Math.sin(gait) * armSwing)
    if (shoulderRRef.current) shoulderRRef.current.rotation.x = lerp(shoulderRRef.current.rotation.x,  Math.sin(gait) * armSwing)
    if (elbowLRef.current) elbowLRef.current.rotation.x = lerp(elbowLRef.current.rotation.x, moving ? (0.3 + Math.max(0, -Math.sin(gait)) * 0.3) : 0)
    if (elbowRRef.current) elbowRRef.current.rotation.x = lerp(elbowRRef.current.rotation.x, moving ? (0.3 + Math.max(0,  Math.sin(gait)) * 0.3) : 0)

    // Subtle body bob when walking
    if (moving) {
      const bob = Math.abs(Math.sin(gait)) * 0.05
      g.position.y = THREE.MathUtils.lerp(g.position.y, bob, delta * 6)
    }
  })

  const [hovered, setHovered] = useState(false)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerEnter = useCallback((e: any) => {
    e.stopPropagation()
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    setHovered(true)
  }, [])

  const handlePointerLeave = useCallback((e: any) => {
    e.stopPropagation()
    leaveTimerRef.current = setTimeout(() => setHovered(false), 250)
  }, [])

  const [initPos] = useState<[number, number, number]>(() => {
    const wp = WAYPOINTS[lastWpIdxRef.current]
    return [wp.dest[0], 0, wp.dest[1]]
  })

  const auraColor = state === "processing" ? "#fb923c" : tokens.accent

  // Compute level once per agent (cheap; no allocations in useFrame).
  const lvl = useMemo(() => computeAgentLevel({
    sessionCount: agent.sessionCount,
    totalTokens:  agent.totalTokens,
    createdAt:    agent.createdAt,
  }), [agent.sessionCount, agent.totalTokens, agent.createdAt])

  return (
    <group ref={groupRef} position={initPos}>
      {/* Tier-based level aura — always-on, scales with level (T2-T6) */}
      <LevelAura tier={lvl.tier} />

      {/* Working / processing floor aura */}
      {(state === "working" || state === "processing") && (
        <WorkingAura color={auraColor} processing={state === "processing"} />
      )}

      {/* ── Large invisible hover hitbox covering the whole avatar ── */}
      <Box
        args={[2.8, 4.0, 2.8]}
        position={[0, 1.7, 0]}
        visible={false}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      />

      {/* ══════ LEGS — short & chunky ══════ */}
      <group ref={hipLRef} position={[-0.28, 0.72, 0]}>
        <Cylinder args={[0.17, 0.20, 0.32, 12]} position={[0, -0.16, 0]} castShadow>
          <meshStandardMaterial color={darkerColor} roughness={0.55} metalness={0.2} />
        </Cylinder>
        <Sphere args={[0.19, 12, 8]} position={[0, -0.32, 0]} castShadow>
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.25} />
        </Sphere>
        <group ref={kneeLRef} position={[0, -0.32, 0]}>
          <Cylinder args={[0.16, 0.18, 0.30, 12]} position={[0, -0.15, 0]} castShadow>
            <meshStandardMaterial color={darkerColor} roughness={0.55} metalness={0.2} />
          </Cylinder>
          <Box args={[0.34, 0.14, 0.48]} position={[0, -0.35, 0.10]} castShadow>
            <meshStandardMaterial color="#1a1a22" roughness={0.7} metalness={0.15} />
          </Box>
        </group>
      </group>
      <group ref={hipRRef} position={[0.28, 0.72, 0]}>
        <Cylinder args={[0.17, 0.20, 0.32, 12]} position={[0, -0.16, 0]} castShadow>
          <meshStandardMaterial color={darkerColor} roughness={0.55} metalness={0.2} />
        </Cylinder>
        <Sphere args={[0.19, 12, 8]} position={[0, -0.32, 0]} castShadow>
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.25} />
        </Sphere>
        <group ref={kneeRRef} position={[0, -0.32, 0]}>
          <Cylinder args={[0.16, 0.18, 0.30, 12]} position={[0, -0.15, 0]} castShadow>
            <meshStandardMaterial color={darkerColor} roughness={0.55} metalness={0.2} />
          </Cylinder>
          <Box args={[0.34, 0.14, 0.48]} position={[0, -0.35, 0.10]} castShadow>
            <meshStandardMaterial color="#1a1a22" roughness={0.7} metalness={0.15} />
          </Box>
        </group>
      </group>

      {/* Pelvis / hip block — chunky, wide base */}
      <Box args={[0.88, 0.30, 0.70]} position={[0, 0.86, 0]} castShadow>
        <meshStandardMaterial color={darkerColor} roughness={0.5} metalness={0.2} />
      </Box>

      {/* ══════ TORSO — wide, rounded, chunky ══════ */}
      <Cylinder
        ref={bodyRef}
        args={[0.72, 0.80, 0.90, 24]}
        position={[0, 1.50, 0]}
        castShadow
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0}
          roughness={0.38}
          metalness={0.3}
        />
      </Cylinder>
      {/* Rounded shoulder cap — mascot silhouette */}
      <Sphere args={[0.72, 24, 16]} scale={[1, 0.55, 0.95]} position={[0, 1.88, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.38} metalness={0.3} />
      </Sphere>

      {/* Chest plate — raised darker panel housing the orb */}
      <Cylinder args={[0.34, 0.34, 0.06, 24]} position={[0, 1.50, 0.80]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <meshStandardMaterial color={darkerColor} roughness={0.45} metalness={0.5} />
      </Cylinder>
      {/* Housing ring around orb */}
      <mesh position={[0, 1.50, 0.83]}>
        <torusGeometry args={[0.22, 0.055, 12, 28]} />
        <meshStandardMaterial color="#0a0a12" roughness={0.25} metalness={0.8} />
      </mesh>
      {/* Glowing core orb */}
      <Sphere args={[0.18, 16, 12]} position={[0, 1.50, 0.85]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3.8} toneMapped={false} roughness={0.05} />
      </Sphere>

      {/* Shoulder armor bolts — small rivets on shoulder joints for mech detail */}
      {[-0.88, 0.88].map((xp) => (
        <Sphere key={xp} args={[0.035, 8, 6]} position={[xp, 1.88, 0.26]}>
          <meshStandardMaterial color={darkerColor} roughness={0.4} metalness={0.7} />
        </Sphere>
      ))}

      {/* ══════ ARMS — short, stubby ══════ */}
      <group ref={shoulderLRef} position={[-0.88, 1.88, 0]}>
        <Sphere args={[0.28, 14, 10]} castShadow>
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.15} />
        </Sphere>
        <Cylinder args={[0.16, 0.18, 0.32, 12]} position={[0, -0.17, 0]} castShadow>
          <meshStandardMaterial color={darkerColor} roughness={0.4} metalness={0.2} />
        </Cylinder>
        <group ref={elbowLRef} position={[0, -0.33, 0]}>
          <Sphere args={[0.15, 12, 8]} castShadow>
            <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
          </Sphere>
          <Cylinder args={[0.15, 0.17, 0.30, 12]} position={[0, -0.15, 0]} castShadow>
            <meshStandardMaterial color={darkerColor} roughness={0.4} metalness={0.2} />
          </Cylinder>
          {/* Chunky hand */}
          <Sphere args={[0.20, 14, 10]} position={[0, -0.34, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.35} metalness={0.18} />
          </Sphere>
        </group>
      </group>
      <group ref={shoulderRRef} position={[0.88, 1.88, 0]}>
        <Sphere args={[0.28, 14, 10]} castShadow>
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.15} />
        </Sphere>
        <Cylinder args={[0.16, 0.18, 0.32, 12]} position={[0, -0.17, 0]} castShadow>
          <meshStandardMaterial color={darkerColor} roughness={0.4} metalness={0.2} />
        </Cylinder>
        <group ref={elbowRRef} position={[0, -0.33, 0]}>
          <Sphere args={[0.15, 12, 8]} castShadow>
            <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
          </Sphere>
          <Cylinder args={[0.15, 0.17, 0.30, 12]} position={[0, -0.15, 0]} castShadow>
            <meshStandardMaterial color={darkerColor} roughness={0.4} metalness={0.2} />
          </Cylinder>
          <Sphere args={[0.20, 14, 10]} position={[0, -0.34, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.35} metalness={0.18} />
          </Sphere>
        </group>
      </group>

      {/* Neck — short, stubby */}
      <Cylinder args={[0.24, 0.28, 0.14, 14]} position={[0, 2.05, 0]} castShadow>
        <meshStandardMaterial color={darkerColor} roughness={0.55} metalness={0.1} />
      </Cylinder>

      {/* ══════ HEAD — large mech helmet ══════ */}
      <group position={[0, 2.80, 0]}>
        {/* Main helmet — slight vertical stretch, matte-metallic */}
        <Sphere args={[0.84, 30, 24]} scale={[1.0, 1.04, 1.0]} castShadow>
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.25} />
        </Sphere>
        {/* Crown seam — horizontal panel line around top third */}
        <mesh position={[0, 0.28, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.76, 0.020, 6, 36]} />
          <meshStandardMaterial color={darkerColor} roughness={0.5} metalness={0.35} />
        </mesh>
        {/* Lower jaw seam */}
        <mesh position={[0, -0.38, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.72, 0.018, 6, 36]} />
          <meshStandardMaterial color={darkerColor} roughness={0.5} metalness={0.35} />
        </mesh>

        {/* Ear caps — rotated disc with embossed center */}
        <group position={[-0.84, -0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
          <Cylinder args={[0.24, 0.24, 0.16, 20]} castShadow>
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.22} />
          </Cylinder>
          <Cylinder args={[0.16, 0.16, 0.175, 18]}>
            <meshStandardMaterial color={darkerColor} roughness={0.55} metalness={0.35} />
          </Cylinder>
          <Cylinder args={[0.07, 0.07, 0.185, 12]}>
            <meshStandardMaterial color="#0b0b12" roughness={0.3} metalness={0.7} />
          </Cylinder>
        </group>
        <group position={[ 0.84, -0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
          <Cylinder args={[0.24, 0.24, 0.16, 20]} castShadow>
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.22} />
          </Cylinder>
          <Cylinder args={[0.16, 0.16, 0.175, 18]}>
            <meshStandardMaterial color={darkerColor} roughness={0.55} metalness={0.35} />
          </Cylinder>
          <Cylinder args={[0.07, 0.07, 0.185, 12]}>
            <meshStandardMaterial color="#0b0b12" roughness={0.3} metalness={0.7} />
          </Cylinder>
        </group>

        {/* VISOR — big wrap-around dark glass panel, clearly pokes out of the
            helmet front so it reads as a face mask, not hidden inside. */}
        <Sphere args={[0.72, 32, 22]} scale={[1.25, 0.78, 0.55]} position={[0, -0.04, 0.55]} castShadow>
          <meshStandardMaterial color="#06060d" roughness={0.05} metalness={0.92} />
        </Sphere>
        {/* Visor frame — ring around the visor edge, darker color (like ref mascot) */}
        <Sphere args={[0.74, 32, 22]} scale={[1.28, 0.82, 0.58]} position={[0, -0.04, 0.52]} castShadow>
          <meshStandardMaterial color={darkerColor} roughness={0.45} metalness={0.35} />
        </Sphere>
        {/* Visor glossy highlight */}
        <Sphere args={[0.72, 28, 18]} scale={[1.00, 0.10, 0.52]} position={[0, 0.22, 0.62]}>
          <meshStandardMaterial color="#ffffff" roughness={0.1} metalness={0.3} transparent opacity={0.18} />
        </Sphere>

        {/* EYES — bright arch glow, pushed out in front of the visor surface */}
        <mesh ref={eyeRef} position={[-0.24, -0.02, 0.94]} scale={[0.9, 1.35, 0.4]}>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={4.0} toneMapped={false} />
        </mesh>
        <mesh ref={eyeRef2} position={[ 0.24, -0.02, 0.94]} scale={[0.9, 1.35, 0.4]}>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={4.0} toneMapped={false} />
        </mesh>

        {/* Small rivets on helmet side — mech detail */}
        {[-0.2, 0.2].map((xp) => (
          <Sphere key={`rivet-${xp}`} args={[0.028, 8, 6]} position={[xp, 0.50, 0.72]}>
            <meshStandardMaterial color={darkerColor} roughness={0.35} metalness={0.8} />
          </Sphere>
        ))}

        {/* Antenna stem — slight bend via rotated cylinder */}
        <Cylinder args={[0.035, 0.05, 0.42, 10]} position={[0, 1.05, 0]} rotation={[0, 0, -0.08]} castShadow>
          <meshStandardMaterial color={darkerColor} roughness={0.45} metalness={0.35} />
        </Cylinder>
        {/* Antenna ball */}
        <Sphere args={[0.15, 16, 12]} position={[0.02, 1.32, 0]} castShadow>
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} roughness={0.3} metalness={0.3} toneMapped={false} />
        </Sphere>
      </group>

      {/* Nametag — HTML overlay with name + level pill (glass).
          NOTE: no `distanceFactor` — that prop scales by perspective distance and
          balloons wildly under our OrthographicCamera. Plain Html renders the
          overlay at a fixed CSS pixel size, anchored to the world position. */}
      <Html
        position={[0, 3.95, 0]}
        center
        zIndexRange={[10, 50]}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <AgentNameTag agent={agent} />
      </Html>

      {/* Hover profile card */}
      {hovered && (
        <Html position={[0, 5.2, 0]} center zIndexRange={[100, 200]} style={{ pointerEvents: "auto" }}>
          <div
            onPointerEnter={() => {
              if (leaveTimerRef.current) {
                clearTimeout(leaveTimerRef.current)
                leaveTimerRef.current = null
              }
              setHovered(true)
            }}
            onPointerLeave={() => {
              leaveTimerRef.current = setTimeout(() => setHovered(false), 250)
            }}
          >
            <AgentProfileCard agent={agent} state={state} color={color} />
          </div>
        </Html>
      )}
    </group>
  )
}


// Workstation slot grid is now generated dynamically — see `computeDeskSlots`
// below. Platform bounds: x ∈ [2, 28] (width 26), z ∈ [-28, -2] (depth 26).
// y = 0.62 sits desks on top of the elevated platform slab.
const PLATFORM_BOUNDS = { x0: 2, x1: 28, z0: -28, z1: -2, y: 0.62 } as const

// Generate uniformly-spaced desk slots inside the workspace platform for any
// agent count. Picks a roughly-square grid (cols × rows) that fits N agents;
// caller maps each agent index → slot. For N > 36 the grid still produces N
// slots but desks get cramped — at that point the room itself should grow.
function computeDeskSlots(agentCount: number): [number, number, number][] {
  const N = Math.max(1, agentCount)
  const cols = Math.max(1, Math.ceil(Math.sqrt(N)))
  const rows = Math.max(1, Math.ceil(N / cols))
  const w = PLATFORM_BOUNDS.x1 - PLATFORM_BOUNDS.x0
  const d = PLATFORM_BOUNDS.z1 - PLATFORM_BOUNDS.z0
  const xStep = w / (cols + 1)
  const zStep = d / (rows + 1)
  const slots: [number, number, number][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (slots.length >= N) break
      const x = PLATFORM_BOUNDS.x0 + (c + 1) * xStep
      const z = PLATFORM_BOUNDS.z0 + (r + 1) * zStep
      slots.push([x, PLATFORM_BOUNDS.y, z])
    }
  }
  return slots
}

// ── First-mount camera zoom settle ──────────────────────────────────────────
// Lerps zoom from `targetZoom * startScale` down to `targetZoom` over `durationMs`
// on first mount, so users notice the visual refresh without a jarring snap.
function CameraSettle({ targetZoom, startScale = 1.1, durationMs = 600 }: {
  targetZoom: number
  startScale?: number
  durationMs?: number
}) {
  const startTimeRef = useRef<number | null>(null)
  useFrame((state) => {
    const cam = state.camera as THREE.OrthographicCamera
    if (startTimeRef.current === null) startTimeRef.current = state.clock.getElapsedTime()
    const elapsed = (state.clock.getElapsedTime() - startTimeRef.current) * 1000
    if (elapsed >= durationMs) return
    const t = Math.min(1, elapsed / durationMs)
    const eased = 1 - Math.pow(1 - t, 3)
    const startZoom = targetZoom * startScale
    cam.zoom = startZoom + (targetZoom - startZoom) * eased
    cam.updateProjectionMatrix()
  })
  return null
}

// ── Camera focus on selected agent ──────────────────────────────────────────
// While `selectedAgentId` is set, smoothly lerps OrbitControls.target toward
// that agent's live world position (read from AGENT_WORLD_POSITIONS each frame).
// User can still pan — the lerp only runs while a selection exists; releasing
// (clicking the chip again to deselect) leaves the camera where it is.
function CameraFocus({ selectedAgentId }: { selectedAgentId: string | null | undefined }) {
  const { controls } = useThree() as { controls: { target: THREE.Vector3; update?: () => void } | null }
  useFrame((_, delta) => {
    if (!selectedAgentId || !controls) return
    const pos = AGENT_WORLD_POSITIONS.get(selectedAgentId)
    if (!pos) return
    const [tx, tz] = pos
    const target = controls.target
    if (!target) return
    const lerp = Math.min(1, delta * 4) // ~250ms half-life
    target.x = THREE.MathUtils.lerp(target.x, tx, lerp)
    target.z = THREE.MathUtils.lerp(target.z, tz, lerp)
    target.y = THREE.MathUtils.lerp(target.y, 1, lerp)
    if (typeof controls.update === "function") controls.update()
  })
  return null
}

// ── Selection highlight ring ────────────────────────────────────────────────
// Animated glowing ring that follows the selected agent's live position, plus
// a vertical light beam to make them visually unambiguous in a crowded scene.
function SelectionHighlight({
  selectedAgentId,
  accentColor,
}: {
  selectedAgentId: string | null | undefined
  accentColor: string
}) {
  const groupRef = useRef<THREE.Group>(null)
  const ringRef  = useRef<THREE.Mesh>(null)
  const visible = !!selectedAgentId
  useFrame(({ clock }) => {
    if (!groupRef.current || !ringRef.current) return
    if (!visible) {
      // Park off-scene so it doesn't render visibly when nothing selected.
      groupRef.current.visible = false
      return
    }
    const pos = selectedAgentId ? AGENT_WORLD_POSITIONS.get(selectedAgentId) : null
    if (!pos) {
      groupRef.current.visible = false
      return
    }
    groupRef.current.visible = true
    const [x, z] = pos
    groupRef.current.position.x = x
    groupRef.current.position.z = z
    // Pulse ring scale for a subtle "you are here" effect
    const pulse = 1 + Math.sin(clock.elapsedTime * 2.4) * 0.06
    ringRef.current.scale.set(pulse, pulse, 1)
  })
  return (
    <group ref={groupRef} visible={false}>
      {/* Flat ring on the floor */}
      <mesh ref={ringRef} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.85, 1.05, 48]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.85} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Soft inner disc for extra glow */}
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0, 0.85, 48]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.12} toneMapped={false} />
      </mesh>
      {/* Vertical beam — clearer in dense scenes */}
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[0.08, 0.6, 8, 16, 1, true]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.18} toneMapped={false} side={THREE.BackSide} />
      </mesh>
    </group>
  )
}

export function AgentWorld3D({ agents, agentStates, selectedAgentId }: AgentWorld3DProps) {
  const theme = useThemeStore(s => s.theme)
  const t     = SCENE_THEME[theme]
  const tokens = useThemeTokens()
  const deskSlots = useMemo(() => computeDeskSlots(agents.length), [agents.length])
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      performance={{ min: 0.5 }}
      className="w-full h-full"
      style={{ background: t.canvasBg }}
      onCreated={(state) => console.log('[AgentWorld3D] Canvas created, gl:', state.gl.info)}
      fallback={<div style={{color:'#fff',padding:20}}>Loading 3D scene...</div>}
    >
      <OrthographicCamera
        makeDefault
        position={[60, 50, 60]}
        zoom={14}
        near={-400}
        far={500}
      />
      <CameraSettle targetZoom={14} />
      <OrbitControls
        makeDefault
        target={[-2, 1, 2]}
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2 - 0.05}
        minZoom={8}
        maxZoom={28}
      />
      <CameraFocus selectedAgentId={selectedAgentId} />
      <SelectionHighlight selectedAgentId={selectedAgentId} accentColor={tokens.accent} />

      {/* ============== LIGHTING ============== */}
      <ambientLight intensity={0.7} color={tokens.ambient} />

      {/* Main sun — softer than before */}
      <directionalLight
        position={[40, 70, -20]}
        intensity={1.1}
        color="#f6f1e6"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.001}
        shadow-camera-left={-65}
        shadow-camera-right={65}
        shadow-camera-top={65}
        shadow-camera-bottom={-65}
      />
      {/* Fill light — cooler, lower (Claw3D playbook) */}
      <directionalLight position={[-30, 30, 40]} intensity={0.4} color="#7090ff" />
      {/* Soft IBL reflections — the "smoothness" lever */}
      <Environment preset="city" />

      {/* ── Atmospheric enhancements ── */}
      <FloatingParticles theme={theme} />
      <CityBackdrop     theme={theme} />
      <CeilingLights    theme={theme} />
      <HologramSphere   theme={theme} />

      <SceneRoom theme={theme} />

      {/* Workstations + Avatar + Status Signs — desk slots auto-scale to agent count */}
      {agents.map((agent, i) => {
        const ws = agentStates[i]
        const slot = deskSlots[i]
        return (
          <group key={agent.id}>
            <Workstation3D
              position={slot}
              color={getAgentColor(agent)}
              processing={ws === "processing"}
            />
            <StatusSign
              position={[slot[0], slot[1] + 6, slot[2] - 2.5]}
              state={ws}
            />
            <AgentAvatar3D
              agent={agent}
              state={ws}
              deskPos={slot}
              color={getAgentColor(agent)}
            />
          </group>
        )
      })}
    </Canvas>
  )
}
