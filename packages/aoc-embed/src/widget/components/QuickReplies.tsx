// packages/aoc-embed/src/widget/components/QuickReplies.tsx
import { QuickReply } from '../types';

export function QuickReplies({ replies, onPick }: { replies: QuickReply[], onPick: (prompt: string) => void }) {
  if (!replies.length) return null;
  return (
    <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {replies.map((r, i) => (
        <button key={i} onClick={() => onPick(r.prompt)} style={{
          all: 'unset', cursor: 'pointer', padding: '12px 16px', background: 'white',
          border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '14px',
          color: '#0F172A', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{r.label}</span><span style={{ color: '#94A3B8' }}>›</span>
        </button>
      ))}
    </div>
  );
}
