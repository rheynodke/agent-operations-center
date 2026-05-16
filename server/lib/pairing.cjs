'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME, getUserHome, readJsonSafe } = require('./config.cjs');

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';

const SUPPORTED_CHANNELS = ['telegram', 'whatsapp', 'discord'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function homeFor(userId) {
  return userId == null || Number(userId) === 1 ? OPENCLAW_HOME : getUserHome(userId);
}
function credentialsDir(userId) {
  return path.join(homeFor(userId), 'credentials');
}

function resolvePairingPath(channel, userId) {
  return path.join(credentialsDir(userId), `${channel}-pairing.json`);
}

function resolveAllowFromPath(channel, accountId, userId) {
  const dir = credentialsDir(userId);
  const base = channel;
  if (!accountId || accountId === 'default') return path.join(dir, `${base}-allowFrom.json`);
  return path.join(dir, `${base}-${accountId}-allowFrom.json`);
}

/**
 * List pending pairing requests for a channel (optionally filtered by accountId).
 * Reads the pairing store file directly for speed.
 */
function listPairingRequests(channel, accountId, userId) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported pairing channel: ${channel}`);
  }
  const filePath = resolvePairingPath(channel, userId);
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
function listAllPairingRequests(agentId, userId) {
  const result = {};
  for (const channel of SUPPORTED_CHANNELS) {
    result[channel] = listPairingRequests(channel, agentId || undefined, userId);
  }
  return result;
}

/**
 * Approve a pairing code: allow the requester immediately in-process and
 * defer the side-channel notification to a detached CLI subprocess.
 *
 * Why not just call the OpenClaw CLI synchronously? Its `pairing approve`
 * command loads the full plugin tree (channels, providers, MCP) on every
 * invocation, costing ~30s of bootstrap before any work runs. AOC's
 * execFile timeout kept tripping at 15s and the dashboard surfaced a
 * generic "Command failed" with no hint at the real problem.
 *
 * Split of responsibilities:
 *   - In-process (this function): add the requester to the channel's
 *     allowFrom list (atomic temp+rename, mirroring `rejectPairingCode`).
 *     This is the only step the operator needs to be sure of when the
 *     dashboard returns success — once it's in allowFrom, the bot will
 *     accept the sender on their next message.
 *   - Detached CLI (background): consume the still-pending entry, send
 *     the "you're approved" DM via the channel adapter, and clear the
 *     pending file. We don't await it; if it fails the pending entry
 *     just lingers until TTL or operator retry (which is idempotent —
 *     allowFrom already contains the id, the CLI move is a no-op).
 *
 * @returns Promise<{ ok: boolean, error?: string, addedEntry?: string }>
 */
function approvePairingCode(channel, code, accountId, userId) {
  return new Promise((resolve, reject) => {
    if (!SUPPORTED_CHANNELS.includes(channel)) {
      return reject(new Error(`Unsupported pairing channel: ${channel}`));
    }
    if (!code || typeof code !== 'string') {
      return reject(new Error('Pairing code is required'));
    }

    const upperCode = code.toUpperCase();
    const normalizedAccount = accountId ? String(accountId).toLowerCase() : null;

    const pairingPath = resolvePairingPath(channel, userId);
    const data = readJsonSafe(pairingPath);
    if (!data || !Array.isArray(data.requests)) {
      return resolve({ ok: false, error: `No pending pairing request found for code: ${code}` });
    }

    const matched = data.requests.find(r => {
      if (!r) return false;
      if (String(r.code || '').toUpperCase() !== upperCode) return false;
      if (normalizedAccount) {
        const rAccount = String(r.meta?.accountId || 'default').toLowerCase();
        if (rAccount !== normalizedAccount) return false;
      }
      return true;
    });

    if (!matched) {
      return resolve({ ok: false, error: `No pending pairing request found for code: ${code}` });
    }
    const requesterId = String(matched.id || '').trim();
    if (!requesterId) {
      return resolve({ ok: false, error: 'Pending entry has no requester id; refusing to approve' });
    }

    try {
      addAllowFromEntry(channel, accountId, requesterId, userId);
    } catch (err) {
      return resolve({ ok: false, error: `Failed to persist approval: ${err.message}` });
    }

    // Detached CLI run: it will re-read the (still-intact) pending entry,
    // move it to allowFrom (no-op since we wrote it), and send the DM. We
    // don't await; unref so AOC shutdown isn't blocked by a 30s CLI boot.
    try {
      const notifyEnv = { ...process.env };
      delete notifyEnv.OPENCLAW_HOME;
      if (userId != null && Number(userId) !== 1) {
        notifyEnv.OPENCLAW_STATE_DIR = getUserHome(userId);
      }
      const notifyArgs = ['pairing', 'approve', channel, upperCode];
      if (accountId) notifyArgs.push('--account', accountId);
      notifyArgs.push('--notify');
      const child = execFile(OPENCLAW_BIN, notifyArgs, {
        timeout: 90000,
        env: notifyEnv,
      }, () => { /* best effort — pending entry will TTL out if this fails */ });
      child.unref?.();
    } catch (_) { /* notify + pending-clear are best-effort */ }

    resolve({ ok: true, addedEntry: requesterId });
  });
}

/**
 * Reject (delete) a pending pairing request by code, optionally scoped to an
 * accountId. Removes the matching entry from the pairing store JSON file.
 * @returns { ok: true, removed: 1 } | { ok: false, error: string }
 */
function rejectPairingCode(channel, code, accountId, userId) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported pairing channel: ${channel}`);
  }
  if (!code || typeof code !== 'string') {
    throw new Error('Pairing code is required');
  }
  const filePath = resolvePairingPath(channel, userId);
  const data = readJsonSafe(filePath);
  if (!data || !Array.isArray(data.requests)) {
    return { ok: false, error: 'No pending pairing request found' };
  }

  const upperCode = code.toUpperCase();
  const normalizedAccount = accountId ? String(accountId).toLowerCase() : null;

  const before = data.requests.length;
  const kept = data.requests.filter(r => {
    if (!r) return false;
    const rCode = String(r.code || '').toUpperCase();
    if (rCode !== upperCode) return true;
    if (normalizedAccount) {
      const rAccount = String(r.meta?.accountId || 'default').toLowerCase();
      if (rAccount !== normalizedAccount) return true;
    }
    return false; // matched → drop
  });

  if (kept.length === before) {
    return { ok: false, error: `No pending pairing request found for code: ${code}` };
  }

  const next = { ...data, version: data.version || 1, requests: kept };
  // Atomic write: write to a temp file, then rename.
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);

  return { ok: true, removed: before - kept.length };
}

