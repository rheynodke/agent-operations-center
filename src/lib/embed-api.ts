import { useAuthStore } from '@/stores';
import type { Embed, CreateEmbedInput, AuditEvent } from '@/types/embed';

function _authHeaders() {
  const token = useAuthStore.getState().token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const embedApi = {
  async list(): Promise<Embed[]> {
    const res = await fetch('/api/embed/admin/embeds', { headers: _authHeaders() });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async get(id: string): Promise<Embed> {
    const res = await fetch(`/api/embed/admin/embeds/${id}`, { headers: _authHeaders() });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async create(input: CreateEmbedInput): Promise<Embed> {
    const res = await fetch('/api/embed/admin/embeds', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async update(id: string, patch: Partial<Embed>): Promise<Embed> {
    const res = await fetch(`/api/embed/admin/embeds/${id}`, {
      method: 'PATCH',
      headers: _authHeaders(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/embed/admin/embeds/${id}`, {
      method: 'DELETE',
      headers: _authHeaders(),
    });
    if (!res.ok) throw await res.json();
  },

  async toggle(id: string, enabled: boolean, mode?: 'maintenance' | 'emergency'): Promise<void> {
    const res = await fetch(`/api/embed/admin/embeds/${id}/toggle`, {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ enabled, mode }),
    });
    if (!res.ok) throw await res.json();
  },

  async regenerateSecret(id: string): Promise<string> {
    const res = await fetch(`/api/embed/admin/embeds/${id}/regenerate-secret`, {
      method: 'POST',
      headers: _authHeaders(),
    });
    if (!res.ok) throw await res.json();
    const data = await res.json();
    return data.signingSecret;
  },

  async disableAll(mode?: 'emergency' | 'maintenance'): Promise<{ disabled: string[] }> {
    const res = await fetch('/api/embed/admin/disable-all', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ mode: mode || 'emergency' }),
    });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async getAudit(id: string, params?: { eventType?: string; severity?: string; cursor?: number; limit?: number }): Promise<{ events: AuditEvent[] }> {
    const qs = new URLSearchParams();
    if (params?.eventType) qs.set('event_type', params.eventType);
    if (params?.severity) qs.set('severity', params.severity);
    if (params?.cursor) qs.set('cursor', String(params.cursor));
    if (params?.limit) qs.set('limit', String(params.limit));
    const res = await fetch(`/api/embed/admin/embeds/${id}/audit?${qs}`, { headers: _authHeaders() });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async dlpTest(embedId: string, text: string, allowlistOverride?: string[]): Promise<{ matches: { type: string; text: string; start: number; end: number }[]; redacted: string; warnings: string[] }> {
    const res = await fetch(`/api/embed/admin/embeds/${embedId}/dlp-test`, {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ text, ...(allowlistOverride ? { allowlistOverride } : {}) }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `dlp-test failed (${res.status})`);
    return res.json();
  },

  async uploadAvatar(embedId: string, file: File): Promise<{ avatarUrl: string; resolvedAvatarUrl: string | null }> {
    const fd = new FormData();
    fd.append('file', file);
    // Strip Content-Type — browser sets multipart boundary automatically
    const headers = { ..._authHeaders() } as Record<string, string>;
    delete headers['Content-Type'];
    const r = await fetch(`/api/embed/admin/embeds/${embedId}/avatar`, {
      method: 'POST', headers, body: fd,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || `upload failed (${r.status})`);
    }
    return r.json() as Promise<{ avatarUrl: string; resolvedAvatarUrl: string | null }>;
  },

  async deleteAvatar(embedId: string): Promise<{ ok: true; resolvedAvatarUrl: string | null }> {
    const r = await fetch(`/api/embed/admin/embeds/${embedId}/avatar`, {
      method: 'DELETE', headers: _authHeaders(),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || `delete failed (${r.status})`);
    }
    return r.json() as Promise<{ ok: true; resolvedAvatarUrl: string | null }>;
  },
};
