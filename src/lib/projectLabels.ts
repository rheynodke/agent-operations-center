// User-facing labels for internal project enums. Keep the wire/DB format
// (greenfield/brownfield, kind=ops/adlc/...) but render friendly names in UI.

import type { ProjectKind, ProjectWorkspaceMode } from "@/types"

export const WORKSPACE_MODE_LABEL: Record<ProjectWorkspaceMode, string> = {
  greenfield: "New project",
  brownfield: "Existing project",
}

export const WORKSPACE_MODE_HINT: Record<ProjectWorkspaceMode, string> = {
  greenfield: "AOC scaffolds a fresh folder for this project.",
  brownfield: "Bound to an existing folder/repo on disk.",
}

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  adlc:     "ADLC",
  codebase: "Codebase",
  ops:      "Ops",
  research: "Research",
}

export function formatWorkspaceMode(mode?: ProjectWorkspaceMode | null): string {
  if (!mode) return "—"
  return WORKSPACE_MODE_LABEL[mode] ?? mode
}

export function formatProjectKind(kind?: ProjectKind | null): string {
  if (!kind) return "Ops"
  return PROJECT_KIND_LABEL[kind] ?? kind
}

// ── ADLC stage / role labels (Phase B) ─────────────────────────────────────

import type { TaskStage, TaskRole } from "@/types"

export const STAGE_LABEL: Record<TaskStage, string> = {
  discovery:      "Discovery",
  design:         "Design",
  architecture:   "Architecture",
  implementation: "Implementation",
  qa:             "QA",
  docs:           "Docs",
  release:        "Release",
  ops:            "Ops",
}

export const STAGE_TONE: Record<TaskStage, string> = {
  discovery:      "text-violet-500 bg-violet-500/10 border-violet-500/20",
  design:         "text-pink-500 bg-pink-500/10 border-pink-500/20",
  architecture:   "text-cyan-500 bg-cyan-500/10 border-cyan-500/20",
  implementation: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  qa:             "text-amber-500 bg-amber-500/10 border-amber-500/20",
  docs:           "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  release:        "text-fuchsia-500 bg-fuchsia-500/10 border-fuchsia-500/20",
  ops:            "text-zinc-500 bg-zinc-500/10 border-zinc-500/20",
}

export const ALL_STAGES: TaskStage[] = [
  "discovery", "design", "architecture", "implementation",
  "qa", "docs", "release", "ops",
]

export const ROLE_LABEL: Record<TaskRole, string> = {
  pm:   "PM",
  pa:   "PA",
  ux:   "UX",
  em:   "EM",
  swe:  "SWE",
  qa:   "QA",
  doc:  "Doc",
  biz:  "Biz",
  data: "Data",
}

export const ROLE_FULL_LABEL: Record<TaskRole, string> = {
  pm:   "Product Manager",
  pa:   "Product Analyst",
  ux:   "UX Designer",
  em:   "Engineering Manager",
  swe:  "Software Engineer",
  qa:   "QA Engineer",
  doc:  "Doc Writer",
  biz:  "Business Analyst",
  data: "Data Analyst",
}

export const ALL_ROLES: TaskRole[] = ["pm", "pa", "ux", "em", "swe", "qa", "doc", "biz", "data"]

export function formatStage(stage?: TaskStage | null): string {
  if (!stage) return "—"
  return STAGE_LABEL[stage] ?? stage
}

export function formatRole(role?: TaskRole | null, full = false): string {
  if (!role) return "—"
  return (full ? ROLE_FULL_LABEL : ROLE_LABEL)[role] ?? role
}
