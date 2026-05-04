import { useAuthStore } from "@/stores"
import type { Agent, Connection, Project, SkillInfo } from "@/types"

/**
 * Role-based permission helpers. Mirror the server-side checks in
 * server/lib/db.cjs (requireAdmin / requireAgentOwnership / requireConnectionOwnership).
 *
 * Admin bypasses every check. Regular users may only mutate resources they
 * created themselves. All users retain read access to everything.
 */

export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.user?.role) === "admin"
}

/** True if the current user can open the Skills page Claude terminal. */
export function useCanUseClaudeTerminal(): boolean {
  const role = useAuthStore((s) => s.user?.role)
  const granted = useAuthStore((s) => s.user?.canUseClaudeTerminal)
  return role === "admin" || Boolean(granted)
}

export function useCurrentUserId(): number | undefined {
  return useAuthStore((s) => s.user?.id)
}

/** True if the current user can write to a given agent. */
export function useCanEditAgent(agent: Pick<Agent, "provisionedBy"> | null | undefined): boolean {
  const userId = useAuthStore((s) => s.user?.id)
  const role = useAuthStore((s) => s.user?.role)
  if (!agent) return false
  if (role === "admin") return true
  return agent.provisionedBy != null && agent.provisionedBy === userId
}

/** True if the current user can write to a given connection. */
export function useCanEditConnection(conn: Pick<Connection, "createdBy"> | null | undefined): boolean {
  const userId = useAuthStore((s) => s.user?.id)
  const role = useAuthStore((s) => s.user?.role)
  if (!conn) return false
  if (role === "admin") return true
  return conn.createdBy != null && conn.createdBy === userId
}

/** Pure (non-hook) variants for use inside list maps. */
export function canEditAgent(agent: Pick<Agent, "provisionedBy"> | null | undefined, user: { id?: number; role?: string } | null): boolean {
  if (!agent || !user) return false
  if (user.role === "admin") return true
  return agent.provisionedBy != null && agent.provisionedBy === user.id
}

export function canEditConnection(conn: Pick<Connection, "createdBy"> | null | undefined, user: { id?: number; role?: string } | null): boolean {
  if (!conn || !user) return false
  if (user.role === "admin") return true
  return conn.createdBy != null && conn.createdBy === user.id
}

/**
 * True if the current user can write to a given project.
 *
 * Mirrors server-side `userOwnsProject` in db.cjs:
 *   - admin bypass
 *   - null `createdBy` → shared / legacy project (anyone may mutate)
 *   - otherwise must match user.id
 */
export function useCanEditProject(project: Pick<Project, "createdBy"> | null | undefined): boolean {
  const userId = useAuthStore((s) => s.user?.id)
  const role   = useAuthStore((s) => s.user?.role)
  if (!project) return false
  if (role === "admin") return true
  if (project.createdBy == null) return true // shared / legacy
  return project.createdBy === userId
}

export function canEditProject(project: Pick<Project, "createdBy"> | null | undefined, user: { id?: number; role?: string } | null): boolean {
  if (!project || !user) return false
  if (user.role === "admin") return true
  if (project.createdBy == null) return true
  return project.createdBy === user.id
}

// ─── Shared Resource Permissions ─────────────────────────────────────────────

/** Pure: any logged-in user can USE a shared connection. */
export function canUseConnection(_conn: Connection | null | undefined, user: { id?: number; role?: string } | null): boolean {
  return Boolean(user)
}

/** Pure: any logged-in user can USE a shared skill. */
export function canUseSkill(_skill: SkillInfo | null | undefined, user: { id?: number; role?: string } | null): boolean {
  return Boolean(user)
}

/** Pure: edit/delete only by owner or admin. Mirrors canEditConnection. */
export function canEditSkill(skill: SkillInfo | null | undefined, user: { id?: number; role?: string } | null): boolean {
  if (!user || !skill) return false
  if (user.role === "admin") return true
  // SkillInfo does not yet have a createdBy column — default-deny for non-admin.
  const owner = (skill as unknown as { createdBy?: number | null }).createdBy
  if (owner == null) return false
  return owner === user.id
}

/** Hook: true if the current user can use a shared connection. */
export function useCanUseConnection(conn: Connection | null | undefined): boolean {
  const user = useAuthStore((s) => s.user)
  return canUseConnection(conn, user)
}

/** Hook: true if the current user can use a shared skill. */
export function useCanUseSkill(skill: SkillInfo | null | undefined): boolean {
  const user = useAuthStore((s) => s.user)
  return canUseSkill(skill, user)
}

/** Hook: true if the current user can edit/delete a skill. */
export function useCanEditSkill(skill: SkillInfo | null | undefined): boolean {
  const user = useAuthStore((s) => s.user)
  return canEditSkill(skill, user)
}

// ─── View-as / Impersonation Hooks ───────────────────────────────────────────

import { useViewAsStore } from "@/stores/useViewAsStore"

/** The userId whose data should be displayed (impersonated for admin, self for non-admin). */
export function useEffectiveScope(): number {
  const userId = useAuthStore((s) => s.user?.id)
  const viewing = useViewAsStore((s) => s.viewingAsUserId)
  return viewing ?? userId ?? 0
}

/** True when admin is viewing as a different user (impersonating). */
export function useIsImpersonating(): boolean {
  const userId = useAuthStore((s) => s.user?.id)
  const viewing = useViewAsStore((s) => s.viewingAsUserId)
  return Boolean(userId != null && viewing != null && viewing !== userId)
}

/** True when the current view allows mutations (i.e., not impersonating). */
export function useCanWrite(): boolean {
  return !useIsImpersonating()
}
