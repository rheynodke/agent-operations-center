'use strict';
/**
 * Passive WhatsApp group discovery via log scraping.
 *
 * Two log sources are scanned and merged:
 *
 *   1. Per-user text log: ~/.openclaw/users/<id>/.openclaw/logs/gateway.log
 *      Contains the auto-reply monitor's console line:
 *        "Inbound message <fromJid> -> <botE164> (group[, <media>], <N> chars)"
 *      Only emitted AFTER policy checks — so groups currently blocked by
 *      groupPolicy=allowlist never appear here.
 *
 *   2. Shared JSON structured log: /tmp/openclaw/openclaw-YYYY-MM-DD.log
 *      Contains the inbound monitor's pre-policy event:
 *        {"module":"web-inbound"},{"from":"<jid>@g.us","to":"<botE164>",...},"inbound message"
 *      This is the source that surfaces still-blocked groups — which is what
 *      the UI picker needs to let the user allowlist them.
 *
 * Cache stored at data/whatsapp-seen-groups.json under (userId, accountId) →
 * { jid: { lastSeenAt } }. Keeps entries even if logs rotate.
 */
const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME, getUserHome, readJsonSafe } = require('./config.cjs');

const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'whatsapp-seen-groups.json');

// Match the production log line. Strips ANSI escapes first; regex itself is
// tolerant of optional media-type and chars-count formatting:
//   "Inbound message 6281234567890-1234567890@g.us -> 6289000000000 (group, 12 chars)"
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const LINE_RE = /Inbound message\s+([0-9-]+@g\.us)\s+->\s+\+?(\d{7,15})\s+\(group\b/i;
const TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)/;

function homeFor(userId) {
  return userId == null || Number(userId) === 1 ? OPENCLAW_HOME : getUserHome(userId);
}

function gatewayLogPath(userId) {
  return path.join(homeFor(userId), 'logs', 'gateway.log');
}

function resolveOwnerForAgent(agentId) {
  const { getOwnerContext } = require('./agents/owner-context.cjs');
  const ctx = getOwnerContext();
  if (ctx != null) return ctx;
  try {
    const owner = require('./db.cjs').getAgentOwner(agentId);
    return owner == null ? null : Number(owner);
  } catch { return null; }
}

function readCache() {
  const d = readJsonSafe(CACHE_PATH);
  return d && typeof d === 'object' ? d : {};
}

function writeCache(cache) {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${CACHE_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CACHE_PATH);
}

/**
 * Bot E.164 lives in the Baileys creds file for each account. We resolve it
 * once per call so we can filter the log to entries that belong to this
 * specific account when multiple accounts share a single gateway.
 */
function getAccountE164(userId, accountId) {
  const credsPath = path.join(
    homeFor(userId),
    'credentials',
    'whatsapp',
    accountId,
    'creds.json',
  );
  const creds = readJsonSafe(credsPath);
  // Baileys: creds.me.id = "<e164>:<deviceId>@s.whatsapp.net"
  const rawId = creds?.me?.id;
  if (typeof rawId !== 'string') return null;
  const m = /^\+?(\d{7,15})(?::|@)/.exec(rawId);
  return m ? m[1] : null;
}

/**
 * Scan gateway.log for group-inbound lines belonging to the given bot E.164.
 * Returns array of { jid, lastSeenAt } sorted by lastSeenAt desc.
 *
 * Reads the entire file (gateway logs are small per session — ~MB scale at
 * worst). If logs grow huge later we can switch to incremental offset
 * tracking. Keep it simple until measurements demand otherwise.
 */
