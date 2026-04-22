// server/lib/metrics.cjs
// Aggregated task metrics for the /metrics dashboard.
// All queries are read-only against the existing tasks + task_activity tables;
// no caching (data volumes are small for now).
'use strict';

const db = require('./db.cjs');

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done'];

function resolveRange(range) {
  const days = RANGE_DAYS[range];
  if (!days) throw new Error(`Invalid range: ${range} (expected 7d|30d|90d)`);
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400_000);
  const previousSince = new Date(since.getTime() - days * 86400_000);
  return {
    days,
    since: since.toISOString(),
    until: until.toISOString(),
    previousSince: previousSince.toISOString(),
    previousUntil: since.toISOString(),
  };
}

function deltaPct(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null; // null = no baseline
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Execute a parameterized SQL query and return rows as plain objects.
 * Wrapper around sql.js's exec which returns a column/values tuple.
 */
function query(sql, params = []) {
  const sqlDb = db.getDb();
  if (!sqlDb) throw new Error('DB not initialized');
  const res = sqlDb.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

function scalar(sql, params = [], fallback = 0) {
  const rows = query(sql, params);
  if (!rows.length) return fallback;
  const v = Object.values(rows[0])[0];
  return v == null ? fallback : v;
}

/**
 * Build a WHERE clause + params array covering optional project filter.
 * Returns { clause, params } — clause begins with ' AND ' so it appends cleanly.
 */
function projectFilter(projectId) {
  if (!projectId) return { clause: '', params: [] };
  return { clause: ' AND project_id = ?', params: [projectId] };
}

/**
 * KPI summary + status distribution.
 * Returns numbers comparable to the previous same-length window for deltas.
 */
function getSummary({ range = '30d', projectId = null } = {}) {
  const r = resolveRange(range);
  const pf = projectFilter(projectId);

  // Completed in range
  const completedCurrent = scalar(
    `SELECT COUNT(*) FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?${pf.clause}`,
    [r.since, r.until, ...pf.params]
  );
  const completedPrevious = scalar(
    `SELECT COUNT(*) FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?${pf.clause}`,
    [r.previousSince, r.previousUntil, ...pf.params]
  );

  // Cost sum in range (only for done tasks — cost is usually set on completion)
  const costCurrent = scalar(
    `SELECT COALESCE(SUM(cost), 0) FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ? AND cost IS NOT NULL${pf.clause}`,
    [r.since, r.until, ...pf.params]
  );
  const costPrevious = scalar(
    `SELECT COALESCE(SUM(cost), 0) FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ? AND cost IS NOT NULL${pf.clause}`,
    [r.previousSince, r.previousUntil, ...pf.params]
  );

  // Active agents: distinct agent_id with any task update in the window
  const activeCurrent = scalar(
    `SELECT COUNT(DISTINCT agent_id) FROM tasks WHERE agent_id IS NOT NULL AND updated_at >= ? AND updated_at < ?${pf.clause}`,
    [r.since, r.until, ...pf.params]
  );
  const activePrevious = scalar(
    `SELECT COUNT(DISTINCT agent_id) FROM tasks WHERE agent_id IS NOT NULL AND updated_at >= ? AND updated_at < ?${pf.clause}`,
    [r.previousSince, r.previousUntil, ...pf.params]
  );

  // Blocked: current snapshot (not a range metric)
  const blockedCurrent = scalar(
    `SELECT COUNT(*) FROM tasks WHERE status = 'blocked'${pf.clause}`,
    [...pf.params]
  );
  // Previous snapshot is a reconstruction: count tasks that entered 'blocked' before
  // previousUntil and were not moved out before previousUntil. Cheaper approximation:
  // count tasks whose most recent status_change activity before previousUntil set
  // the status to 'blocked'. For MVP we keep it simple — just report current.
  const blockedPrevious = blockedCurrent; // no historical snapshot (MVP)

  // Status distribution — current snapshot
  const statusRows = query(
    `SELECT status, COUNT(*) AS c FROM tasks WHERE 1=1${pf.clause} GROUP BY status`,
    [...pf.params]
  );
  const statusDistribution = Object.fromEntries(VALID_STATUSES.map(s => [s, 0]));
  for (const row of statusRows) {
    if (statusDistribution[row.status] !== undefined) statusDistribution[row.status] = row.c;
  }

  return {
    range,
    since: r.since,
    until: r.until,
    projectId: projectId || null,
    kpis: {
      completed:    { current: completedCurrent, previous: completedPrevious, deltaPct: deltaPct(completedCurrent, completedPrevious) },
      cost:         { current: Number(costCurrent.toFixed ? costCurrent.toFixed(4) : costCurrent) * 1, previous: Number(costPrevious.toFixed ? costPrevious.toFixed(4) : costPrevious) * 1, deltaPct: deltaPct(costCurrent, costPrevious) },
      activeAgents: { current: activeCurrent, previous: activePrevious, deltaPct: deltaPct(activeCurrent, activePrevious) },
      blocked:      { current: blockedCurrent, previous: blockedPrevious, deltaPct: null },
    },
    statusDistribution,
  };
}

/**
 * Throughput: completed tasks per calendar day (UTC), bucketed by project.
 * Fills missing dates with 0 so the chart has a continuous x-axis.
 */
function getThroughput({ range = '30d', projectId = null } = {}) {
  const r = resolveRange(range);
  const pf = projectFilter(projectId);

  // SQLite's date() returns YYYY-MM-DD from ISO 8601 timestamps
  const rows = query(
    `SELECT date(completed_at) AS bucket_date,
            COALESCE(project_id, 'general') AS project_id,
            COUNT(*) AS c
       FROM tasks
      WHERE status = 'done'
        AND completed_at >= ? AND completed_at < ?${pf.clause}
   GROUP BY bucket_date, project_id
   ORDER BY bucket_date ASC`,
    [r.since, r.until, ...pf.params]
  );

  // Build a dense date list
  const dates = [];
  const startDay = new Date(r.since);
  startDay.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(r.until);
  endDay.setUTCHours(0, 0, 0, 0);
  for (let d = new Date(startDay); d <= endDay; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  // Pivot rows → { date → { projectId → count } }
  const pivot = new Map();
  for (const row of rows) {
    if (!pivot.has(row.bucket_date)) pivot.set(row.bucket_date, {});
    pivot.get(row.bucket_date)[row.project_id] = row.c;
  }

  const buckets = dates.map(date => {
    const byProject = pivot.get(date) || {};
    const count = Object.values(byProject).reduce((a, b) => a + b, 0);
    return { date, count, byProject };
  });

  // Include project metadata so the frontend can color segments
  const projects = db.getAllProjects().map(p => ({ id: p.id, name: p.name, color: p.color }));

  return { range, since: r.since, until: r.until, projectId: projectId || null, buckets, projects };
}

module.exports = {
  getSummary,
  getThroughput,
  // exposed for tests
  _resolveRange: resolveRange,
  _deltaPct: deltaPct,
};
