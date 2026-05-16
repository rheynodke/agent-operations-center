'use strict';

/**
 * server/lib/metrics/poller.cjs
 *
 * Periodic snapshot of gateway state into the metrics DB. Reuses
 * gateway-orchestrator.listGatewaysRich() so the chart view and the list view
 * see identical numbers.
 *
 * In-flight lock prevents overlap if a probe call exceeds the interval.
 *
 * Env:
 *   AOC_METRICS_POLL_INTERVAL_MS — override interval (default 30000)
 */

const queries = require('./queries.cjs');

const DEFAULT_INTERVAL_MS = Number(process.env.AOC_METRICS_POLL_INTERVAL_MS) || 30_000;

let timer = null;
let inFlight = false;

function rowFromGateway(g, ts) {
  const activity = g.activity || {};
  const lastIso = activity.lastActivityAt || null;
  return {
    ts,
    user_id: g.userId,
    state: g.state,
    port: g.port ?? null,
    pid: g.pid ?? null,
    uptime_seconds: g.uptimeSeconds ?? null,
    rss_mb: g.rssMb ?? null,
    cpu_percent: g.cpuPercent ?? null,
    messages_1h: activity.messagesLast1h ?? null,
    messages_24h: activity.messagesLast24h ?? null,
    last_activity_at: lastIso ? new Date(lastIso).getTime() : null,
  };
}

async function runOnce({ probe } = {}) {
  if (inFlight) return; // overlap guard
  inFlight = true;
  try {
    const probeFn = probe || require('../gateway-orchestrator.cjs').listGatewaysRich;
    const gateways = await probeFn();
    const ts = Date.now();
    const rows = gateways.map((g) => rowFromGateway(g, ts));
    queries.insertSamplesBatch(rows);
  } catch (err) {
    console.warn('[metrics-poller] tick failed:', err.message);
  } finally {
    inFlight = false;
  }
}

function start({ probe, intervalMs } = {}) {
  if (timer) return; // already running
  const interval = intervalMs || DEFAULT_INTERVAL_MS;
  // Fire immediately, then on interval
  runOnce({ probe }).catch((e) => console.warn('[metrics-poller] initial tick error:', e.message));
  timer = setInterval(() => {
    runOnce({ probe }).catch((e) => console.warn('[metrics-poller] tick error:', e.message));
  }, interval);
  if (timer.unref) timer.unref();
  console.log(`[metrics-poller] started (interval ${interval}ms)`);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log('[metrics-poller] stopped');
}

module.exports = { start, stop, runOnce };