// ── AllowFrom store management ───────────────────────────────────────────────

function readAllowFromFile(channel, accountId, userId) {
  const filePath = resolveAllowFromPath(channel, accountId, userId);
  const data = readJsonSafe(filePath);
  const entries = Array.isArray(data?.allowFrom) ? data.allowFrom.filter(e => typeof e === 'string' && e.trim()) : [];
  return { filePath, entries };
}

function writeAllowFromFile(filePath, entries) {
  const next = { version: 1, allowFrom: entries };
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function listAllowFromEntries(channel, accountId, userId) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported pairing channel: ${channel}`);
  }
  return readAllowFromFile(channel, accountId, userId).entries;
}

function addAllowFromEntry(channel, accountId, entry, userId) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported pairing channel: ${channel}`);
  }
  const trimmed = String(entry || '').trim();
  if (!trimmed) throw new Error('Entry is required');

  const { filePath, entries } = readAllowFromFile(channel, accountId, userId);
  if (entries.includes(trimmed)) {
    return { ok: true, added: 0, entries };
  }
  const next = [...entries, trimmed];
  writeAllowFromFile(filePath, next);
  return { ok: true, added: 1, entries: next };
}

function removeAllowFromEntry(channel, accountId, entry, userId) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported pairing channel: ${channel}`);
  }
  const trimmed = String(entry || '').trim();
  if (!trimmed) throw new Error('Entry is required');

  const { filePath, entries } = readAllowFromFile(channel, accountId, userId);
  const next = entries.filter(e => e !== trimmed);
  if (next.length === entries.length) {
    return { ok: false, error: `Entry not found: ${trimmed}` };
  }
  writeAllowFromFile(filePath, next);
  return { ok: true, removed: entries.length - next.length, entries: next };
}

module.exports = {
  listPairingRequests,
  listAllPairingRequests,
  approvePairingCode,
  rejectPairingCode,
  listAllowFromEntries,
  addAllowFromEntry,
  removeAllowFromEntry,
  SUPPORTED_CHANNELS,
};
