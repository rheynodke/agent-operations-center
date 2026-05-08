// Agent leveling system — L1 to L100, six visual tiers
//
// Formula:
//   activityScore = sessionCount * 30 + totalTokens / 500
//   ageBonus      = min(2.5, 1 + ageDays / 90)        // 1× new, 2.5× at 90 days+
//   XP            = round(activityScore * ageBonus)
//   level         = clamp(1, 100, floor(sqrt(XP / 22)) + 1)
//
// Why a multiplier (not additive) for age:
//   age alone shouldn't push an unused agent up the ladder. Activity drives
//   leveling; tenure rewards engagement on top.
//
// Sample milestones:
//   L1   →  brand new                                          (XP 0)
//   L10  →  ~25 sessions over a few weeks                      (XP ~1.8k)
//   L25  →  ~150 sessions, several months, modest tokens       (XP ~13k)
//   L50  →  ~500 sessions, 6 months                            (XP ~54k)
//   L75  →  ~1k sessions + heavy memory + 1 year               (XP ~123k)
//   L100 →  veteran: ~2k sessions + 50M+ tokens + 1 year       (XP ≥216k)

import type { Agent } from "@/types"

export interface AgentLevel {
  level: number               // 1..100
  xp: number
  xpToNextLevel: number       // XP needed to reach the next level
  xpInTier: number            // XP earned within the current level
  pct: number                 // 0-100, progress toward next level
  breakdown: {
    sessions: number          // sessionCount * 30
    memory:   number          // totalTokens / 500
    ageBonus: number          // 1.0 - 2.5 multiplier
  }
  ageDays: number
  tier: AgentTier
}

export interface AgentTier {
  index: 1 | 2 | 3 | 4 | 5 | 6
  range: [number, number]     // inclusive level range
  label: string
  /** Aura ring + glow color (hex) */
  color: string
  /** Aura intensity 0-1.5 — drives emissive strength + ring opacity */
  intensity: number
  /** True if tier should render rotating/animated effects */
  animated: boolean
  /** True if tier should render a vertical light beam */
  beam: boolean
  /** True if tier should render orbital particles */
  particles: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const LEVEL_CAP = 100
const LEVEL_K = 22 // tunes the curve. XP-to-level: floor(sqrt(XP / K)) + 1

const TIERS: AgentTier[] = [
  { index: 1, range: [1, 19],   label: "Novice",       color: "#94a3b8", intensity: 0.0, animated: false, beam: false, particles: false },
  { index: 2, range: [20, 39],  label: "Adept",        color: "#38bdf8", intensity: 0.4, animated: false, beam: false, particles: false },
  { index: 3, range: [40, 59],  label: "Expert",       color: "#22c55e", intensity: 0.6, animated: true,  beam: false, particles: false },
  { index: 4, range: [60, 79],  label: "Master",       color: "#f59e0b", intensity: 0.85, animated: true, beam: true,  particles: false },
  { index: 5, range: [80, 99],  label: "Legend",       color: "#a855f7", intensity: 1.1, animated: true,  beam: true,  particles: true },
  { index: 6, range: [100, 100],label: "Mythic",       color: "#fbbf24", intensity: 1.5, animated: true,  beam: true,  particles: true },
]

export function tierFor(level: number): AgentTier {
  for (const t of TIERS) {
    if (level >= t.range[0] && level <= t.range[1]) return t
  }
  return TIERS[0]
}

interface LevelInputs {
  sessionCount?: number | null
  totalTokens?: number | null
  createdAt?: string | null
}

export function computeAgentLevel(input: LevelInputs | Agent): AgentLevel {
  const sessions = Math.max(0, input.sessionCount || 0)
  const tokens = Math.max(0, input.totalTokens || 0)
  const createdMs = input.createdAt ? new Date(input.createdAt).getTime() : NaN
  const ageDays = Number.isFinite(createdMs)
    ? Math.max(0, (Date.now() - createdMs) / DAY_MS)
    : 0

  const sessionContribution = sessions * 30
  const memoryContribution  = tokens / 500
  const activityScore       = sessionContribution + memoryContribution
  const ageBonus            = Math.min(2.5, 1 + ageDays / 90)
  const xp                  = Math.round(activityScore * ageBonus)

  const rawLevel = Math.floor(Math.sqrt(xp / LEVEL_K)) + 1
  const level = Math.max(1, Math.min(LEVEL_CAP, rawLevel))

  const xpAtLevel = (level - 1) * (level - 1) * LEVEL_K
  const xpAtNext  = level === LEVEL_CAP
    ? xpAtLevel
    : level * level * LEVEL_K
  const xpInTier      = Math.max(0, xp - xpAtLevel)
  const xpToNextLevel = level === LEVEL_CAP ? 0 : Math.max(0, xpAtNext - xp)
  const pct = level === LEVEL_CAP
    ? 100
    : (xpAtNext > xpAtLevel ? Math.min(100, Math.max(0, Math.round((xpInTier / (xpAtNext - xpAtLevel)) * 100))) : 0)

  return {
    level,
    xp,
    xpToNextLevel,
    xpInTier,
    pct,
    breakdown: {
      sessions: Math.round(sessionContribution),
      memory:   Math.round(memoryContribution),
      ageBonus: Number(ageBonus.toFixed(2)),
    },
    ageDays,
    tier: tierFor(level),
  }
}

// XP needed to reach a given level — useful for tooltips
export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.min(LEVEL_CAP, level))
  return (L - 1) * (L - 1) * LEVEL_K
}

// Backwards-compat shim — older call sites used `rankFor()`. Now returns the
// tier label for the given level.
export function rankFor(level: number): string {
  return tierFor(level).label
}