function scanTextLog(userId, botE164, out) {
  const logPath = gatewayLogPath(userId);
  if (!fs.existsSync(logPath)) return;
  let text;
  try { text = fs.readFileSync(logPath, 'utf-8'); }
  catch (err) { if (err.code === 'ENOENT') return; throw err; }
  for (const rawLine of text.split('\n')) {
    if (!rawLine) continue;
    const line = rawLine.replace(ANSI_RE, '');
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const jid = m[1].toLowerCase();
    if (botE164 && m[2] !== botE164) continue;
    const ts = TS_RE.exec(line)?.[1] || new Date().toISOString();
    const prev = out.get(jid);
    if (!prev || prev < ts) out.set(jid, ts);
  }
}

/**
 * Shared JSON structured log captures the pre-policy "inbound message" event.
 * This is the only source that surfaces groups still blocked by groupPolicy —
 * which is exactly what the user needs to allowlist.
 *
 * Lines look like:
 *   {"0":"{...}","1":{"from":"<jid>@g.us","to":"<botE164>","body":"…",...},"2":"inbound message",...,"time":"2026-05-12T..."}
 *
 * Multiple users' gateways may share this file; filtering by botE164 isolates
 * one account's traffic. We only read recent files (today + yesterday) to keep
 * the scan bounded.
 */
function scanJsonLogs(botE164, out) {
  const dir = '/tmp/openclaw';
  if (!fs.existsSync(dir)) return;
  let files;
  try {
    files = fs.readdirSync(dir)
      .filter(n => /^openclaw-\d{4}-\d{2}-\d{2}\.log$/.test(n))
      .sort()
      .slice(-2);
  } catch { return; }
  for (const name of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name), 'utf-8'); }
    catch { continue; }
    for (const rawLine of text.split('\n')) {
      if (!rawLine || !rawLine.includes('@g.us')) continue;
      let obj;
      try { obj = JSON.parse(rawLine); } catch { continue; }
      // The inbound monitor's structured event is {"1":{from,to,...},"2":"inbound message"}.
      const payload = obj?.[1];
      const msg = obj?.[2];
      if (msg !== 'inbound message' || !payload) continue;
      const from = String(payload.from || '');
      if (!from.endsWith('@g.us')) continue;
      const to = String(payload.to || '').replace(/^\+/, '');
      if (botE164 && to !== botE164) continue;
      const ts = obj.time || new Date().toISOString();
      const jid = from.toLowerCase();
      const prev = out.get(jid);
      if (!prev || prev < ts) out.set(jid, ts);
    }
  }
}

function scanLog(userId, botE164) {
  const seen = new Map(); // jid -> lastSeenAtISO
  scanTextLog(userId, botE164, seen);
  scanJsonLogs(botE164, seen);
  return [...seen.entries()]
    .map(([jid, lastSeenAt]) => ({ jid, lastSeenAt }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/**
 * Public entry: returns recently active groups for an agent's WhatsApp
 * account. Merges fresh log scan with the persisted cache so groups stay in
 * the picker even after log rotation truncates them.
 */
function listSeenWhatsAppGroupsForAgent(agentId, accountId) {
  const userId = resolveOwnerForAgent(agentId);
  return listSeenWhatsAppGroups(userId, accountId);
}

function listSeenWhatsAppGroups(userId, accountId) {
  const botE164 = getAccountE164(userId, accountId);
  const fresh = scanLog(userId, botE164);

  const cache = readCache();
  const accountKey = `${userId ?? 1}::${accountId}`;
  const cached = cache[accountKey] || {};

  // Merge: keep the max(lastSeenAt) per jid across cache + fresh scan.
  const merged = { ...cached };
  for (const { jid, lastSeenAt } of fresh) {
    const prev = merged[jid]?.lastSeenAt;
    if (!prev || prev < lastSeenAt) merged[jid] = { lastSeenAt };
  }
  cache[accountKey] = merged;
  try { writeCache(cache); } catch { /* best-effort */ }

  return Object.entries(merged)
    .map(([jid, info]) => ({ jid, lastSeenAt: info.lastSeenAt }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

module.exports = { listSeenWhatsAppGroups, listSeenWhatsAppGroupsForAgent };
