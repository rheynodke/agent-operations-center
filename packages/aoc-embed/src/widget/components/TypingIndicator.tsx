// packages/aoc-embed/src/widget/components/TypingIndicator.tsx
import { useEffect, useState } from 'preact/hooks';
import { config } from '../store';

const DEFAULT_PHRASES = [
  'Agent sedang mengetik',
  'Agent sedang berpikir',
  'Agent sedang menyiapkan jawaban',
  'Sebentar lagi...',
];

/**
 * Per-stage duration before advancing to the next phrase. Last phrase sticks
 * until the response arrives — no cyclic rotation. The progression is intentional:
 *  - First phrase appears immediately and stays brief (looks responsive)
 *  - Middle phrases hold longer (feels like deeper thinking)
 *  - Final phrase sticks indefinitely (the response is imminent)
 */
const STAGE_DURATIONS_MS = [2200, 4500, 7500];

/**
 * Dot bounce period per stage. Slower bounce on later stages reinforces
 * the "thinking deeper" perception.
 */
const DOT_PERIODS = ['1.0s', '1.3s', '1.6s', '1.9s'];

interface Props {
  /** Optional phrase list; falls back to DEFAULT_PHRASES. */
  phrases?: string[];
  /** Optional agent avatar shown next to indicator. */
  agentAvatarUrl?: string | null;
  /** Optional agent initial fallback when no avatar. */
  agentInitial?: string;
  /** Optional brand color for avatar fallback bg. */
  brandColor?: string;
  /** Optional brand color text for avatar fallback fg. */
  brandColorText?: string;
}

export function TypingIndicator({
  phrases,
  agentAvatarUrl,
  agentInitial = 'A',
  brandColor = '#3B82F6',
  brandColorText = '#FFFFFF',
}: Props) {
  const customPhrases = config.value?.typingPhrases;
  const list: string[] =
    (phrases && phrases.length > 0)
      ? phrases
      : (customPhrases && customPhrases.length > 0)
        ? customPhrases
        : DEFAULT_PHRASES;

  const [index, setIndex] = useState(0);

  // Stage-based progression: schedule the NEXT advance with a timeout sized to
  // the current stage's duration. Last phrase has no timer (it sticks).
  useEffect(() => {
    if (list.length <= 1) return;
    if (index >= list.length - 1) return;
    const dur = STAGE_DURATIONS_MS[index] ?? 5000;
    const t = setTimeout(() => setIndex((i) => i + 1), dur);
    return () => clearTimeout(t);
  }, [index, list.length]);

  // Reset to first phrase when the phrase list itself changes (e.g. new message)
  useEffect(() => {
    setIndex(0);
  }, [list.join('')]);

  const display = list[index];
  const dotPeriod = DOT_PERIODS[Math.min(index, DOT_PERIODS.length - 1)];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: '8px',
      margin: '8px 12px',
    }}>
      {agentAvatarUrl ? (
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
      )}
      <div style={{
        padding: '10px 14px', borderRadius: '14px', background: '#F1F5F9',
        color: '#64748B', fontSize: '13px', fontStyle: 'italic',
        display: 'flex', alignItems: 'center', gap: '10px',
        minHeight: '40px',
      }}>
        <span style={{ display: 'inline-flex', gap: '4px' }}>
          {[0, 1, 2].map((i) => (
            <span
              key={`dot-${index}-${i}`}
              style={{
                width: '6px', height: '6px', borderRadius: '50%', background: '#94A3B8',
                animation: `aocBounce ${dotPeriod} ${i * 0.18}s infinite ease-in-out both`,
              }}
            />
          ))}
        </span>
        <span
          key={display}
          style={{
            display: 'inline-block',
            animation: 'aocPhraseFade 700ms cubic-bezier(0.22, 0.61, 0.36, 1)',
          }}
        >
          {display}
          <span style={{ animation: 'aocCaret 1.1s steps(2) infinite', marginLeft: '2px', opacity: 0.6 }}>…</span>
        </span>
        <style>{`
          @keyframes aocBounce {
            0%, 80%, 100% { transform: scale(0.55); opacity: 0.45; }
            40%           { transform: scale(1);    opacity: 1;    }
          }
          @keyframes aocPhraseFade {
            0%   { opacity: 0; transform: translateY(4px); filter: blur(1px); }
            60%  { opacity: 1; filter: blur(0); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes aocCaret {
            0%, 50%  { opacity: 0.2; }
            51%, 100% { opacity: 0.8; }
          }
        `}</style>
      </div>
    </div>
  );
}
