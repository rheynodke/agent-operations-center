// packages/aoc-embed/src/widget/preview.ts
import { config, messages, view } from './store';
import { ChatMessage, EmbedConfig } from './types';

const SAMPLE: ChatMessage[] = [
  {
    id: 'sample-u',
    role: 'user',
    text: 'Halo, ini contoh pesan dari pengunjung.',
    timestamp: Date.now() - 60_000,
  },
  {
    id: 'sample-a',
    role: 'agent',
    text: 'Halo! Ini contoh balasan dari agent. Bubble ini menggunakan brand color & avatar yang Anda pilih.',
    timestamp: Date.now() - 30_000,
  },
];

export function installPreviewListener() {
  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'aoc:preview-config') {
      config.value = data.config as EmbedConfig;
      if (messages.value.length === 0) messages.value = SAMPLE;
      view.value = 'chat';
    } else if (data.type === 'aoc:preview-show-welcome') {
      view.value = 'welcome';
    } else if (data.type === 'aoc:preview-show-chat') {
      view.value = 'chat';
      if (messages.value.length === 0) messages.value = SAMPLE;
    }
  });

  // Tell parent we're ready to receive config
  try {
    window.parent?.postMessage({ type: 'aoc:preview-ready' }, '*');
  } catch (_) {}
}
