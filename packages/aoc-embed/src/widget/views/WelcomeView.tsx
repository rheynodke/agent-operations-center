// packages/aoc-embed/src/widget/views/WelcomeView.tsx
import { config, view } from '../store';
import { QuickReplies } from '../components/QuickReplies';

export function WelcomeView({ onPickQuickReply }: { onPickQuickReply: (text: string) => void }) {
  const cfg = config.value;
  if (!cfg) return null;

  const initial = (cfg.brandName || 'A').slice(0, 1).toUpperCase();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'white' }}>
      {/* Hero — brand color background with decorative pattern + avatar + greeting */}
      <div style={{
        position: 'relative',
        background: `linear-gradient(135deg, ${cfg.brandColor} 0%, ${cfg.brandColor} 60%, ${shade(cfg.brandColor, -12)} 100%)`,
        color: cfg.brandColorText,
        padding: '32px 24px 56px',
        overflow: 'hidden',
      }}>
        {/* Decorative blobs (subtle) */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 160, height: 160,
          borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: 20, left: -30, width: 100, height: 100,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none',
        }} />

        {/* Avatar with online presence dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            {cfg.avatarUrl ? (
              <img
                src={cfg.avatarUrl}
                alt=""
                style={{
                  width: 56, height: 56, borderRadius: '50%',
                  border: '3px solid rgba(255,255,255,0.3)', objectFit: 'cover',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}
              />
            ) : (
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)', color: cfg.brandColorText,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '22px', fontWeight: 700,
                border: '3px solid rgba(255,255,255,0.3)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}>{initial}</div>
            )}
            {/* Online presence indicator */}
            <span style={{
              position: 'absolute', bottom: 2, right: 2,
              width: 14, height: 14, borderRadius: '50%',
              background: '#22C55E', border: '2.5px solid white',
              boxShadow: '0 0 0 0 rgba(34,197,94,0.7)',
              animation: 'aocPulse 2s infinite',
            }} />
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, opacity: 0.95 }}>{cfg.brandName}</div>
            <div style={{ fontSize: '12px', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E' }} />
              Online
            </div>
          </div>
        </div>

        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, lineHeight: 1.3, position: 'relative' }}>
          {cfg.welcomeTitle}
        </h2>
        {cfg.welcomeSubtitle && (
          <p style={{ margin: '8px 0 0', fontSize: '14px', opacity: 0.9, lineHeight: 1.5, position: 'relative' }}>
            {cfg.welcomeSubtitle}
          </p>
        )}
      </div>

      {/* Body — quick replies + Chat with us card, lifted onto hero with curve */}
      <div style={{
        flex: 1, marginTop: '-24px', background: 'white',
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.06)',
        overflow: 'auto',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ padding: '20px 12px 12px' }}>
          {cfg.quickReplies && cfg.quickReplies.length > 0 && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '0 4px 8px' }}>
                Quick questions
              </div>
              <QuickReplies replies={cfg.quickReplies} onPick={onPickQuickReply} />
            </>
          )}

          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '12px 4px 8px' }}>
            Or start a conversation
          </div>
          <button onClick={() => view.value = 'chat'} style={{
            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
            width: 'calc(100% - 24px)', margin: '0 12px',
            padding: '14px 16px', background: 'white',
            border: '1px solid #E2E8F0', borderRadius: '12px',
            transition: 'all 0.15s',
            boxSizing: 'border-box',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = cfg.brandColor;
            (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 8px ${cfg.brandColor}22`;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
            (e.currentTarget as HTMLElement).style.boxShadow = 'none';
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: cfg.brandColor + '15', color: cfg.brandColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '14px', color: '#0F172A' }}>Chat with us</div>
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                Balasan biasanya dalam beberapa detik
              </div>
            </div>
            <span style={{ color: '#CBD5E1', fontSize: '18px' }}>›</span>
          </button>
        </div>
      </div>

      {!cfg.hidePoweredBy && (
        <div style={{ padding: '10px', textAlign: 'center', fontSize: '11px', color: '#94A3B8', borderTop: '1px solid #F1F5F9' }}>
          Powered by AOC
        </div>
      )}

      <style>{`
        @keyframes aocPulse {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7); }
          70% { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }
        .aoc-markdown p { margin: 0 0 8px; }
        .aoc-markdown p:last-child { margin-bottom: 0; }
        .aoc-markdown ul, .aoc-markdown ol { margin: 4px 0 8px; padding-left: 22px; }
        .aoc-markdown li { margin: 2px 0; }
        .aoc-markdown code { background: rgba(15,23,42,0.08); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .aoc-markdown pre { background: rgba(15,23,42,0.06); padding: 8px 10px; border-radius: 8px; overflow-x: auto; margin: 6px 0; }
        .aoc-markdown pre code { background: transparent; padding: 0; }
        .aoc-markdown a { color: #2563EB; text-decoration: underline; }
        .aoc-markdown blockquote { margin: 6px 0; padding: 4px 12px; border-left: 3px solid rgba(15,23,42,0.15); color: rgba(15,23,42,0.75); }
        .aoc-markdown table { border-collapse: collapse; margin: 6px 0; font-size: 13px; }
        .aoc-markdown th, .aoc-markdown td { border: 1px solid rgba(15,23,42,0.15); padding: 4px 8px; text-align: left; }
        .aoc-markdown h1, .aoc-markdown h2, .aoc-markdown h3, .aoc-markdown h4 { margin: 8px 0 4px; line-height: 1.3; font-weight: 600; }
        .aoc-markdown h1 { font-size: 17px; }
        .aoc-markdown h2 { font-size: 15.5px; }
        .aoc-markdown h3 { font-size: 14.5px; }
        .aoc-markdown h4 { font-size: 14px; }
        .aoc-markdown hr { border: 0; border-top: 1px solid rgba(15,23,42,0.12); margin: 8px 0; }
      `}</style>
    </div>
  );
}

/** Lighten/darken a hex color by percentage. Negative = darker. */
function shade(hex: string, percent: number): string {
  let s = hex.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const num = parseInt(s, 16);
  let r = (num >> 16) + Math.round(255 * (percent / 100));
  let g = ((num >> 8) & 0xff) + Math.round(255 * (percent / 100));
  let b = (num & 0xff) + Math.round(255 * (percent / 100));
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
