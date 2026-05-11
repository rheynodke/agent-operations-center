import { useEffect, useRef } from 'react';
import type { Embed } from '@/types/embed';
import { useAuthStore } from '@/stores';

interface Props {
  embed: Embed;
  reloadKey: number; // bump to force iframe reload after Save
}

export default function PlaygroundIframe({ embed, reloadKey }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ownerJwt = useAuthStore((s) => s.token);
  const initedRef = useRef(false);

  // Reset the "already inited" guard whenever the iframe is reloaded.
  useEffect(() => {
    initedRef.current = false;
  }, [reloadKey]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== ref.current?.contentWindow) return;
      if (e.data?.type !== 'aoc:ready') return;
      if (initedRef.current) return;
      initedRef.current = true;
      ref.current!.contentWindow!.postMessage(
        {
          type: 'aoc:init',
          embedId: embed.id,
          token: embed.embedToken,
          jwt: undefined,
          base: window.location.origin,
          config: toEmbedConfig(embed),
          parentOrigin: window.location.origin,
          ownerJwt: ownerJwt || undefined,
          playground: true,
        },
        '*',
      );
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embed, ownerJwt]);

  return (
    <iframe
      key={reloadKey}
      ref={ref}
      src={`/embed/v1/widget.html?id=${embed.id}&playground=1`}
      className="w-full h-full border-0 rounded-lg bg-white"
      title="Embed playground"
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
