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

// ---------------------------------------------------------------------------
// Range definitions for adaptive downsampling (spec §6.6)
// ---------------------------------------------------------------------------

const RANGE_DEFS = Object.freeze({
  '1h':  { rangeMs: 3_600_000,     bucketMs: 30_000 },
  '6h':  { rangeMs: 21_600_000,    bucketMs: 60_000 },
  '24h': { rangeMs: 86_400_000,    bucketMs: 300_000 },
  '7d':  { rangeMs: 604_800_000,   bucketMs: 1_800_000 },
  '30d': { rangeMs: 2_592_000_000, bucketMs: 7_200_000 },
});

function resolveRange(rangeKey) {
  const def = RANGE_DEFS[rangeKey];
  if (!def) {
    const err = new RangeError(`Unknown range "${rangeKey}". Expected one of: ${Object.keys(RANGE_DEFS).join(', ')}`);
    err.code = 'BAD_RANGE';
    throw err;
  }
  const toTs = Date.now();
  return { rangeMs: def.rangeMs, bucketMs: def.bucketMs, fromTs: toTs - def.rangeMs, toTs };
}

function timeseries(rangeKey, opts = {}) {
  const { rangeMs, bucketMs, fromTs, toTs } = resolveRange(rangeKey);
  const db = getDb();

  const params = { bucket: bucketMs, from: fromTs, to: toTs };
  let whereExtra = '';
  if (opts.userId != null) {
    whereExtra = ' AND user_id = @userId';
    params.userId = opts.userId;
  }

  // NOTE: SQLite's `/` promotes to REAL when a bound JS number is treated as
  // REAL, so `(ts/@bucket)*@bucket` can round-trip back to `ts`. Use modulo
  // subtraction to floor reliably regardless of operand types.
  const sql = `
    SELECT user_id,
           (ts - (ts % @bucket)) AS bucket_ts,
           AVG(rss_mb)      AS rss_mb,
           AVG(cpu_percent) AS cpu_percent,
           AVG(messages_1h) AS messages_1h
      FROM gateway_samples
     WHERE ts >= @from AND ts < @to${whereExtra}
     GROUP BY user_id, bucket_ts
     ORDER BY user_id, bucket_ts
  `;

  const rows = db.prepare(sql).all(params);

  const byUser = new Map();
  for (const r of rows) {
    let bucket = byUser.get(r.user_id);
    if (!bucket) {
      bucket = { userId: r.user_id, points: [] };
      byUser.set(r.user_id, bucket);
    }
    bucket.points.push({
      ts: r.bucket_ts,
      rssMb: r.rss_mb,
      cpuPercent: r.cpu_percent,
      messages1h: r.messages_1h,
    });
  }

  return { range: rangeKey, bucketMs, users: Array.from(byUser.values()) };
}

// ---------------------------------------------------------------------------
// aggregate(rangeKey) — cluster KPIs + delta vs equivalent previous window
// ---------------------------------------------------------------------------

function aggregate(rangeKey) {
  const { rangeMs, fromTs, toTs } = resolveRange(rangeKey);
  const prevFromTs = fromTs - rangeMs;
  const db = getDb();

  // Latest sample per user in current window
  const snapshotRows = db.prepare(`
    WITH latest AS (
      SELECT user_id, MAX(ts) AS max_ts
        FROM gateway_samples
       WHERE ts >= @from AND ts < @to
       GROUP BY user_id
    )
    SELECT s.user_id, s.state, s.rss_mb, s.cpu_percent, s.messages_24h
      FROM gateway_samples s
      JOIN latest l ON s.user_id = l.user_id AND s.ts = l.max_ts
  `).all({ from: fromTs, to: toTs });

  let totalRssMb = 0;
  let cpuSum = 0;
  let cpuCount = 0;
  let runningCount = 0;
  let totalMessages24h = 0;
  for (const r of snapshotRows) {
    if (r.state === 'running') runningCount += 1;
    if (r.rss_mb != null) totalRssMb += r.rss_mb;
    if (r.cpu_percent != null) { cpuSum += r.cpu_percent; cpuCount += 1; }
    if (r.messages_24h != null) totalMessages24h += r.messages_24h;
  }
  const totalCount = snapshotRows.length;
  const avgCpuPercent = cpuCount > 0 ? cpuSum / cpuCount : 0;

  // Window averages for delta math
  const avgStmt = db.prepare(`
    SELECT AVG(rss_mb) AS avg_rss, AVG(cpu_percent) AS avg_cpu
      FROM gateway_samples
     WHERE ts >= @from AND ts < @to
  `);
  const cur = avgStmt.get({ from: fromTs,     to: toTs });
  const prev = avgStmt.get({ from: prevFromTs, to: fromTs });

  function pctDelta(curVal, prevVal) {
    if (curVal == null || prevVal == null || prevVal === 0) return null;
    return ((curVal - prevVal) / prevVal) * 100;
  }

  return {
    totalRssMb,
    avgCpuPercent,
    runningCount,
    totalCount,
    totalMessages24h,
    deltaRssPercent: pctDelta(cur.avg_rss, prev.avg_rss),
    deltaCpuPercent: pctDelta(cur.avg_cpu, prev.avg_cpu),
  };
}

module.exports = {
  insertSample,
  insertSamplesBatch,
  countSamples,
  pruneBefore,
  RANGE_DEFS,
  resolveRange,
  timeseries,
  aggregate,
};
