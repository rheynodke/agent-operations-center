import { useEffect, useState } from 'react';
import { embedApi } from '@/lib/embed-api';
import type { Embed } from '@/types/embed';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useEmbedStore } from '@/stores';
import DlpAllowlistTester from './components/DlpAllowlistTester';

type ToastKind = 'success' | 'warning' | 'danger';
interface Toast { id: number; kind: ToastKind; title: string; body?: string }

export default function SecurityTab({ embed, onUpdate }: { embed: Embed, onUpdate: (e: Embed) => void }) {
  const { toggle } = useEmbedStore();
  const [allowlistInput, setAllowlistInput] = useState(embed.dlpAllowlistPatterns.join('\n'));
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  function showToast(t: Omit<Toast, 'id'>) {
    setToast({ ...t, id: Date.now() });
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function handleToggle(enabled: boolean, mode?: 'maintenance' | 'emergency') {
    if (busy) return;
    // No-op if already in this state
    if (enabled && embed.enabled === 1) {
      showToast({ kind: 'success', title: 'Already enabled', body: 'Embed is currently live.' });
      return;
    }
    if (!enabled && embed.enabled === 0 && embed.disableMode === mode) {
      showToast({ kind: 'warning', title: 'No change', body: `Already in ${mode} mode.` });
      return;
    }
    setBusy(true);
    try {
      await toggle(embed.id, enabled, mode);
      // Mirror the optimistic state from store into parent's embed prop
      onUpdate({
        ...embed,
        enabled: enabled ? 1 : 0,
        disableMode: enabled ? null : (mode || 'maintenance'),
      });
      if (enabled) {
        showToast({
          kind: 'success',
          title: 'Embed enabled',
          body: 'Widget is live again on customer sites.',
        });
      } else if (mode === 'emergency') {
        showToast({
          kind: 'danger',
          title: 'Emergency disable applied',
          body: 'All active sessions ended. Widget returns 503 Service Unavailable.',
        });
      } else {
        showToast({
          kind: 'warning',
          title: 'Maintenance mode',
          body: 'Visitors see your offline message; production traffic blocked.',
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Toggle failed';
      showToast({ kind: 'danger', title: 'Failed', body: msg });
    } finally {
      setBusy(false);
    }
  }

  async function saveAllowlist() {
    const patterns = allowlistInput.split('\n').map(s => s.trim()).filter(Boolean);
    try {
      const updated = await embedApi.update(embed.id, { dlpAllowlistPatterns: patterns });
      onUpdate(updated);
      showToast({ kind: 'success', title: 'Allowlist saved', body: `${patterns.length} pattern${patterns.length === 1 ? '' : 's'} active.` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      showToast({ kind: 'danger', title: 'Save failed', body: msg });
    }
  }

  async function doRegenerateSecret() {
    setBusy(true);
    try {
      const newSecret = await embedApi.regenerateSecret(embed.id);
      onUpdate({ ...embed, signingSecret: newSecret });
      showToast({
        kind: 'warning',
        title: 'New signing secret generated',
        body: 'Old secret is now invalid. Copy the new one from the Snippet tab.',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Regenerate failed';
      showToast({ kind: 'danger', title: 'Failed', body: msg });
    } finally {
      setBusy(false);
      setConfirmRegen(false);
    }
  }

  // Current state pill
  const stateBadge = embed.enabled
    ? { dot: 'bg-green-500', label: 'Enabled', tone: 'text-green-700 dark:text-green-400' }
    : embed.disableMode === 'emergency'
      ? { dot: 'bg-red-500', label: 'Emergency disabled', tone: 'text-red-700 dark:text-red-400' }
      : { dot: 'bg-amber-500', label: 'Maintenance', tone: 'text-amber-700 dark:text-amber-400' };

  return (
    <div className="space-y-4 relative">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-medium">Kill switch</h3>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${stateBadge.tone}`}>
            <span className={`w-2 h-2 rounded-full ${stateBadge.dot}`} />
            {stateBadge.label}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant={embed.enabled ? 'default' : 'outline'}
            onClick={() => handleToggle(true)}
            disabled={busy}
          >Enabled</Button>
          <Button
            variant={!embed.enabled && embed.disableMode === 'maintenance' ? 'default' : 'outline'}
            onClick={() => handleToggle(false, 'maintenance')}
            disabled={busy}
          >Maintenance</Button>
          <Button
            variant={!embed.enabled && embed.disableMode === 'emergency' ? 'destructive' : 'outline'}
            onClick={() => handleToggle(false, 'emergency')}
            disabled={busy}
          >⛔ Emergency</Button>
        </div>
      </div>

      <div>
        <h3 className="font-medium mb-2">DLP preset</h3>
        <p className="text-sm text-muted-foreground">{embed.dlpPreset}</p>
      </div>

      <div>
        <h3 className="font-medium mb-2">DLP allowlist patterns (one per line)</h3>
        <textarea
          value={allowlistInput}
          onChange={(e) => setAllowlistInput(e.target.value)}
          rows={5}
          className="w-full p-2 border border-border rounded bg-background font-mono text-sm"
        />
        <Button onClick={saveAllowlist} className="mt-2">Save allowlist</Button>
      </div>

      <div>
        <h3 className="font-medium mb-2">Test patterns</h3>
        <p className="text-xs text-muted-foreground mb-2">
          Paste sample text — see what the live filter would match using the patterns above
          (your unsaved edits in the textarea are tested).
        </p>
        <DlpAllowlistTester embed={embed}
          allowlistDraft={allowlistInput.split('\n').map(s => s.trim()).filter(Boolean)} />
      </div>

      {embed.mode === 'private' && (
        <div>
          <h3 className="font-medium mb-2">Signing secret</h3>
          <p className="text-sm text-muted-foreground mb-2">Used by your host site to sign visitor JWTs. Keep secret.</p>
          <Button variant="destructive" onClick={() => setConfirmRegen(true)}>⚠ Regenerate signing secret</Button>
        </div>
      )}

      {/* Toast — fixed bottom-right */}
      {toast && <ToastView key={toast.id} toast={toast} onClose={() => setToast(null)} />}

      {/* Confirm dialog (regenerate signing secret) */}
      {confirmRegen && (
        <ConfirmDialog
          title="Regenerate signing secret?"
          description="Invalidates ALL active sessions. Your host site must update its AOC_EMBED_SECRET env var to the new value. Old secret stops working immediately."
          confirmLabel="Regenerate"
          destructive
          loading={busy}
          onConfirm={doRegenerateSecret}
          onCancel={() => setConfirmRegen(false)}
        />
      )}
    </div>
  );
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const palette: Record<ToastKind, { bg: string; border: string; icon: string; iconColor: string }> = {
    success: { bg: 'bg-green-50 dark:bg-green-950/40',    border: 'border-green-200 dark:border-green-900', icon: '✓', iconColor: 'text-green-600' },
    warning: { bg: 'bg-amber-50 dark:bg-amber-950/40',    border: 'border-amber-200 dark:border-amber-900', icon: '!', iconColor: 'text-amber-600' },
    danger:  { bg: 'bg-red-50 dark:bg-red-950/40',        border: 'border-red-200 dark:border-red-900',     icon: '⛔', iconColor: 'text-red-600' },
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
