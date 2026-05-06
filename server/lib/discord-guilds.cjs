'use strict';
/**
 * Discord guild allowlist management.
 *
 * The openclaw config schema is strict — only `requireMention` and `users`
 * are allowed under each guild entry. Adding any other property (like a
 * friendly label) makes the gateway refuse to load the config.
 *
 * Layout:
 *   - Functional config in openclaw.json:
 *       channels.discord.accounts.<accountId>.guilds.<guildId> =
 *         { requireMention, users }
 *   - Friendly labels in an AOC-only sidecar file (not consumed by openclaw):
 *       data/discord-guild-labels.json =
 *         { "<accountId>": { "<guildId>": "Label string" } }
 *
 * Edits to the openclaw config require a gateway restart to take effect; the
 * label sidecar is purely for UI display and needs no restart.
 */
const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME, getUserHome, readJsonSafe } = require('./config.cjs');

// ── Multi-tenant home resolution ─────────────────────────────────────────────

function _ownerOf(agentId) {
  const { getOwnerContext } = require('./agents/owner-context.cjs');
  const ctx = getOwnerContext();
  if (ctx != null) return ctx;
  try {
    const owner = require('./db.cjs').getAgentOwner(agentId);
    return owner == null ? null : Number(owner);
  } catch { return null; }
}
function homeFor(agentId) {
  const o = _ownerOf(agentId);
  return o == null || o === 1 ? OPENCLAW_HOME : getUserHome(o);
}

function configPath(agentId) {
  return path.join(agentId ? homeFor(agentId) : OPENCLAW_HOME, 'openclaw.json');
}

// AOC-owned sidecar — colocated with aoc.db so it travels with dashboard data.
const LABELS_PATH = path.join(__dirname, '..', '..', 'data', 'discord-guild-labels.json');

function readLabels() {
  const data = readJsonSafe(LABELS_PATH);
  return data && typeof data === 'object' ? data : {};
}

