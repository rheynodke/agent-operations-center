import { useState } from 'react';
import type { Embed } from '@/types/embed';
import { embedApi } from '@/lib/embed-api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import QuickReplyEditor from './components/QuickReplyEditor';
import PhraseEditor from './components/PhraseEditor';

export default function BehaviorTab({ embed, onUpdate }: { embed: Embed, onUpdate: (e: Embed) => void }) {
  const [draft, setDraft] = useState<Embed>({ ...embed });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(embed);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await embedApi.update(embed.id, draft);
      onUpdate(updated);
      setDraft(updated);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <span className="text-sm font-medium">Quick replies</span>
        <p className="text-xs text-muted-foreground mb-2">
          Drag to reorder. Max 5 — empty list hides the section in the welcome view.
        </p>
        <QuickReplyEditor value={draft.quickReplies || []}
                          onChange={(qr) => setDraft({ ...draft, quickReplies: qr })} />
      </div>

      <PhraseEditor value={draft.typingPhrases || null}
                    onChange={(p) => setDraft({ ...draft, typingPhrases: p })} />

      <label className="block">
        <span className="text-sm">Waiting text</span>
        <Input value={draft.waitingText}
               onChange={(e) => setDraft({ ...draft, waitingText: e.target.value })} />
      </label>
      <label className="block">
        <span className="text-sm">Offline message</span>
        <Input value={draft.offlineMessage}
               onChange={(e) => setDraft({ ...draft, offlineMessage: e.target.value })} />
      </label>
      <label className="block">
        <span className="text-sm">Retention days</span>
        <Input type="number" value={draft.retentionDays}
               onChange={(e) => setDraft({ ...draft, retentionDays: parseInt(e.target.value) || 30 })} />
      </label>

      <div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
          {dirty && <Button variant="outline" onClick={() => setDraft({ ...embed })}>Discard</Button>}
        </div>
        {saveError && <div className="text-xs text-red-600 mt-1">{saveError}</div>}
      </div>
    </div>
  );
}
