'use strict';
const fs = require('node:fs');

// Keys we treat as background noise (not user activity):
//   - `:heartbeat` suffix — main heartbeat AND per-channel heartbeats
//     (agent:main:main:heartbeat, agent:main:telegram:direct:...:heartbeat, etc.)
//   - `:cron:` segment — scheduled job runs (agent:main:cron:<id> and :run:<id>)
//   - `:dreaming-` segment — overnight memory-narrative pipeline writes
const HEARTBEAT_KEY_PATTERNS = [/:heartbeat$/, /:cron:/, /:dreaming-/];

function isHeartbeatKey(sessionKey) {
  return HEARTBEAT_KEY_PATTERNS.some((re) => re.test(sessionKey));
}

/**
 * Read a tenant's sessions.json and summarise non-heartbeat activity in
 * 1h / 24h windows. Returns null when the file is missing or unreadable —
 * caller surfaces that to the UI as "no agent / no data".
 *
 * @param {object} params
 * @param {string} params.sessionsFile  absolute path to sessions.json
 * @param {number} params.now           reference timestamp (ms) — injectable for tests
 * @returns {{messagesLast1h:number, messagesLast24h:number, lastActivityAt:string|null, idleHeartbeatOnly:boolean} | null}
 */
function probeActivity({ sessionsFile, now }) {
  let raw;
  try {
    raw = fs.readFileSync(sessionsFile, 'utf-8');
  } catch {
    return null;
  }
  let store;
  try {
    store = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!store || typeof store !== 'object') return null;

  const cutoff1h = now - 60 * 60 * 1000;
  const cutoff24h = now - 24 * 60 * 60 * 1000;

  let count1h = 0;
  let count24h = 0;
  let lastActivityMs = null;
  let hasHeartbeat = false;

  for (const [key, entry] of Object.entries(store)) {
    if (!entry || typeof entry !== 'object') continue;
    const updatedAt = Number(entry.updatedAt);
    if (!Number.isFinite(updatedAt)) continue;

    if (isHeartbeatKey(key)) {
      if (updatedAt >= cutoff24h) hasHeartbeat = true;
      continue;
    }

    if (updatedAt >= cutoff1h) count1h += 1;
    if (updatedAt >= cutoff24h) count24h += 1;
    if (lastActivityMs === null || updatedAt > lastActivityMs) lastActivityMs = updatedAt;
  }

  return {
    messagesLast1h: count1h,
    messagesLast24h: count24h,
    lastActivityAt: lastActivityMs != null ? new Date(lastActivityMs).toISOString() : null,
    idleHeartbeatOnly: count24h === 0 && hasHeartbeat,
  };
}

module.exports = { probeActivity, isHeartbeatKey };
