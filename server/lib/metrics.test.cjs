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
function insertCompletedTask({ title, projectId = 'general', agentId = 'a1', daysAgo, cost = null }) {
  const sqlDb = db.getDb();
  const crypto = require('node:crypto');
  const id = crypto.randomUUID();
  const ts = isoDaysAgo(daysAgo);
  sqlDb.run(
    'INSERT INTO tasks (id, title, status, priority, agent_id, tags, project_id, attachments, cost, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, 'done', 'medium', agentId, '[]', projectId, '[]', cost, ts, ts, ts]
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
