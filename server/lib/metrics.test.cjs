// node --test server/lib/metrics.test.cjs
//
// Tests for metrics aggregation: KPI math, delta %, throughput bucketing,
// project filtering, range validation.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-metrics-test-'));
process.env.AOC_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';

const db = require('./db.cjs');
const metrics = require('./metrics.cjs');

const DAY_MS = 86400_000;

function isoDaysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

// Insert a task with explicit timestamps by bypassing createTask (which always
// sets now()). We write directly so we can backdate completed_at.
function insertCompletedTask({ title, projectId = 'general', agentId = 'a1', daysAgo, createdDaysAgo, cost = null }) {
  const sqlDb = db.getDb();
  const crypto = require('node:crypto');
  const id = crypto.randomUUID();
  const completedTs = isoDaysAgo(daysAgo);
  // Default created 1 day before completion so duration > 0 out of the box
  const createdTs = isoDaysAgo(createdDaysAgo ?? (daysAgo + 1));
  sqlDb.run(
    'INSERT INTO tasks (id, title, status, priority, agent_id, tags, project_id, attachments, cost, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, 'done', 'medium', agentId, '[]', projectId, '[]', cost, createdTs, completedTs, completedTs]
  );
  return id;
}

function insertOpenTask({ title, status = 'backlog', agentId = 'a1', projectId = 'general', daysAgo = 0 }) {
  const sqlDb = db.getDb();
  const crypto = require('node:crypto');
  const id = crypto.randomUUID();
  const ts = isoDaysAgo(daysAgo);
  sqlDb.run(
    'INSERT INTO tasks (id, title, status, priority, agent_id, tags, project_id, attachments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, status, 'medium', agentId, '[]', projectId, '[]', ts, ts]
  );
  return id;
}

test.before(async () => {
  await db.initDatabase();
  // Seed an extra project with a deterministic id for the filter tests.
  // (createProject always generates a UUID, so insert directly.)
  const sqlDb = db.getDb();
  sqlDb.run(
    'INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['sales', 'Sales', '#10b981', new Date().toISOString(), new Date().toISOString()]
  );
});

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ── helpers ───────────────────────────────────────────────────────────────────

test('_resolveRange: valid presets compute correct window', () => {
  const r = metrics._resolveRange('30d');
  const sinceMs = new Date(r.since).getTime();
  const untilMs = new Date(r.until).getTime();
  assert.equal(Math.round((untilMs - sinceMs) / DAY_MS), 30);
  // Previous window sits back-to-back immediately before since
  assert.equal(r.previousUntil, r.since);
});

test('_resolveRange: rejects invalid presets', () => {
  assert.throws(() => metrics._resolveRange('1d'), /Invalid range/);
  assert.throws(() => metrics._resolveRange(undefined), /Invalid range/);
});

test('_deltaPct: zero baseline returns null, same-zero returns 0', () => {
  assert.equal(metrics._deltaPct(5, 0), null);
  assert.equal(metrics._deltaPct(0, 0), 0);
  assert.equal(metrics._deltaPct(10, 5), 100);
  assert.equal(metrics._deltaPct(5, 10), -50);
});

// ── summary ───────────────────────────────────────────────────────────────────

test('getSummary: completed + cost + delta vs previous window', () => {
  // Seed: 3 tasks completed 10 days ago ($1 each), 1 task completed 45 days ago ($2)
  insertCompletedTask({ title: 's1', daysAgo: 10, cost: 1.0 });
  insertCompletedTask({ title: 's2', daysAgo: 11, cost: 1.0 });
  insertCompletedTask({ title: 's3', daysAgo: 12, cost: 1.0 });
  insertCompletedTask({ title: 's4', daysAgo: 45, cost: 2.0 });

  const s = metrics.getSummary({ range: '30d' });
  // current window = last 30 days → 3 tasks, $3.0
  assert.equal(s.kpis.completed.current, 3);
  assert.equal(s.kpis.cost.current, 3.0);
  // previous window = days 30..60 ago → 1 task ($2)
  assert.equal(s.kpis.completed.previous, 1);
  assert.equal(s.kpis.cost.previous, 2.0);
  assert.equal(s.kpis.completed.deltaPct, 200); // (3-1)/1 * 100
  assert.equal(s.kpis.cost.deltaPct, 50);
});

test('getSummary: active agents counts distinct agent_ids with updates in window', () => {
  // The above seeded tasks were all agent_id='a1'; add another agent in the window
  insertCompletedTask({ title: 'other-agent', daysAgo: 5, agentId: 'zephyr' });
  const s = metrics.getSummary({ range: '30d' });
  assert.ok(s.kpis.activeAgents.current >= 2);
});

