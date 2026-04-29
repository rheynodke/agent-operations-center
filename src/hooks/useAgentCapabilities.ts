// useAgentCapabilities — lightweight cache for agent composite capability data
// used by the workflow capability card. Keyed by agentId, loaded on demand.

import { useEffect, useState, useRef } from "react"
import { api } from "@/lib/api"
import type { AgentCapabilities } from "@/types"

// Module-level cache so different capability cards don't re-fetch the same
// agent. Values expire after a few minutes to keep role/skill/connection
// assignments reasonably fresh.
const cache = new Map<string, { data: AgentCapabilities; fetchedAt: number }>()
const TTL_MS = 2 * 60 * 1000
// Deduplicate concurrent fetches for the same id.
const inflight = new Map<string, Promise<AgentCapabilities>>()

export function prefetchAgentCapabilities(agentId: string): Promise<AgentCapabilities> | null {
  if (!agentId) return null
  const cached = cache.get(agentId)
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return Promise.resolve(cached.data)
  if (inflight.has(agentId)) return inflight.get(agentId)!
  const p = api
    .getAgentCapabilities(agentId)
    .then((data) => {
      cache.set(agentId, { data, fetchedAt: Date.now() })
      return data
    })
    .finally(() => inflight.delete(agentId))
  inflight.set(agentId, p)
  return p
}

export function invalidateAgentCapabilities(agentId?: string) {
  if (agentId) {
    cache.delete(agentId)
    inflight.delete(agentId)
  } else {
    cache.clear()
    inflight.clear()
  }
}

export function useAgentCapabilities(agentId: string | null | undefined): {
  data: AgentCapabilities | null
  loading: boolean
  error: string | null
} {
  const [data, setData] = useState<AgentCapabilities | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastIdRef = useRef<string | null | undefined>(null)

  useEffect(() => {
    lastIdRef.current = agentId
    if (!agentId) {
      setData(null)
      setError(null)
      return
    }
    const cached = cache.get(agentId)
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      setData(cached.data)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const p = prefetchAgentCapabilities(agentId)
    if (!p) return
    p.then((result) => {
      if (cancelled || lastIdRef.current !== agentId) return
      setData(result)
    })
      .catch((err) => {
        if (cancelled || lastIdRef.current !== agentId) return
        setError((err as Error).message)
      })
      .finally(() => {
        if (cancelled || lastIdRef.current !== agentId) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentId])

  return { data, loading, error }
}
