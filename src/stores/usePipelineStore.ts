// src/stores/usePipelineStore.ts
import { create } from 'zustand'
import type { Pipeline, PipelineGraph } from '@/types'
import { api } from '@/lib/api'

interface PipelineState {
  pipelines: Pipeline[]
  selected: Pipeline | null
  loading: boolean
  error: string | null

  fetchList: () => Promise<void>
  fetchOne: (id: string) => Promise<void>
  createPipeline: (data: { name: string; description?: string; graph?: PipelineGraph }) => Promise<Pipeline>
  updatePipeline: (id: string, patch: Partial<Pick<Pipeline, 'name' | 'description' | 'graph'>>) => Promise<Pipeline>
  deletePipeline: (id: string) => Promise<void>
  clear: () => void
}

export const usePipelineStore = create<PipelineState>((set) => ({
  pipelines: [],
  selected: null,
  loading: false,
  error: null,

  fetchList: async () => {
    set({ loading: true, error: null })
    try {
      const pipelines = await api.listPipelines()
      set({ pipelines, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  fetchOne: async (id) => {
    set({ loading: true, error: null })
    try {
      const p = await api.getPipeline(id)
      set({ selected: p, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false, selected: null })
    }
  },

  createPipeline: async (data) => {
    const p = await api.createPipeline(data)
    set((s) => ({ pipelines: [p, ...s.pipelines] }))
    return p
  },

  updatePipeline: async (id, patch) => {
    const p = await api.updatePipeline(id, patch)
    set((s) => ({
      pipelines: s.pipelines.map((x) => (x.id === id ? p : x)),
      selected: s.selected?.id === id ? p : s.selected,
    }))
    return p
  },

  deletePipeline: async (id) => {
    await api.deletePipeline(id)
    set((s) => ({
      pipelines: s.pipelines.filter((p) => p.id !== id),
      selected: s.selected?.id === id ? null : s.selected,
    }))
  },

  clear: () => set({ selected: null, error: null }),
}))
