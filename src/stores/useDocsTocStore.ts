import { create } from "zustand"
import { persist } from "zustand/middleware"

interface DocsTocStore {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggle: () => void
}

export const useDocsTocStore = create<DocsTocStore>()(
  persist(
    (set, get) => ({
      collapsed: true, // default: collapsed
      setCollapsed: (collapsed) => set({ collapsed }),
      toggle: () => set({ collapsed: !get().collapsed }),
    }),
    { name: "aoc.docs.toc.collapsed" }
  )
)
