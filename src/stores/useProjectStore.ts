// src/stores/useProjectStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Project, ProjectIntegration } from '@/types'
import { api } from '@/lib/api'

interface ProjectState {
  projects: Project[]
  activeProjectId: string
  integrations: ProjectIntegration[]
  syncingIds: Set<string>

  setProjects: (projects: Project[]) => void
  setActiveProject: (id: string) => void
  setIntegrations: (integrations: ProjectIntegration[]) => void
  setSyncing: (id: string, syncing: boolean) => void

  createProject: (data: { name: string; color?: string; description?: string }) => Promise<Project>
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'color' | 'description'>>) => Promise<void>
  deleteProject: (id: string) => Promise<void>

  fetchIntegrations: (projectId: string) => Promise<void>
  deleteIntegration: (projectId: string, id: string) => Promise<void>
  updateIntegration: (projectId: string, id: string, patch: object) => Promise<void>
  syncNow: (projectId: string, integrationId: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: 'general',
      integrations: [],
      syncingIds: new Set(),

      setProjects: (projects) => set({ projects }),
      setActiveProject: (id) => set({ activeProjectId: id, integrations: [] }),
      setIntegrations: (integrations) => set({ integrations }),
      setSyncing: (id, syncing) => set((s) => {
        const next = new Set(s.syncingIds)
        syncing ? next.add(id) : next.delete(id)
        return { syncingIds: next }
      }),

      createProject: async (data) => {
        const res = await api.createProject(data)
        set((s) => ({ projects: [...s.projects, res.project] }))
        return res.project
      },

      updateProject: async (id, patch) => {
        const res = await api.updateProject(id, patch)
        set((s) => ({ projects: s.projects.map(p => p.id === id ? res.project : p) }))
      },

      deleteProject: async (id) => {
        await api.deleteProject(id)
        set((s) => ({
          projects: s.projects.filter(p => p.id !== id),
          activeProjectId: s.activeProjectId === id ? 'general' : s.activeProjectId,
        }))
      },

      fetchIntegrations: async (projectId) => {
        const res = await api.getProjectIntegrations(projectId)
        set({ integrations: res.integrations })
      },

      deleteIntegration: async (projectId, id) => {
        await api.deleteIntegration(projectId, id)
        set((s) => ({ integrations: s.integrations.filter(i => i.id !== id) }))
      },

      updateIntegration: async (projectId, id, patch) => {
        const res = await api.updateIntegration(projectId, id, patch)
        set((s) => ({ integrations: s.integrations.map(i => i.id === id ? res.integration : i) }))
      },

      syncNow: async (projectId, integrationId) => {
        get().setSyncing(integrationId, true)
        try {
          await api.syncIntegrationNow(projectId, integrationId)
        } finally {
          // WS event will clear syncing state; fallback clear after 30s
          setTimeout(() => get().setSyncing(integrationId, false), 30_000)
        }
      },
    }),
    {
      name: 'aoc-active-project',
      partialize: (s) => ({ activeProjectId: s.activeProjectId }),
    }
  )
)
