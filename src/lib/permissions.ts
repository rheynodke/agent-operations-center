import { useAuthStore } from "@/stores"
import type { Agent, Connection, Project } from "@/types"

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
