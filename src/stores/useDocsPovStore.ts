import { create } from "zustand"
import { persist } from "zustand/middleware"

export type DocsPov = "user" | "developer" | "admin"

interface DocsPovStore {
  pov: DocsPov
  setPov: (pov: DocsPov) => void
}

export const useDocsPovStore = create<DocsPovStore>()(
  persist(
    (set) => ({
      pov: "user",
      setPov: (pov) => set({ pov }),
    }),
    { name: "aoc.docs.pov" }
  )
)
