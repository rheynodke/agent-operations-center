// packages/aoc-embed/src/widget/App.tsx
import { useEffect, useState } from 'preact/hooks';
import { config, view, messages, isWaiting, errorBanner, sessionTokenSignal, appendMessage, reset, previewMode, playgroundMode } from './store';
import { WelcomeView } from './views/WelcomeView';
import { ChatView } from './views/ChatView';
import { ApiContext, createSession, sendMessage, clearSession, fetchHistory } from './api';
import { InitMessage, SendCommand, ClearCommand, ChatMessage } from './types';

export function App() {
  const [ctx, setCtx] = useState<ApiContext | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isPreview = params.get('preview') === '1';
    const isPlayground = params.get('playground') === '1';
    previewMode.value = isPreview;
    playgroundMode.value = isPlayground;

    if (isPreview) {
      // Late import to keep main bundle tight if vite tree-shakes
      import('./preview').then(({ installPreviewListener }) => installPreviewListener());
      return; // Skip normal aoc:init flow
    }

    const handler = async (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'aoc:init') {
        const init = data as InitMessage;
        // Idempotency guard — postMessage retry from loader can fire multiple times
        if (config.value) return;
        config.value = init.config;
        const apiCtx: ApiContext = {
          base: init.base,
          embedToken: init.token,
          jwt: init.jwt,
          sessionToken: null,
          parentOrigin: init.parentOrigin || '',
          ownerJwt: init.ownerJwt || null,
          playground: init.playground === true,
        };
        try {
          const sess = await createSession(apiCtx, init.embedId);
          apiCtx.sessionToken = sess.session_token;
          sessionTokenSignal.value = sess.session_token;
          setCtx(apiCtx);
          // Load history
          const hist = await fetchHistory(apiCtx, null);
          if (hist.messages?.length) {
            messages.value = hist.messages.map((m: any) => ({
              id: m.id || crypto.randomUUID(), role: m.role, text: m.text, timestamp: m.timestamp,
            } as ChatMessage));
            view.value = 'chat';
          }
        } catch (err: any) {
          errorBanner.value = `Initialization failed: ${err.error || err.message || 'unknown'}`;
        }
      } else if (data.type === 'aoc:send' && ctx) {
        await handleSend(data.text);
      } else if (data.type === 'aoc:clear' && ctx) {
        await handleClear();
      }
    };
    window.addEventListener('message', handler);
    // Signal to parent that the widget is ready to receive aoc:init.
    try { window.parent?.postMessage({ type: 'aoc:ready' }, '*'); } catch (_) {}
    // Flush any messages that arrived before this listener was registered.
    const w = window as any;
    if (Array.isArray(w.__AOC_PRE_BUFFER__) && w.__AOC_PRE_BUFFER__.length) {
      const buffered = w.__AOC_PRE_BUFFER__.splice(0);
      buffered.forEach((e: MessageEvent) => handler(e));
    }
    if (w.__AOC_PRE_HANDLER__) {
      window.removeEventListener('message', w.__AOC_PRE_HANDLER__);
      delete w.__AOC_PRE_HANDLER__;
    }
    return () => window.removeEventListener('message', handler);
  }, [ctx]);

  async function handleSend(text: string) {
    if (!ctx) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text, timestamp: Date.now() };
    appendMessage(userMsg);
    view.value = 'chat';
    isWaiting.value = true;
    errorBanner.value = null;
    try {
      const result = await sendMessage(ctx, text);
      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(), role: 'agent', text: result.text, timestamp: Date.now(),
        redactionCount: result.redaction_count,
      };
      appendMessage(agentMsg);
    } catch (err: any) {
      if (err.status === 503) errorBanner.value = err.message || 'Service unavailable';
      else if (err.status === 429) errorBanner.value = "You're sending messages too quickly. Please wait.";
      else errorBanner.value = 'Something went wrong. Try again.';
    } finally {
      isWaiting.value = false;
    }
  }

  async function handleClear() {
    if (!ctx) return;
    const init = config.value!;
    await clearSession(ctx, init.embedId);
    reset();
  }

  if (!config.value) return <div style={{ padding: '20px', color: '#64748B' }}>Loading...</div>;
  if (!config.value.enabled) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#64748B' }}>{config.value.offlineMessage}</div>;
  }

  return view.value === 'welcome'
    ? <WelcomeView onPickQuickReply={(text) => handleSend(text)} />
    : <ChatView onSend={handleSend} onClear={handleClear} />;
}
