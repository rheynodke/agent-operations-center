import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark', // Default is dark as requested
      setTheme: (theme) => {
        set({ theme })
        updateDocumentTheme(theme)
      },
      toggleTheme: () => {
        set((state) => {
          const newTheme = state.theme === 'light' ? 'dark' : 'light'
          updateDocumentTheme(newTheme)
          return { theme: newTheme }
        })
      },
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'aoc-theme-storage',
      onRehydrateStorage: () => (state) => {
        // Run after hydration is complete to apply the saved or default theme
        if (state) {
          updateDocumentTheme(state.theme)
        }
      },
    }
  )
)

// Helper to directly update HTML class
function updateDocumentTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    // Also explicitly set color-scheme to help browser with scrollbars, etc.
    root.style.colorScheme = theme
  }
}
