import { useState } from 'react';
import type { Embed } from '@/types/embed';
import { embedApi } from '@/lib/embed-api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import PreviewIframe from './PreviewIframe';
import PlaygroundIframe from './PlaygroundIframe';
import AvatarUploader from './AvatarUploader';

interface Props {
  embed: Embed;
  onUpdate: (e: Embed) => void;
}

export default function EmbedDesigner({ embed, onUpdate }: Props) {
  const [draft, setDraft] = useState<Embed>({ ...embed });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playgroundReloadKey, setPlaygroundReloadKey] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(embed);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await embedApi.update(embed.id, draft);
      onUpdate(updated);
      setDraft(updated);
      setPlaygroundReloadKey(k => k + 1);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-4 h-[680px]">
      {/* Form column */}
      <div className="col-span-4 overflow-y-auto pr-2 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Branding</h3>
          {dirty && <span className="text-xs text-amber-600">Unsaved</span>}
        </div>

        <label className="block">
          <span className="text-sm">Brand name</span>
          <Input
            value={draft.brandName}
            onChange={(e) => setDraft({ ...draft, brandName: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="text-sm">Brand color</span>
          <div className="flex gap-2">
            <Input
              type="color"
              value={draft.brandColor}
              onChange={(e) => setDraft({ ...draft, brandColor: e.target.value })}
              className="w-16 h-10 p-1"
            />
            <Input
              value={draft.brandColor}
              onChange={(e) => setDraft({ ...draft, brandColor: e.target.value })}
              className="flex-1"
            />
          </div>
        </label>

        <label className="block">
          <span className="text-sm">Brand color text (on top of brand color)</span>
          <Input
            type="color"
            value={draft.brandColorText}
            onChange={(e) => setDraft({ ...draft, brandColorText: e.target.value })}
            className="w-16 h-10 p-1"
          />
        </label>

        <label className="block">
          <span className="text-sm">Welcome title</span>
          <Input
            value={draft.welcomeTitle}
            onChange={(e) => setDraft({ ...draft, welcomeTitle: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="text-sm">Welcome subtitle</span>
          <Input
            value={draft.welcomeSubtitle || ''}
            onChange={(e) =>
              setDraft({ ...draft, welcomeSubtitle: e.target.value || null })
            }
          />
        </label>

        <div>
          <span className="text-sm">Avatar</span>
          <AvatarUploader embed={draft}
            onChange={(next) => {
              setDraft(next);
              onUpdate(next);   // server already updated by uploadAvatar/deleteAvatar, sync parent
            }} />
        </div>

        <div className="pt-3 sticky bottom-0 bg-card pb-2">
          <div className="flex gap-2">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {dirty && (
              <Button variant="outline" onClick={() => setDraft({ ...embed })}>
                Discard
              </Button>
            )}
          </div>
          {saveError && <div className="text-xs text-red-600 mt-1">{saveError}</div>}
        </div>
      </div>

      {/* Preview column */}
      <div className="col-span-4 flex flex-col">
        <div className="text-xs text-muted-foreground mb-1">
          Live preview <span className="opacity-60">(visual only)</span>
        </div>
        <div className="flex-1 border border-border rounded-lg bg-muted/40 overflow-hidden">
          <PreviewIframe draft={draft} />
        </div>
      </div>

      {/* Playground column */}
      <div className="col-span-4 flex flex-col">
        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
          <span>
            Playground <span className="opacity-60">(real chat, no quota)</span>
          </span>
          {dirty && <span className="text-amber-600">Save to refresh</span>}
        </div>
        <div className="flex-1 border border-border rounded-lg bg-muted/40 overflow-hidden">
          <PlaygroundIframe embed={embed} reloadKey={playgroundReloadKey} />
        </div>
      </div>
    </div>
  );
}
