/**
 * Typed TanStack Query hooks for AOC's hot read paths.
 *
 * These wrap `api.*` so callers get caching, deduplication, retry, and
 * automatic refetch on mutation invalidation. Existing Zustand stores
 * remain the single source of truth for WS-pushed updates — when you
 * mutate via these hooks, they invalidate the matching cache key so the
 * next render re-fetches.
 *
 * Don't add a hook here for write paths; use `useMutation` inline in the
 * component (or a dedicated `useXMutation` hook) so success/error UX
 * stays close to the action.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/queryClient"
import type { Agent, MissionRoom, Project, Connection } from "@/types"

// ── Agents ─────────────────────────────────────────────────────────────────
export function useAgents(scope: "me" | "all" | number = "me") {
  return useQuery({
    queryKey: queryKeys.agents(scope),
    queryFn: async () => {
      const r = (await api.getAgents({ owner: scope })) as { agents: Agent[] }
      return r.agents
    },
  })
}

export function useAgentDetail(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.agentDetail(id ?? ""),
    queryFn: () => api.getAgentDetail(id!),
    enabled: !!id,
  })
}

export function useAgentSkills(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.agentSkills(id ?? ""),
    queryFn: async () => {
      const r = (await (api as { getAgentSkills?: (id: string) => Promise<{ skills: unknown[] }> }).getAgentSkills?.(id!)) ?? { skills: [] }
      return r.skills
    },
    enabled: !!id,
  })
}

export function useAgentConnections(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.agentConnections(id ?? ""),
    queryFn: async () => {
      const r = (await (api as { getAgentConnections?: (id: string) => Promise<{ connectionIds: string[]; connections: Connection[] }> }).getAgentConnections?.(id!)) ?? { connectionIds: [], connections: [] }
      return r
    },
    enabled: !!id,
  })
}

// ── Rooms ──────────────────────────────────────────────────────────────────
export function useRooms() {
  return useQuery({
    queryKey: queryKeys.rooms(),
    queryFn: async () => {
      const r = await api.getRooms()
      return r.rooms
    },
  })
}

export function useRoom(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.room(id ?? ""),
    queryFn: () => api.getRoom(id!) as Promise<{ room: MissionRoom; agents: Agent[] }>,
    enabled: !!id,
  })
}

// ── Projects ───────────────────────────────────────────────────────────────
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: async () => {
      const r = (await (api as { getProjects?: () => Promise<{ projects: Project[] }> }).getProjects?.()) ?? { projects: [] }
      return r.projects
    },
  })
}

// ── Connections ────────────────────────────────────────────────────────────
export function useConnections() {
  return useQuery({
    queryKey: queryKeys.connections(),
    queryFn: async () => {
      const r = await api.getConnections()
      return r.connections
    },
  })
}

export function useConnectionAssignments() {
  return useQuery({
    queryKey: queryKeys.connectionAssignments(),
    queryFn: async () => {
      const r = (await (api as { getConnectionAssignments?: () => Promise<{ assignments: Record<string, string[]> }> }).getConnectionAssignments?.()) ?? { assignments: {} }
      return r.assignments
    },
  })
}

// ── Invalidation helpers ──────────────────────────────────────────────────
//
// Centralised so mutations don't have to know the key shape.
export function useInvalidate() {
  const qc = useQueryClient()
  return {
    agents: () => qc.invalidateQueries({ queryKey: ["agents"] }),
    agent: (id: string) => qc.invalidateQueries({ queryKey: ["agent", id] }),
    rooms: () => qc.invalidateQueries({ queryKey: queryKeys.rooms() }),
    room: (id: string) => qc.invalidateQueries({ queryKey: queryKeys.room(id) }),
    projects: () => qc.invalidateQueries({ queryKey: queryKeys.projects() }),
    connections: () => qc.invalidateQueries({ queryKey: ["connections"] }),
  }
}

// Re-export so consumers can build ad-hoc mutations without an extra import.
export { useMutation }
