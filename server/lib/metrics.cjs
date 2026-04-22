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

/**
 * Per-agent performance table for the leaderboard.
 * Returns one row per agent that touched at least one task in the window.
 */
function getAgentLeaderboard({ range = '30d', projectId = null } = {}) {
  const r = resolveRange(range);
  const pf = projectFilter(projectId);

  // Fetch done tasks in window with agent + duration + cost
  const doneRows = query(
    `SELECT agent_id,
            cost,
            (julianday(completed_at) - julianday(created_at)) * 86400000.0 AS duration_ms
       FROM tasks
      WHERE status = 'done'
        AND completed_at >= ? AND completed_at < ?
        AND agent_id IS NOT NULL${pf.clause}`,
    [r.since, r.until, ...pf.params]
  );

  // Blocked snapshot per agent (current, for success-rate denominator)
  const blockedRows = query(
    `SELECT agent_id, COUNT(*) AS c
       FROM tasks
      WHERE status = 'blocked' AND agent_id IS NOT NULL${pf.clause}
   GROUP BY agent_id`,
    [...pf.params]
  );

  // For change-request rate we need, per agent:
  //   - reviewReached: COUNT DISTINCT task_id where any activity has to_value='in_review'
  //     for tasks owned by that agent in the window
  //   - reviewReturns: COUNT activities where from_value='in_review' AND to_value IN ('in_progress','todo')
  const reviewReached = query(
    `SELECT t.agent_id, COUNT(DISTINCT ta.task_id) AS c
       FROM task_activity ta
       JOIN tasks t ON t.id = ta.task_id
      WHERE ta.type = 'status_change' AND ta.to_value = 'in_review'
        AND ta.created_at >= ? AND ta.created_at < ?
        AND t.agent_id IS NOT NULL${pf.clause.replace('project_id', 't.project_id')}
   GROUP BY t.agent_id`,
    [r.since, r.until, ...pf.params]
  );
  const reviewReturns = query(
    `SELECT t.agent_id, COUNT(*) AS c
       FROM task_activity ta
       JOIN tasks t ON t.id = ta.task_id
      WHERE ta.type = 'status_change'
        AND ta.from_value = 'in_review'
        AND ta.to_value IN ('in_progress', 'todo')
        AND ta.created_at >= ? AND ta.created_at < ?
        AND t.agent_id IS NOT NULL${pf.clause.replace('project_id', 't.project_id')}
   GROUP BY t.agent_id`,
    [r.since, r.until, ...pf.params]
  );

  // Aggregate done metrics per agent
  const perAgent = new Map();
  function ensure(agentId) {
    if (!perAgent.has(agentId)) {
      perAgent.set(agentId, {
        agentId,
        completed: 0,
        costSum: 0,
        costCount: 0,
        durationSum: 0,
        durationCount: 0,
        blocked: 0,
        reviewReached: 0,
        reviewReturns: 0,
      });
    }
    return perAgent.get(agentId);
  }
  for (const row of doneRows) {
    const a = ensure(row.agent_id);
    a.completed++;
    if (row.cost != null) { a.costSum += Number(row.cost); a.costCount++; }
    if (row.duration_ms != null) { a.durationSum += Number(row.duration_ms); a.durationCount++; }
  }
  for (const row of blockedRows) ensure(row.agent_id).blocked = row.c;
  for (const row of reviewReached) ensure(row.agent_id).reviewReached = row.c;
  for (const row of reviewReturns) ensure(row.agent_id).reviewReturns = row.c;

  // Compute final per-agent row
  const agents = [...perAgent.values()].map(a => {
    const successDenom = a.completed + a.blocked;
    const successRate = successDenom === 0 ? null : a.completed / successDenom;
    const changeRequestRate = a.reviewReached === 0 ? null : a.reviewReturns / a.reviewReached;
    return {
      agentId: a.agentId,
      completed: a.completed,
      blocked: a.blocked,
      avgCost: a.costCount === 0 ? null : a.costSum / a.costCount,
      avgDurationMs: a.durationCount === 0 ? null : a.durationSum / a.durationCount,
      changeRequestRate,                // 0..1 or null
      successRate,                      // 0..1 or null
      reviewReached: a.reviewReached,
      reviewReturns: a.reviewReturns,
    };
  });

  // Default sort: completed desc, then avgCost asc
  agents.sort((x, y) => y.completed - x.completed || (x.avgCost ?? Infinity) - (y.avgCost ?? Infinity));

  return { range, since: r.since, until: r.until, projectId: projectId || null, agents };
}

