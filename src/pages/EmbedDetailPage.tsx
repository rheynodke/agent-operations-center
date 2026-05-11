import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { embedApi } from '@/lib/embed-api';
import type { Embed } from '@/types/embed';
import DesignTab from './embed-detail/DesignTab';
import BehaviorTab from './embed-detail/BehaviorTab';
import SecurityTab from './embed-detail/SecurityTab';
import SnippetTab from './embed-detail/SnippetTab';

type Tab = 'design' | 'behavior' | 'security' | 'snippet';

export default function EmbedDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [embed, setEmbed] = useState<Embed | null>(null);
  const [tab, setTab] = useState<Tab>('design');

  useEffect(() => { if (id) embedApi.get(id).then(setEmbed); }, [id]);

  if (!embed) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 w-full">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/embeds')} className="text-sm text-muted-foreground">← All embeds</button>
        <h1 className="text-2xl font-semibold">{embed.brandName}</h1>
      </div>

      <div className="border-b border-border mb-4">
        <nav className="flex gap-4">
          {(['design', 'behavior', 'security', 'snippet'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
                    className={`pb-2 px-1 capitalize ${tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}>
              {t}
            </button>
          ))}
        </nav>
      </div>

      <div className="border border-border rounded-lg p-6 bg-card">
        {tab === 'design' && <DesignTab embed={embed} onUpdate={setEmbed} />}
        {tab === 'behavior' && <BehaviorTab embed={embed} onUpdate={setEmbed} />}
        {tab === 'security' && <SecurityTab embed={embed} onUpdate={setEmbed} />}
        {tab === 'snippet' && <SnippetTab embed={embed} />}
      </div>
    </div>
  );
}