test('getSummary: statusDistribution reflects current snapshot across all statuses', () => {
  insertOpenTask({ title: 'bl1', status: 'backlog' });
  insertOpenTask({ title: 'bl2', status: 'backlog' });
  insertOpenTask({ title: 'b1',  status: 'blocked' });
  insertOpenTask({ title: 'ir1', status: 'in_review' });

  const s = metrics.getSummary({ range: '30d' });
  assert.ok(s.statusDistribution.backlog >= 2);
  assert.ok(s.statusDistribution.blocked >= 1);
  assert.ok(s.statusDistribution.in_review >= 1);
  assert.ok(s.statusDistribution.done >= 4); // from previous tests
  assert.equal(s.kpis.blocked.current, s.statusDistribution.blocked);
});

test('getSummary: projectId filter narrows the result set', () => {
  // Add a task in the 'sales' project completed recently
  insertCompletedTask({ title: 'sales-task', daysAgo: 3, projectId: 'sales', cost: 5.0 });

  const all = metrics.getSummary({ range: '30d' });
  const sales = metrics.getSummary({ range: '30d', projectId: 'sales' });
  const general = metrics.getSummary({ range: '30d', projectId: 'general' });

  // 'sales' filter sees only the sales task (1 completed, $5)
  assert.equal(sales.kpis.completed.current, 1);
  assert.equal(sales.kpis.cost.current, 5.0);
  // general excludes sales
  assert.equal(all.kpis.completed.current, sales.kpis.completed.current + general.kpis.completed.current);
});

// ── throughput ────────────────────────────────────────────────────────────────

test('getThroughput: returns dense date buckets with counts per project', () => {
  const t = metrics.getThroughput({ range: '30d' });
  // ~30 consecutive dates
  assert.ok(t.buckets.length >= 30 && t.buckets.length <= 32);
  // buckets are ISO YYYY-MM-DD sorted ascending
  for (let i = 1; i < t.buckets.length; i++) {
    assert.ok(t.buckets[i].date >= t.buckets[i - 1].date);
  }
  // At least one bucket has a non-zero count (we seeded tasks)
  assert.ok(t.buckets.some(b => b.count > 0));
  // byProject sub-map only contains projects with activity that day
  const bucketWithActivity = t.buckets.find(b => b.count > 0);
  assert.ok(Object.keys(bucketWithActivity.byProject).length > 0);
});

test('getThroughput: projectId filter limits buckets to that project', () => {
  const salesOnly = metrics.getThroughput({ range: '30d', projectId: 'sales' });
  // Every bucket that has activity should have ONLY sales in byProject
  for (const b of salesOnly.buckets) {
    if (b.count > 0) {
      assert.deepEqual(Object.keys(b.byProject), ['sales']);
    }
  }
});

test('getThroughput: exposes project metadata for charting', () => {
  const t = metrics.getThroughput({ range: '30d' });
  const ids = t.projects.map(p => p.id).sort();
  assert.ok(ids.includes('general'));
  assert.ok(ids.includes('sales'));
  const general = t.projects.find(p => p.id === 'general');
  assert.ok(general.color);
});

// ── agent leaderboard ────────────────────────────────────────────────────────

function insertActivity({ taskId, fromValue, toValue, daysAgo = 1, actor = 'user' }) {
  const sqlDb = db.getDb();
  const crypto = require('node:crypto');
  const id = crypto.randomUUID();
  const ts = isoDaysAgo(daysAgo);
  sqlDb.run(
    'INSERT INTO task_activity (id, task_id, type, from_value, to_value, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, taskId, 'status_change', fromValue, toValue, actor, ts]
  );
  return { id, ts };
}

test('getAgentLeaderboard: completed + avgCost + avgDurationMs per agent', () => {
  // Dedicated project so counts are isolated from earlier seeds
  const sqlDb = db.getDb();
  sqlDb.run("INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES ('lb', 'LB', '#000', datetime('now'), datetime('now'))");
  // Agent 'alpha' completes 2 tasks, agent 'beta' completes 1
  insertCompletedTask({ title: 'lb-a1', projectId: 'lb', agentId: 'alpha', daysAgo: 3, cost: 1.0 });
  insertCompletedTask({ title: 'lb-a2', projectId: 'lb', agentId: 'alpha', daysAgo: 5, cost: 3.0 });
  insertCompletedTask({ title: 'lb-b1', projectId: 'lb', agentId: 'beta',  daysAgo: 4, cost: 2.0 });

  const lb = metrics.getAgentLeaderboard({ range: '30d', projectId: 'lb' });
  assert.equal(lb.agents.length, 2);
  const [top, next] = lb.agents;
  // Default sort: completed desc
  assert.equal(top.agentId, 'alpha');
  assert.equal(top.completed, 2);
  assert.equal(top.avgCost, 2.0); // (1 + 3) / 2
  assert.ok(top.avgDurationMs > 0, 'duration should be a positive ms value');
  assert.equal(next.agentId, 'beta');
  assert.equal(next.completed, 1);
  assert.equal(next.avgCost, 2.0);
});