function writeLabels(labels) {
  const dir = path.dirname(LABELS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${LABELS_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(labels, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, LABELS_PATH);
}

function getLabel(accountId, guildId) {
  const labels = readLabels();
  const v = labels?.[accountId]?.[guildId];
  return typeof v === 'string' ? v : '';
}

function setLabel(accountId, guildId, label) {
  const labels = readLabels();
  if (!labels[accountId]) labels[accountId] = {};
  if (label) labels[accountId][guildId] = label;
  else delete labels[accountId][guildId];
  if (Object.keys(labels[accountId]).length === 0) delete labels[accountId];
  writeLabels(labels);
}

function deleteLabel(accountId, guildId) {
  setLabel(accountId, guildId, '');
}

function readConfig(agentId) {
  const cfg = readJsonSafe(configPath(agentId));
  if (!cfg) throw new Error('openclaw.json not found or unreadable');
  return cfg;
}

function writeConfig(cfg, agentId) {
  const target = configPath(agentId);
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

function ensureAccountNode(cfg, accountId) {
  cfg.channels = cfg.channels || {};
  cfg.channels.discord = cfg.channels.discord || {};
  cfg.channels.discord.accounts = cfg.channels.discord.accounts || {};
  if (!cfg.channels.discord.accounts[accountId]) {
    throw new Error(`Discord account "${accountId}" not configured`);
  }
  return cfg.channels.discord.accounts[accountId];
}

function normalizeGuildId(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) throw new Error('Guild ID is required');
  if (!/^\d{15,25}$/.test(trimmed)) {
    throw new Error('Guild ID must be a numeric Discord snowflake (15–25 digits)');
  }
  return trimmed;
}

function normalizeUserId(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (!/^\d{15,25}$/.test(trimmed)) {
    throw new Error(`User ID "${trimmed}" must be a numeric Discord snowflake`);
  }
  return trimmed;
}

function normalizeUsers(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const u of input) {
    const id = normalizeUserId(u);
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/** Resolve the accountId for the agent's Discord binding(s). */
function resolveAgentDiscordAccount(agentId, getAgentChannels) {
  const channels = getAgentChannels(agentId);
  const discord = (channels.discord || []);
  if (discord.length === 0) {
    throw new Error(`Agent "${agentId}" has no Discord binding`);
  }
  // Prefer accountId === agentId; fall back to first discord binding
  const match = discord.find(d => d.accountId === agentId) || discord[0];
  return match.accountId;
}

function normalizeLabel(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim().slice(0, 60); // soft cap
}

/**
 * List configured guilds for the agent's Discord account.
 * Merges openclaw config (functional fields) with AOC-only label sidecar.
 * Returns { accountId, groupPolicy, guilds: [{ guildId, label, requireMention, users }] }
 */
function listAgentDiscordGuilds(agentId, getAgentChannels) {
  const accountId = resolveAgentDiscordAccount(agentId, getAgentChannels);
  const cfg = readConfig(agentId);
  const account = cfg?.channels?.discord?.accounts?.[accountId];
  const guilds = account?.guilds || {};
  const labels = readLabels()[accountId] || {};
  return {
    accountId,
    groupPolicy: account?.groupPolicy || 'allowlist',
    guilds: Object.entries(guilds).map(([guildId, opts]) => ({
      guildId,
      label: typeof labels[guildId] === 'string' ? labels[guildId] : '',
      requireMention: Boolean(opts?.requireMention),
      users: Array.isArray(opts?.users) ? opts.users.map(String) : [],
    })),
  };
}

/**
 * Upsert (create or update) a guild entry in the agent's Discord account.
 * - Functional fields (requireMention, users) → openclaw.json
 * - Label → AOC sidecar
 * @param opts { label?: string, requireMention?: boolean, users?: string[] }
 */
function upsertAgentDiscordGuild(agentId, guildId, opts, getAgentChannels) {
  const accountId = resolveAgentDiscordAccount(agentId, getAgentChannels);
  const normalizedGuildId = normalizeGuildId(guildId);

  // 1. Update functional fields in openclaw.json (skip if only label changed
  //    and entry already exists — but for simplicity always re-write).
  const cfg = readConfig(agentId);
  const account = ensureAccountNode(cfg, accountId);
  account.guilds = account.guilds || {};

  const prev = account.guilds[normalizedGuildId] || {};
  const next = {
    requireMention: opts?.requireMention !== undefined
      ? Boolean(opts.requireMention)
      : Boolean(prev.requireMention),
    users: opts?.users !== undefined
      ? normalizeUsers(opts.users)
      : Array.isArray(prev.users) ? prev.users : [],
  };
  account.guilds[normalizedGuildId] = next;

  // Make sure groupPolicy is allowlist so the guild gate actually evaluates.
  if (account.groupPolicy !== 'open' && account.groupPolicy !== 'disabled') {
    account.groupPolicy = 'allowlist';
  }

  writeConfig(cfg, agentId);

  // 2. Update label sidecar (AOC-only, doesn't trigger gateway reload).
  let label;
  if (opts?.label !== undefined) {
    label = normalizeLabel(opts.label);
    setLabel(accountId, normalizedGuildId, label);
  } else {
    label = getLabel(accountId, normalizedGuildId);
  }

  return {
    ok: true,
    accountId,
    guildId: normalizedGuildId,
    entry: { ...next, label },
  };
}

function removeAgentDiscordGuild(agentId, guildId, getAgentChannels) {
  const accountId = resolveAgentDiscordAccount(agentId, getAgentChannels);
  const normalizedGuildId = normalizeGuildId(guildId);
  const cfg = readConfig(agentId);
  const account = cfg?.channels?.discord?.accounts?.[accountId];
  if (!account?.guilds || !(normalizedGuildId in account.guilds)) {
    return { ok: false, error: `Guild ${normalizedGuildId} not found` };
  }
  delete account.guilds[normalizedGuildId];
  writeConfig(cfg, agentId);
  deleteLabel(accountId, normalizedGuildId);
  return { ok: true, accountId, guildId: normalizedGuildId };
}

module.exports = {
  listAgentDiscordGuilds,
  upsertAgentDiscordGuild,
  removeAgentDiscordGuild,
};
