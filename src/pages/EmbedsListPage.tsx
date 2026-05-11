import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useEmbedStore } from '@/stores';
import { Button } from '@/components/ui/button';

export default function EmbedsListPage() {
  const { embeds, loading, error, load, disableAll } = useEmbedStore();
  const navigate = useNavigate();
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Embeds</h1>
        <div className="flex gap-2">
          <Button variant="destructive" onClick={() => {
            if (confirm('Disable ALL your embeds? This will immediately take down every chat widget you have deployed.')) {
              disableAll('emergency');
            }
          }}>⚠ Disable All</Button>
          <Button onClick={() => navigate('/embeds/new')}>+ New Embed</Button>
        </div>
      </div>

      {loading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">Error: {error}</p>}

      <div className="space-y-3">
        {embeds.map((e) => (
          <div key={e.id} className="border border-border rounded-lg p-4 bg-card hover:bg-card/80 cursor-pointer"
               onClick={() => navigate(`/embeds/${e.id}`)}>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-2 py-0.5 rounded bg-foreground/10 text-foreground">
                    {e.mode === 'private' ? '🔒 Private' : '🌐 Public'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${e.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {e.enabled ? '● enabled' : `⛔ ${e.disableMode || 'disabled'}`}
                  </span>
                </div>
                <h3 className="font-medium text-foreground">{e.brandName}</h3>
                <p className="text-sm text-muted-foreground">{e.productionOrigin} · agent: {e.agentId}</p>
              </div>
            </div>
          </div>
        ))}
        {!loading && embeds.length === 0 && (
          <p className="text-muted-foreground text-center py-12">No embeds yet. Click "+ New Embed" to create one.</p>
        )}
      </div>
    </div>
  );
}
