'use strict';

/**
 * server/lib/metrics/retention.cjs
 *
 * Hourly prune of samples older than AOC_METRICS_RETENTION_DAYS (default 30).
 * Weekly VACUUM to reclaim disk after prune.
 *
 * Env:
 *   AOC_METRICS_RETENTION_DAYS  — default 30
 */

const { getDb } = require('./db.cjs');
const queries = require('./queries.cjs');

const DEFAULT_RETENTION_DAYS = Number(process.env.AOC_METRICS_RETENTION_DAYS) || 30;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

let pruneTimer = null;
let vacuumTimer = null;

function runPrune({ retentionDays, now } = {}) {
  const days = retentionDays || DEFAULT_RETENTION_DAYS;
  const cutoff = (now || Date.now()) - days * DAY_MS;
  const removed = queries.pruneBefore(cutoff);
  if (removed > 0) {
    console.log(`[metrics-retention] pruned ${removed} samples older than ${days}d`);
  }
  return removed;
}

function runVacuum() {
  try {
    getDb().exec('VACUUM');
    console.log('[metrics-retention] vacuum complete');
  } catch (err) {
    console.warn('[metrics-retention] vacuum failed:', err.message);
  }
}

function start({ pruneIntervalMs, vacuumIntervalMs } = {}) {
  if (pruneTimer) return;
  const pruneEvery = pruneIntervalMs || HOUR_MS;
  const vacuumEvery = vacuumIntervalMs || 7 * DAY_MS;

  // Fire once shortly after boot, then on interval
  setTimeout(() => runPrune({}), 5 * 60_000);

  pruneTimer = setInterval(() => runPrune({}), pruneEvery);
  vacuumTimer = setInterval(runVacuum, vacuumEvery);

  if (pruneTimer.unref) pruneTimer.unref();
  if (vacuumTimer.unref) vacuumTimer.unref();

  console.log(`[metrics-retention] started (prune every ${pruneEvery}ms, vacuum every ${vacuumEvery}ms)`);
}

function stop() {
  if (pruneTimer) clearInterval(pruneTimer);
  if (vacuumTimer) clearInterval(vacuumTimer);
  pruneTimer = null;
  vacuumTimer = null;
}

module.exports = { start, stop, runPrune, runVacuum };
