// server/lib/db/embeds.cjs
'use strict';

const crypto = require('crypto');
const { getDb, persist } = require('./_handle.cjs');

function _now() { return Date.now(); }
function _uuid() { return crypto.randomUUID(); }
function _randomHex(bytes) { return crypto.randomBytes(bytes).toString('hex'); }

function _parseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agent_id,
    ownerId: row.owner_id,
    mode: row.mode,
    embedToken: row.embed_token,
    signingSecret: row.signing_secret,
    productionOrigin: row.production_origin,
    devOrigins: JSON.parse(row.dev_origins || '[]'),
    brandName: row.brand_name,
    brandColor: row.brand_color,
    brandColorText: row.brand_color_text,
    avatarSource: row.avatar_source,
    avatarUrl: row.avatar_url,
    welcomeTitle: row.welcome_title,
    welcomeSubtitle: row.welcome_subtitle,
    quickReplies: JSON.parse(row.quick_replies || '[]'),
    waitingText: row.waiting_text,
    offlineMessage: row.offline_message,
    hidePoweredBy: row.hide_powered_by === 1,
    consentText: row.consent_text,
    languageDefault: row.language_default,
    dlpPreset: row.dlp_preset,
    dlpAllowlistPatterns: JSON.parse(row.dlp_allowlist_patterns || '[]'),
    enabled: row.enabled,
    disableMode: row.disable_mode,
    dailyTokenQuota: row.daily_token_quota,
    dailyMessageQuota: row.daily_message_quota,
    rateLimitPerIp: row.rate_limit_per_ip,
    retentionDays: row.retention_days,
    alertThresholdPercent: row.alert_threshold_percent,
    turnstileSitekey: row.turnstile_sitekey,
    turnstileSecret: row.turnstile_secret,
    widgetVersion: row.widget_version,
    typingPhrases: row.typing_phrases != null ? JSON.parse(row.typing_phrases) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createEmbed(input) {
  const db = getDb();
  const id = _uuid();
  const embedToken = 'emb_' + _randomHex(24);
  const signingSecret = input.mode === 'private' ? _randomHex(32) : null;
  const now = _now();

  const stmt = db.prepare(`
    INSERT INTO agent_embeds (
      id, agent_id, owner_id, mode, embed_token, signing_secret,
      production_origin, dev_origins,
      brand_name, brand_color, avatar_source,
      welcome_title, welcome_subtitle,
      quick_replies, waiting_text, offline_message,
      dlp_preset,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    id, input.agentId, input.ownerId, input.mode, embedToken, signingSecret,
    input.productionOrigin, JSON.stringify(input.devOrigins || []),
    input.brandName, input.brandColor || '#3B82F6', input.avatarSource || 'agent',
    input.welcomeTitle, input.welcomeSubtitle || null,
    JSON.stringify(input.quickReplies || []),
    input.waitingText || 'Sebentar, saya cek dulu...',
    input.offlineMessage || "We're temporarily offline. Please try again later.",
    input.dlpPreset,
    now, now,
  ]);
  stmt.free();
  persist();
  return getEmbedById(id);
}

function getEmbedById(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM agent_embeds WHERE id = ?');
  stmt.bind([id]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return _parseRow(row);
}

function getEmbedByToken(token) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM agent_embeds WHERE embed_token = ?');
  stmt.bind([token]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return _parseRow(row);
}

function listEmbedsForOwner(ownerId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM agent_embeds WHERE owner_id = ? ORDER BY created_at DESC');
  stmt.bind([ownerId]);
  const out = [];
  while (stmt.step()) out.push(_parseRow(stmt.getAsObject()));
  stmt.free();
  return out;
}

const UPDATABLE_FIELDS = {
  brandName: 'brand_name',
  brandColor: 'brand_color',
  brandColorText: 'brand_color_text',
  avatarSource: 'avatar_source',
  avatarUrl: 'avatar_url',
  welcomeTitle: 'welcome_title',
  welcomeSubtitle: 'welcome_subtitle',
  quickReplies: 'quick_replies',
  waitingText: 'waiting_text',
  offlineMessage: 'offline_message',
  hidePoweredBy: 'hide_powered_by',
  consentText: 'consent_text',
  languageDefault: 'language_default',
  dlpPreset: 'dlp_preset',
  dlpAllowlistPatterns: 'dlp_allowlist_patterns',
  enabled: 'enabled',
  disableMode: 'disable_mode',
  dailyTokenQuota: 'daily_token_quota',
  dailyMessageQuota: 'daily_message_quota',
  rateLimitPerIp: 'rate_limit_per_ip',
  retentionDays: 'retention_days',
  alertThresholdPercent: 'alert_threshold_percent',
  turnstileSitekey: 'turnstile_sitekey',
  turnstileSecret: 'turnstile_secret',
  productionOrigin: 'production_origin',
  devOrigins: 'dev_origins',
  typingPhrases: 'typing_phrases',
};

function updateEmbed(id, patch) {
  const db = getDb();
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = UPDATABLE_FIELDS[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    if (k === 'quickReplies' || k === 'devOrigins' || k === 'dlpAllowlistPatterns') {
      vals.push(JSON.stringify(v));
    } else if (k === 'typingPhrases') {
      vals.push(v === null ? null : JSON.stringify(v));
    } else if (k === 'hidePoweredBy') {
      vals.push(v ? 1 : 0);
    } else {
      vals.push(v);
    }
  }
  if (!sets.length) return getEmbedById(id);
  sets.push('updated_at = ?');
  vals.push(_now());
  vals.push(id);

  const stmt = db.prepare(`UPDATE agent_embeds SET ${sets.join(', ')} WHERE id = ?`);
  stmt.run(vals);
  stmt.free();
  persist();
  return getEmbedById(id);
}

function deleteEmbed(id) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM agent_embeds WHERE id = ?');
  stmt.run([id]);
  stmt.free();
  persist();
}

function regenerateSigningSecret(id) {
  const newSecret = _randomHex(32);
  const db = getDb();
  const stmt = db.prepare('UPDATE agent_embeds SET signing_secret = ?, updated_at = ? WHERE id = ?');
  stmt.run([newSecret, _now(), id]);
  stmt.free();
  persist();
  return newSecret;
}

module.exports = {
  createEmbed,
  getEmbedById,
  getEmbedByToken,
  listEmbedsForOwner,
  updateEmbed,
  deleteEmbed,
  regenerateSigningSecret,
};
