// packages/aoc-embed/src/widget/components/MessageBubble.tsx
import { ChatMessage } from '../types';
import { Markdown } from './Markdown';

interface Props {
  msg: ChatMessage;
  brandColor: string;
  brandColorText: string;
  agentAvatarUrl: string | null;
  agentInitial: string;
}

export function MessageBubble({ msg, brandColor, brandColorText, agentAvatarUrl, agentInitial }: Props) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      gap: '8px',
      margin: '8px 12px',
    }}>
      {!isUser && (
        agentAvatarUrl ? (
          <img
            src={agentAvatarUrl}
            alt=""
            style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: brandColor, color: brandColorText,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', fontWeight: 600, textTransform: 'uppercase',
          }}>{agentInitial}</div>
        )
      )}
      <div style={{
        maxWidth: '78%',
        padding: '10px 14px',
        borderRadius: '14px',
        background: isUser ? brandColor : '#F1F5F9',
        color: isUser ? brandColorText : '#0F172A',
        fontSize: '14px',
        lineHeight: '1.4',
        wordBreak: 'break-word',
      }}>
        {isUser
          ? <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
          : <Markdown text={msg.text} />}
      </div>
    </div>
  );
}
