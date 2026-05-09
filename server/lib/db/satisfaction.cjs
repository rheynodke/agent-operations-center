'use strict';

/**
 * Satisfaction domain — feedback ratings, session summaries, daily rollups.
 *
 * Tables (created in migration 0005):
 *   - message_ratings              (event log; INSERT OR REPLACE for flip)
 *   - session_satisfaction_summary (one row per reflected session)
 *   - agent_satisfaction_metrics_daily (UPSERT'd by daily rollup)
 *
 * See spec §4 + plan Task 2-5.
 */

const handle = require('./_handle.cjs');

function _db() { return handle.getDb(); }
function _persist() { return handle.persist(); }

function recordRating({
  messageId, sessionId, agentId, ownerId, channel, source, rating,
  reason = null, raterExternalId = null, createdAt = Date.now(),
}) {
  const db = _db();
  // Coerce NULL raterExternalId to '' (sentinel for anonymous in-app rater).
  // Required because the column is NOT NULL DEFAULT '' (migration 0005)
  // and SQLite treats multiple NULLs as distinct in UNIQUE indexes — without
  // this coercion, dashboard ratings (where caller passes null) wouldn't
  // dedupe correctly on flip.
  const rater = raterExternalId == null ? '' : raterExternalId;
  // INSERT OR REPLACE on UNIQUE(message_id, source, rater_external_id) →
  // last-write-wins. Dashboard ratings (rater='') and channel reactions
  // (rater=external chat ID) live in separate UNIQUE buckets.
  db.run(
    `INSERT OR REPLACE INTO message_ratings
     (message_id, session_id, agent_id, owner_id, channel, source, rating, reason, rater_external_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [messageId, sessionId, agentId, ownerId, channel, source, rating, reason, rater, createdAt]
  );
  _persist();
  // sql.js doesn't expose lastInsertRowid the same way; query it.
  const r = db.exec(`SELECT id FROM message_ratings WHERE message_id=? AND source=? AND rater_external_id=?`,
    [messageId, source, rater]);
  return r[0]?.values?.[0]?.[0] ?? null;
}

function getMessageRatings({ sessionId, messageId, agentId } = {}) {
  const db = _db();
  const where = [];
  const params = [];
  if (sessionId) { where.push('session_id = ?'); params.push(sessionId); }
  if (messageId) { where.push('message_id = ?'); params.push(messageId); }
  if (agentId)   { where.push('agent_id = ?');   params.push(agentId); }
  const sql = `SELECT id, message_id, session_id, agent_id, owner_id, channel, source, rating, reason, rater_external_id, created_at
               FROM message_ratings
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at ASC`;
  const r = db.exec(sql, params);
  if (!r[0]) return [];
  return r[0].values.map(row => ({
    id: row[0],
    messageId: row[1],
    sessionId: row[2],
    agentId: row[3],
    ownerId: row[4],
    channel: row[5],
    source: row[6],
    rating: row[7],
    reason: row[8],
    raterExternalId: row[9],
    createdAt: row[10],
  }));
}

function upsertSessionSummary(s) {
  const db = _db();
  db.run(
    `INSERT INTO session_satisfaction_summary
     (session_id, agent_id, owner_id, message_count, endorsed_count, flagged_count,
      presumed_good_count, hallucination_rate, endorsement_rate,
      reflection_status, reflection_skip_reason, lessons_extracted, examples_captured,
      llm_input_tokens, llm_output_tokens, prompt_version, reflection_at, duration_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       message_count=excluded.message_count,
       endorsed_count=excluded.endorsed_count,
       flagged_count=excluded.flagged_count,
       presumed_good_count=excluded.presumed_good_count,
       hallucination_rate=excluded.hallucination_rate,
       endorsement_rate=excluded.endorsement_rate,
       reflection_status=excluded.reflection_status,
       reflection_skip_reason=excluded.reflection_skip_reason,
       lessons_extracted=excluded.lessons_extracted,
       examples_captured=excluded.examples_captured,
       llm_input_tokens=excluded.llm_input_tokens,
       llm_output_tokens=excluded.llm_output_tokens,
       prompt_version=excluded.prompt_version,
       reflection_at=excluded.reflection_at,
       duration_ms=excluded.duration_ms`,
    [
      s.sessionId, s.agentId, s.ownerId,
      s.messageCount, s.endorsedCount, s.flaggedCount,
      s.presumedGoodCount, s.hallucinationRate, s.endorsementRate,
      s.reflectionStatus, s.reflectionSkipReason ?? null,
      s.lessonsExtracted ?? 0, s.examplesCaptured ?? 0,
      s.llmInputTokens ?? null, s.llmOutputTokens ?? null,
      s.promptVersion ?? null, s.reflectionAt, s.durationMs ?? null,
    ]
  );
  _persist();
}

function getSessionSummary(sessionId) {
  const db = _db();
  const r = db.exec(
    `SELECT session_id, agent_id, owner_id, message_count, endorsed_count, flagged_count,
            presumed_good_count, hallucination_rate, endorsement_rate,
            reflection_status, reflection_skip_reason, lessons_extracted, examples_captured,
            llm_input_tokens, llm_output_tokens, prompt_version, reflection_at, duration_ms
     FROM session_satisfaction_summary WHERE session_id = ?`,
    [sessionId]
  );
  if (!r[0]?.values?.length) return null;
  const row = r[0].values[0];
  return {
    sessionId: row[0], agentId: row[1], ownerId: row[2],
    messageCount: row[3], endorsedCount: row[4], flaggedCount: row[5],
    presumedGoodCount: row[6], hallucinationRate: row[7], endorsementRate: row[8],
    reflectionStatus: row[9], reflectionSkipReason: row[10],
    lessonsExtracted: row[11], examplesCaptured: row[12],
    llmInputTokens: row[13], llmOutputTokens: row[14],
    promptVersion: row[15], reflectionAt: row[16], durationMs: row[17],
  };
}

function upsertDailyMetric(m) {
  const db = _db();
  db.run(
    `INSERT INTO agent_satisfaction_metrics_daily
     (agent_id, owner_id, day, channel, session_count, message_count,
      endorsed_count, flagged_count, hallucination_rate, endorsement_rate)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(agent_id, owner_id, day, channel) DO UPDATE SET
       session_count=excluded.session_count,
       message_count=excluded.message_count,
       endorsed_count=excluded.endorsed_count,
       flagged_count=excluded.flagged_count,
       hallucination_rate=excluded.hallucination_rate,
       endorsement_rate=excluded.endorsement_rate`,
    [m.agentId, m.ownerId, m.day, m.channel,
     m.sessionCount, m.messageCount,
     m.endorsedCount, m.flaggedCount,
     m.hallucinationRate, m.endorsementRate]
  );
  _persist();
}

function getDailyMetrics({ agentId, ownerId, fromDay, toDay, channel = 'all' }) {
  const db = _db();
  const r = db.exec(
    `SELECT agent_id, owner_id, day, channel, session_count, message_count,
            endorsed_count, flagged_count, hallucination_rate, endorsement_rate
     FROM agent_satisfaction_metrics_daily
     WHERE agent_id = ? AND owner_id = ? AND day >= ? AND day <= ? AND channel = ?
     ORDER BY day ASC`,
    [agentId, ownerId, fromDay, toDay, channel]
  );
  if (!r[0]) return [];
  return r[0].values.map(row => ({
    agentId: row[0], ownerId: row[1], day: row[2], channel: row[3],
    sessionCount: row[4], messageCount: row[5],
    endorsedCount: row[6], flaggedCount: row[7],
    hallucinationRate: row[8], endorsementRate: row[9],
  }));
}

/**
 * Compute aggregate counts from raw data for a given day. Used by
 * satisfaction-rollup.cjs to populate agent_satisfaction_metrics_daily.
 *
 * For channel='all', sums across all channels by joining ratings via session.
 * For specific channel, only counts ratings of that channel + sessions where
 * at least one rating from that channel was recorded.
 */
function aggregateRawForDay({ agentId, ownerId, day, channel = 'all' }) {
  const db = _db();
  // Day boundary in ms (UTC)
  const dayStart = new Date(`${day}T00:00:00Z`).getTime();
  const dayEnd = dayStart + 86_400_000;

  // Sessions reflected this day for this agent/owner
  const summaryRows = db.exec(
    `SELECT session_id, message_count, endorsed_count, flagged_count
     FROM session_satisfaction_summary
     WHERE agent_id = ? AND owner_id = ? AND reflection_at >= ? AND reflection_at < ?
       AND reflection_status = 'completed'`,
    [agentId, ownerId, dayStart, dayEnd]
  );

  const sessionData = summaryRows[0]?.values || [];
  let sessionCount = 0, messageCount = 0, endorsedCount = 0, flaggedCount = 0;

  if (channel === 'all') {
    sessionCount = sessionData.length;
    for (const [, mc, ec, fc] of sessionData) {
      messageCount += mc; endorsedCount += ec; flaggedCount += fc;
    }
  } else {
    // Per-channel: count ratings from message_ratings filtered by channel,
    // restrict to sessions that had at least one rating from this channel
    const sessionIds = sessionData.map(r => r[0]);
    if (sessionIds.length === 0) {
      return { sessionCount: 0, messageCount: 0, endorsedCount: 0, flaggedCount: 0,
               hallucinationRate: 0, endorsementRate: 0 };
    }
    const placeholders = sessionIds.map(() => '?').join(',');
    const r = db.exec(
      `SELECT COUNT(DISTINCT session_id),
              COUNT(DISTINCT message_id),
              SUM(CASE WHEN rating='positive' THEN 1 ELSE 0 END),
              SUM(CASE WHEN rating='negative' THEN 1 ELSE 0 END)
       FROM message_ratings
       WHERE channel = ? AND session_id IN (${placeholders})`,
      [channel, ...sessionIds]
    );
    if (r[0]?.values?.[0]) {
      [sessionCount, messageCount, endorsedCount, flaggedCount] = r[0].values[0];
      sessionCount = sessionCount || 0;
      messageCount = messageCount || 0;
      endorsedCount = endorsedCount || 0;
      flaggedCount = flaggedCount || 0;
    }
  }

  const hallucinationRate = messageCount > 0 ? flaggedCount / messageCount : 0;
  const endorsementRate = messageCount > 0 ? endorsedCount / messageCount : 0;

  return { sessionCount, messageCount, endorsedCount, flaggedCount, hallucinationRate, endorsementRate };
}

module.exports = {
  recordRating,
  getMessageRatings,
  upsertSessionSummary,
  getSessionSummary,
  upsertDailyMetric,
  getDailyMetrics,
  aggregateRawForDay,
};
