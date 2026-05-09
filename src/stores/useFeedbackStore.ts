import { create } from 'zustand'
import { api } from '@/lib/api'
import type { MessageRating } from '@/lib/api'

type RatingMap = Record<string, MessageRating> // keyed by messageId

interface FeedbackState {
  /** Cache of ratings, keyed by messageId. Loaded per-session via loadForSession. */
  ratings: RatingMap
  /** Sessions whose ratings have been hydrated. Avoid re-fetching. */
  loadedSessions: Set<string>
  /** In-flight fetches, to deduplicate concurrent requests. */
  loadingSessions: Set<string>

  loadForSession: (sessionId: string) => Promise<void>
  recordRating: (input: {
    messageId: string
    sessionId: string
    agentId: string
    rating: 'positive' | 'negative'
    reason?: string
  }) => Promise<void>
  /** Get the dashboard rating (source='button') for a messageId, if any. */
  getDashboardRating: (messageId: string) => 'positive' | 'negative' | null
  /** All ratings for a messageId across sources/channels. */
  getAllRatings: (messageId: string) => MessageRating[]
  reset: () => void
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  ratings: {},
  loadedSessions: new Set(),
  loadingSessions: new Set(),

  loadForSession: async (sessionId) => {
    const { loadedSessions, loadingSessions } = get()
    if (loadedSessions.has(sessionId) || loadingSessions.has(sessionId)) return
    set({ loadingSessions: new Set([...loadingSessions, sessionId]) })
    try {
      const { ratings } = await api.getMessageRatings({ sessionId })
      set((s) => {
        const next: RatingMap = { ...s.ratings }
        for (const r of ratings) next[r.messageId] = r
        const newLoaded = new Set(s.loadedSessions); newLoaded.add(sessionId)
        const newLoading = new Set(s.loadingSessions); newLoading.delete(sessionId)
        return { ratings: next, loadedSessions: newLoaded, loadingSessions: newLoading }
      })
    } catch (e) {
      const newLoading = new Set(get().loadingSessions); newLoading.delete(sessionId)
      set({ loadingSessions: newLoading })
      console.warn(`[useFeedbackStore] loadForSession(${sessionId}) failed:`, e)
    }
  },

  recordRating: async (input) => {
    // Optimistic update — synthesize a placeholder MessageRating and commit
    // it to local state immediately. If the server call fails, revert.
    const prev = get().ratings[input.messageId]
    const optimistic: MessageRating = {
      id: -1,
      messageId: input.messageId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      ownerId: -1,
      channel: 'dashboard',
      source: 'button',
      rating: input.rating,
      reason: input.reason ?? null,
      raterExternalId: '',
      createdAt: Date.now(),
    }
    set((s) => ({ ratings: { ...s.ratings, [input.messageId]: optimistic } }))
    try {
      await api.recordMessageRating(input)
    } catch (e) {
      set((s) => {
        const next = { ...s.ratings }
        if (prev) next[input.messageId] = prev; else delete next[input.messageId]
        return { ratings: next }
      })
      throw e
    }
  },

  getDashboardRating: (messageId) => {
    const r = get().ratings[messageId]
    if (!r || r.source !== 'button') return null
    return r.rating
  },

  getAllRatings: (messageId) => {
    // For Phase 2 we only cache one rating per messageId; channel reactions
    // would need a separate fetch path or richer caching. Wired in Phase 5.
    const r = get().ratings[messageId]
    return r ? [r] : []
  },

  reset: () => set({ ratings: {}, loadedSessions: new Set(), loadingSessions: new Set() }),
}))
