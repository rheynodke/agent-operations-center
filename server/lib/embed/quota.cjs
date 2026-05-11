// server/lib/embed/quota.cjs
// Daily quota enforcement for embed channel sessions.
//
// Quota is enforced against pre-aggregated daily counters in embed_metrics_daily.
// Production traffic is subject to:
//   - dailyMessageQuota — total message count per embed per day
//   - dailyTokenQuota   — total token count per embed per day
//
// Playground traffic (trafficType === 'playground') bypasses both caps so
// the owner can test the embed without burning production quota.
// Per-IP rate limiting and DLP filtering are NOT skipped for playground sessions.
'use strict';

const { getDb, persist } = require('../db/_handle.cjs');

function _today() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Increment a daily metric counter for an embed.
 *
 * @param {string} embedId
 * @param {number} ownerId
 * @param {string} date        — 'YYYY-MM-DD'
 * @param {string} trafficType — 'production' | 'playground' | 'dev'
 * @param {{ messageDelta?: number, tokenDelta?: number }} deltas
 */
function incrementDailyMetric(embedId, ownerId, date, trafficType, { messageDelta = 0, tokenDelta = 0 } = {}) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO embed_metrics_daily (embed_id, owner_id, date, traffic_type, message_count, token_total)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(embed_id, date, traffic_type) DO UPDATE SET
      message_count = message_count + excluded.message_count,
      token_total   = token_total   + excluded.token_total
  `);
  stmt.run([embedId, ownerId, date, trafficType, messageDelta, tokenDelta]);
  stmt.free();
  persist();
}

/**
 * Read the current daily totals for an embed + date + trafficType.
 *
 * @returns {{ messageCount: number, tokenTotal: number }}
 */
function getDailyTotals(embedId, date, trafficType) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT message_count, token_total
    FROM embed_metrics_daily
    WHERE embed_id = ? AND date = ? AND traffic_type = ?
    LIMIT 1
  `);
  stmt.bind([embedId, date, trafficType]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  if (!row) return { messageCount: 0, tokenTotal: 0 };
  return { messageCount: row.message_count, tokenTotal: row.token_total };
}

/**
 * Check whether the embed is within its daily quota limits.
 *
 * @param {object} db           — db module (unused here; kept for interface consistency)
 * @param {string} embedId      — embed UUID
 * @param {number} dailyMessageQuota — message cap (0 / null = unlimited)
 * @param {number} dailyTokenQuota   — token cap   (0 / null = unlimited)
 * @param {string} [date]       — 'YYYY-MM-DD', defaults to today
 * @param {string} [trafficType] — 'production' | 'playground' | 'dev', default 'production'
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, messageCount?: number, tokenTotal?: number }}
 */
function checkDailyQuota(dbModule, embedId, dailyMessageQuota, dailyTokenQuota, date, trafficType = 'production') {
  // Playground sessions bypass daily message + token quota entirely.
  // Per-IP rate limit and DLP filter are still applied upstream.
  if (trafficType === 'playground') {
    return { ok: true, skipped: true };
  }

  const today = date || _today();
  const { messageCount, tokenTotal } = getDailyTotals(embedId, today, trafficType);

  if (dailyMessageQuota && dailyMessageQuota > 0 && messageCount >= dailyMessageQuota) {
    return { ok: false, reason: 'daily_message_quota_exceeded', messageCount, tokenTotal };
  }
  if (dailyTokenQuota && dailyTokenQuota > 0 && tokenTotal >= dailyTokenQuota) {
    return { ok: false, reason: 'daily_token_quota_exceeded', messageCount, tokenTotal };
  }

  return { ok: true, messageCount, tokenTotal };
}

module.exports = {
  checkDailyQuota,
  incrementDailyMetric,
  getDailyTotals,
  _today,
};