const FORWARD_PAIRS = [
  ['backlog', 'todo'],
  ['todo', 'in_progress'],
  ['in_progress', 'in_review'],
  ['in_review', 'done'],
];

/**
 * Lifecycle funnel: avg time each forward transition takes.
 * For each status_change activity in the window, compute how long the task
 * spent in the `from_value` status before this transition. Then avg per pair.
 */
function getLifecycleFunnel({ range = '30d', projectId = null } = {}) {
  const r = resolveRange(range);
  const pf = projectFilter(projectId);

  // Pull transitions inside the window, joined with the task's created_at as a
  // fallback for the 'backlog → ...' transition where there is no prior activity.
  const activities = query(
    `SELECT ta.task_id, ta.from_value, ta.to_value, ta.created_at AS to_time,
            t.created_at AS task_created
       FROM task_activity ta
       JOIN tasks t ON t.id = ta.task_id
      WHERE ta.type = 'status_change'
        AND ta.created_at >= ? AND ta.created_at < ?${pf.clause.replace('project_id', 't.project_id')}
   ORDER BY ta.task_id, ta.created_at ASC`,
    [r.since, r.until, ...pf.params]
  );

  // Also fetch prior activities per task that might be outside the window but
  // define when the current transition's `from_value` was entered.
  const priorActivities = query(
    `SELECT ta.task_id, ta.to_value, ta.created_at
       FROM task_activity ta
       JOIN tasks t ON t.id = ta.task_id
      WHERE ta.type = 'status_change'
        AND ta.created_at < ?${pf.clause.replace('project_id', 't.project_id')}
   ORDER BY ta.task_id, ta.created_at ASC`,
    [r.until, ...pf.params]
  );

  // Build per-task arrival-at-status map: task_id → { status → arrival_time[] }
  const arrivals = new Map();
  for (const row of priorActivities) {
    if (!arrivals.has(row.task_id)) arrivals.set(row.task_id, {});
    const m = arrivals.get(row.task_id);
    if (!m[row.to_value]) m[row.to_value] = [];
    m[row.to_value].push(row.created_at);
  }

  // For each in-window transition, compute time-in-from-status
  const aggregates = new Map(); // key `from|to` → { sumMs, count }
  for (const a of activities) {
    if (!a.from_value || !a.to_value) continue;
    // Find most recent arrival at from_value BEFORE to_time
    let fromTime = null;
    const perTask = arrivals.get(a.task_id) || {};
    const arr = perTask[a.from_value] || [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] < a.to_time) { fromTime = arr[i]; break; }
    }
    // Fallback for backlog: use task creation time
    if (!fromTime && a.from_value === 'backlog') fromTime = a.task_created;
    if (!fromTime) continue;
    const ms = new Date(a.to_time).getTime() - new Date(fromTime).getTime();
    if (ms < 0) continue;
    const key = `${a.from_value}|${a.to_value}`;
    if (!aggregates.has(key)) aggregates.set(key, { sumMs: 0, count: 0 });
    const agg = aggregates.get(key);
    agg.sumMs += ms;
    agg.count++;
  }

  // Emit all forward pairs (filled or zero) so the chart always shows the full funnel
  const transitions = FORWARD_PAIRS.map(([from, to]) => {
    const agg = aggregates.get(`${from}|${to}`) || { sumMs: 0, count: 0 };
    return {
      from,
      to,
      avgMs: agg.count === 0 ? null : agg.sumMs / agg.count,
      count: agg.count,
    };
  });

  return { range, since: r.since, until: r.until, projectId: projectId || null, transitions };
}

module.exports = {
  getSummary,
  getThroughput,
  getAgentLeaderboard,
  getLifecycleFunnel,
  // exposed for tests
  _resolveRange: resolveRange,
  _deltaPct: deltaPct,
  _FORWARD_PAIRS: FORWARD_PAIRS,
};
