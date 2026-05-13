'use strict';
/**
 * WhatsApp group allowlist + activation management.
 *
 * The openclaw WhatsApp config schema (packages/plugin-sdk/.../types.whatsapp.d.ts)
 * allows the following editable fields per account:
 *   channels.whatsapp.accounts.<acc>.groupPolicy      (open|allowlist|disabled)
 *   channels.whatsapp.accounts.<acc>.groupAllowFrom[] (E.164 senders allowed in groups)
 *   channels.whatsapp.accounts.<acc>.historyLimit
 *   channels.whatsapp.accounts.<acc>.groups.<jid>.requireMention
 *
 * Per-agent mention regex patterns are at:
 *   agents.list[].groupChat.mentionPatterns[]
 *
 * Friendly labels for groups are stored in an AOC-only sidecar
 * (the openclaw schema rejects unknown properties under groups.<jid>):
 *   data/whatsapp-group-labels.json = { "<accountId>": { "<jid>": "Label" } }
 *
 * Edits to openclaw.json require a gateway restart to take effect; label
 * sidecar is UI-only and needs no restart.
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

const LABELS_PATH = path.join(__dirname, '..', '..', 'data', 'whatsapp-group-labels.json');

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

function getLabel(accountId, jid) {
  const v = readLabels()?.[accountId]?.[jid];
  return typeof v === 'string' ? v : '';
}

function setLabel(accountId, jid, label) {
  const labels = readLabels();
  if (!labels[accountId]) labels[accountId] = {};
  if (label) labels[accountId][jid] = label;
  else delete labels[accountId][jid];
  if (Object.keys(labels[accountId]).length === 0) delete labels[accountId];
  writeLabels(labels);
}

function deleteLabel(accountId, jid) { setLabel(accountId, jid, ''); }

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
  cfg.channels.whatsapp = cfg.channels.whatsapp || {};
  cfg.channels.whatsapp.accounts = cfg.channels.whatsapp.accounts || {};
  if (!cfg.channels.whatsapp.accounts[accountId]) {
    throw new Error(`WhatsApp account "${accountId}" not configured`);
  }
  return cfg.channels.whatsapp.accounts[accountId];
}

function normalizeJid(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) throw new Error('Group JID is required');
  // WhatsApp group JID forms:
  //   <digits>-<digits>@g.us       (legacy: creator-e164 + timestamp)
  //   <digits>@g.us                (community / newer)
  if (!/^[0-9-]+@g\.us$/.test(trimmed)) {
    throw new Error('Group JID must be of the form <digits>[-<digits>]@g.us');
  }
  return trimmed;
}

function normalizeE164(value) {
  // E.164: optional leading "+", then 7-15 digits. We persist without "+".
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const m = /^\+?(\d{7,15})$/.exec(trimmed);
  if (!m) throw new Error(`Sender "${trimmed}" must be a valid E.164 phone number (7–15 digits)`);
  return m[1];
}

function normalizeE164List(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const v of input) {
    const id = normalizeE164(v);
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

function normalizeMentionPatterns(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const v of input) {
    const s = String(v ?? '').trim();
    if (!s || seen.has(s)) continue;
    // Best-effort regex validation — reject patterns that won't compile.
    try { new RegExp(s); } catch (e) {
      throw new Error(`Invalid regex pattern "${s}": ${e.message}`);
    }
    seen.add(s); out.push(s);
  }
  return out;
}

function normalizeLabel(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim().slice(0, 80);
}

function normalizePolicy(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!['open', 'allowlist', 'disabled'].includes(v)) {
    throw new Error('groupPolicy must be one of: open, allowlist, disabled');
  }
  return v;
}

function resolveAgentWhatsAppAccount(agentId, getAgentChannels) {
  const channels = getAgentChannels(agentId);
  const wa = channels.whatsapp || [];
  if (wa.length === 0) {
    throw new Error(`Agent "${agentId}" has no WhatsApp binding`);
  }
  const match = wa.find(d => d.accountId === agentId) || wa[0];
  return match.accountId;
}

// ── Read ─────────────────────────────────────────────────────────────────────

function listAgentWhatsAppGroups(agentId, getAgentChannels) {
  const accountId = resolveAgentWhatsAppAccount(agentId, getAgentChannels);
  const cfg = readConfig(agentId);
  const account = cfg?.channels?.whatsapp?.accounts?.[accountId] || {};
  const groups = account.groups || {};
  const labels = readLabels()[accountId] || {};
  const agentNode = (cfg?.agents?.list || []).find(a => a.id === agentId);
  const mentionPatterns = Array.isArray(agentNode?.groupChat?.mentionPatterns)
    ? agentNode.groupChat.mentionPatterns.map(String) : [];

  return {
    accountId,
    groupPolicy: account.groupPolicy || 'allowlist',
    groupAllowFrom: Array.isArray(account.groupAllowFrom) ? account.groupAllowFrom.map(String) : [],
    historyLimit: typeof account.historyLimit === 'number' ? account.historyLimit : null,
    mentionPatterns,
    groups: Object.entries(groups).map(([jid, opts]) => ({
      jid,
      label: typeof labels[jid] === 'string' ? labels[jid] : '',
      requireMention: Boolean(opts?.requireMention),
    })),
  };
}

// ── Upsert per-group ─────────────────────────────────────────────────────────

function upsertAgentWhatsAppGroup(agentId, jid, opts, getAgentChannels) {
  const accountId = resolveAgentWhatsAppAccount(agentId, getAgentChannels);
  const normalizedJid = normalizeJid(jid);

  const cfg = readConfig(agentId);
  const account = ensureAccountNode(cfg, accountId);
  account.groups = account.groups || {};

  const prev = account.groups[normalizedJid] || {};
  const next = {
    requireMention: opts?.requireMention !== undefined
      ? Boolean(opts.requireMention)
      : Boolean(prev.requireMention),
  };
  // Preserve any keys we don't manage (e.g. tools, toolsBySender) untouched.
  for (const k of Object.keys(prev)) {
    if (k !== 'requireMention') next[k] = prev[k];
  }
  account.groups[normalizedJid] = next;

  // Make sure groupPolicy is at least allowlist (so the per-group gate actually evaluates).
  if (account.groupPolicy !== 'open' && account.groupPolicy !== 'disabled') {
    account.groupPolicy = 'allowlist';
  }

  writeConfig(cfg, agentId);

  let label;
  if (opts?.label !== undefined) {
    label = normalizeLabel(opts.label);
    setLabel(accountId, normalizedJid, label);
  } else {
    label = getLabel(accountId, normalizedJid);
  }

  return { ok: true, accountId, jid: normalizedJid, entry: { ...next, label } };
}

function removeAgentWhatsAppGroup(agentId, jid, getAgentChannels) {
  const accountId = resolveAgentWhatsAppAccount(agentId, getAgentChannels);
  const normalizedJid = normalizeJid(jid);
  const cfg = readConfig(agentId);
  const account = cfg?.channels?.whatsapp?.accounts?.[accountId];
  if (!account?.groups || !(normalizedJid in account.groups)) {
    return { ok: false, error: `Group ${normalizedJid} not found` };
  }
  delete account.groups[normalizedJid];
  writeConfig(cfg, agentId);
  deleteLabel(accountId, normalizedJid);
  return { ok: true, accountId, jid: normalizedJid };
}

// ── Account-level + per-agent settings ───────────────────────────────────────

function updateAgentWhatsAppSettings(agentId, patch, getAgentChannels) {
  const accountId = resolveAgentWhatsAppAccount(agentId, getAgentChannels);
  const cfg = readConfig(agentId);
  const account = ensureAccountNode(cfg, accountId);

  if (patch.groupPolicy !== undefined) {
    account.groupPolicy = normalizePolicy(patch.groupPolicy);
  }
  if (patch.groupAllowFrom !== undefined) {
    account.groupAllowFrom = normalizeE164List(patch.groupAllowFrom);
  }
  if (patch.historyLimit !== undefined) {
    const n = Number(patch.historyLimit);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      throw new Error('historyLimit must be a number between 0 and 1000');
    }
    if (n === 0) delete account.historyLimit;
    else account.historyLimit = Math.floor(n);
  }
  if (patch.mentionPatterns !== undefined) {
    const patterns = normalizeMentionPatterns(patch.mentionPatterns);
    cfg.agents = cfg.agents || {};
    cfg.agents.list = cfg.agents.list || [];
    const idx = cfg.agents.list.findIndex(a => a.id === agentId);
    if (idx < 0) throw new Error(`Agent "${agentId}" not found in agents.list`);
    const node = cfg.agents.list[idx];
    if (patterns.length === 0) {
      if (node.groupChat && 'mentionPatterns' in node.groupChat) {
        delete node.groupChat.mentionPatterns;
        if (Object.keys(node.groupChat).length === 0) delete node.groupChat;
      }
    } else {
      node.groupChat = node.groupChat || {};
      node.groupChat.mentionPatterns = patterns;
    }
  }

  writeConfig(cfg, agentId);
  return listAgentWhatsAppGroups(agentId, getAgentChannels);
}

module.exports = {
  listAgentWhatsAppGroups,
  upsertAgentWhatsAppGroup,
  removeAgentWhatsAppGroup,
  updateAgentWhatsAppSettings,
};
