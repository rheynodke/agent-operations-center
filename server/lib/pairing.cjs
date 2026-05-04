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
 * Approve a pairing code via the OpenClaw CLI.
 * Uses the CLI to ensure proper file locking + notification to the user.
 * @returns Promise<{ ok: boolean, error?: string }>
 */
function approvePairingCode(channel, code, accountId, userId) {
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

    // CRITICAL: openclaw CLI interprets OPENCLAW_HOME as the *user home dir*
    // (then appends `.openclaw` for state dir). AOC uses OPENCLAW_HOME to mean
    // the state dir directly. Passing AOC's value through to the subprocess
    // makes the CLI read/write `~/.openclaw/.openclaw/credentials/…` instead
    // of `~/.openclaw/credentials/…`, so approves silently land in a parallel
    // tree and the actual pending request is never matched.
    //
    // For non-admin tenants, point OPENCLAW_STATE_DIR at the user's home so
    // the CLI reads/writes their per-user credentials. Drop OPENCLAW_HOME so
    // the appended-".openclaw" issue never triggers.
    const subprocessEnv = { ...process.env };
    delete subprocessEnv.OPENCLAW_HOME;
    if (userId != null && Number(userId) !== 1) {
      subprocessEnv.OPENCLAW_STATE_DIR = getUserHome(userId);
    }

    execFile(OPENCLAW_BIN, args, { timeout: 15000, env: subprocessEnv }, (err, stdout, stderr) => {
      // Strip ANSI escape codes so success-marker matching is robust.
      // eslint-disable-next-line no-control-regex
      const out = (stdout || '').toString().replace(/\x1b\[[0-9;]*m/g, '');
      // eslint-disable-next-line no-control-regex
      const errOut = (stderr || '').toString().replace(/\x1b\[[0-9;]*m/g, '');

      // The CLI may exit with a non-zero code even after a successful approve
      // (e.g., the post-approve `--notify` step fails because the requester's
      // DMs are closed → "Invalid Recipient(s)"). Detect approval success from
      // stdout instead of relying solely on exit code.
      const approved = /Approved\s+\S+\s+sender/i.test(out);

      if (approved) {
        const notifyFailed = /Failed to notify requester/i.test(out);
        return resolve({
          ok: true,
          stdout: out.trim(),
          ...(notifyFailed ? { warning: 'Approved, but failed to notify the requester' } : {}),
        });
      }

      if (err) {
        // Genuine failure — surface a useful message. CLI throws "No pending
        // pairing request found for code: ..." when the entry is already gone
        // (often because a previous approve already succeeded).
        const stackMsg = /Error:\s*([^\n]+)/.exec(errOut + '\n' + out);
        const errMsg =
          (stackMsg && stackMsg[1].trim()) ||
          errOut.trim() ||
          err.message ||
          'Approval failed';
        return resolve({ ok: false, error: errMsg });
      }
      resolve({ ok: true, stdout: out.trim() });
    });
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
