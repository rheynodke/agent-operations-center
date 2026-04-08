'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, AGENTS_DIR, readJsonSafe } = require('./config.cjs');

const CONFIG_PATH = path.join(OPENCLAW_HOME, 'openclaw.json');

// ─── Read hooks config ────────────────────────────────────────────────────────
// OpenClaw schema: all inbound-webhook fields live directly under hooks.*
// (not nested under hooks.inbound — that key is unrecognized and crashes gateway)

function getHooksConfig() {
  const config = readJsonSafe(CONFIG_PATH);
  if (!config) throw new Error('Cannot read openclaw.json');

  const hooks    = config.hooks || {};
  const internal = hooks.internal || {};

  const token        = hooks.token || '';
  const hasToken     = !!token;
  const tokenPreview = hasToken ? token.slice(0, 6) + '…' : null;

  return {
    enabled:               !!hooks.enabled,
    hasToken,
    tokenPreview,
    path:                  hooks.path || '/hooks',
    gatewayPort:           config.gateway?.port || 18789,
    defaultSessionKey:     hooks.defaultSessionKey || '',
    allowRequestSessionKey:!!hooks.allowRequestSessionKey,
    allowedAgentIds:       hooks.allowedAgentIds || [],
    mappings:              hooks.mappings || [],
    internal: {
      enabled:             !!internal.enabled,
      sessionMemory:       internal.entries?.['session-memory']?.enabled ?? true,
      commandLogger:       internal.entries?.['command-logger']?.enabled ?? true,
      bootstrapExtraFiles: internal.entries?.['bootstrap-extra-files']?.enabled ?? true,
    },
  };
}

// ─── Save hooks config ────────────────────────────────────────────────────────

function saveHooksConfig(updates) {
  const raw    = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(raw);

  if (!config.hooks) config.hooks = {};
  const hooks = config.hooks;

  // Remove any accidentally-added 'inbound' key from previous bad writes
  delete hooks.inbound;

  // Update flat fields directly under hooks.*
  if ('enabled'               in updates) hooks.enabled               = !!updates.enabled;
  if ('path'                  in updates) hooks.path                  = updates.path || '/hooks';
  if ('token'                 in updates && updates.token) hooks.token = updates.token;
  if ('defaultSessionKey'     in updates) {
    if (updates.defaultSessionKey) hooks.defaultSessionKey = updates.defaultSessionKey;
    else delete hooks.defaultSessionKey;
  }
  if ('allowRequestSessionKey' in updates) hooks.allowRequestSessionKey = !!updates.allowRequestSessionKey;
  if ('allowedAgentIds'        in updates) hooks.allowedAgentIds        = updates.allowedAgentIds || [];
  if ('mappings'               in updates) hooks.mappings               = updates.mappings || [];

  // Internal hooks stay nested under hooks.internal (this key IS known to OpenClaw)
  if (updates.internal) {
    if (!hooks.internal) hooks.internal = { enabled: true, entries: {} };
    if (!hooks.internal.entries) hooks.internal.entries = {};
    if ('sessionMemory'       in updates.internal)
      hooks.internal.entries['session-memory']        = { enabled: !!updates.internal.sessionMemory };
    if ('commandLogger'       in updates.internal)
      hooks.internal.entries['command-logger']         = { enabled: !!updates.internal.commandLogger };
    if ('bootstrapExtraFiles' in updates.internal)
      hooks.internal.entries['bootstrap-extra-files'] = { enabled: !!updates.internal.bootstrapExtraFiles };
  }

  if (config.meta) config.meta.lastTouchedAt = new Date().toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ─── List recent hook sessions ────────────────────────────────────────────────

function getHookSessions(limit = 50) {
  const sessions = [];
  let agentDirs = [];
  try { agentDirs = fs.readdirSync(AGENTS_DIR); } catch { return []; }

  for (const agentId of agentDirs) {
    const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
    let metaFile = null;
    try {
      metaFile = readJsonSafe(path.join(AGENTS_DIR, agentId, 'sessions.json'));
    } catch {}

    if (!metaFile?.sessions) continue;

    for (const [key, meta] of Object.entries(metaFile.sessions)) {
      const parts = key.split(':');
      const sessionType = parts[2] || '';
      if (sessionType !== 'hook') continue;

      const sessionId   = parts[1] || key;
      const hookName    = meta.label || parts[3] || sessionId.slice(0, 8);
      const jsonlFile   = path.join(sessionsDir, `${sessionId}.jsonl`);
      let messageCount  = 0;
      let totalCost     = 0;
      let lastTimestamp = meta.updatedAt || 0;
      let lastMessage   = '';

      try {
        if (fs.existsSync(jsonlFile)) {
          const lines = fs.readFileSync(jsonlFile, 'utf-8').split('\n').filter(Boolean);
          messageCount = lines.length;
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.message?.usage?.cost?.total) totalCost += entry.message.usage.cost.total;
              if (entry.message?.content) {
                const c = entry.message.content;
                if (typeof c === 'string') lastMessage = c.slice(0, 200);
                else if (Array.isArray(c)) {
                  for (const p of c) { if (p.type === 'text' && p.text) lastMessage = p.text.slice(0, 200); }
                }
              }
              if (entry.message?.timestamp) lastTimestamp = Math.max(lastTimestamp, entry.message.timestamp);
              if (entry.timestamp) {
                const ts = new Date(entry.timestamp).getTime();
                if (ts > 0) lastTimestamp = Math.max(lastTimestamp, ts);
              }
            } catch {}
          }
        }
      } catch {}

      sessions.push({
        id:           sessionId,
        key,
        agentId,
        hookName,
        messageCount,
        totalCost:    Math.round(totalCost * 10000) / 10000,
        lastMessage,
        startTime:    meta.createdAt ? new Date(meta.createdAt).toISOString() : null,
        lastActivity: lastTimestamp  ? new Date(lastTimestamp).toISOString()  : null,
        status:       meta.status || 'completed',
      });
    }
  }

  sessions.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  return sessions.slice(0, limit);
}

// ─── Generate a random token ──────────────────────────────────────────────────

function generateToken() {
  return require('crypto').randomBytes(24).toString('hex');
}

module.exports = { getHooksConfig, saveHooksConfig, getHookSessions, generateToken };
