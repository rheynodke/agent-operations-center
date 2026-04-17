'use strict';
const { execFile } = require('child_process');
const path = require('path');
const { OPENCLAW_HOME, readJsonSafe } = require('./config.cjs');

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';
const CREDENTIALS_DIR = path.join(OPENCLAW_HOME, 'credentials');

const SUPPORTED_CHANNELS = ['telegram', 'whatsapp', 'discord'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolvePairingPath(channel) {
  return path.join(CREDENTIALS_DIR, `${channel}-pairing.json`);
}

function resolveAllowFromPath(channel, accountId) {
  const base = channel;
  if (!accountId || accountId === 'default') return path.join(CREDENTIALS_DIR, `${base}-allowFrom.json`);
  return path.join(CREDENTIALS_DIR, `${base}-${accountId}-allowFrom.json`);
}

/**
 * List pending pairing requests for a channel (optionally filtered by accountId).
 * Reads the pairing store file directly for speed.
 */
function listPairingRequests(channel, accountId) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported pairing channel: ${channel}`);
  }
  const filePath = resolvePairingPath(channel);
  const data = readJsonSafe(filePath);
  if (!data || !Array.isArray(data.requests)) return [];

  const now = Date.now();
  const TTL_MS = 3600 * 1000; // 1 hour, matches OpenClaw's PAIRING_PENDING_TTL_MS

  return data.requests
    .filter(r => {
      if (!r || !r.id || !r.code || !r.createdAt) return false;
      // Filter expired
      const createdMs = new Date(r.createdAt).getTime();
      if (now - createdMs > TTL_MS) return false;
      // Filter by accountId if specified
      if (accountId) {
        const reqAccount = r.meta?.accountId || 'default';
        if (reqAccount !== accountId) return false;
      }
      return true;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(r => ({
      id: r.id,
      code: r.code,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt || r.createdAt,
      accountId: r.meta?.accountId || 'default',
      meta: r.meta || {},
    }));
}

/**
 * List pending pairing requests across ALL channels for a specific agent.
 * Returns { telegram: [...], whatsapp: [...], discord: [...] }
 */
function listAllPairingRequests(agentId) {
  const result = {};
  for (const channel of SUPPORTED_CHANNELS) {
    result[channel] = listPairingRequests(channel, agentId || undefined);
  }
  return result;
}

/**
 * Approve a pairing code via the OpenClaw CLI.
 * Uses the CLI to ensure proper file locking + notification to the user.
 * @returns Promise<{ ok: boolean, error?: string }>
 */
function approvePairingCode(channel, code, accountId) {
  return new Promise((resolve, reject) => {
    if (!SUPPORTED_CHANNELS.includes(channel)) {
      return reject(new Error(`Unsupported pairing channel: ${channel}`));
    }
    if (!code || typeof code !== 'string') {
      return reject(new Error('Pairing code is required'));
    }

    const args = ['pairing', 'approve', channel, code.toUpperCase()];
    if (accountId) {
      args.push('--account', accountId);
    }
    args.push('--notify');

    execFile(OPENCLAW_BIN, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        // Try to extract meaningful error from stderr
        const errMsg = (stderr || '').trim() || err.message || 'Approval failed';
        return resolve({ ok: false, error: errMsg });
      }
      resolve({ ok: true, stdout: (stdout || '').trim() });
    });
  });
}

module.exports = {
  listPairingRequests,
  listAllPairingRequests,
  approvePairingCode,
  SUPPORTED_CHANNELS,
};