test('getAgentLeaderboard: successRate = done / (done + blocked), null when no signal', () => {
  const sqlDb = db.getDb();
  sqlDb.run("INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES ('sr', 'SR', '#000', datetime('now'), datetime('now'))");
  // Agent 'gamma': 3 done, 1 blocked → 75%
  insertCompletedTask({ title: 'sr-1', projectId: 'sr', agentId: 'gamma', daysAgo: 1 });
  insertCompletedTask({ title: 'sr-2', projectId: 'sr', agentId: 'gamma', daysAgo: 1 });
  insertCompletedTask({ title: 'sr-3', projectId: 'sr', agentId: 'gamma', daysAgo: 1 });
  insertOpenTask({ title: 'sr-b', status: 'blocked', projectId: 'sr', agentId: 'gamma', daysAgo: 1 });

  const lb = metrics.getAgentLeaderboard({ range: '30d', projectId: 'sr' });
  const gamma = lb.agents.find(a => a.agentId === 'gamma');
  assert.equal(gamma.completed, 3);
  assert.equal(gamma.blocked, 1);
  assert.equal(gamma.successRate, 0.75);
});

test('getAgentLeaderboard: changeRequestRate counts in_review→in_progress/todo transitions', () => {
  const sqlDb = db.getDb();
  sqlDb.run("INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES ('cr', 'CR', '#000', datetime('now'), datetime('now'))");
  const t1 = insertOpenTask({ title: 'cr-1', projectId: 'cr', agentId: 'delta', status: 'in_review', daysAgo: 2 });
  const t2 = insertOpenTask({ title: 'cr-2', projectId: 'cr', agentId: 'delta', status: 'in_review', daysAgo: 2 });
  // Both tasks reached in_review
  insertActivity({ taskId: t1, fromValue: 'in_progress', toValue: 'in_review', daysAgo: 2 });
  insertActivity({ taskId: t2, fromValue: 'in_progress', toValue: 'in_review', daysAgo: 2 });
  // Only t1 was sent back (change request)
  insertActivity({ taskId: t1, fromValue: 'in_review',   toValue: 'in_progress', daysAgo: 1 });

  const lb = metrics.getAgentLeaderboard({ range: '30d', projectId: 'cr' });
  const delta = lb.agents.find(a => a.agentId === 'delta');
  assert.equal(delta.reviewReached, 2);
  assert.equal(delta.reviewReturns, 1);
  assert.equal(delta.changeRequestRate, 0.5);
});

// ── lifecycle funnel ─────────────────────────────────────────────────────────

test('getLifecycleFunnel: returns all 4 forward pairs, filling zero when no data', () => {
  const lf = metrics.getLifecycleFunnel({ range: '7d', projectId: 'empty-nope' });
  assert.equal(lf.transitions.length, 4);
  const pairs = lf.transitions.map(t => `${t.from}→${t.to}`);
  assert.deepEqual(pairs, [
    'backlog→todo', 'todo→in_progress', 'in_progress→in_review', 'in_review→done'
  ]);
  // All zeroed out because of nonexistent project filter
  lf.transitions.forEach(t => assert.equal(t.count, 0));
  lf.transitions.forEach(t => assert.equal(t.avgMs, null));
});

