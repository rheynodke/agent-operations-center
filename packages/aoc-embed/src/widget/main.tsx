import { render } from 'preact';
import { App } from './App';

// Pre-render: buffer any aoc:* messages that arrive before React mounts.
// App.tsx flushes the buffer in its useEffect.
const w = window as any;
w.__AOC_PRE_BUFFER__ = w.__AOC_PRE_BUFFER__ || [];
const preHandler = (e: MessageEvent) => {
  if (e.data && typeof e.data === 'object' && typeof e.data.type === 'string' && e.data.type.startsWith('aoc:')) {
    w.__AOC_PRE_BUFFER__.push(e);
  }
};
window.addEventListener('message', preHandler);
w.__AOC_PRE_HANDLER__ = preHandler;

// Notify parent that the widget script has booted — parent can re-deliver init.
try {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'aoc:ready' }, '*');
  }
} catch { /* no-op */ }

const root = document.getElementById('root');
if (root) render(<App />, root);
