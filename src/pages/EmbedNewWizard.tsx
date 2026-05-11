import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useEmbedStore, useAgentStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function EmbedNewWizard() {
  const navigate = useNavigate();
  const { create } = useEmbedStore();
  const { agents } = useAgentStore();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    agentId: '',
    mode: 'private' as const,
    productionOrigin: '',
    devOrigins: '',
    brandName: '',
    brandColor: '#3B82F6',
    welcomeTitle: '👋 Halo! Ada yang bisa saya bantu?',
    dlpPreset: 'internal-tool-default' as const,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(f => ({ ...f, [k]: v })); }

  async function submit() {
    setCreating(true); setError(null);
    try {
      const embed = await create({
        agentId: form.agentId,
        mode: 'private',
        productionOrigin: form.productionOrigin,
        devOrigins: form.devOrigins.split(',').map(s => s.trim()).filter(Boolean),
        brandName: form.brandName,
        brandColor: form.brandColor,
        welcomeTitle: form.welcomeTitle,
        dlpPreset: form.dlpPreset,
      });
      navigate(`/embeds/${embed.id}`);
    } catch (e: unknown) {
      const err = e as { error?: string; message?: string };
      setError(err.error || err.message || 'create_failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">New Embed (Step {step}/5)</h1>
      <div className="border border-border rounded-lg p-6 bg-card">
        {step === 1 && (
          <>
            <h2 className="font-medium mb-3">Choose mode</h2>
            <div className="space-y-2">
              <button className="block w-full text-left p-4 border-2 border-primary bg-primary/5 rounded-lg" type="button">
                <div className="font-medium">🔒 Embed for Internal Tool</div>
                <div className="text-sm text-muted-foreground">Staff portal, ops dashboard. Auth via JWT exchange from your host site.</div>
              </button>
              <button disabled className="block w-full text-left p-4 border border-border rounded-lg opacity-50 cursor-not-allowed" type="button">
                <div className="font-medium">🌐 Embed for Public Site (coming soon)</div>
                <div className="text-sm text-muted-foreground">Anonymous customer-facing chat — available in Phase 2.</div>
              </button>
            </div>
            <div className="flex justify-end mt-6">
              <Button onClick={() => setStep(2)}>Next →</Button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="font-medium mb-3">Choose agent</h2>
            <select value={form.agentId} onChange={(e) => update('agentId', e.target.value)}
                    className="w-full p-2 border border-border rounded bg-background">
              <option value="">— Select an agent —</option>
              {agents.filter(a => !('isPublicAgent' in a && a.isPublicAgent)).map(a => (
                <option key={a.id} value={a.id}>{a.name || a.id}</option>
              ))}
            </select>
            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button disabled={!form.agentId} onClick={() => setStep(3)}>Next →</Button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h2 className="font-medium mb-3">Origins</h2>
            <label className="block mb-3">
              <span className="text-sm">Production origin (exact URL)</span>
              <Input value={form.productionOrigin} onChange={(e) => update('productionOrigin', e.target.value)}
                     placeholder="https://your-site.com" />
            </label>
            <label className="block mb-3">
              <span className="text-sm">Dev origins (comma-separated patterns)</span>
              <Input value={form.devOrigins} onChange={(e) => update('devOrigins', e.target.value)}
                     placeholder="http://localhost:*, *.local" />
            </label>
            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
              <Button disabled={!form.productionOrigin} onClick={() => setStep(4)}>Next →</Button>
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <h2 className="font-medium mb-3">Branding</h2>
            <label className="block mb-3">
              <span className="text-sm">Brand name</span>
              <Input value={form.brandName} onChange={(e) => update('brandName', e.target.value)} />
            </label>
            <label className="block mb-3">
              <span className="text-sm">Brand color</span>
              <Input type="color" value={form.brandColor} onChange={(e) => update('brandColor', e.target.value)} />
            </label>
            <label className="block mb-3">
              <span className="text-sm">Welcome title</span>
              <Input value={form.welcomeTitle} onChange={(e) => update('welcomeTitle', e.target.value)} />
            </label>
            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => setStep(3)}>← Back</Button>
              <Button disabled={!form.brandName} onClick={() => setStep(5)}>Next →</Button>
            </div>
          </>
        )}
        {step === 5 && (
          <>
            <h2 className="font-medium mb-3">Review & Create</h2>
            <pre className="text-xs bg-muted p-3 rounded mb-3">{JSON.stringify(form, null, 2)}</pre>
            {error && <p className="text-destructive mb-3">Error: {error}</p>}
            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => setStep(4)}>← Back</Button>
              <Button onClick={submit} disabled={creating}>{creating ? 'Creating…' : 'Create Embed'}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
