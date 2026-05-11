import { create } from "zustand"
import { persist } from "zustand/middleware"

export type DocsLang = "id" | "en"

interface DocsLangStore {
  lang: DocsLang
  setLang: (lang: DocsLang) => void
}

export const useDocsLangStore = create<DocsLangStore>()(
  persist(
    (set) => ({
      lang: "id",
      setLang: (lang) => set({ lang }),
    }),
    { name: "aoc.docs.lang" }
  )
)
