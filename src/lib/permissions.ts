import { useAuthStore } from "@/stores"
import type { Agent, Connection } from "@/types"

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
