// packages/aoc-embed/src/widget/views/ChatView.tsx
import { useState, useRef, useEffect } from 'preact/hooks';
import { config, messages, isWaiting, view, errorBanner, previewMode } from '../store';
import { MessageBubble } from '../components/MessageBubble';
import { TypingIndicator } from '../components/TypingIndicator';

export function ChatView({ onSend, onClear }: { onSend: (text: string) => void, onClear: () => void }) {
  const cfg = config.value!;
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isPreview = previewMode.value;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.value, isWaiting.value]);

  function submit() {
    if (isPreview) return;
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
  }

  const sendDisabled = isPreview || isWaiting.value || !draft.trim();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'white' }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={() => view.value = 'welcome'} style={{ all: 'unset', cursor: 'pointer', color: '#64748B' }} aria-label="Back">←</button>
        <div style={{ fontWeight: 600, fontSize: '14px' }}>{cfg.brandName}</div>
        <button onClick={onClear} style={{ all: 'unset', cursor: 'pointer', color: '#64748B', fontSize: '12px' }}>Clear</button>
      </div>
      <div ref={scrollRef as any} style={{ flex: 1, overflow: 'auto' }}>
        {messages.value.map(m => (
          <MessageBubble
            key={m.id}
            msg={m}
            brandColor={cfg.brandColor}
            brandColorText={cfg.brandColorText}
            agentAvatarUrl={cfg.avatarUrl}
            agentInitial={(cfg.brandName || 'A').slice(0, 1)}
          />
        ))}
        {isWaiting.value && (
          <TypingIndicator
            agentAvatarUrl={cfg.avatarUrl}
            agentInitial={(cfg.brandName || 'A').slice(0, 1)}
            brandColor={cfg.brandColor}
            brandColorText={cfg.brandColorText}
          />
        )}
        {errorBanner.value && (
          <div style={{ margin: '8px 12px', padding: '8px 12px', background: '#FEE2E2', color: '#991B1B', borderRadius: '8px', fontSize: '13px' }}>
            {errorBanner.value}
          </div>
        )}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{
        padding: '12px', borderTop: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '6px',
      }}>
        {isPreview && (
          <p style={{ margin: 0, fontSize: '11px', color: '#94A3B8', textAlign: 'center' }}>
            Preview mode — sending disabled
          </p>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={draft} onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            placeholder="Enter your message..." disabled={isPreview}
            style={{
              flex: 1, padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '20px',
              fontSize: '14px', outline: 'none',
              background: isPreview ? '#F8FAFC' : 'white',
              color: isPreview ? '#94A3B8' : 'inherit',
            }} />
          <button type="submit" disabled={sendDisabled} style={{
            all: 'unset', cursor: sendDisabled ? 'not-allowed' : 'pointer',
            padding: '10px 14px', background: cfg.brandColor, color: cfg.brandColorText,
            borderRadius: '20px', fontSize: '14px', fontWeight: 500,
            opacity: sendDisabled ? 0.5 : 1,
          }}>Send</button>
        </div>
      </form>
    </div>
  );
}
