import React, { useMemo, useRef, useState, useEffect, useCallback } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrthographicCamera, Grid, Box, Cylinder, Sphere, OrbitControls, Text, Html } from "@react-three/drei"
import * as THREE from "three"
import type { Agent } from "@/types"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import { useThemeStore, useSessionStore } from "@/stores"

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

type WorldState = "processing" | "working" | "idle" | "offline"

interface AgentWorld3DProps {
  agents: Agent[]
  agentStates: WorldState[]
  deskXPcts: number[]
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
          <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={1.2} toneMapped={false} />
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
        <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={2.5} toneMapped={false} />
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
      <pointLight position={[9, 7, 2]} intensity={1.0} distance={20} color="#06b6d4" />

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
        <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={2} toneMapped={false} />
      </Cylinder>
      {/* Hologram Globe */}
      <Sphere args={[1.2]} position={[0, 3.2, 0]}>
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.8} wireframe transparent opacity={0.7} toneMapped={false} />
      </Sphere>
      <pointLight position={[0, 3, 0]} intensity={1.5} distance={12} color="#38bdf8" decay={2} />
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
function CityBackdrop({ theme }: { theme: ThemeMode }) {
  const windows = useMemo(() => {
    const wins: { x: number; y: number; w: number; h: number; col: string; int: number }[] = []
    // Back wall windows  (z = -29.5)
    const cols = ["#38bdf8","#818cf8","#c084fc","#f472b6","#34d399","#fb923c"]
    for (let i = 0; i < 22; i++) {
      wins.push({
        x: -26 + i * 2.6, y: 3 + Math.random() * 6,
        w: 1.2 + Math.random() * 1.6, h: 0.9 + Math.random() * 3.5,
        col: cols[i % cols.length],
        int: 0.4 + Math.random() * 0.9,
      })
    }
    return wins
  }, [])

  const sideWins = useMemo(() => {
    const wins: { z: number; y: number; w: number; h: number; col: string; int: number }[] = []
    const cols = ["#38bdf8","#818cf8","#c084fc","#fb923c"]
    for (let i = 0; i < 12; i++) {
      wins.push({
        z: -26 + i * 4.6, y: 4 + Math.random() * 5,
        w: 1.0 + Math.random() * 2.0, h: 1.0 + Math.random() * 3.0,
        col: cols[i % cols.length],
        int: 0.3 + Math.random() * 0.8,
      })
    }
    return wins
  }, [])

  const wallCol = theme === "dark" ? "#0c1220" : "#e8edf5"
  const wallEmi = theme === "dark" ? "#0c1220" : "#dde5f0"

  return (
    <group>
      {/* ── Back wall skin (on top of existing wall) ── */}
      <Box args={[58, 12, 0.3]} position={[0, 6, -29.6]}>
        <meshStandardMaterial color={wallCol} roughness={0.9} />
      </Box>
      {/* ── City window panels on back wall ── */}
      {windows.map((w, i) => (
        <Box key={i} args={[w.w, w.h, 0.2]} position={[w.x, w.y, -29.45]}>
          <meshStandardMaterial
            color={w.col} emissive={w.col} emissiveIntensity={w.int}
            toneMapped={false} transparent opacity={0.85}
          />
        </Box>
      ))}

      {/* ── Left wall skin ── */}
      <Box args={[0.3, 12, 58]} position={[-29.6, 6, 0]}>
        <meshStandardMaterial color={wallCol} roughness={0.9} />
      </Box>
      {/* ── City window panels on left wall ── */}
      {sideWins.map((w, i) => (
        <Box key={i} args={[0.2, w.h, w.w]} position={[-29.45, w.y, w.z]}>
          <meshStandardMaterial
            color={w.col} emissive={w.col} emissiveIntensity={w.int}
            toneMapped={false} transparent opacity={0.85}
          />
        </Box>
      ))}

      {/* ── Neon "AGENT HQ" sign on back wall ── */}
      <group position={[-8, 10.2, -29.3]}>
        {/* Sign backplate */}
        <Box args={[12, 1.8, 0.15]}>
          <meshStandardMaterial color="#070d1a" />
        </Box>
        <Text
          position={[0, 0, 0.12]}
          fontSize={1.1} letterSpacing={0.12}
          color="#06b6d4" anchorX="center" anchorY="middle"
          outlineWidth={0.04} outlineColor="#0e7490"
        >AGENT HQ</Text>
        {/* Glow strip below sign */}
        <Box args={[12, 0.12, 0.1]} position={[0, -1.0, 0.1]}>
          <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={3} toneMapped={false} />
        </Box>
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
        <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={2} toneMapped={false} />
      </mesh>

      {/* Rotating orbital group */}
      <group ref={groupRef} position={[0, 4, 0]}>
        {/* Orbit ring 1 — cyan horizontal */}
        <mesh ref={ring1Ref}>
          <torusGeometry args={[1.8, 0.055, 8, 40]} />
          <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={2.5} toneMapped={false} transparent opacity={0.85} />
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
            color="#06b6d4" emissive="#0284c7" emissiveIntensity={0.35}
            wireframe transparent opacity={0.45} toneMapped={false}
          />
        </mesh>
      </group>

      {/* Vertical light beam pillar */}
      <mesh ref={beamRef} position={[0, 5, 0]}>
        <cylinderGeometry args={[0.06, 1.6, 10, 16, 1, true]} />
        <meshStandardMaterial
          color="#06b6d4" emissive="#06b6d4" emissiveIntensity={0.2}
          side={THREE.BackSide} transparent opacity={0.05} toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function SceneRoom({ theme = "dark" }: { theme?: ThemeMode }) {

  const t = SCENE_THEME[theme]
  return (
    <group>
      {/* ==================== FLOOR ==================== */}
      {/* Main floor slab */}
      <Box args={[60, 1, 60]} position={[0, -0.5, 0]} receiveShadow>
        <meshStandardMaterial color={t.floorColor} roughness={0.6} />
      </Box>
      {/* Main floor grid */}
      <Grid
        position={[0, 0.01, 0]}
        args={[60, 60]}
        cellSize={2}
        cellThickness={1}
        cellColor={t.gridCell}
        sectionSize={10}
        sectionThickness={1.5}
        sectionColor={t.gridSection}
        fadeDistance={80}
      />

      {/* ===================== WALLS ===================== */}
      {/* Left wall (at x = -30) */}
      <Box args={[1, 12, 60]} position={[-30, 6, 0]} receiveShadow>
        <meshStandardMaterial color={t.wallColor} roughness={0.4} />
      </Box>
      {/* Back wall (at z = -30) */}
      <Box args={[60, 12, 1]} position={[0, 6, -30]} receiveShadow>
        <meshStandardMaterial color={t.wallColor} roughness={0.4} />
      </Box>

      {/* Skirter LED Left Wall */}
      <Box args={[0.2, 0.3, 60]} position={[-29.4, 0.3, 0]}>
        <meshStandardMaterial color={t.skirterColor} emissive={t.skirterColor} emissiveIntensity={t.skirterIntensity} toneMapped={false} />
      </Box>
      {/* Skirter LED Back Wall */}
      <Box args={[60, 0.3, 0.2]} position={[0, 0.3, -29.4]}>
        <meshStandardMaterial color={t.skirterColor} emissive={t.skirterColor} emissiveIntensity={t.skirterIntensity} toneMapped={false} />
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
  const preset = AVATAR_PRESETS.find(p => p.id === agent.avatarPresetId) ?? null
  const accentColor = preset?.color ?? color

  // ── Derive stats from the already-loaded sessions store ──────────────────
  const sessions = useSessionStore(s => s.sessions)
  const agentSessions = useMemo(
    () => sessions.filter(s => s.agentId === agent.id),
    [sessions, agent.id]
  )
  const sessionCount  = agentSessions.length
  const totalCost     = agentSessions.reduce((sum, s) => sum + (s.totalCost ?? 0), 0)
  const totalTokens   = agentSessions.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0)
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

  // Composite EXP: 50% from sessions (cap 200), 50% from tokens (cap 2M)
  const sessionScore = Math.min(50, (sessionCount / 200) * 50)
  const tokenScore   = Math.min(50, (totalTokens / 2_000_000) * 50)
  const expPct       = Math.round(sessionScore + tokenScore)
  const expLevel     = Math.max(1, Math.ceil(expPct / 10))
  const sessionPct   = Math.round(sessionScore * 2)
  const tokenPct     = Math.round(tokenScore   * 2)

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
                <span style={{ width: 6, height: 6, borderRadius: 1, background: "#22d3ee", display: "inline-block" }} />
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
              background: "linear-gradient(90deg, #0891b2, #22d3ee)",
              boxShadow: "0 0 6px #22d3ee88",
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

  const auraColor = state === "processing" ? "#fb923c" : "#22d3ee"

  return (
    <group ref={groupRef} position={initPos}>
      {/* Working / processing floor aura */}
      {(state === "working" || state === "processing") && (
        <WorkingAura color={auraColor} processing={state === "processing"} />
      )}

      {/* ── Platform / feet ── */}
      <Box args={[0.88, 0.22, 0.88]} position={[0, 0.11, 0]} castShadow>
        <meshStandardMaterial color={darkerColor} roughness={0.7} metalness={0.1} />
      </Box>

      {/* ── Large invisible hover hitbox covering the whole avatar ── */}
      <Box
        args={[2.2, 4.0, 2.2]}
        position={[0, 1.6, 0]}
        visible={false}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      />

      {/* ── Torso — live emissive via bodyRef ── */}
      <Cylinder
        ref={bodyRef}
        args={[0.46, 0.50, 1.15, 16]}
        position={[0, 0.85, 0]}
        castShadow
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0}
          roughness={0.28}
          metalness={0.18}
        />
      </Cylinder>

      {/* Shoulder joint L */}
      <Sphere args={[0.22, 12, 8]} position={[-0.68, 1.1, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.15} />
      </Sphere>
      {/* Shoulder joint R */}
      <Sphere args={[0.22, 12, 8]} position={[ 0.68, 1.1, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.15} />
      </Sphere>

      {/* Chest orb */}
      <Sphere args={[0.15, 12, 8]} position={[0, 0.85, 0.48]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.5} toneMapped={false} roughness={0.1} />
      </Sphere>

      {/* Neck */}
      <Cylinder args={[0.19, 0.21, 0.28, 12]} position={[0, 1.6, 0]} castShadow>
        <meshStandardMaterial color={darkerColor} roughness={0.55} metalness={0.1} />
      </Cylinder>

      {/* ── Head group ── */}
      <group position={[0, 2.26, 0]}>
        {/* Rounded helmet */}
        <Sphere args={[0.62, 22, 16]} scale={[1, 1.08, 1]} castShadow>
          <meshStandardMaterial color={color} roughness={0.25} metalness={0.15} />
        </Sphere>

        {/* Ear bump L */}
        <Cylinder args={[0.14, 0.14, 0.15, 10]} position={[-0.64, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} />
        </Cylinder>
        {/* Ear bump R */}
        <Cylinder args={[0.14, 0.14, 0.15, 10]} position={[ 0.64, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} />
        </Cylinder>

        {/* Wide dark visor */}
        <Box args={[0.88, 0.46, 0.07]} position={[0, -0.05, 0.52]}>
          <meshStandardMaterial color="#040810" roughness={0.04} metalness={0.92} />
        </Box>

        {/* Eye L — live emissive via eyeRef */}
        <mesh ref={eyeRef} position={[-0.18, -0.03, 0.58]}>
          <sphereGeometry args={[0.1, 12, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} toneMapped={false} />
        </mesh>
        {/* Eye R — live emissive via eyeRef2 */}
        <mesh ref={eyeRef2} position={[ 0.18, -0.03, 0.58]}>
          <sphereGeometry args={[0.1, 12, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} toneMapped={false} />
        </mesh>

        {/* Antenna stem */}
        <Cylinder args={[0.04, 0.05, 0.56, 8]} position={[0, 0.86, 0]} castShadow>
          <meshStandardMaterial color={darkerColor} roughness={0.5} metalness={0.1} />
        </Cylinder>
        {/* Antenna ball */}
        <Sphere args={[0.13, 12, 8]} position={[0, 1.17, 0]} castShadow>
          <meshStandardMaterial color={color} roughness={0.25} metalness={0.2} />
        </Sphere>
      </group>

      {/* Nametag */}
      <Text
        position={[0, 3.3, 0]}
        rotation={[-Math.PI / 4.5, 0, 0]}
        fontSize={0.45}
        color="#1e293b"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.05}
        outlineColor="#ffffff"
        fontWeight="bold"
      >
        {agent.name}
      </Text>

      {/* Hover profile card */}
      {hovered && (
        <Html position={[0, 4.8, 0]} center zIndexRange={[100, 200]} style={{ pointerEvents: "auto" }}>
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


// Workstation slot grid: 3 cols × 3 rows on the raised platform
const DESK_SLOTS: [number, number, number][] = [
  [8, 0.62, -22],
  [15, 0.62, -22],
  [22, 0.62, -22],
  [8, 0.62, -14],
  [15, 0.62, -14],
  [22, 0.62, -14],
  [8, 0.62, -6],
  [15, 0.62, -6],
  [22, 0.62, -6],
]

export function AgentWorld3D({ agents, agentStates }: AgentWorld3DProps) {
  const theme = useThemeStore(s => s.theme)
  const t     = SCENE_THEME[theme]
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
      <OrbitControls
        target={[-2, 1, 2]}
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2 - 0.05}
        minZoom={8}
        maxZoom={28}
      />

      {/* ============== LIGHTING ============== */}
      <ambientLight intensity={t.ambientIntensity} color={t.ambientColor} />

      {/* Main sun */}
      <directionalLight
        position={[40, 70, -20]}
        intensity={t.sunIntensity}
        color={t.sunColor}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.001}
        shadow-camera-left={-65}
        shadow-camera-right={65}
        shadow-camera-top={65}
        shadow-camera-bottom={-65}
      />
      {/* Fill light */}
      <directionalLight position={[-30, 30, 40]} intensity={t.fillIntensity} color={t.fillColor} />

      {/* ── Atmospheric enhancements ── */}
      <FloatingParticles theme={theme} />
      <CityBackdrop     theme={theme} />
      <CeilingLights    theme={theme} />
      <HologramSphere   theme={theme} />

      <SceneRoom theme={theme} />

      {/* Workstations + Avatar + Status Signs */}
      {agents.map((agent, i) => {
        const ws = agentStates[i]
        const slot = DESK_SLOTS[i % DESK_SLOTS.length]
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