test('getLifecycleFunnel: computes avg time in from-status using prior activities + task.created_at fallback', () => {
  const sqlDb = db.getDb();
  sqlDb.run("INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES ('lf', 'LF', '#000', datetime('now'), datetime('now'))");
  // Task: created 10d ago, moved to todo 7d ago, in_progress 5d ago, in_review 4d ago, done 3d ago
  const taskId = insertOpenTask({ title: 'lf-1', projectId: 'lf', agentId: 'epsilon', status: 'done', daysAgo: 10 });
  // Backdate the task's created_at so the backlog→todo transition has a sensible base
  sqlDb.run('UPDATE tasks SET created_at = ? WHERE id = ?', [isoDaysAgo(10), taskId]);
  insertActivity({ taskId, fromValue: 'backlog',     toValue: 'todo',        daysAgo: 7 });
  insertActivity({ taskId, fromValue: 'todo',        toValue: 'in_progress', daysAgo: 5 });
  insertActivity({ taskId, fromValue: 'in_progress', toValue: 'in_review',   daysAgo: 4 });
  insertActivity({ taskId, fromValue: 'in_review',   toValue: 'done',        daysAgo: 3 });

  const lf = metrics.getLifecycleFunnel({ range: '30d', projectId: 'lf' });
  const byPair = Object.fromEntries(lf.transitions.map(t => [`${t.from}→${t.to}`, t]));
  // Sanity checks — use day-level tolerance because setTimeout micro-offsets creep in
  const ONE_DAY = 86400_000;
  // backlog→todo = created (10d ago) to todo entry (7d ago) → ~3 days
  assert.ok(byPair['backlog→todo'].avgMs >= 2.9 * ONE_DAY && byPair['backlog→todo'].avgMs <= 3.1 * ONE_DAY);
  // todo→in_progress: 7d → 5d → ~2 days
  assert.ok(byPair['todo→in_progress'].avgMs >= 1.9 * ONE_DAY && byPair['todo→in_progress'].avgMs <= 2.1 * ONE_DAY);
  // in_progress→in_review: 5d → 4d → ~1 day
  assert.ok(byPair['in_progress→in_review'].avgMs >= 0.9 * ONE_DAY && byPair['in_progress→in_review'].avgMs <= 1.1 * ONE_DAY);
  // in_review→done: 4d → 3d → ~1 day
  assert.ok(byPair['in_review→done'].avgMs >= 0.9 * ONE_DAY && byPair['in_review→done'].avgMs <= 1.1 * ONE_DAY);

  lf.transitions.forEach(t => assert.equal(t.count, 1));
});

test('getLifecycleFunnel: projectId filter isolates transitions', () => {
  // The prior test seeded 'lf' with 1 of each transition. Filtering by another
  // project that has no lifecycle data should yield zero counts.
  const lf = metrics.getLifecycleFunnel({ range: '30d', projectId: 'sales' });
  lf.transitions.forEach(t => assert.equal(t.count, 0));
});

// ── agentId filter (drilldown) ────────────────────────────────────────────────

test('getSummary: agentId filter narrows to just that agent', () => {
  const sqlDb = db.getDb();
  sqlDb.run("INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES ('dr', 'Dr', '#000', datetime('now'), datetime('now'))");
  insertCompletedTask({ title: 'dr-a', projectId: 'dr', agentId: 'solo',  daysAgo: 2, cost: 1.0 });
  insertCompletedTask({ title: 'dr-b', projectId: 'dr', agentId: 'other', daysAgo: 2, cost: 5.0 });

  const both = metrics.getSummary({ range: '30d', projectId: 'dr' });
  const solo = metrics.getSummary({ range: '30d', projectId: 'dr', agentId: 'solo' });
  assert.equal(both.kpis.completed.current, 2);
  assert.equal(solo.kpis.completed.current, 1);
  assert.equal(solo.kpis.cost.current, 1.0);
  assert.equal(solo.agentId, 'solo');
});

test('getAgentRecentTasks: returns tasks for the agent, newest first, respects limit', async () => {
  const sqlDb = db.getDb();
  sqlDb.run("INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at) VALUES ('rt', 'RT', '#000', datetime('now'), datetime('now'))");
  // Seed 3 tasks with distinct updated_at via sleep (SQL timestamps respect insertion order here)
  insertCompletedTask({ title: 'rt-old', projectId: 'rt', agentId: 'zed', daysAgo: 8, cost: 0.1 });
  await new Promise(r => setTimeout(r, 10));
  insertCompletedTask({ title: 'rt-mid', projectId: 'rt', agentId: 'zed', daysAgo: 5, cost: 0.2 });
  await new Promise(r => setTimeout(r, 10));
  insertCompletedTask({ title: 'rt-new', projectId: 'rt', agentId: 'zed', daysAgo: 2, cost: 0.3 });
  // Also one task from a different agent — must not appear
  insertCompletedTask({ title: 'rt-other', projectId: 'rt', agentId: 'notzed', daysAgo: 1 });

  const res = metrics.getAgentRecentTasks({ agentId: 'zed', projectId: 'rt', limit: 20 });
  assert.equal(res.length, 3);
  assert.equal(res[0].title, 'rt-new');
  assert.ok(res[0].durationMs > 0);
  assert.equal(res[0].cost, 0.3);

  // limit works
  const lim = metrics.getAgentRecentTasks({ agentId: 'zed', projectId: 'rt', limit: 2 });
  assert.equal(lim.length, 2);
});

test('getAgentRecentTasks: throws when agentId missing', () => {
  assert.throws(() => metrics.getAgentRecentTasks({}), /agentId is required/);
});
