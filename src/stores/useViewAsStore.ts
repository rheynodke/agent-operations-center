import { create } from 'zustand'

interface ViewAsState {
  /** The userId whose data the dashboard should reflect. Null until login completes. */
  viewingAsUserId: number | null
  setViewingAs: (id: number | null) => void
  reset: () => void
}

export const useViewAsStore = create<ViewAsState>((set) => ({
  viewingAsUserId: null,
  setViewingAs: (id) => set({ viewingAsUserId: id }),
  reset: () => set({ viewingAsUserId: null }),
}))

// Bootstrap: if a user is already loaded from localStorage at module init, init view-as now.
// Use a dynamic ESM import to avoid the cycle (stores/index.ts ← useViewAsStore) — `require`
// is not defined in browser ESM, which previously caused a silent ReferenceError that left
// viewingAsUserId stuck at null and broke the WS event filter.
import("./index").then(({ useAuthStore }) => {
  // Subscribe to auth changes: keep viewingAsUserId in sync with logged-in user.
  useAuthStore.subscribe((state, prev) => {
    if (state.user === prev.user) return
    const uid = state.user?.id ?? null
    if (uid == null) {
      useViewAsStore.getState().reset()
    } else if (useViewAsStore.getState().viewingAsUserId !== uid) {
      // Whenever the user changes, snap back to their own scope.
      useViewAsStore.getState().setViewingAs(uid)
    }
  })

  // Bootstrap init: if a user is already present (from localStorage restore), set it now.
  const u = useAuthStore.getState().user
  if (u?.id != null && useViewAsStore.getState().viewingAsUserId == null) {
    useViewAsStore.getState().setViewingAs(u.id)
  }
}).catch((e) => {
  // eslint-disable-next-line no-console
  console.warn("[useViewAsStore] auth subscribe init failed:", e)
})
