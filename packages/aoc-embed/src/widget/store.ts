// packages/aoc-embed/src/widget/store.ts
import { signal } from '@preact/signals';
import { ChatMessage, EmbedConfig } from './types';

export const config = signal<EmbedConfig | null>(null);
export const view = signal<'welcome' | 'chat'>('welcome');
export const messages = signal<ChatMessage[]>([]);
export const isWaiting = signal(false);
export const errorBanner = signal<string | null>(null);
export const sessionTokenSignal = signal<string | null>(null);
export const previewMode = signal(false);
export const playgroundMode = signal(false);

export function appendMessage(msg: ChatMessage) {
  messages.value = [...messages.value, msg];
}

export function reset() {
  messages.value = [];
  view.value = 'welcome';
  isWaiting.value = false;
  errorBanner.value = null;
}
