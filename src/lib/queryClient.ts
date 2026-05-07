import { QueryClient } from "@tanstack/react-query"

/**
 * App-wide TanStack Query client.
 *
 * Defaults tuned for AOC's read pattern: list views are read often, mutated
 * less, and any cross-tab change broadcasts via WebSocket — so we set short
 * staleTime (data feels fresh) but rely on WS-driven invalidation for the
 * authoritative refresh signal.
 *
 * Avoid retry on 4xx — that's almost always a real error (auth expired,
 * forbidden) and retrying just delays the UI feedback.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status
        if (status && status >= 400 && status < 500) return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: false,
    },
  },
})

/**
 * Centralised query keys. Co-locating prevents typo-driven cache misses and
 * makes invalidation from mutations explicit.
 */
export const queryKeys = {
  agents: (scope?: "me" | "all" | number) => ["agents", scope ?? "me"] as const,
  agent: (id: string) => ["agent", id] as const,
  agentDetail: (id: string) => ["agent", id, "detail"] as const,
  agentSkills: (id: string) => ["agent", id, "skills"] as const,
  agentTools: (id: string) => ["agent", id, "tools"] as const,
  agentConnections: (id: string) => ["agent", id, "connections"] as const,
  rooms: () => ["rooms"] as const,
  room: (id: string) => ["room", id] as const,
  projects: () => ["projects"] as const,
  connections: () => ["connections"] as const,
  connectionAssignments: () => ["connections", "assignments"] as const,
  models: () => ["models"] as const,
} as const
