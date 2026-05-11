'use strict';

// Mirrors src/lib/avatarPresets.ts (id → file path). Kept in sync manually.
// The widget config endpoint uses this to resolve agent-bound avatar URLs
// when an embed's avatarSource === 'agent'.

const PRESET_FILES = {
  emerald:  '/avatars/bot-emerald.png',
  violet:   '/avatars/bot-violet.png',
  amber:    '/avatars/bot-amber.png',
  rose:     '/avatars/bot-rose.png',
  teal:     '/avatars/bot-teal.png',
  orange:   '/avatars/bot-orange.png',
  slate:    '/avatars/bot-slate.png',
  gold:     '/avatars/bot-gold.png',
  cyan:     '/avatars/bot-cyan.png',
  red:      '/avatars/bot-red.png',
  midnight: '/avatars/bot-midnight.png',
  copper:   '/avatars/bot-copper.png',
  lime:     '/avatars/bot-lime.png',
  sky:      '/avatars/bot-sky.png',
  indigo:   '/avatars/bot-indigo.png',
  fuchsia:  '/avatars/bot-fuchsia.png',
};

function resolvePresetPath(presetId) {
  if (!presetId) return null;
  return PRESET_FILES[presetId] || null;
}

module.exports = { PRESET_FILES, resolvePresetPath };
