'use strict';

/**
 * Daily rollup — aggregates session_satisfaction_summary into
 * agent_satisfaction_metrics_daily for fast dashboard reads.
 *
 * Idempotent: re-runs UPSERT, so safe to schedule on hourly tick.
 *
 * See spec §10 + plan Task 15.
 */

const handle = require('./db/_handle.cjs');
const sat = require('./db/satisfaction.cjs');

function _db() { return handle.getDb(); }

function _todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function rollupForDay({ day, agentId, ownerId, channel = 'all' }) {
  const agg = sat.aggregateRawForDay({ agentId, ownerId, day, channel });
  sat.upsertDailyMetric({
    agentId, ownerId, day, channel,
    sessionCount: agg.sessionCount,
    messageCount: agg.messageCount,
    endorsedCount: agg.endorsedCount,
    flaggedCount: agg.flaggedCount,
    hallucinationRate: agg.hallucinationRate,
    endorsementRate: agg.endorsementRate,
  });
}

async function rollupAllAgents({ day = _todayUtc() } = {}) {
  const dayStart = new Date(`${day}T00:00:00Z`).getTime();
  const dayEnd = dayStart + 86_400_000;

  const r = _db().exec(
    `SELECT DISTINCT agent_id, owner_id FROM session_satisfaction_summary
     WHERE reflection_at >= ? AND reflection_at < ? AND reflection_status = 'completed'`,
    [dayStart, dayEnd]
  );
  const pairs = (r[0]?.values || []).map(row => ({ agentId: row[0], ownerId: row[1] }));

  for (const p of pairs) {
    await rollupForDay({ day, agentId: p.agentId, ownerId: p.ownerId, channel: 'all' });
    // Per-channel rollups (basic set; UI can request more if needed)
    for (const ch of ['dashboard', 'telegram', 'whatsapp', 'discord']) {
      await rollupForDay({ day, agentId: p.agentId, ownerId: p.ownerId, channel: ch });
    }
  }
  return { processed: pairs.length, day };
}

let _intervalHandle = null;
function startBackgroundRollup({ intervalMs = 3600_000 } = {}) {
  if (_intervalHandle) return;
  // Run immediately on start, then every interval
  rollupAllAgents({ day: _todayUtc() }).catch(() => {});
  _intervalHandle = setInterval(() => {
    rollupAllAgents({ day: _todayUtc() }).catch(() => {});
  }, intervalMs);
  _intervalHandle.unref?.();
}

function stopBackgroundRollup() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

module.exports = {
  rollupForDay,
  rollupAllAgents,
  startBackgroundRollup,
  stopBackgroundRollup,
};
