import { create } from 'zustand';
import { embedApi } from '@/lib/embed-api';
import type { Embed, CreateEmbedInput } from '@/types/embed';

interface EmbedState {
  embeds: Embed[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: CreateEmbedInput) => Promise<Embed>;
  update: (id: string, patch: Partial<Embed>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string, enabled: boolean, mode?: 'maintenance' | 'emergency') => Promise<void>;
  disableAll: (mode?: 'emergency' | 'maintenance') => Promise<void>;
}

export const useEmbedStore = create<EmbedState>((set, get) => ({
  embeds: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const list = await embedApi.list();
      set({ embeds: list, loading: false });
    } catch (e: unknown) {
      const err = e as { error?: string; message?: string };
      set({ error: err.error || err.message || 'load_failed', loading: false });
    }
  },

  create: async (input) => {
    const created = await embedApi.create(input);
    set((s) => ({ embeds: [created, ...s.embeds] }));
    return created;
  },

  update: async (id, patch) => {
    const updated = await embedApi.update(id, patch);
    set((s) => ({ embeds: s.embeds.map(e => e.id === id ? updated : e) }));
  },

  remove: async (id) => {
    await embedApi.remove(id);
    set((s) => ({ embeds: s.embeds.filter(e => e.id !== id) }));
  },

  toggle: async (id, enabled, mode) => {
    await embedApi.toggle(id, enabled, mode);
    set((s) => ({
      embeds: s.embeds.map(e => e.id === id ? { ...e, enabled: enabled ? 1 : 0, disableMode: enabled ? null : (mode || 'maintenance') } : e),
    }));
  },

  disableAll: async (mode) => {
    await embedApi.disableAll(mode);
    await get().load();
  },
}));
