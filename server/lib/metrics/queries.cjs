'use strict';

/**
 * server/lib/metrics/queries.cjs
 *
 * Prepared statements for the metrics DB. Prepared lazily on first call to
 * avoid coupling module load order with db.cjs bootstrap timing.
 */

const { getDb } = require('./db.cjs');

let stmtInsert;
let stmtCount;
let stmtPrune;
let stmtInsertBatchTx;

function ensure() {
  if (stmtInsert) return;
  const db = getDb();

  stmtInsert = db.prepare(`
    INSERT INTO gateway_samples
      (ts, user_id, state, port, pid, uptime_seconds, rss_mb, cpu_percent,
       messages_1h, messages_24h, last_activity_at)
    VALUES
      (@ts, @user_id, @state, @port, @pid, @uptime_seconds, @rss_mb, @cpu_percent,
       @messages_1h, @messages_24h, @last_activity_at)
  `);

  stmtCount = db.prepare('SELECT COUNT(*) AS n FROM gateway_samples');
  stmtPrune = db.prepare('DELETE FROM gateway_samples WHERE ts < ?');

  stmtInsertBatchTx = db.transaction((rows) => {
    for (const r of rows) {
      stmtInsert.run({
        ts: r.ts,
        user_id: r.user_id,
        state: r.state,
        port: r.port ?? null,
        pid: r.pid ?? null,
        uptime_seconds: r.uptime_seconds ?? null,
        rss_mb: r.rss_mb ?? null,
        cpu_percent: r.cpu_percent ?? null,
        messages_1h: r.messages_1h ?? null,
        messages_24h: r.messages_24h ?? null,
        last_activity_at: r.last_activity_at ?? null,
      });
    }
  });
}

function insertSample(row) {
  ensure();
  stmtInsert.run({
    ts: row.ts,
    user_id: row.user_id,
    state: row.state,
    port: row.port ?? null,
    pid: row.pid ?? null,
    uptime_seconds: row.uptime_seconds ?? null,
    rss_mb: row.rss_mb ?? null,
    cpu_percent: row.cpu_percent ?? null,
    messages_1h: row.messages_1h ?? null,
    messages_24h: row.messages_24h ?? null,
    last_activity_at: row.last_activity_at ?? null,
  });
}

function insertSamplesBatch(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  ensure();
  stmtInsertBatchTx(rows);
}

function countSamples() {
  ensure();
  return stmtCount.get().n;
}

function pruneBefore(cutoffMs) {
  ensure();
  const result = stmtPrune.run(cutoffMs);
  return result.changes;
}

module.exports = { insertSample, insertSamplesBatch, countSamples, pruneBefore };
