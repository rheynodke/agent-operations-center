import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useEmbedStore } from '@/stores';
import { embedApi } from '@/lib/embed-api';
import type { Embed } from '@/types/embed';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Filter = 'all' | 'enabled' | 'disabled' | 'private' | 'public';
type ToastKind = 'success' | 'warning' | 'danger';
interface Toast { id: number; kind: ToastKind; title: string; body?: string }

export default function EmbedsListPage() {
  const { embeds, loading, error, load, disableAll, toggle } = useEmbedStore();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmState, setConfirmState] = useState<null | {
    title: string;
    description: string;
    destructive?: boolean;
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
  }>(null);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(t: Omit<Toast, 'id'>) { setToast({ ...t, id: Date.now() }); }

  // ── Filtering ───────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return embeds.filter((e) => {
      if (filter === 'enabled' && !e.enabled) return false;
      if (filter === 'disabled' && e.enabled) return false;
      if (filter === 'private' && e.mode !== 'private') return false;
      if (filter === 'public' && e.mode !== 'public') return false;
      if (q) {
        return (
          e.brandName.toLowerCase().includes(q) ||
          e.productionOrigin.toLowerCase().includes(q) ||
          e.agentId.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [embeds, filter, search]);

  // ── Selection helpers ───────────────────────────────────────────────────
  const visibleIds = visible.map((e) => e.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAllVisible() {
    setSelected((s) => {
      const next = new Set(s);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  // ── Bulk action capability based on current state ──────────────────────
  const selectedEmbeds = embeds.filter((e) => selected.has(e.id));
  const anyDisabled = selectedEmbeds.some((e) => !e.enabled);
  const anyEnabled = selectedEmbeds.some((e) => e.enabled);

  async function bulkAction(action: 'enable' | 'maintenance' | 'emergency') {
    if (selectedEmbeds.length === 0 || busy) return;
    setBusy(true);
    let okCount = 0;
    let failCount = 0;
    try {
      for (const e of selectedEmbeds) {
        try {
          if (action === 'enable') {
            if (!e.enabled) { await toggle(e.id, true); okCount++; }
          } else {
            if (e.enabled || e.disableMode !== action) {
              await toggle(e.id, false, action);
              okCount++;
            }
          }
        } catch (_err) {
          failCount++;
        }
      }
      const verb = action === 'enable' ? 'enabled' : action === 'emergency' ? 'emergency-disabled' : 'set to maintenance';
      showToast({
        kind: failCount > 0 ? 'warning' : 'success',
        title: `${okCount} embed${okCount === 1 ? '' : 's'} ${verb}`,
        body: failCount > 0 ? `${failCount} failed.` : undefined,
      });
      clearSelection();
    } finally {
      setBusy(false);
    }
  }

  function bulkDelete() {
    if (selectedEmbeds.length === 0) return;
    const n = selectedEmbeds.length;
    setConfirmState({
      title: `Delete ${n} embed${n === 1 ? '' : 's'}?`,
      description: `This permanently removes the embed${n === 1 ? '' : 's'} and any associated session history. The loader URL${n === 1 ? '' : 's'} will return 404. This cannot be undone.`,
      destructive: true,
      confirmLabel: `Delete ${n}`,
      onConfirm: async () => {
        setBusy(true);
        let okCount = 0; let failCount = 0;
        try {
          for (const e of selectedEmbeds) {
            try { await embedApi.remove(e.id); okCount++; } catch (_) { failCount++; }
          }
          showToast({
            kind: failCount > 0 ? 'warning' : 'success',
            title: `${okCount} embed${okCount === 1 ? '' : 's'} deleted`,
            body: failCount > 0 ? `${failCount} failed.` : undefined,
          });
          clearSelection();
          await load();
        } finally {
          setBusy(false);
          setConfirmState(null);
        }
      },
    });
  }

  // ── Stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const enabled = embeds.filter((e) => e.enabled).length;
    const disabled = embeds.length - enabled;
    return { total: embeds.length, enabled, disabled };
  }, [embeds]);

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Embeds</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {stats.total} total · <span className="text-green-600 dark:text-green-400">{stats.enabled} enabled</span>{stats.disabled > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{stats.disabled} disabled</span></>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={() => setConfirmState({
              title: 'Emergency-disable all embeds?',
              description: `This immediately takes down every chat widget you have deployed (${stats.enabled} currently enabled). Visitors mid-session see a service-unavailable error. You can re-enable each embed individually afterwards.`,
              destructive: true,
              confirmLabel: 'Disable all',
              onConfirm: async () => {
                setBusy(true);
                try {
                  await disableAll('emergency');
                  showToast({ kind: 'danger', title: 'All embeds emergency-disabled', body: 'Every widget is now offline.' });
                } finally {
                  setBusy(false);
                  setConfirmState(null);
                }
              },
            })}
          >⚠ Disable All</Button>
          <Button onClick={() => navigate('/embeds/new')}>+ New Embed</Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, origin, or agent…"
          className="flex-1 min-w-[200px] max-w-md h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <div className="flex gap-1">
          {([
            { value: 'all',      label: `All (${embeds.length})` },
            { value: 'enabled',  label: `Enabled (${stats.enabled})` },
            { value: 'disabled', label: `Disabled (${stats.disabled})` },
            { value: 'private',  label: '🔒 Private' },
            { value: 'public',   label: '🌐 Public' },
          ] as { value: Filter; label: string }[]).map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                filter === f.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary text-muted-foreground hover:text-foreground border-border'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">Error: {error}</p>}

      {/* Bulk action bar (shows when 1+ selected) */}
      {selected.size > 0 && (
        <div className="sticky top-4 z-10 mb-3 flex items-center gap-2 bg-primary/10 dark:bg-primary/20 border border-primary/30 rounded-lg px-3 py-2 shadow-lg backdrop-blur-sm">
          <span className="text-sm font-medium text-foreground">
            {selected.size} selected
          </span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            ({selectedEmbeds.filter(e => e.enabled).length} enabled, {selectedEmbeds.filter(e => !e.enabled).length} disabled)
          </span>
          <div className="flex-1" />
          <Button
            size="sm" variant="outline"
            onClick={() => bulkAction('enable')}
            disabled={busy || !anyDisabled}
            title={!anyDisabled ? 'All selected are already enabled' : ''}
          >● Enable</Button>
          <Button
            size="sm" variant="outline"
            onClick={() => bulkAction('maintenance')}
            disabled={busy || (!anyEnabled && selectedEmbeds.every(e => e.disableMode === 'maintenance'))}
          >⚠ Maintenance</Button>
          <Button
            size="sm" variant="destructive"
            onClick={() => bulkAction('emergency')}
            disabled={busy || (!anyEnabled && selectedEmbeds.every(e => e.disableMode === 'emergency'))}
          >⛔ Emergency</Button>
          <Button
            size="sm" variant="ghost"
            onClick={bulkDelete}
            disabled={busy}
            className="text-destructive hover:text-destructive"
          >🗑</Button>
          <span className="w-px h-5 bg-border" />
          <Button size="sm" variant="ghost" onClick={clearSelection} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}

      {/* Embeds list */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {/* List header */}
        {visible.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
              onChange={toggleSelectAllVisible}
              className="w-4 h-4 accent-primary cursor-pointer"
              aria-label="Select all visible"
            />
            <span className="flex-1">Embed</span>
            <span className="hidden md:inline w-32">Origin</span>
            <span className="hidden md:inline w-24">Agent</span>
            <span className="w-28 text-right">Status</span>
          </div>
        )}

        {/* Rows */}
        {visible.map((e) => (
          <EmbedRow
            key={e.id}
            embed={e}
            selected={selected.has(e.id)}
            onToggleSelect={() => toggleSelect(e.id)}
            onOpen={() => navigate(`/embeds/${e.id}`)}
          />
        ))}

        {!loading && visible.length === 0 && embeds.length > 0 && (
          <div className="px-4 py-12 text-center text-muted-foreground text-sm">
            No embeds match the current filter.
          </div>
        )}
        {!loading && embeds.length === 0 && (
          <div className="px-4 py-16 text-center">
            <div className="text-4xl mb-3">💬</div>
            <p className="text-foreground font-medium mb-1">No embeds yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first embed to start adding chat widgets to your sites.
            </p>
            <Button onClick={() => navigate('/embeds/new')}>+ Create your first embed</Button>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && <ToastView key={toast.id} toast={toast} onClose={() => setToast(null)} />}

      {/* Confirm dialog (Disable All + bulk Delete) */}
      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          destructive={confirmState.destructive}
          loading={busy}
          onConfirm={() => { void confirmState.onConfirm(); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────

function EmbedRow({
  embed, selected, onToggleSelect, onOpen,
}: { embed: Embed; selected: boolean; onToggleSelect: () => void; onOpen: () => void }) {
  const stateColor = embed.enabled
    ? { dot: 'bg-green-500', tone: 'text-green-700 dark:text-green-400', label: 'Enabled' }
    : embed.disableMode === 'emergency'
      ? { dot: 'bg-red-500',   tone: 'text-red-700 dark:text-red-400',   label: 'Emergency' }
      : { dot: 'bg-amber-500', tone: 'text-amber-700 dark:text-amber-400', label: 'Maintenance' };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors ${
        selected ? 'bg-primary/5' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
        className="w-4 h-4 accent-primary cursor-pointer shrink-0"
        aria-label={`Select ${embed.brandName}`}
      />

      {/* Brand + mode + avatar */}
      <button
        onClick={onOpen}
        className="flex-1 flex items-center gap-3 text-left min-w-0"
      >
        {embed.resolvedAvatarUrl ? (
          <img
            src={embed.resolvedAvatarUrl}
            alt=""
            className="w-9 h-9 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
            style={{ background: embed.brandColor, color: embed.brandColorText }}
          >
            {embed.brandName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground truncate">{embed.brandName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-muted-foreground shrink-0">
              {embed.mode === 'private' ? '🔒 Private' : '🌐 Public'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate md:hidden">
            {embed.productionOrigin} · {embed.agentId}
          </p>
        </div>
      </button>

      {/* Origin (md+) */}
      <button
        onClick={onOpen}
        className="hidden md:block w-32 text-xs text-muted-foreground truncate text-left"
        title={embed.productionOrigin}
      >
        {embed.productionOrigin.replace(/^https?:\/\//, '')}
      </button>

      {/* Agent (md+) */}
      <button
        onClick={onOpen}
        className="hidden md:block w-24 text-xs text-muted-foreground truncate text-left font-mono"
        title={embed.agentId}
      >
        {embed.agentId}
      </button>

      {/* Status */}
      <button
        onClick={onOpen}
        className="w-28 flex items-center justify-end gap-1.5"
      >
        <span className={`w-2 h-2 rounded-full ${stateColor.dot}`} />
        <span className={`text-xs font-medium ${stateColor.tone}`}>
          {stateColor.label}
        </span>
      </button>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const palette: Record<ToastKind, { bg: string; border: string; icon: string; iconColor: string }> = {
    success: { bg: 'bg-green-50 dark:bg-green-950/40', border: 'border-green-200 dark:border-green-900', icon: '✓', iconColor: 'text-green-600' },
    warning: { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-900', icon: '!', iconColor: 'text-amber-600' },
    danger:  { bg: 'bg-red-50 dark:bg-red-950/40',     border: 'border-red-200 dark:border-red-900',     icon: '⛔', iconColor: 'text-red-600' },
  };
  const p = palette[toast.kind];
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 min-w-[280px] max-w-[400px] ${p.bg} ${p.border} border rounded-lg shadow-lg px-4 py-3 flex items-start gap-3`}
      style={{ animation: 'aocToastIn 220ms cubic-bezier(0.22, 0.61, 0.36, 1)' }}
      role="status"
      aria-live="polite"
    >
      <div className={`text-lg leading-tight ${p.iconColor} font-bold`}>{p.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{toast.title}</div>
        {toast.body && <div className="text-xs text-muted-foreground mt-0.5">{toast.body}</div>}
      </div>
      <button
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground text-sm leading-none px-1"
        aria-label="Dismiss"
      >×</button>
      <style>{`
        @keyframes aocToastIn {
          from { opacity: 0; transform: translateX(20px) translateY(4px); }
          to   { opacity: 1; transform: translateX(0)    translateY(0);   }
        }
      `}</style>
    </div>
  );
}
