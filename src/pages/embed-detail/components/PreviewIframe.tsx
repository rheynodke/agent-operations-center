import { useEffect, useRef } from 'react';
import type { Embed } from '@/types/embed';

interface Props {
  draft: Embed;
  className?: string;
}

export default function PreviewIframe({ draft, className }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== ref.current?.contentWindow) return;
      if (e.data?.type === 'aoc:preview-ready') {
        readyRef.current = true;
        postConfig();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function postConfig() {
    const win = ref.current?.contentWindow;
    if (!win || !readyRef.current) return;
    win.postMessage({ type: 'aoc:preview-config', config: toEmbedConfig(draftRef.current) }, '*');
  }

  useEffect(() => {
    if (!readyRef.current) return;
    const t = setTimeout(postConfig, 100);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft)]);

  return (
    <iframe
      ref={ref}
      src="/embed/v1/widget.html?preview=1"
      className={`w-full h-full border-0 rounded-lg bg-white ${className || ''}`}
      title="Embed preview"
    />
  );
}

function toEmbedConfig(e: Embed) {
  return {
    embedId: e.id,
    brandName: e.brandName,
    brandColor: e.brandColor,
    brandColorText: e.brandColorText,
    welcomeTitle: e.welcomeTitle,
    welcomeSubtitle: e.welcomeSubtitle,
    waitingText: e.waitingText,
    typingPhrases: e.typingPhrases || null,
    quickReplies: e.quickReplies || [],
    avatarUrl: e.resolvedAvatarUrl ?? e.avatarUrl,
    enabled: !!e.enabled,
    hidePoweredBy: !!e.hidePoweredBy,
    offlineMessage: e.offlineMessage,
  };
}
