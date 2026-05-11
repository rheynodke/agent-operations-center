import { useRef, useState } from 'react';
import type { Embed } from '@/types/embed';
import { embedApi } from '@/lib/embed-api';
import { Button } from '@/components/ui/button';

const MAX_BYTES = 256 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

interface Props {
  embed: Embed;
  onChange: (next: Embed) => void;
}

export default function AvatarUploader({ embed, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!ALLOWED.includes(file.type)) {
      setError('PNG, JPG, or WEBP only');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Max 256 KB (got ${Math.round(file.size / 1024)} KB)`);
      return;
    }
    setBusy(true);
    try {
      const { avatarUrl, resolvedAvatarUrl } = await embedApi.uploadAvatar(embed.id, file);
      onChange({ ...embed, avatarSource: 'custom', avatarUrl, resolvedAvatarUrl });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(msg || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function revertToAgent() {
    setBusy(true);
    setError(null);
    try {
      const r = await embedApi.deleteAvatar(embed.id);
      onChange({ ...embed, avatarSource: 'agent', avatarUrl: null, resolvedAvatarUrl: r?.resolvedAvatarUrl ?? null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      setError(msg || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0">
          {(embed.resolvedAvatarUrl || embed.avatarUrl)
            ? <img src={embed.resolvedAvatarUrl || embed.avatarUrl || ''} alt="" className="w-full h-full object-cover" />
            : <div className="flex items-center justify-center h-full text-muted-foreground text-xs">agent</div>}
        </div>
        <div className="flex-1 text-sm min-w-0">
          <div className="truncate">{embed.avatarSource === 'custom' ? 'Custom upload' : "Agent's preset"}</div>
          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED.join(',')}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.currentTarget.value = '';
        }}
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          {embed.avatarSource === 'custom' ? 'Replace…' : 'Upload custom…'}
        </Button>
        {embed.avatarSource === 'custom' && (
          <Button variant="ghost" size="sm" onClick={revertToAgent} disabled={busy}>
            Use agent preset
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">PNG, JPG, or WEBP — max 256 KB.</p>
    </div>
  );
}
