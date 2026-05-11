import { useState } from 'react';
import { embedApi } from '@/lib/embed-api';
import type { Embed } from '@/types/embed';
import { Button } from '@/components/ui/button';
import { useEmbedStore } from '@/stores';
import DlpAllowlistTester from './components/DlpAllowlistTester';

export default function SecurityTab({ embed, onUpdate }: { embed: Embed, onUpdate: (e: Embed) => void }) {
  const { toggle } = useEmbedStore();
  const [allowlistInput, setAllowlistInput] = useState(embed.dlpAllowlistPatterns.join('\n'));

  async function saveAllowlist() {
    const patterns = allowlistInput.split('\n').map(s => s.trim()).filter(Boolean);
    const updated = await embedApi.update(embed.id, { dlpAllowlistPatterns: patterns });
    onUpdate(updated);
  }

  async function regenerateSecret() {
    if (!confirm('Regenerate signing secret? This invalidates ALL active sessions and your host site must update its env.')) return;
    const newSecret = await embedApi.regenerateSecret(embed.id);
    alert(`New signing secret:\n\n${newSecret}\n\nCopy this and update your host site env. Old secret is now invalid.`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Kill switch</h3>
        <div className="flex gap-2 mt-2">
          <Button variant={embed.enabled ? 'outline' : 'default'} onClick={() => toggle(embed.id, true)}>Enabled</Button>
          <Button variant={embed.disableMode === 'maintenance' ? 'default' : 'outline'} onClick={() => toggle(embed.id, false, 'maintenance')}>Maintenance</Button>
          <Button variant={embed.disableMode === 'emergency' ? 'destructive' : 'outline'} onClick={() => toggle(embed.id, false, 'emergency')}>⛔ Emergency</Button>
        </div>
      </div>

      <div>
        <h3 className="font-medium mb-2">DLP preset</h3>
        <p className="text-sm text-muted-foreground">{embed.dlpPreset}</p>
      </div>

      <div>
        <h3 className="font-medium mb-2">DLP allowlist patterns (one per line)</h3>
        <textarea value={allowlistInput} onChange={(e) => setAllowlistInput(e.target.value)}
                  rows={5} className="w-full p-2 border border-border rounded bg-background font-mono text-sm" />
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
          <Button variant="destructive" onClick={regenerateSecret}>⚠ Regenerate signing secret</Button>
        </div>
      )}
    </div>
  );
}
