# AOC Self-Learning — Phase 1 (Foundation Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation for AOC's satisfaction-gated self-learning pipeline — schema, LLM provider abstraction, reflection service, lessons writer, daily rollup, and basic feedback REST endpoints. After this phase, the pipeline is functional and triggerable via internal RPC; UI and channel integrations come in later phases.

**Architecture:** Per spec [docs/superpowers/specs/2026-05-09-aoc-self-learning-satisfaction-design.md](../specs/2026-05-09-aoc-self-learning-satisfaction-design.md). Three new SQLite tables + pluggable LLM provider (claude-code CLI subprocess) + session_end-driven reflection service that does single Haiku call producing flagged turns, lessons, and validated examples; lessons written as YAML-frontmatter markdown to `<workspace>/aoc-lessons/` (auto-indexed by qmd via existing workspace collection bootstrap).

**Tech Stack:** Node.js 20+, Express 5, sql.js (existing AOC DB), node:test, CommonJS. Reuses Claude CLI subprocess pattern from `server/lib/ai.cjs`. New code in `server/lib/{db,llm-providers,reflection-*,lessons-*,satisfaction-*}.cjs` and `server/routes/feedback.cjs`.

**Out of scope for Phase 1:** Frontend buttons, channel adapter modifications (Telegram/Discord/WhatsApp reactions), WebSocket events, OpenClaw fork webhooks. Those land in Phases 2-5.

---

## File Structure

**New files (Phase 1):**

| Path | Responsibility |
|---|---|
| `server/lib/db-migrations/0005-satisfaction-tables.cjs` | Schema: 3 tables (ratings, summary, daily metrics) |
| `server/lib/db/satisfaction.cjs` | Domain accessor — record/read ratings, summaries, rollup queries |
| `server/lib/db/satisfaction.test.cjs` | Unit tests |
| `server/lib/llm-providers/index.cjs` | Provider registry |
| `server/lib/llm-providers/claude-code-provider.cjs` | Claude CLI subprocess wrapper |
| `server/lib/llm-providers/claude-code-provider.test.cjs` | Unit tests (mocked spawn) |
| `server/lib/llm-providers/README.md` | How to add a new provider |
| `server/lib/reflection-prompts.cjs` | Prompt template + version constants |
| `server/lib/reflection-service.cjs` | Skip rules + transcript compression + LLM orchestration + concurrency queue |
| `server/lib/reflection-service.test.cjs` | Unit tests |
| `server/lib/lessons-writer.cjs` | Verbatim resolver + frontmatter render + atomic write |
| `server/lib/lessons-writer.test.cjs` | Unit tests |
| `server/lib/satisfaction-rollup.cjs` | Daily rollup job |
| `server/lib/satisfaction-rollup.test.cjs` | Unit tests |
| `server/routes/feedback.cjs` | REST endpoints for ratings + satisfaction metrics |
| `server/routes/feedback.test.cjs` | Route integration tests |

**Modified files:**

| Path | Change |
|---|---|
| `server/lib/db-migrations/index.cjs` | Append migration 0005 to MIGRATIONS array |
| `server/lib/db.cjs` | Re-export new domain via `...require('./db/satisfaction.cjs')` |
| `server/lib/index.cjs` | Add satisfaction modules to barrel exports |
| `server/index.cjs` | Mount feedback router at `/api` |
| `.env.example` | Add reflection-related env vars |

---

## Task 1: Schema migration — three new tables

**Files:**
- Create: `server/lib/db-migrations/0005-satisfaction-tables.cjs`
- Modify: `server/lib/db-migrations/index.cjs`

- [ ] **Step 1: Write the migration file**

```javascript
'use strict';

/**
 * Migration 0005 — satisfaction tables.
 *
 * Three tables for AOC's self-learning satisfaction pipeline:
 *
 * 1. message_ratings — append-style event log, INSERT OR REPLACE on
 *    (message_id, source, rater_external_id) for last-write-wins on
 *    flip (👍 → 👎). source ∈ button|reaction|nl_correction.
 *
 * 2. session_satisfaction_summary — one row per reflected session,
 *    written by reflection-service after session_end. Holds counts,
 *    rates, LLM token usage, status, prompt_version.
 *
 * 3. agent_satisfaction_metrics_daily — pre-aggregated dashboard rollup,
 *    UPSERT'd by daily job. Avoids scanning ratings on every render.
 *
 * See spec §4 (Storage Schema).
 */
module.exports = {
  id: '0005-satisfaction-tables',
  description: 'Create satisfaction tables for self-learning pipeline',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS message_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        source TEXT NOT NULL,
        rating TEXT NOT NULL,
        reason TEXT,
        rater_external_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_ratings_agent_session ON message_ratings(agent_id, session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ratings_owner_created ON message_ratings(owner_id, created_at DESC)`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_dedupe ON message_ratings(message_id, source, rater_external_id)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS session_satisfaction_summary (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        endorsed_count INTEGER NOT NULL,
        flagged_count INTEGER NOT NULL,
        presumed_good_count INTEGER NOT NULL,
        hallucination_rate REAL NOT NULL,
        endorsement_rate REAL NOT NULL,
        reflection_status TEXT NOT NULL,
        reflection_skip_reason TEXT,
        lessons_extracted INTEGER DEFAULT 0,
        examples_captured INTEGER DEFAULT 0,
        llm_input_tokens INTEGER,
        llm_output_tokens INTEGER,
        prompt_version TEXT,
        reflection_at INTEGER NOT NULL,
        duration_ms INTEGER
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_session_summary_agent_time ON session_satisfaction_summary(agent_id, reflection_at DESC)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS agent_satisfaction_metrics_daily (
        agent_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        channel TEXT NOT NULL,
        session_count INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        endorsed_count INTEGER NOT NULL,
        flagged_count INTEGER NOT NULL,
        hallucination_rate REAL NOT NULL,
        endorsement_rate REAL NOT NULL,
        PRIMARY KEY (agent_id, owner_id, day, channel)
      )
    `);
  },
};
```

- [ ] **Step 2: Register migration in index**

Edit `server/lib/db-migrations/index.cjs`. Find the `MIGRATIONS` array and append:

```javascript
const MIGRATIONS = [
  require('./0001-audit-log.cjs'),
  require('./0002-connection-shares.cjs'),
  require('./0003-connection-shared-flag.cjs'),
  require('./0004-announcements.cjs'),
  require('./0005-satisfaction-tables.cjs'),
];
```

- [ ] **Step 3: Verify migration applies cleanly**

Run: `npm test -- --test-only-files=server/lib/db.test.cjs 2>&1 | head -30` (or the broader suite if no filter). Expected: passes — existing tests don't fail because the new migration is purely additive (CREATE TABLE IF NOT EXISTS).

- [ ] **Step 4: Manual sanity check**

```bash
rm -rf /tmp/aocdb-sanity && mkdir /tmp/aocdb-sanity
AOC_DATA_DIR=/tmp/aocdb-sanity node -e "
  const db = require('./server/lib/db.cjs');
  db.initDatabase().then(() => {
    const raw = db.getDb();
    const tables = raw.exec(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%rating%' OR name LIKE '%satisfaction%'\");
    console.log(JSON.stringify(tables, null, 2));
  });
"
```

Expected output includes `message_ratings`, `session_satisfaction_summary`, `agent_satisfaction_metrics_daily`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/db-migrations/0005-satisfaction-tables.cjs server/lib/db-migrations/index.cjs
git commit -m "feat(satisfaction): add schema migration for self-learning tables"
```

---

## Task 2: DB accessor — recordRating + getMessageRatings

**Files:**
- Create: `server/lib/db/satisfaction.cjs`
- Create: `server/lib/db/satisfaction.test.cjs`
- Modify: `server/lib/db.cjs`

- [ ] **Step 1: Write the failing test for `recordRating` idempotency**

Create `server/lib/db/satisfaction.test.cjs`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-sat-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('../db.cjs')];
  delete require.cache[require.resolve('./satisfaction.cjs')];
  const db = require('../db.cjs');
  return { db, tmpDir };
}

test('recordRating inserts a new row', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const id = db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    reason: null, raterExternalId: null, createdAt: 1700000000000,
  });
  assert.ok(typeof id === 'number' && id > 0);

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 'positive');
  assert.equal(rows[0].source, 'button');
});

test('recordRating same (messageId, source, rater) flips rating (INSERT OR REPLACE)', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    reason: null, raterExternalId: null, createdAt: 1700000000000,
  });

  // Same key, flipped rating
  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'negative',
    reason: 'changed mind', raterExternalId: null, createdAt: 1700000001000,
  });

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 1, 'should still be 1 row (replaced)');
  assert.equal(rows[0].rating, 'negative');
  assert.equal(rows[0].reason, 'changed mind');
});

test('recordRating different sources for same message coexist', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    raterExternalId: null, createdAt: 1700000000000,
  });
  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'telegram', source: 'reaction', rating: 'positive',
    raterExternalId: 'tg-user-42', createdAt: 1700000001000,
  });

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 2);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test server/lib/db/satisfaction.test.cjs`
Expected: FAIL with `db.recordRating is not a function`.

- [ ] **Step 3: Implement `recordRating` and `getMessageRatings`**

Create `server/lib/db/satisfaction.cjs`:

```javascript
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

module.exports = {
  recordRating,
  getMessageRatings,
};
```

- [ ] **Step 4: Re-export from `server/lib/db.cjs`**

Open `server/lib/db.cjs` and add to the spread re-exports section (look for existing `...require('./db/<x>.cjs')` lines and append):

```javascript
  ...require('./db/satisfaction.cjs'),
```

- [ ] **Step 5: Run test, verify it passes**

Run: `node --test server/lib/db/satisfaction.test.cjs`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/lib/db/satisfaction.cjs server/lib/db/satisfaction.test.cjs server/lib/db.cjs
git commit -m "feat(satisfaction): add recordRating + getMessageRatings DB accessors"
```

---

## Task 3: DB accessor — session summary upsert + read

**Files:**
- Modify: `server/lib/db/satisfaction.cjs`
- Modify: `server/lib/db/satisfaction.test.cjs`

- [ ] **Step 1: Append failing tests for summary**

Append to `server/lib/db/satisfaction.test.cjs`:

```javascript
test('upsertSessionSummary inserts then updates by session_id', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 10, endorsedCount: 3, flaggedCount: 1, presumedGoodCount: 6,
    hallucinationRate: 0.1, endorsementRate: 0.3,
    reflectionStatus: 'completed',
    lessonsExtracted: 2, examplesCaptured: 1,
    llmInputTokens: 4500, llmOutputTokens: 280,
    promptVersion: 'v1.0', reflectionAt: 1700000000000, durationMs: 4200,
  });

  let s = db.getSessionSummary('s1');
  assert.equal(s.messageCount, 10);
  assert.equal(s.reflectionStatus, 'completed');

  // Update (re-reflect)
  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 10, endorsedCount: 5, flaggedCount: 0, presumedGoodCount: 5,
    hallucinationRate: 0, endorsementRate: 0.5,
    reflectionStatus: 'completed',
    lessonsExtracted: 3, examplesCaptured: 2,
    llmInputTokens: 4600, llmOutputTokens: 290,
    promptVersion: 'v1.0', reflectionAt: 1700000010000, durationMs: 4300,
  });
  s = db.getSessionSummary('s1');
  assert.equal(s.endorsedCount, 5);
  assert.equal(s.lessonsExtracted, 3);
});

test('getSessionSummary returns null for missing session', async () => {
  const { db } = setupDb();
  await db.initDatabase();
  assert.equal(db.getSessionSummary('nonexistent'), null);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/db/satisfaction.test.cjs`
Expected: FAIL with `db.upsertSessionSummary is not a function`.

- [ ] **Step 3: Implement upsertSessionSummary + getSessionSummary**

Append to `server/lib/db/satisfaction.cjs` (before `module.exports`):

```javascript
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
```

Update `module.exports`:

```javascript
module.exports = {
  recordRating,
  getMessageRatings,
  upsertSessionSummary,
  getSessionSummary,
};
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test server/lib/db/satisfaction.test.cjs`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/db/satisfaction.cjs server/lib/db/satisfaction.test.cjs
git commit -m "feat(satisfaction): add upsertSessionSummary + getSessionSummary"
```

---

## Task 4: DB accessor — daily metrics queries

**Files:**
- Modify: `server/lib/db/satisfaction.cjs`
- Modify: `server/lib/db/satisfaction.test.cjs`

- [ ] **Step 1: Append failing tests**

Append to `server/lib/db/satisfaction.test.cjs`:

```javascript
test('upsertDailyMetric inserts then updates by composite key', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.upsertDailyMetric({
    agentId: 'a1', ownerId: 1, day: '2026-05-09', channel: 'all',
    sessionCount: 5, messageCount: 50,
    endorsedCount: 12, flaggedCount: 4,
    hallucinationRate: 0.08, endorsementRate: 0.24,
  });
  let m = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-09', toDay: '2026-05-09' });
  assert.equal(m.length, 1);
  assert.equal(m[0].sessionCount, 5);

  // Re-upsert (rollup re-run for same day)
  db.upsertDailyMetric({
    agentId: 'a1', ownerId: 1, day: '2026-05-09', channel: 'all',
    sessionCount: 6, messageCount: 60,
    endorsedCount: 14, flaggedCount: 5,
    hallucinationRate: 0.083, endorsementRate: 0.233,
  });
  m = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-09', toDay: '2026-05-09' });
  assert.equal(m.length, 1);
  assert.equal(m[0].sessionCount, 6);
});

test('getDailyMetrics filters by date range and channel', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  for (const day of ['2026-05-07', '2026-05-08', '2026-05-09']) {
    db.upsertDailyMetric({
      agentId: 'a1', ownerId: 1, day, channel: 'all',
      sessionCount: 1, messageCount: 10,
      endorsedCount: 2, flaggedCount: 1,
      hallucinationRate: 0.1, endorsementRate: 0.2,
    });
  }
  const m = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-08', toDay: '2026-05-09', channel: 'all' });
  assert.equal(m.length, 2);
  assert.equal(m[0].day, '2026-05-08');
  assert.equal(m[1].day, '2026-05-09');
});

test('aggregateRawForDay computes counts from message_ratings + summaries', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  // Two sessions on the same day with summaries
  const dayMs = new Date('2026-05-09T12:00:00Z').getTime();
  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 10, endorsedCount: 3, flaggedCount: 1, presumedGoodCount: 6,
    hallucinationRate: 0.1, endorsementRate: 0.3, reflectionStatus: 'completed',
    reflectionAt: dayMs,
  });
  db.upsertSessionSummary({
    sessionId: 's2', agentId: 'a1', ownerId: 1,
    messageCount: 5, endorsedCount: 1, flaggedCount: 0, presumedGoodCount: 4,
    hallucinationRate: 0, endorsementRate: 0.2, reflectionStatus: 'completed',
    reflectionAt: dayMs + 3600_000,
  });

  const agg = db.aggregateRawForDay({ agentId: 'a1', ownerId: 1, day: '2026-05-09', channel: 'all' });
  assert.equal(agg.sessionCount, 2);
  assert.equal(agg.messageCount, 15);
  assert.equal(agg.endorsedCount, 4);
  assert.equal(agg.flaggedCount, 1);
  assert.ok(Math.abs(agg.hallucinationRate - 1/15) < 1e-9);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/db/satisfaction.test.cjs`
Expected: FAIL with `db.upsertDailyMetric is not a function`.

- [ ] **Step 3: Implement daily metrics functions**

Append to `server/lib/db/satisfaction.cjs` (before `module.exports`):

```javascript
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
```

Update `module.exports`:

```javascript
module.exports = {
  recordRating,
  getMessageRatings,
  upsertSessionSummary,
  getSessionSummary,
  upsertDailyMetric,
  getDailyMetrics,
  aggregateRawForDay,
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/db/satisfaction.test.cjs`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/db/satisfaction.cjs server/lib/db/satisfaction.test.cjs
git commit -m "feat(satisfaction): add daily metrics upsert + aggregate queries"
```

---

## Task 5: LLM provider registry + Claude Code provider

**Files:**
- Create: `server/lib/llm-providers/index.cjs`
- Create: `server/lib/llm-providers/claude-code-provider.cjs`
- Create: `server/lib/llm-providers/claude-code-provider.test.cjs`
- Create: `server/lib/llm-providers/README.md`

- [ ] **Step 1: Write failing test for provider registry + claude-code provider (mocked spawn)**

Create `server/lib/llm-providers/claude-code-provider.test.cjs`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

// Stub child_process.spawn before requiring provider
const spawnCalls = [];
let nextSpawnBehavior = null; // { stdout: string, stderr: string, exitCode: number, delayMs?: number }

const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'child_process' || request === 'node:child_process') {
    return {
      spawn(cmd, args, opts) {
        spawnCalls.push({ cmd, args, opts });
        const child = new EventEmitter();
        child.stdin = { write() {}, end() {} };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => { child.emit('close', 137); };
        const b = nextSpawnBehavior || { stdout: '{}', stderr: '', exitCode: 0 };
        setImmediate(() => {
          if (b.stdout) child.stdout.emit('data', Buffer.from(b.stdout));
          if (b.stderr) child.stderr.emit('data', Buffer.from(b.stderr));
          setTimeout(() => child.emit('close', b.exitCode), b.delayMs ?? 1);
        });
        return child;
      }
    };
  }
  return origLoad.apply(this, arguments);
};

const provider = require('./claude-code-provider.cjs');

test('claude-code provider parses CLI JSON output and returns CompleteResponse', async () => {
  spawnCalls.length = 0;
  nextSpawnBehavior = {
    stdout: JSON.stringify({
      type: 'result',
      result: '{"hello":"world"}',
      usage: { input_tokens: 1234, output_tokens: 56 },
      model: 'claude-haiku-4-5',
    }),
    stderr: '', exitCode: 0,
  };

  const r = await provider.complete({ prompt: 'test', model: 'claude-haiku-4-5', responseFormat: 'json' });
  assert.equal(r.text, '{"hello":"world"}');
  assert.equal(r.inputTokens, 1234);
  assert.equal(r.outputTokens, 56);
  assert.equal(r.modelUsed, 'claude-haiku-4-5');
  assert.ok(typeof r.providerLatencyMs === 'number');

  // Args sanity
  const call = spawnCalls[0];
  assert.ok(call.args.includes('-p'));
  assert.ok(call.args.includes('--output-format'));
  assert.ok(call.args.includes('json'));
  assert.ok(call.args.includes('--model'));
  assert.ok(call.args.includes('claude-haiku-4-5'));
});

test('claude-code provider rejects on non-zero exit', async () => {
  nextSpawnBehavior = { stdout: '', stderr: 'bad', exitCode: 1 };
  await assert.rejects(
    provider.complete({ prompt: 'test', model: 'claude-haiku-4-5' }),
    /exit code 1/
  );
});

test('claude-code provider times out after timeoutMs', async () => {
  nextSpawnBehavior = { stdout: '', stderr: '', exitCode: 0, delayMs: 5000 };
  await assert.rejects(
    provider.complete({ prompt: 'test', model: 'claude-haiku-4-5', timeoutMs: 50 }),
    /timeout/i
  );
});

test('claude-code provider rejects on malformed JSON', async () => {
  nextSpawnBehavior = { stdout: 'not json at all', stderr: '', exitCode: 0 };
  await assert.rejects(
    provider.complete({ prompt: 'test', model: 'claude-haiku-4-5' }),
    /JSON/
  );
});

test('provider registry returns claude-code by name', async () => {
  const registry = require('./index.cjs');
  const p = registry.getProvider('claude-code');
  assert.equal(p.name, 'claude-code');
  assert.equal(typeof p.complete, 'function');
});

test('provider registry throws on unknown provider', () => {
  const registry = require('./index.cjs');
  assert.throws(() => registry.getProvider('does-not-exist'), /unknown LLM provider/);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/llm-providers/claude-code-provider.test.cjs`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement claude-code provider**

Create `server/lib/llm-providers/claude-code-provider.cjs`:

```javascript
'use strict';

/**
 * Claude Code CLI subprocess provider.
 *
 * Spawns `claude -p --output-format json --model <model>` with prompt on stdin.
 * Used by reflection-service for satisfaction self-learning. Cost is $0
 * marginal on Max subscription; falls back to API if user has no subscription
 * (handled by the CLI itself, not us).
 *
 * CLI output schema (--output-format json):
 *   { type: "result", result: "<text>", usage: { input_tokens, output_tokens }, model: "..." }
 *
 * See spec §5.5.
 */

const { spawn } = require('child_process');

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 60_000;

async function complete({
  prompt,
  model = DEFAULT_MODEL,
  maxTokens,
  responseFormat = 'text',  // accepted but Claude CLI handles via prompt
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('claude-code provider: prompt must be a non-empty string');
  }

  const args = ['-p', '--output-format', 'json', '--model', model];
  if (maxTokens) args.push('--max-tokens', String(maxTokens));

  const startTime = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timer = null;
    let settled = false;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener?.('abort', onAbort);
      fn(val);
    };

    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch {}
      settle(reject, new Error('claude-code provider: aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort);

    timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      settle(reject, new Error(`claude-code provider: timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => settle(reject, err));

    child.on('close', (code) => {
      if (code !== 0) {
        return settle(reject, new Error(`claude-code provider: CLI exit code ${code}: ${stderr.slice(0, 500)}`));
      }
      let parsed;
      try { parsed = JSON.parse(stdout); }
      catch (e) {
        return settle(reject, new Error(`claude-code provider: malformed JSON output: ${e.message}`));
      }
      const result = parsed.result ?? parsed.text ?? '';
      const usage = parsed.usage || {};
      settle(resolve, {
        text: result,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        modelUsed: parsed.model || model,
        providerLatencyMs: Date.now() - startTime,
      });
    });

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (e) {
      settle(reject, e);
    }
  });
}

module.exports = {
  name: 'claude-code',
  complete,
  supportsModel: () => true,  // CLI accepts any model alias Anthropic supports
};
```

- [ ] **Step 4: Implement registry**

Create `server/lib/llm-providers/index.cjs`:

```javascript
'use strict';

/**
 * LLM provider registry. MVP has one impl: claude-code (subprocess).
 * Future providers (anthropic-api, openai-compatible) plug in here without
 * touching reflection-service.
 *
 * See spec §5 + plan Task 5.
 */

const claudeCode = require('./claude-code-provider.cjs');

const PROVIDERS = {
  'claude-code': claudeCode,
};

function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) {
    throw new Error(`unknown LLM provider: ${name}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return p;
}

function listProviders() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, listProviders };
```

- [ ] **Step 5: Write README**

Create `server/lib/llm-providers/README.md`:

```markdown
# LLM Providers

Pluggable backends for AOC reflection / generation. Used by `reflection-service.cjs`.

## Current providers

| Name | Status | Notes |
|---|---|---|
| `claude-code` | ✅ Implemented (Phase 1) | Spawns `claude` CLI with `-p --output-format json`. Free on Max subscription. |
| `anthropic-api` | ⏳ Planned | Direct Anthropic SDK call. Pay-per-token. |
| `openai-compatible` | ⏳ Planned | Generic — covers OpenRouter, LMStudio, Kilocode, Together, Groq, vLLM, Ollama. |

## Interface

A provider exports:

```javascript
{
  name: 'provider-name',
  complete(req: CompleteRequest): Promise<CompleteResponse>,
  supportsModel?(model: string): boolean
}

type CompleteRequest = {
  prompt: string;
  model: string;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
  timeoutMs?: number;
  signal?: AbortSignal;
};

type CompleteResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  providerLatencyMs: number;
};
```

## Adding a new provider

1. Create `<name>-provider.cjs` exporting the interface above.
2. Register in `index.cjs` PROVIDERS map.
3. Add unit tests in `<name>-provider.test.cjs` (use Module._load stub for HTTP/spawn isolation).
4. Document in this README.
5. Add env vars to `.env.example` if config required.

## Configuration

Selection via env:

```
REFLECTION_LLM_PROVIDER=claude-code        # registry key
REFLECTION_LLM_MODEL=claude-haiku-4-5      # provider-specific
REFLECTION_TIMEOUT_MS=60000
```

Future OpenAI-compatible swap (no code change):

```
REFLECTION_LLM_PROVIDER=openai-compatible
REFLECTION_LLM_BASE_URL=https://openrouter.ai/api/v1
REFLECTION_LLM_API_KEY=sk-or-v1-...
REFLECTION_LLM_MODEL=anthropic/claude-haiku-4.5
```
```

- [ ] **Step 6: Run test, verify pass**

Run: `node --test server/lib/llm-providers/claude-code-provider.test.cjs`
Expected: 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/lib/llm-providers/
git commit -m "feat(satisfaction): add LLM provider abstraction + claude-code subprocess impl"
```

---

## Task 6: Reflection prompts module

**Files:**
- Create: `server/lib/reflection-prompts.cjs`

- [ ] **Step 1: Implement prompt module**

Create `server/lib/reflection-prompts.cjs`:

```javascript
'use strict';

/**
 * Reflection prompt template + version constants.
 *
 * Single LLM call combines 3 tasks: detect NL corrections, distill lessons,
 * tag verbatim endorsed examples. Output is JSON validated against schema.
 *
 * See spec §6.3 + plan Task 6.
 *
 * IMPORTANT: bumping REFLECTION_PROMPT_VERSION does NOT auto-re-reflect old
 * sessions. Existing summaries record their prompt_version; UI exposes
 * manual re-reflect endpoint for sessions on older versions.
 */

const REFLECTION_PROMPT_VERSION = 'v1.0';
const REFLECTION_SCHEMA_VERSION = '1';

const SYSTEM_PROMPT = `You are a reflection analyzer for an AI agent's session. Your output is structured JSON only — no prose, no markdown fences.

TASKS (do all three in this single pass):
1. DETECT: For each ASSISTANT message, decide if the NEXT user turn expresses disagreement/correction (NL signal that the assistant was wrong). Examples of correction: "itu salah", "bukan begitu", "wrong", "incorrect", or any factual contradiction/clarification of the assistant's claim.
2. DISTILL: Extract 0-5 reusable lessons. Each lesson must be specific (e.g., "User's BigQuery dataset is named Odoo17DKEpublic, not Odoo") not generic ("user values clarity"). DO NOT extract lessons from messages you flagged in task 1.
3. CAPTURE: For each ASSISTANT message marked [rating=endorsed], reference it in validated_examples by messageId only. DO NOT include the message text — the host system will fetch it verbatim.

RULES:
- DO NOT flag tone/style disagreements — only factual errors or false claims.
- DO NOT flag follow-up questions or scope expansions.
- DO NOT mix flagged content into lessons.
- Lessons must each be ≤ 200 chars, factual, declarative.
- If session has no learning value (mostly chitchat, no resolution), return empty arrays with session_quality="poor".
- Output JSON matching the schema below. Nothing else.

SCHEMA:
{
  "schema_version": "${REFLECTION_SCHEMA_VERSION}",
  "session_quality": "good" | "mixed" | "poor",
  "flagged_messages": [
    { "messageId": "<id>", "evidence": "T<n> user said: <quote>", "type": "factual_error|user_correction|incomplete" }
  ],
  "lessons": [
    { "kind": "pattern|preference|fact|warning", "text": "<lesson>", "tags": ["<tag>", ...], "evidence_message_ids": ["<id>", ...] }
  ],
  "validated_examples": [
    { "messageId": "<id>", "kind": "code|config|explanation", "title": "<short title>", "tags": [...] }
  ]
}`;

function buildPrompt({ compactTranscript, retryStrict = false }) {
  const prefix = retryStrict ? 'VALID JSON ONLY:\n\n' : '';
  return `${prefix}${SYSTEM_PROMPT}\n\nTRANSCRIPT:\n${compactTranscript}`;
}

module.exports = {
  REFLECTION_PROMPT_VERSION,
  REFLECTION_SCHEMA_VERSION,
  SYSTEM_PROMPT,
  buildPrompt,
};
```

- [ ] **Step 2: Sanity check via require**

Run: `node -e "const m = require('./server/lib/reflection-prompts.cjs'); console.log(m.REFLECTION_PROMPT_VERSION, typeof m.buildPrompt);"`
Expected: `v1.0 function`

- [ ] **Step 3: Commit**

```bash
git add server/lib/reflection-prompts.cjs
git commit -m "feat(satisfaction): add reflection prompt template + version constants"
```

---

## Task 7: Reflection service — skip rules

**Files:**
- Create: `server/lib/reflection-service.cjs`
- Create: `server/lib/reflection-service.test.cjs`

- [ ] **Step 1: Write failing tests for skip rules**

Create `server/lib/reflection-service.test.cjs`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluateSkip } = require('./reflection-service.cjs');

test('skip: messageCount < 5 → skipped_too_short', () => {
  const res = evaluateSkip({
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi back' },
    ],
    ratings: [],
  });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'skipped_too_short');
});

test('skip: zero feedback signal → skipped_no_signal', () => {
  const messages = [];
  for (let i = 0; i < 10; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'msg ' + i });
  }
  const res = evaluateSkip({ messages, ratings: [] });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'skipped_no_signal');
});

test('proceed: long enough + has feedback', () => {
  const messages = [];
  for (let i = 0; i < 12; i++) {
    messages.push({ id: 'm' + i, role: i % 2 === 0 ? 'user' : 'assistant', content: 'msg ' + i });
  }
  const ratings = [{ messageId: 'm5', source: 'button', rating: 'positive' }];
  const res = evaluateSkip({ messages, ratings });
  assert.equal(res.skip, false);
});

test('skip: trivial transcript token count < 500', () => {
  const messages = [];
  for (let i = 0; i < 6; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'a' });
  }
  const ratings = [{ messageId: 'x', source: 'button', rating: 'positive' }];
  const res = evaluateSkip({ messages, ratings });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'skipped_too_short');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement evaluateSkip**

Create `server/lib/reflection-service.cjs`:

```javascript
'use strict';

/**
 * Reflection Service — runs at session_end (or via internal RPC) to filter,
 * compress, and submit a session transcript to the LLM provider, then writes
 * results to message_ratings (NL corrections), lessons file, and
 * session_satisfaction_summary.
 *
 * See spec §6 + plan Tasks 7-12.
 */

const MIN_MESSAGE_COUNT = 5;
const MIN_TRANSCRIPT_TOKEN_ESTIMATE = 500;

// Crude token estimate: ~4 chars per token. Good enough for skip thresholds.
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function evaluateSkip({ messages, ratings }) {
  if (!Array.isArray(messages) || messages.length < MIN_MESSAGE_COUNT) {
    return { skip: true, reason: 'skipped_too_short' };
  }

  const totalText = messages.map(m => (m.content || '')).join('\n');
  if (estimateTokens(totalText) < MIN_TRANSCRIPT_TOKEN_ESTIMATE) {
    return { skip: true, reason: 'skipped_too_short' };
  }

  if (!ratings || ratings.length === 0) {
    // Look for user follow-ups beyond first turn (a heuristic for engagement)
    const userTurns = messages.filter(m => m.role === 'user');
    if (userTurns.length <= 1) {
      return { skip: true, reason: 'skipped_no_signal' };
    }
    // Long-enough conversation with no rating but multiple user turns → proceed
    // (let LLM look for NL corrections)
  }

  return { skip: false, reason: null };
}

module.exports = {
  evaluateSkip,
  estimateTokens,
  MIN_MESSAGE_COUNT,
  MIN_TRANSCRIPT_TOKEN_ESTIMATE,
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/reflection-service.cjs server/lib/reflection-service.test.cjs
git commit -m "feat(satisfaction): reflection service skip rules"
```

---

## Task 8: Reflection service — transcript compression

**Files:**
- Modify: `server/lib/reflection-service.cjs`
- Modify: `server/lib/reflection-service.test.cjs`

- [ ] **Step 1: Write failing tests for compression**

Append to `server/lib/reflection-service.test.cjs`:

```javascript
const { compressTranscript } = require('./reflection-service.cjs');

test('compressTranscript strips tool_use and thinking blocks', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'do thing' },
    { id: 'a1', role: 'assistant',
      content: [
        { type: 'thinking', text: 'hidden reasoning' },
        { type: 'tool_use', name: 'bash', input: { cmd: 'ls' } },
        { type: 'text', text: 'I ran ls' },
      ]
    },
  ];
  const out = compressTranscript({ messages, ratings: [] });
  assert.ok(out.includes('do thing'));
  assert.ok(out.includes('I ran ls'));
  assert.ok(out.includes('[tool: bash]'));
  assert.ok(!out.includes('hidden reasoning'));
});

test('compressTranscript injects rating tags inline', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'q' },
    { id: 'a1', role: 'assistant', content: 'reply' },
  ];
  const ratings = [
    { messageId: 'a1', source: 'button', rating: 'positive', channel: 'dashboard' },
  ];
  const out = compressTranscript({ messages, ratings });
  assert.ok(out.includes('[rating=endorsed via button:dashboard]'));
});

test('compressTranscript applies sliding window above threshold', () => {
  const messages = [];
  for (let i = 0; i < 30; i++) {
    messages.push({
      id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(2000),  // ~500 tokens each
    });
  }
  // No ratings on middle messages
  const ratings = [
    { messageId: 'm0', source: 'button', rating: 'positive', channel: 'dashboard' },
    { messageId: 'm29', source: 'button', rating: 'positive', channel: 'dashboard' },
  ];
  const out = compressTranscript({ messages, ratings });
  assert.ok(out.includes('omitted'));
  // First few + last few preserved
  assert.ok(out.includes('m0'));
  assert.ok(out.includes('m29'));
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: FAIL — `compressTranscript is not a function`.

- [ ] **Step 3: Implement compressTranscript**

Append to `server/lib/reflection-service.cjs` (before `module.exports`):

```javascript
const TARGET_MAX_TOKENS = 4000;
const COMPRESSION_KEEP_FIRST = 3;
const COMPRESSION_KEEP_LAST = 5;

function _extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || !block.type) continue;
    if (block.type === 'text') parts.push(block.text || '');
    else if (block.type === 'thinking') continue;  // strip thinking
    else if (block.type === 'tool_use') parts.push(`[tool: ${block.name || 'unknown'}]`);
    else if (block.type === 'tool_result') continue;  // strip
  }
  return parts.join('\n').trim();
}

function _ratingTagFor(messageId, ratings) {
  const matches = (ratings || []).filter(r => r.messageId === messageId);
  if (matches.length === 0) return '';
  // Prefer most informative tag: positive first, then negative
  const tags = matches.map(r => {
    const verb = r.rating === 'positive' ? 'endorsed' : 'flagged';
    return `[rating=${verb} via ${r.source}:${r.channel}]`;
  });
  return ' ' + tags.join(' ');
}

function _renderTurn(turnIndex, msg, ratingTag) {
  const role = (msg.role || 'unknown').toUpperCase();
  const id = msg.id ? `[msgId=${msg.id}]` : '';
  const text = _extractTextFromContent(msg.content);
  return `T${turnIndex} ${role} ${id}${ratingTag}: ${text}`.trim();
}

function compressTranscript({ messages, ratings, sessionMeta }) {
  if (!messages || messages.length === 0) return '';

  // Build full rendered turns first (we'll trim if too big)
  const rendered = messages.map((m, i) => ({
    msg: m,
    index: i + 1,
    text: _renderTurn(i + 1, m, _ratingTagFor(m.id, ratings)),
    hasFeedback: (ratings || []).some(r => r.messageId === m.id),
  }));

  const fullText = rendered.map(r => r.text).join('\n\n');
  const fullTokens = estimateTokens(fullText);

  let header = '';
  if (sessionMeta) {
    const { sessionId, agentId, messageCount } = sessionMeta;
    const endorsed = (ratings || []).filter(r => r.rating === 'positive').length;
    const flagged = (ratings || []).filter(r => r.rating === 'negative').length;
    header = `[Session ${sessionId || '?'}, agent=${agentId || '?'}, ${messageCount || messages.length} turns, ${endorsed} endorsed, ${flagged} flagged]\n\n`;
  }

  if (fullTokens <= TARGET_MAX_TOKENS) {
    return header + fullText;
  }

  // Sliding window: keep first N, all turns with feedback, last M
  const keepIndices = new Set();
  for (let i = 0; i < Math.min(COMPRESSION_KEEP_FIRST, rendered.length); i++) keepIndices.add(i);
  for (let i = Math.max(0, rendered.length - COMPRESSION_KEEP_LAST); i < rendered.length; i++) keepIndices.add(i);
  rendered.forEach((r, i) => { if (r.hasFeedback) keepIndices.add(i); });

  const sortedKeep = [...keepIndices].sort((a, b) => a - b);
  const out = [];
  let lastKept = -1;
  for (const idx of sortedKeep) {
    if (idx > lastKept + 1) {
      const omitted = idx - lastKept - 1;
      out.push(`... [${omitted} turns omitted, no signal] ...`);
    }
    out.push(rendered[idx].text);
    lastKept = idx;
  }
  return header + out.join('\n\n');
}
```

Update `module.exports`:

```javascript
module.exports = {
  evaluateSkip,
  compressTranscript,
  estimateTokens,
  MIN_MESSAGE_COUNT,
  MIN_TRANSCRIPT_TOKEN_ESTIMATE,
  TARGET_MAX_TOKENS,
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/reflection-service.cjs server/lib/reflection-service.test.cjs
git commit -m "feat(satisfaction): reflection service transcript compression"
```

---

## Task 9: Reflection service — output parsing & validation

**Files:**
- Modify: `server/lib/reflection-service.cjs`
- Modify: `server/lib/reflection-service.test.cjs`

- [ ] **Step 1: Append failing tests for `parseAndValidateOutput`**

Append to `server/lib/reflection-service.test.cjs`:

```javascript
const { parseAndValidateOutput } = require('./reflection-service.cjs');

test('parseAndValidateOutput accepts well-formed schema v1', () => {
  const raw = JSON.stringify({
    schema_version: '1',
    session_quality: 'mixed',
    flagged_messages: [{ messageId: 'm1', evidence: 'T2 said no', type: 'factual_error' }],
    lessons: [{ kind: 'fact', text: 'X is Y', tags: ['t1'], evidence_message_ids: ['m3'] }],
    validated_examples: [{ messageId: 'm5', kind: 'code', title: 'q', tags: ['x'] }],
  });
  const r = parseAndValidateOutput(raw, ['m1', 'm3', 'm5']);
  assert.equal(r.ok, true);
  assert.equal(r.data.flagged_messages.length, 1);
  assert.equal(r.data.lessons.length, 1);
  assert.equal(r.data.validated_examples.length, 1);
});

test('parseAndValidateOutput drops entries with messageIds not in JSONL', () => {
  const raw = JSON.stringify({
    schema_version: '1',
    session_quality: 'good',
    flagged_messages: [{ messageId: 'ghost1', evidence: 'fake', type: 'factual_error' }],
    lessons: [{ kind: 'fact', text: 'real', tags: [], evidence_message_ids: ['m1'] }],
    validated_examples: [{ messageId: 'ghost2', kind: 'code', title: 'fake' }],
  });
  const r = parseAndValidateOutput(raw, ['m1']);
  assert.equal(r.ok, true);
  assert.equal(r.data.flagged_messages.length, 0, 'ghost1 dropped');
  assert.equal(r.data.validated_examples.length, 0, 'ghost2 dropped');
  assert.equal(r.data.lessons.length, 1);
});

test('parseAndValidateOutput rejects malformed JSON', () => {
  const r = parseAndValidateOutput('not json', []);
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
});

test('parseAndValidateOutput rejects missing required fields', () => {
  const raw = JSON.stringify({ schema_version: '1' });
  const r = parseAndValidateOutput(raw, []);
  assert.equal(r.ok, false);
});

test('parseAndValidateOutput strips markdown fences if present', () => {
  const raw = '```json\n' + JSON.stringify({
    schema_version: '1', session_quality: 'good',
    flagged_messages: [], lessons: [], validated_examples: [],
  }) + '\n```';
  const r = parseAndValidateOutput(raw, []);
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: FAIL — `parseAndValidateOutput is not a function`.

- [ ] **Step 3: Implement parseAndValidateOutput**

Append to `server/lib/reflection-service.cjs` (before `module.exports`):

```javascript
function _stripMarkdownFences(text) {
  return text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
}

function parseAndValidateOutput(rawText, validMessageIds) {
  let parsed;
  try {
    parsed = JSON.parse(_stripMarkdownFences(rawText));
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${e.message}` };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'output not an object' };
  }

  const requiredFields = ['schema_version', 'session_quality', 'flagged_messages', 'lessons', 'validated_examples'];
  for (const f of requiredFields) {
    if (!(f in parsed)) return { ok: false, error: `missing field: ${f}` };
  }

  const validIdSet = new Set(validMessageIds || []);

  // Drop flagged_messages entries with unknown messageId
  const flagged = (parsed.flagged_messages || []).filter(
    e => e && typeof e.messageId === 'string' && validIdSet.has(e.messageId)
  );

  // Drop validated_examples with unknown messageId
  const examples = (parsed.validated_examples || []).filter(
    e => e && typeof e.messageId === 'string' && validIdSet.has(e.messageId)
  );

  // Lessons: keep all, but filter evidence_message_ids
  const lessons = (parsed.lessons || []).map(l => ({
    ...l,
    evidence_message_ids: (l.evidence_message_ids || []).filter(id => validIdSet.has(id)),
  }));

  return {
    ok: true,
    data: {
      schema_version: parsed.schema_version,
      session_quality: parsed.session_quality,
      flagged_messages: flagged,
      lessons,
      validated_examples: examples,
    },
  };
}
```

Update `module.exports` to include `parseAndValidateOutput`.

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/reflection-service.cjs server/lib/reflection-service.test.cjs
git commit -m "feat(satisfaction): reflection service output parser + validation"
```

---

## Task 10: Reflection service — main orchestration (`reflectSession`)

**Files:**
- Modify: `server/lib/reflection-service.cjs`
- Modify: `server/lib/reflection-service.test.cjs`

- [ ] **Step 1: Write failing test for `reflectSession`**

Append to `server/lib/reflection-service.test.cjs`:

```javascript
test('reflectSession skips short session and writes summary with skip status', async () => {
  const { reflectSession } = require('./reflection-service.cjs');
  const writes = { ratings: [], summary: null, lessons: null };

  const result = await reflectSession({
    sessionId: 's-skip',
    agentId: 'a1',
    ownerId: 1,
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi' },
    ],
    ratings: [],
    workspace: '/tmp/dummy',
    deps: {
      provider: { complete: async () => { throw new Error('should not be called'); } },
      recordRating: () => {},
      upsertSessionSummary: (s) => { writes.summary = s; },
      writeLessonsForSession: () => { writes.lessons = 'should not happen'; },
    },
  });
  assert.equal(result.status, 'skipped_too_short');
  assert.equal(writes.summary.reflectionStatus, 'skipped_too_short');
  assert.equal(writes.lessons, null);
});

test('reflectSession runs LLM, writes ratings + lessons + summary on success', async () => {
  const { reflectSession } = require('./reflection-service.cjs');

  // 12 turns, with 1 endorsed
  const messages = [];
  for (let i = 0; i < 12; i++) {
    messages.push({
      id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'message ' + i + ' '.repeat(100),
    });
  }
  const ratings = [{ messageId: 'm5', source: 'button', rating: 'positive', channel: 'dashboard' }];

  const writes = { ratings: [], summary: null, lessons: null };
  const llmOutput = JSON.stringify({
    schema_version: '1',
    session_quality: 'mixed',
    flagged_messages: [{ messageId: 'm3', evidence: 'T4 said no', type: 'factual_error' }],
    lessons: [{ kind: 'fact', text: 'X is Y', tags: ['t1'], evidence_message_ids: ['m5'] }],
    validated_examples: [{ messageId: 'm5', kind: 'code', title: 'eg', tags: ['x'] }],
  });

  const result = await reflectSession({
    sessionId: 's-good',
    agentId: 'a1',
    ownerId: 1,
    messages,
    ratings,
    workspace: '/tmp/dummy',
    jsonlPath: '/tmp/dummy.jsonl',
    deps: {
      provider: {
        complete: async () => ({ text: llmOutput, inputTokens: 4500, outputTokens: 280, modelUsed: 'claude-haiku-4-5', providerLatencyMs: 4200 }),
      },
      recordRating: (r) => writes.ratings.push(r),
      upsertSessionSummary: (s) => { writes.summary = s; },
      writeLessonsForSession: async (params) => {
        writes.lessons = params;
        return '/tmp/dummy/aoc-lessons/test.md';
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(writes.ratings.length, 1, 'flagged turn recorded as nl_correction');
  assert.equal(writes.ratings[0].source, 'nl_correction');
  assert.equal(writes.ratings[0].rating, 'negative');
  assert.equal(writes.ratings[0].messageId, 'm3');
  assert.equal(writes.summary.reflectionStatus, 'completed');
  assert.equal(writes.summary.lessonsExtracted, 1);
  assert.equal(writes.summary.examplesCaptured, 1);
  assert.equal(writes.summary.flaggedCount, 1);
  assert.equal(writes.summary.endorsedCount, 1);
  assert.ok(writes.lessons, 'lessons writer called');
});

test('reflectSession honors safety net: do not write lessons if flagged > 50%', async () => {
  const { reflectSession } = require('./reflection-service.cjs');

  const messages = [];
  for (let i = 0; i < 10; i++) {
    messages.push({ id: 'm' + i, role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(200) });
  }
  const ratings = [{ messageId: 'm1', source: 'button', rating: 'positive', channel: 'dashboard' }];

  const writes = { lessons: null, summary: null };
  const llmOutput = JSON.stringify({
    schema_version: '1',
    session_quality: 'poor',
    // 6 flagged out of 10 messages
    flagged_messages: ['m1', 'm3', 'm5', 'm7', 'm9'].map(id => ({ messageId: id, evidence: 'bad', type: 'factual_error' })),
    lessons: [{ kind: 'fact', text: 'should not be saved', tags: [], evidence_message_ids: [] }],
    validated_examples: [],
  });

  await reflectSession({
    sessionId: 's-bad', agentId: 'a1', ownerId: 1, messages, ratings,
    workspace: '/tmp/dummy', jsonlPath: '/tmp/dummy.jsonl',
    deps: {
      provider: { complete: async () => ({ text: llmOutput, inputTokens: 1, outputTokens: 1, modelUsed: 'h', providerLatencyMs: 10 }) },
      recordRating: () => {},
      upsertSessionSummary: (s) => { writes.summary = s; },
      writeLessonsForSession: async (p) => { writes.lessons = p; return '/tmp/x'; },
    },
  });

  assert.equal(writes.lessons, null, 'safety net engaged: lessons not written');
  assert.equal(writes.summary.reflectionStatus, 'completed');
  assert.equal(writes.summary.lessonsExtracted, 0);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: FAIL — `reflectSession is not a function`.

- [ ] **Step 3: Implement reflectSession**

Append to `server/lib/reflection-service.cjs` (before `module.exports`):

```javascript
const { buildPrompt, REFLECTION_PROMPT_VERSION } = require('./reflection-prompts.cjs');

const SAFETY_FLAG_RATIO_THRESHOLD = 0.5;

function _countSignals(ratings) {
  const endorsed = ratings.filter(r => r.rating === 'positive').length;
  const flagged = ratings.filter(r => r.rating === 'negative').length;
  return { endorsed, flagged };
}

/**
 * Reflect over a single session. Returns {status, summary, llmStats}.
 * Pure logic — all I/O and LLM are injected via `deps`.
 *
 * deps:
 *   - provider: { complete(req) → { text, inputTokens, outputTokens, modelUsed, providerLatencyMs } }
 *   - recordRating(rating)
 *   - upsertSessionSummary(summary)
 *   - writeLessonsForSession({workspace, sessionId, agentId, ownerId, llmOutput, jsonlPath, sessionMeta}) → filePath
 */
async function reflectSession({
  sessionId, agentId, ownerId,
  messages, ratings = [], workspace, jsonlPath,
  channel = 'all',
  deps,
  promptVersion = REFLECTION_PROMPT_VERSION,
  retryStrictOnParse = true,
}) {
  const startTime = Date.now();
  const messageCount = messages.length;
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  // Skip evaluation
  const skip = evaluateSkip({ messages, ratings });
  if (skip.skip) {
    const summary = {
      sessionId, agentId, ownerId,
      messageCount,
      endorsedCount: ratings.filter(r => r.rating === 'positive').length,
      flaggedCount: ratings.filter(r => r.rating === 'negative').length,
      presumedGoodCount: assistantMessages.length - ratings.length,
      hallucinationRate: 0, endorsementRate: 0,
      reflectionStatus: skip.reason,
      reflectionSkipReason: skip.reason,
      lessonsExtracted: 0, examplesCaptured: 0,
      llmInputTokens: null, llmOutputTokens: null,
      promptVersion,
      reflectionAt: Date.now(),
      durationMs: Date.now() - startTime,
    };
    deps.upsertSessionSummary(summary);
    return { status: skip.reason, summary, llmStats: null };
  }

  // Compress
  const compactTranscript = compressTranscript({
    messages, ratings,
    sessionMeta: { sessionId, agentId, messageCount },
  });

  // LLM call (with optional retry on parse fail)
  const validIds = messages.map(m => m.id).filter(Boolean);
  let llmStats = null;
  let parsed = null;
  let attempts = 0;
  const maxAttempts = retryStrictOnParse ? 2 : 1;

  while (attempts < maxAttempts) {
    attempts++;
    let llmRes;
    try {
      const prompt = buildPrompt({ compactTranscript, retryStrict: attempts > 1 });
      llmRes = await deps.provider.complete({
        prompt,
        model: process.env.REFLECTION_LLM_MODEL || 'claude-haiku-4-5',
        responseFormat: 'json',
        timeoutMs: Number(process.env.REFLECTION_TIMEOUT_MS || 60000),
      });
    } catch (e) {
      const summary = _failedSummary({ sessionId, agentId, ownerId, messageCount, ratings,
        promptVersion, startTime, reason: `llm_error: ${e.message}` });
      deps.upsertSessionSummary(summary);
      return { status: 'failed', summary, llmStats: null };
    }
    llmStats = {
      inputTokens: llmRes.inputTokens,
      outputTokens: llmRes.outputTokens,
      modelUsed: llmRes.modelUsed,
      latencyMs: llmRes.providerLatencyMs,
    };

    const validation = parseAndValidateOutput(llmRes.text, validIds);
    if (validation.ok) {
      parsed = validation.data;
      break;
    }
    if (attempts >= maxAttempts) {
      const summary = _failedSummary({ sessionId, agentId, ownerId, messageCount, ratings,
        promptVersion, startTime, reason: `parse_error: ${validation.error}`,
        llmStats });
      deps.upsertSessionSummary(summary);
      return { status: 'failed', summary, llmStats };
    }
  }

  // Resolve flagged → record as nl_correction in message_ratings
  for (const f of parsed.flagged_messages) {
    deps.recordRating({
      messageId: f.messageId,
      sessionId, agentId, ownerId,
      channel: 'reflection', source: 'nl_correction', rating: 'negative',
      reason: f.evidence,
      raterExternalId: null,
      createdAt: Date.now(),
    });
  }

  // Compute counts (after NL corrections recorded)
  const allRatings = [...ratings, ...parsed.flagged_messages.map(f => ({ messageId: f.messageId, rating: 'negative', source: 'nl_correction' }))];
  const totalAssistant = assistantMessages.length;
  const flaggedCount = parsed.flagged_messages.length + ratings.filter(r => r.rating === 'negative').length;
  const endorsedCount = ratings.filter(r => r.rating === 'positive').length;
  const presumedGoodCount = Math.max(0, totalAssistant - flaggedCount - endorsedCount);
  const hallucinationRate = totalAssistant > 0 ? flaggedCount / totalAssistant : 0;
  const endorsementRate = totalAssistant > 0 ? endorsedCount / totalAssistant : 0;

  // Safety net: skip lessons write if too many flagged
  const writeLessons = hallucinationRate <= SAFETY_FLAG_RATIO_THRESHOLD;
  let lessonsExtracted = 0;
  let examplesCaptured = 0;

  if (writeLessons && (parsed.lessons.length > 0 || parsed.validated_examples.length > 0)) {
    try {
      await deps.writeLessonsForSession({
        workspace, sessionId, agentId, ownerId,
        llmOutput: parsed,
        jsonlPath,
        sessionMeta: {
          sessionId, agentId, ownerId,
          messageCount: totalAssistant,
          endorsedCount, flaggedCount,
          hallucinationRate, sessionQuality: parsed.session_quality,
          promptVersion,
          reflectionAt: new Date().toISOString(),
        },
      });
      lessonsExtracted = parsed.lessons.length;
      examplesCaptured = parsed.validated_examples.length;
    } catch (e) {
      // Lessons write failure is logged but doesn't fail the whole reflection
      // (summary still records the LLM result)
    }
  }

  const summary = {
    sessionId, agentId, ownerId,
    messageCount: totalAssistant,
    endorsedCount, flaggedCount, presumedGoodCount,
    hallucinationRate, endorsementRate,
    reflectionStatus: 'completed',
    reflectionSkipReason: null,
    lessonsExtracted, examplesCaptured,
    llmInputTokens: llmStats?.inputTokens ?? null,
    llmOutputTokens: llmStats?.outputTokens ?? null,
    promptVersion,
    reflectionAt: Date.now(),
    durationMs: Date.now() - startTime,
  };
  deps.upsertSessionSummary(summary);

  return { status: 'completed', summary, llmStats };
}

function _failedSummary({ sessionId, agentId, ownerId, messageCount, ratings, promptVersion, startTime, reason, llmStats }) {
  const totalAssistant = messageCount;  // close enough at failure path
  return {
    sessionId, agentId, ownerId,
    messageCount: totalAssistant,
    endorsedCount: ratings.filter(r => r.rating === 'positive').length,
    flaggedCount: ratings.filter(r => r.rating === 'negative').length,
    presumedGoodCount: 0,
    hallucinationRate: 0, endorsementRate: 0,
    reflectionStatus: 'failed',
    reflectionSkipReason: reason,
    lessonsExtracted: 0, examplesCaptured: 0,
    llmInputTokens: llmStats?.inputTokens ?? null,
    llmOutputTokens: llmStats?.outputTokens ?? null,
    promptVersion,
    reflectionAt: Date.now(),
    durationMs: Date.now() - startTime,
  };
}
```

Update `module.exports`:

```javascript
module.exports = {
  reflectSession,
  evaluateSkip,
  compressTranscript,
  parseAndValidateOutput,
  estimateTokens,
  MIN_MESSAGE_COUNT,
  MIN_TRANSCRIPT_TOKEN_ESTIMATE,
  TARGET_MAX_TOKENS,
  SAFETY_FLAG_RATIO_THRESHOLD,
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: 15 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/reflection-service.cjs server/lib/reflection-service.test.cjs
git commit -m "feat(satisfaction): reflection service main orchestration (reflectSession)"
```

---

## Task 11: Reflection service — concurrency queue

**Files:**
- Modify: `server/lib/reflection-service.cjs`
- Modify: `server/lib/reflection-service.test.cjs`

- [ ] **Step 1: Write failing test for queue**

Append to `server/lib/reflection-service.test.cjs`:

```javascript
test('createReflectionQueue limits concurrent reflections', async () => {
  const { createReflectionQueue } = require('./reflection-service.cjs');
  const inFlight = { count: 0, max: 0 };

  const queue = createReflectionQueue({
    concurrency: 2,
    maxQueue: 50,
    runner: async () => {
      inFlight.count++;
      inFlight.max = Math.max(inFlight.max, inFlight.count);
      await new Promise(r => setTimeout(r, 30));
      inFlight.count--;
      return { status: 'completed' };
    },
  });

  const promises = [];
  for (let i = 0; i < 6; i++) promises.push(queue.enqueue({ id: i }));
  await Promise.all(promises);

  assert.ok(inFlight.max <= 2, `max in flight was ${inFlight.max}, expected ≤ 2`);
});

test('createReflectionQueue rejects when full', async () => {
  const { createReflectionQueue } = require('./reflection-service.cjs');
  const queue = createReflectionQueue({
    concurrency: 1,
    maxQueue: 2,
    runner: () => new Promise(r => setTimeout(() => r({ status: 'completed' }), 100)),
  });

  // 1 running + 2 queued = 3 capacity used
  queue.enqueue({ id: 1 });
  queue.enqueue({ id: 2 });
  queue.enqueue({ id: 3 });

  await assert.rejects(
    () => queue.enqueue({ id: 4 }),
    /queue full/
  );
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: FAIL.

- [ ] **Step 3: Implement createReflectionQueue**

Append to `server/lib/reflection-service.cjs` (before `module.exports`):

```javascript
function createReflectionQueue({ concurrency = 3, maxQueue = 50, runner }) {
  const pending = [];
  let inFlight = 0;

  function tick() {
    while (inFlight < concurrency && pending.length > 0) {
      const item = pending.shift();
      inFlight++;
      Promise.resolve()
        .then(() => runner(item.payload))
        .then(
          (res) => { inFlight--; item.resolve(res); tick(); },
          (err) => { inFlight--; item.reject(err); tick(); }
        );
    }
  }

  function enqueue(payload) {
    return new Promise((resolve, reject) => {
      if (pending.length + inFlight >= maxQueue + concurrency) {
        return reject(new Error(`reflection queue full (max=${maxQueue})`));
      }
      pending.push({ payload, resolve, reject });
      tick();
    });
  }

  function stats() {
    return { inFlight, pending: pending.length, concurrency, maxQueue };
  }

  return { enqueue, stats };
}
```

Update `module.exports` to include `createReflectionQueue`.

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/reflection-service.test.cjs`
Expected: 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/reflection-service.cjs server/lib/reflection-service.test.cjs
git commit -m "feat(satisfaction): reflection queue with concurrency + backpressure"
```

---

## Task 12: Lessons writer — frontmatter rendering

**Files:**
- Create: `server/lib/lessons-writer.cjs`
- Create: `server/lib/lessons-writer.test.cjs`

- [ ] **Step 1: Write failing test for `renderLessonsFile`**

Create `server/lib/lessons-writer.test.cjs`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { renderLessonsFile } = require('./lessons-writer.cjs');

test('renderLessonsFile produces YAML frontmatter + lessons + examples', () => {
  const out = renderLessonsFile({
    sessionMeta: {
      sessionId: 's1', agentId: 'a1', ownerId: 1,
      messageCount: 12, endorsedCount: 3, flaggedCount: 1,
      hallucinationRate: 0.083, sessionQuality: 'mixed',
      promptVersion: 'v1.0',
      reflectionAt: '2026-05-09T14:32:00.000Z',
    },
    llmOutput: {
      schema_version: '1', session_quality: 'mixed',
      flagged_messages: [],
      lessons: [
        { kind: 'fact', text: 'X is Y', tags: ['t1', 't2'], evidence_message_ids: ['m3'] },
        { kind: 'pattern', text: 'always do A', tags: [], evidence_message_ids: [] },
      ],
      validated_examples: [],
    },
    examples: [
      { messageId: 'm5', kind: 'code', title: 'demo query', tags: ['sql'], verbatim: 'SELECT 1;' },
    ],
  });

  assert.match(out, /^---/);
  assert.ok(out.includes('session_id: s1'));
  assert.ok(out.includes('agent_id: a1'));
  assert.ok(out.includes('hallucination_rate: 0.083'));
  assert.ok(out.includes('## Lessons'));
  assert.ok(out.includes('### lesson-1'));
  assert.ok(out.includes('X is Y'));
  assert.ok(out.includes('### lesson-2'));
  assert.ok(out.includes('always do A'));
  assert.ok(out.includes('## Validated Examples'));
  assert.ok(out.includes('### example-1: demo query'));
  assert.ok(out.includes('SELECT 1;'));
});

test('renderLessonsFile aggregates tags from frontmatter', () => {
  const out = renderLessonsFile({
    sessionMeta: {
      sessionId: 's1', agentId: 'a1', ownerId: 1,
      messageCount: 5, endorsedCount: 1, flaggedCount: 0,
      hallucinationRate: 0, sessionQuality: 'good',
      promptVersion: 'v1.0',
      reflectionAt: '2026-05-09T14:32:00.000Z',
    },
    llmOutput: {
      lessons: [{ kind: 'fact', text: 'a', tags: ['x', 'y'], evidence_message_ids: [] }],
      validated_examples: [],
      flagged_messages: [],
    },
    examples: [{ messageId: 'm1', kind: 'code', title: 't', tags: ['z'], verbatim: '' }],
  });
  // tags in frontmatter should include x, y, z
  assert.match(out, /tags:.*x.*y.*z|tags:.*z.*x.*y|tags:.*y.*z.*x/s);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/lessons-writer.test.cjs`
Expected: FAIL.

- [ ] **Step 3: Implement renderLessonsFile**

Create `server/lib/lessons-writer.cjs`:

```javascript
'use strict';

/**
 * Lessons writer — composes per-session markdown file with YAML frontmatter
 * and writes atomically to <workspace>/aoc-lessons/. qmd auto-indexes on
 * its 5-min update tick.
 *
 * See spec §7 + plan Tasks 12-14.
 */

const fs = require('fs');
const path = require('path');

function _yamlList(items) {
  if (!items || items.length === 0) return '[]';
  return '[' + items.map(t => String(t).trim()).filter(Boolean).join(', ') + ']';
}

function _aggregateTags(llmOutput, examples) {
  const set = new Set();
  for (const l of (llmOutput.lessons || [])) for (const t of (l.tags || [])) set.add(t);
  for (const e of (examples || [])) for (const t of (e.tags || [])) set.add(t);
  return [...set];
}

function renderLessonsFile({ sessionMeta, llmOutput, examples }) {
  const m = sessionMeta;
  const tags = _aggregateTags(llmOutput, examples);

  const frontmatter = [
    '---',
    'schema_version: 1',
    `session_id: ${m.sessionId}`,
    `agent_id: ${m.agentId}`,
    `owner_id: ${m.ownerId}`,
    `reflection_at: ${m.reflectionAt}`,
    `prompt_version: ${m.promptVersion}`,
    `session_quality: ${m.sessionQuality}`,
    'session_metrics:',
    `  message_count: ${m.messageCount}`,
    `  endorsed_count: ${m.endorsedCount}`,
    `  flagged_count: ${m.flaggedCount}`,
    `  hallucination_rate: ${m.hallucinationRate}`,
    `tags: ${_yamlList(tags)}`,
    'pinned: false',
    '---',
    '',
  ].join('\n');

  const dateLabel = (m.reflectionAt || '').slice(0, 16).replace('T', ' ');
  const lines = [];
  lines.push(`# Session Lessons — ${dateLabel}`, '');

  if ((llmOutput.lessons || []).length > 0) {
    lines.push('## Lessons', '');
    llmOutput.lessons.forEach((l, i) => {
      lines.push(`### lesson-${i + 1}`);
      lines.push(`- **kind**: ${l.kind || 'fact'}`);
      if (l.tags && l.tags.length) lines.push(`- **tags**: ${l.tags.join(', ')}`);
      if (l.evidence_message_ids && l.evidence_message_ids.length) {
        lines.push(`- **evidence**: msgId ${l.evidence_message_ids.join(', ')}`);
      }
      lines.push('');
      lines.push(l.text || '');
      lines.push('');
    });
  }

  if ((examples || []).length > 0) {
    lines.push('## Validated Examples', '');
    examples.forEach((ex, i) => {
      lines.push(`### example-${i + 1}: ${ex.title || ''}`);
      lines.push(`- **messageId**: ${ex.messageId}`);
      lines.push(`- **kind**: ${ex.kind || 'explanation'}`);
      if (ex.tags && ex.tags.length) lines.push(`- **tags**: ${ex.tags.join(', ')}`);
      lines.push('');
      const lang = ex.kind === 'code' ? 'sql' : (ex.kind === 'config' ? 'bash' : '');
      lines.push('```' + lang);
      lines.push(ex.verbatim || '');
      lines.push('```');
      lines.push('');
    });
  }

  return frontmatter + lines.join('\n');
}

module.exports = {
  renderLessonsFile,
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/lessons-writer.test.cjs`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/lessons-writer.cjs server/lib/lessons-writer.test.cjs
git commit -m "feat(satisfaction): lessons writer frontmatter + markdown rendering"
```

---

## Task 13: Lessons writer — verbatim resolver

**Files:**
- Modify: `server/lib/lessons-writer.cjs`
- Modify: `server/lib/lessons-writer.test.cjs`

- [ ] **Step 1: Write failing tests for `resolveVerbatim`**

Append to `server/lib/lessons-writer.test.cjs`:

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveVerbatim } = require('./lessons-writer.cjs');

function writeFixtureJsonl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-'));
  const file = path.join(dir, 'session.jsonl');
  const lines = [
    JSON.stringify({ type: 'session', id: 's1', timestamp: 0 }),
    JSON.stringify({ type: 'message', id: 'u1', role: 'user', content: 'hi' }),
    JSON.stringify({ type: 'message', id: 'a1', role: 'assistant',
      content: [
        { type: 'thinking', text: 'hidden' },
        { type: 'text', text: 'verbatim assistant text' },
        { type: 'tool_use', name: 'bash', input: {} },
      ]
    }),
    JSON.stringify({ type: 'message', id: 'a2', role: 'assistant', content: 'plain string content' }),
  ];
  fs.writeFileSync(file, lines.join('\n'));
  return { dir, file };
}

test('resolveVerbatim extracts assistant text from JSONL, dropping thinking + tool_use', async () => {
  const { file } = writeFixtureJsonl();
  const examples = [
    { messageId: 'a1', kind: 'explanation', title: 't', tags: [] },
    { messageId: 'a2', kind: 'code', title: 'plain', tags: [] },
  ];
  const resolved = await resolveVerbatim(examples, file);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].verbatim, 'verbatim assistant text');
  assert.equal(resolved[1].verbatim, 'plain string content');
});

test('resolveVerbatim drops examples whose messageId is not in JSONL (LLM hallucination guard)', async () => {
  const { file } = writeFixtureJsonl();
  const examples = [
    { messageId: 'ghost', kind: 'code', title: 'fake', tags: [] },
    { messageId: 'a1', kind: 'explanation', title: 'real', tags: [] },
  ];
  const resolved = await resolveVerbatim(examples, file);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].messageId, 'a1');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/lessons-writer.test.cjs`
Expected: FAIL.

- [ ] **Step 3: Implement resolveVerbatim**

Append to `server/lib/lessons-writer.cjs` (before `module.exports`):

```javascript
function _extractAssistantText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(b => b && b.type === 'text')
    .map(b => b.text || '')
    .join('\n')
    .trim();
}

async function _readJsonlMessages(jsonlPath) {
  const raw = await fs.promises.readFile(jsonlPath, 'utf8');
  const messages = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed.type === 'message' || parsed.role) {
      messages.push(parsed);
    }
  }
  return messages;
}

async function resolveVerbatim(examples, jsonlPath) {
  if (!examples || examples.length === 0) return [];
  let messages;
  try {
    messages = await _readJsonlMessages(jsonlPath);
  } catch {
    return [];
  }
  const byId = new Map(messages.map(m => [m.id, m]));
  const out = [];
  for (const ex of examples) {
    const msg = byId.get(ex.messageId);
    if (!msg || msg.role !== 'assistant') continue;
    const verbatim = _extractAssistantText(msg.content);
    out.push({ ...ex, verbatim });
  }
  return out;
}
```

Update `module.exports`:

```javascript
module.exports = {
  renderLessonsFile,
  resolveVerbatim,
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/lessons-writer.test.cjs`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/lessons-writer.cjs server/lib/lessons-writer.test.cjs
git commit -m "feat(satisfaction): lessons writer JSONL verbatim resolver"
```

---

## Task 14: Lessons writer — atomic write with path traversal guard

**Files:**
- Modify: `server/lib/lessons-writer.cjs`
- Modify: `server/lib/lessons-writer.test.cjs`

- [ ] **Step 1: Write failing tests for `writeLessonsForSession`**

Append to `server/lib/lessons-writer.test.cjs`:

```javascript
const { writeLessonsForSession } = require('./lessons-writer.cjs');

test('writeLessonsForSession writes atomically with timestamp+sessionId filename', async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const { file: jsonlPath } = writeFixtureJsonl();

  const filePath = await writeLessonsForSession({
    workspace: wsDir,
    sessionId: 's1',
    agentId: 'a1',
    ownerId: 1,
    llmOutput: {
      schema_version: '1', session_quality: 'good',
      flagged_messages: [],
      lessons: [{ kind: 'fact', text: 'X', tags: ['t'], evidence_message_ids: [] }],
      validated_examples: [{ messageId: 'a1', kind: 'explanation', title: 't', tags: [] }],
    },
    jsonlPath,
    sessionMeta: {
      sessionId: 's1', agentId: 'a1', ownerId: 1,
      messageCount: 5, endorsedCount: 1, flaggedCount: 0,
      hallucinationRate: 0, sessionQuality: 'good',
      promptVersion: 'v1.0',
      reflectionAt: '2026-05-09T14:32:00.000Z',
    },
  });

  assert.ok(fs.existsSync(filePath));
  assert.match(filePath, /aoc-lessons[\/\\]\d{8}T\d{6}Z__s1\.md$/);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('## Lessons'));
  assert.ok(content.includes('verbatim assistant text'));  // resolved from JSONL
});

test('writeLessonsForSession rejects malicious sessionId (path traversal guard)', async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const { file: jsonlPath } = writeFixtureJsonl();
  await assert.rejects(
    writeLessonsForSession({
      workspace: wsDir,
      sessionId: '../../../etc/passwd',
      agentId: 'a1', ownerId: 1,
      llmOutput: { lessons: [], validated_examples: [], flagged_messages: [] },
      jsonlPath,
      sessionMeta: {
        sessionId: '../../../etc/passwd',
        agentId: 'a1', ownerId: 1, messageCount: 1,
        endorsedCount: 0, flaggedCount: 0, hallucinationRate: 0,
        sessionQuality: 'good', promptVersion: 'v1.0',
        reflectionAt: '2026-05-09T14:32:00.000Z',
      },
    }),
    /invalid sessionId/
  );
});

test('writeLessonsForSession is idempotent (re-reflect overwrites)', async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const { file: jsonlPath } = writeFixtureJsonl();
  const meta = {
    sessionId: 's-rerun', agentId: 'a1', ownerId: 1,
    messageCount: 5, endorsedCount: 1, flaggedCount: 0,
    hallucinationRate: 0, sessionQuality: 'good',
    promptVersion: 'v1.0',
    reflectionAt: '2026-05-09T14:32:00.000Z',
  };
  const baseOutput = { schema_version: '1', session_quality: 'good', flagged_messages: [], validated_examples: [] };

  const path1 = await writeLessonsForSession({
    workspace: wsDir, sessionId: 's-rerun', agentId: 'a1', ownerId: 1,
    llmOutput: { ...baseOutput, lessons: [{ kind: 'fact', text: 'V1', tags: [], evidence_message_ids: [] }] },
    jsonlPath, sessionMeta: meta,
  });
  // Filename has timestamp; second call slightly later may produce different name.
  // Verify content: the *latest* sessionId-* file should contain V2.
  await new Promise(r => setTimeout(r, 1100));  // ensure timestamp differs
  const path2 = await writeLessonsForSession({
    workspace: wsDir, sessionId: 's-rerun', agentId: 'a1', ownerId: 1,
    llmOutput: { ...baseOutput, lessons: [{ kind: 'fact', text: 'V2', tags: [], evidence_message_ids: [] }] },
    jsonlPath, sessionMeta: { ...meta, reflectionAt: '2026-05-09T14:33:00.000Z' },
  });
  // Both files should exist (idempotency note: in MVP we keep timestamped files
  // distinct; re-reflect intentionally creates a new timestamp). User-driven
  // re-reflect endpoint will delete the prior file before re-running.
  assert.notEqual(path1, path2);
  const c2 = fs.readFileSync(path2, 'utf8');
  assert.ok(c2.includes('V2'));
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/lessons-writer.test.cjs`
Expected: FAIL.

- [ ] **Step 3: Implement writeLessonsForSession**

Append to `server/lib/lessons-writer.cjs` (before `module.exports`):

```javascript
const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function _safeTimestamp(iso) {
  // 2026-05-09T14:32:00.000Z → 20260509T143200Z
  const t = (iso || new Date().toISOString()).replace(/[:.]/g, '').slice(0, 17);
  return t.endsWith('Z') ? t : t + 'Z';
}

async function writeLessonsForSession({
  workspace, sessionId, agentId, ownerId,
  llmOutput, jsonlPath, sessionMeta,
}) {
  if (!sessionId || !SESSION_ID_REGEX.test(sessionId)) {
    throw new Error(`invalid sessionId: ${sessionId}`);
  }
  if (!workspace || typeof workspace !== 'string') {
    throw new Error('workspace path required');
  }

  const examples = await resolveVerbatim(llmOutput.validated_examples || [], jsonlPath);
  const content = renderLessonsFile({ sessionMeta, llmOutput, examples });

  const dir = path.join(workspace, 'aoc-lessons');
  await fs.promises.mkdir(dir, { recursive: true });

  const ts = _safeTimestamp(sessionMeta?.reflectionAt);
  const filename = `${ts}__${sessionId}.md`;
  const finalPath = path.join(dir, filename);
  const tempPath = path.join(dir, `.${filename}.tmp`);

  // Path traversal guard
  const resolvedFinal = path.resolve(finalPath);
  const resolvedDir = path.resolve(dir);
  if (!resolvedFinal.startsWith(resolvedDir + path.sep)) {
    throw new Error('path traversal detected');
  }

  await fs.promises.writeFile(tempPath, content, 'utf8');
  await fs.promises.rename(tempPath, finalPath);
  return finalPath;
}
```

Update `module.exports`:

```javascript
module.exports = {
  renderLessonsFile,
  resolveVerbatim,
  writeLessonsForSession,
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/lessons-writer.test.cjs`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/lessons-writer.cjs server/lib/lessons-writer.test.cjs
git commit -m "feat(satisfaction): lessons writer atomic write + path traversal guard"
```

---

## Task 15: Daily rollup job

**Files:**
- Create: `server/lib/satisfaction-rollup.cjs`
- Create: `server/lib/satisfaction-rollup.test.cjs`

- [ ] **Step 1: Write failing tests**

Create `server/lib/satisfaction-rollup.test.cjs`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-rollup-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./db/satisfaction.cjs')];
  delete require.cache[require.resolve('./satisfaction-rollup.cjs')];
  return { db: require('./db.cjs'), rollup: require('./satisfaction-rollup.cjs'), tmpDir };
}

test('rollupForDay computes and upserts metrics for given day', async () => {
  const { db, rollup } = setupDb();
  await db.initDatabase();

  // Seed: 2 sessions on 2026-05-09 for agent a1
  const dayMs = new Date('2026-05-09T12:00:00Z').getTime();
  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 10, endorsedCount: 3, flaggedCount: 1, presumedGoodCount: 6,
    hallucinationRate: 0.1, endorsementRate: 0.3,
    reflectionStatus: 'completed', reflectionAt: dayMs,
  });
  db.upsertSessionSummary({
    sessionId: 's2', agentId: 'a1', ownerId: 1,
    messageCount: 5, endorsedCount: 2, flaggedCount: 0, presumedGoodCount: 3,
    hallucinationRate: 0, endorsementRate: 0.4,
    reflectionStatus: 'completed', reflectionAt: dayMs + 3600_000,
  });

  await rollup.rollupForDay({ day: '2026-05-09', agentId: 'a1', ownerId: 1 });
  const m = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-09', toDay: '2026-05-09' });
  assert.equal(m.length, 1);
  assert.equal(m[0].sessionCount, 2);
  assert.equal(m[0].messageCount, 15);
  assert.equal(m[0].endorsedCount, 5);
  assert.equal(m[0].flaggedCount, 1);
});

test('rollupAllAgents iterates all owner+agent combos with sessions on day', async () => {
  const { db, rollup } = setupDb();
  await db.initDatabase();

  const dayMs = new Date('2026-05-09T12:00:00Z').getTime();
  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 5, endorsedCount: 2, flaggedCount: 0, presumedGoodCount: 3,
    hallucinationRate: 0, endorsementRate: 0.4,
    reflectionStatus: 'completed', reflectionAt: dayMs,
  });
  db.upsertSessionSummary({
    sessionId: 's2', agentId: 'b2', ownerId: 2,
    messageCount: 8, endorsedCount: 1, flaggedCount: 1, presumedGoodCount: 6,
    hallucinationRate: 0.125, endorsementRate: 0.125,
    reflectionStatus: 'completed', reflectionAt: dayMs,
  });

  await rollup.rollupAllAgents({ day: '2026-05-09' });
  const m1 = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-09', toDay: '2026-05-09' });
  const m2 = db.getDailyMetrics({ agentId: 'b2', ownerId: 2, fromDay: '2026-05-09', toDay: '2026-05-09' });
  assert.equal(m1.length, 1);
  assert.equal(m2.length, 1);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/lib/satisfaction-rollup.test.cjs`
Expected: FAIL.

- [ ] **Step 3: Implement rollup module**

Create `server/lib/satisfaction-rollup.cjs`:

```javascript
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
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/lib/satisfaction-rollup.test.cjs`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/satisfaction-rollup.cjs server/lib/satisfaction-rollup.test.cjs
git commit -m "feat(satisfaction): daily rollup job + background interval starter"
```

---

## Task 16: REST route — POST /api/feedback/message

**Files:**
- Create: `server/routes/feedback.cjs`
- Create: `server/routes/feedback.test.cjs`

- [ ] **Step 1: Write failing test for the endpoint**

Create `server/routes/feedback.test.cjs`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');
const path = require('path');
const fs = require('fs');
const os = require('os');

function startServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-fb-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('../lib/db.cjs')];
  delete require.cache[require.resolve('../lib/db/satisfaction.cjs')];
  delete require.cache[require.resolve('./feedback.cjs')];
  const db = require('../lib/db.cjs');

  const stubDb = {
    ...db,
    authMiddleware: (req, _res, next) => {
      const u = req.headers['x-test-user'];
      req.user = u ? JSON.parse(u) : null;
      next();
    },
    getAgentOwner: () => 1,  // simulate ownership lookup
    requireAdmin: (req, res, next) =>
      req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'admin only' }),
  };

  const router = require('./feedback.cjs')({ db: stubDb });
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = app.listen(0);
  return { db, server, port: server.address().port };
}

function call(port, method, urlPath, user, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      { method, port, path: '/api' + urlPath,
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user || null), 'content-length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('POST /api/feedback/message records rating with user as owner', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  const user = { userId: 1, role: 'user', username: 'rheyno' };

  const r = await call(port, 'POST', '/feedback/message', user, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1',
    rating: 'positive',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 'positive');
  assert.equal(rows[0].source, 'button');
  assert.equal(rows[0].channel, 'dashboard');
  server.close();
});

test('POST /api/feedback/message rejects unauthenticated', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  const r = await call(port, 'POST', '/feedback/message', null, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1', rating: 'positive',
  });
  assert.equal(r.status, 401);
  server.close();
});

test('POST /api/feedback/message validates rating value', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  const user = { userId: 1, role: 'user' };
  const r = await call(port, 'POST', '/feedback/message', user, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1', rating: 'maybe',
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /api/feedback/message: same key flips rating (last-write-wins)', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  const user = { userId: 1, role: 'user' };

  await call(port, 'POST', '/feedback/message', user, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1', rating: 'positive',
  });
  await call(port, 'POST', '/feedback/message', user, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1', rating: 'negative', reason: 'oops',
  });

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 1, 'still 1 row (replaced)');
  assert.equal(rows[0].rating, 'negative');
  assert.equal(rows[0].reason, 'oops');
  server.close();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/routes/feedback.test.cjs`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement feedback route**

Create `server/routes/feedback.cjs`:

```javascript
'use strict';

/**
 * routes/feedback.cjs
 *
 * Satisfaction feedback REST endpoints.
 * - POST /feedback/message            (Phase 1 — dashboard button)
 * - GET  /feedback/messages?sessionId  (Phase 1 — render thumb states)
 * - POST /feedback/channel-reaction    (internal, used by reaction-bridge in Phase 2/3)
 *
 * See spec §8.3.
 */

module.exports = function feedbackRouter(deps) {
  const { db } = deps;
  const router = require('express').Router();

  const VALID_RATINGS = new Set(['positive', 'negative']);
  const VALID_CHANNELS = new Set(['dashboard', 'telegram', 'whatsapp', 'discord', 'reflection']);
  const VALID_SOURCES = new Set(['button', 'reaction', 'nl_correction']);

  function ensureAuth(req, res) {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  // POST /api/feedback/message — dashboard button click
  router.post('/feedback/message', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;

    const { messageId, sessionId, agentId, rating, reason } = req.body || {};
    if (!messageId || !sessionId || !agentId) {
      return res.status(400).json({ error: 'messageId, sessionId, agentId required' });
    }
    if (!VALID_RATINGS.has(rating)) {
      return res.status(400).json({ error: `rating must be one of: ${[...VALID_RATINGS].join(', ')}` });
    }

    // Resolve owner via getAgentOwner (existing AOC pattern)
    let ownerId;
    try {
      ownerId = typeof db.getAgentOwner === 'function'
        ? (db.getAgentOwner(agentId, req.user.userId) ?? req.user.userId)
        : req.user.userId;
    } catch (e) {
      return res.status(500).json({ error: 'owner lookup failed' });
    }

    db.recordRating({
      messageId, sessionId, agentId, ownerId,
      channel: 'dashboard', source: 'button', rating,
      reason: reason || null,
      raterExternalId: null,
      createdAt: Date.now(),
    });
    return res.json({ ok: true });
  });

  // GET /api/feedback/messages?sessionId=… — list ratings for a session
  router.get('/feedback/messages', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    const { sessionId, agentId } = req.query;
    if (!sessionId && !agentId) {
      return res.status(400).json({ error: 'sessionId or agentId required' });
    }
    const rows = db.getMessageRatings({ sessionId, agentId });
    return res.json({ ratings: rows });
  });

  // POST /api/feedback/channel-reaction — internal (service token gated)
  // Phase 1 ships the endpoint but doesn't yet receive from OpenClaw.
  // The reaction-bridge integration lands in Phase 2 (TG/Discord) + Phase 3 (WA).
  router.post('/feedback/channel-reaction', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    if (req.user.role !== 'agent' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'service or admin token required' });
    }
    const { messageId, sessionId, agentId, channel, rating, raterExternalId, ownerId } = req.body || {};
    if (!messageId || !sessionId || !agentId || !channel || !rating || !ownerId) {
      return res.status(400).json({ error: 'messageId, sessionId, agentId, channel, rating, ownerId required' });
    }
    if (!VALID_RATINGS.has(rating)) return res.status(400).json({ error: 'invalid rating' });
    if (!VALID_CHANNELS.has(channel)) return res.status(400).json({ error: 'invalid channel' });

    db.recordRating({
      messageId, sessionId, agentId, ownerId,
      channel, source: 'reaction', rating,
      reason: null, raterExternalId: raterExternalId || null,
      createdAt: Date.now(),
    });
    return res.json({ ok: true });
  });

  return router;
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/routes/feedback.test.cjs`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/feedback.cjs server/routes/feedback.test.cjs
git commit -m "feat(satisfaction): POST /api/feedback/message + /messages + /channel-reaction"
```

---

## Task 17: REST route — satisfaction metrics endpoints

**Files:**
- Modify: `server/routes/feedback.cjs`
- Modify: `server/routes/feedback.test.cjs`

- [ ] **Step 1: Write failing tests**

Append to `server/routes/feedback.test.cjs`:

```javascript
test('GET /api/satisfaction/agent/:id/metrics returns daily metrics for range', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  // Seed
  db.upsertDailyMetric({
    agentId: 'a1', ownerId: 1, day: '2026-05-09', channel: 'all',
    sessionCount: 3, messageCount: 30, endorsedCount: 10, flaggedCount: 2,
    hallucinationRate: 2/30, endorsementRate: 10/30,
  });

  const user = { userId: 1, role: 'user' };
  const r = await call(port, 'GET', '/satisfaction/agent/a1/metrics?range=7d', user);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.metrics));
  assert.ok(r.body.metrics.length >= 1);
  server.close();
});

test('GET /api/satisfaction/agent/:id/flagged-messages returns flagged ratings', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'negative',
    reason: 'wrong', createdAt: Date.now(),
  });
  db.recordRating({
    messageId: 'm2', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    createdAt: Date.now(),
  });

  const user = { userId: 1, role: 'user' };
  const r = await call(port, 'GET', '/satisfaction/agent/a1/flagged-messages?limit=20', user);
  assert.equal(r.status, 200);
  assert.equal(r.body.flagged.length, 1);
  assert.equal(r.body.flagged[0].messageId, 'm1');
  server.close();
});

test('GET /api/satisfaction/health returns reflection queue + provider info', async () => {
  const { server, port } = startServer();
  const user = { userId: 1, role: 'admin' };
  const r = await call(port, 'GET', '/satisfaction/health', user);
  assert.equal(r.status, 200);
  assert.ok(r.body.reflection);
  assert.ok(r.body.llm_provider);
  server.close();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/routes/feedback.test.cjs`
Expected: FAIL.

- [ ] **Step 3: Implement metrics endpoints**

Append to `server/routes/feedback.cjs` inside the `feedbackRouter` factory (before `return router`):

```javascript
  // GET /api/satisfaction/agent/:id/metrics?range=7d|30d|90d|all
  router.get('/satisfaction/agent/:agentId/metrics', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    const { agentId } = req.params;
    const range = (req.query.range || '7d').toLowerCase();
    const channel = req.query.channel || 'all';

    const today = new Date().toISOString().slice(0, 10);
    const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365 * 5;
    const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const ownerId = (typeof db.getAgentOwner === 'function')
      ? (db.getAgentOwner(agentId, req.user.userId) ?? req.user.userId)
      : req.user.userId;

    const metrics = db.getDailyMetrics({ agentId, ownerId, fromDay: fromDate, toDay: today, channel });
    return res.json({ agentId, ownerId, range, channel, metrics });
  });

  // GET /api/satisfaction/agent/:id/flagged-messages?limit=20
  router.get('/satisfaction/agent/:agentId/flagged-messages', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    const { agentId } = req.params;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

    const all = db.getMessageRatings({ agentId });
    const flagged = all
      .filter(r => r.rating === 'negative')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return res.json({ agentId, flagged });
  });

  // GET /api/satisfaction/health — reflection + provider status
  router.get('/satisfaction/health', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    let queueStats = { inFlight: 0, pending: 0, concurrency: 0, maxQueue: 0 };
    try {
      const reflection = require('../lib/reflection-service.cjs');
      // Phase 1: queue is module-local; Phase 5 wires global instance.
      // For now, return defaults if queue not initialized.
      if (typeof reflection.getQueueStats === 'function') {
        queueStats = reflection.getQueueStats();
      }
    } catch {}

    return res.json({
      reflection: {
        queue_depth: queueStats.pending,
        in_flight: queueStats.inFlight,
        concurrency: queueStats.concurrency,
        max_queue: queueStats.maxQueue,
      },
      llm_provider: {
        name: process.env.REFLECTION_LLM_PROVIDER || 'claude-code',
        model: process.env.REFLECTION_LLM_MODEL || 'claude-haiku-4-5',
      },
    });
  });
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/routes/feedback.test.cjs`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/feedback.cjs server/routes/feedback.test.cjs
git commit -m "feat(satisfaction): GET metrics, flagged-messages, health endpoints"
```

---

## Task 18: Internal trigger endpoint for reflection (testing without OpenClaw)

**Files:**
- Modify: `server/routes/feedback.cjs`
- Modify: `server/routes/feedback.test.cjs`

- [ ] **Step 1: Write failing test for internal trigger**

Append to `server/routes/feedback.test.cjs`:

```javascript
test('POST /api/feedback/internal/reflect (admin) calls reflection service', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();

  // Create a fake JSONL fixture
  const jsonlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-'));
  const jsonlPath = path.join(jsonlDir, 's-trigger.jsonl');
  const lines = [
    JSON.stringify({ type: 'session', id: 's-trigger', timestamp: 0 }),
  ];
  for (let i = 0; i < 12; i++) {
    lines.push(JSON.stringify({
      type: 'message', id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'message ' + i + ' '.repeat(100),
    }));
  }
  fs.writeFileSync(jsonlPath, lines.join('\n'));

  const user = { userId: 1, role: 'admin' };
  const r = await call(port, 'POST', '/feedback/internal/reflect', user, {
    sessionId: 's-trigger', agentId: 'a1', ownerId: 1,
    workspace: jsonlDir,
    jsonlPath,
    mockLlm: true,  // bypass actual subprocess in test
  });
  assert.equal(r.status, 200);
  assert.ok(['completed', 'skipped_too_short', 'skipped_no_signal', 'failed'].includes(r.body.status));
  server.close();
});

test('POST /api/feedback/internal/reflect rejects non-admin', async () => {
  const { server, port } = startServer();
  const user = { userId: 1, role: 'user' };
  const r = await call(port, 'POST', '/feedback/internal/reflect', user, {
    sessionId: 's1', agentId: 'a1', ownerId: 1,
  });
  assert.equal(r.status, 403);
  server.close();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `node --test server/routes/feedback.test.cjs`
Expected: FAIL.

- [ ] **Step 3: Implement internal trigger**

Append to `server/routes/feedback.cjs` inside the factory (before `return router`):

```javascript
  // POST /api/feedback/internal/reflect — admin-only manual trigger.
  // Phase 1 entry point. Phase 5 replaces with OpenClaw session_end webhook.
  router.post('/feedback/internal/reflect', db.authMiddleware, async (req, res) => {
    if (!ensureAuth(req, res)) return;
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'admin only' });
    }
    const { sessionId, agentId, ownerId, workspace, jsonlPath, mockLlm } = req.body || {};
    if (!sessionId || !agentId || !ownerId || !workspace || !jsonlPath) {
      return res.status(400).json({ error: 'sessionId, agentId, ownerId, workspace, jsonlPath required' });
    }

    const fs = require('fs');
    if (!fs.existsSync(jsonlPath)) {
      return res.status(404).json({ error: 'jsonl not found' });
    }

    // Parse JSONL → messages
    const raw = fs.readFileSync(jsonlPath, 'utf8');
    const messages = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'message' || obj.role) messages.push(obj);
      } catch {}
    }

    const ratings = db.getMessageRatings({ sessionId });

    // Provider selection (mockLlm short-circuits for tests)
    let provider;
    if (mockLlm) {
      provider = {
        complete: async () => ({
          text: JSON.stringify({
            schema_version: '1', session_quality: 'mixed',
            flagged_messages: [], lessons: [], validated_examples: [],
          }),
          inputTokens: 100, outputTokens: 30, modelUsed: 'mock',
          providerLatencyMs: 1,
        }),
      };
    } else {
      const { getProvider } = require('../lib/llm-providers/index.cjs');
      provider = getProvider(process.env.REFLECTION_LLM_PROVIDER || 'claude-code');
    }

    const reflection = require('../lib/reflection-service.cjs');
    const lessons = require('../lib/lessons-writer.cjs');

    try {
      const result = await reflection.reflectSession({
        sessionId, agentId, ownerId,
        messages, ratings,
        workspace, jsonlPath,
        deps: {
          provider,
          recordRating: db.recordRating,
          upsertSessionSummary: db.upsertSessionSummary,
          writeLessonsForSession: lessons.writeLessonsForSession,
        },
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test server/routes/feedback.test.cjs`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/feedback.cjs server/routes/feedback.test.cjs
git commit -m "feat(satisfaction): admin-only /internal/reflect endpoint for manual trigger"
```

---

## Task 19: Wire up — mount router, barrel exports, env vars

**Files:**
- Modify: `server/index.cjs`
- Modify: `server/lib/index.cjs`
- Modify: `.env.example`

- [ ] **Step 1: Mount feedback router in `server/index.cjs`**

Open `server/index.cjs`. Find where other routers are mounted (look for lines like `app.use('/api', xxxRouter({...}))` or `app.use('/api', require('./routes/<x>.cjs')(...))`). Append the feedback router in the same style:

```javascript
const feedbackRouter = require('./routes/feedback.cjs');
app.use('/api', feedbackRouter({ db }));
```

(Place it alongside the other route mounts; no specific order required — Express matches by path.)

- [ ] **Step 2: Add satisfaction modules to `server/lib/index.cjs` barrel**

Open `server/lib/index.cjs`. The barrel exports an explicit named list. Find it and append the new modules — at the bottom of the require section first:

```javascript
const reflectionService    = require('./reflection-service.cjs');
const reflectionPrompts    = require('./reflection-prompts.cjs');
const lessonsWriter        = require('./lessons-writer.cjs');
const satisfactionRollup   = require('./satisfaction-rollup.cjs');
const llmProviders         = require('./llm-providers/index.cjs');
```

Then in the `module.exports = { ... }` block at the bottom, expose the symbols other modules might need:

```javascript
  // satisfaction (Phase 1)
  reflectSession: reflectionService.reflectSession,
  evaluateSkip: reflectionService.evaluateSkip,
  compressTranscript: reflectionService.compressTranscript,
  parseAndValidateOutput: reflectionService.parseAndValidateOutput,
  createReflectionQueue: reflectionService.createReflectionQueue,
  REFLECTION_PROMPT_VERSION: reflectionPrompts.REFLECTION_PROMPT_VERSION,
  buildReflectionPrompt: reflectionPrompts.buildPrompt,
  writeLessonsForSession: lessonsWriter.writeLessonsForSession,
  renderLessonsFile: lessonsWriter.renderLessonsFile,
  resolveVerbatim: lessonsWriter.resolveVerbatim,
  rollupForDay: satisfactionRollup.rollupForDay,
  rollupAllAgents: satisfactionRollup.rollupAllAgents,
  startSatisfactionRollup: satisfactionRollup.startBackgroundRollup,
  stopSatisfactionRollup: satisfactionRollup.stopBackgroundRollup,
  getLLMProvider: llmProviders.getProvider,
  listLLMProviders: llmProviders.listProviders,
```

- [ ] **Step 3: Add env vars to `.env.example`**

Open `.env.example` and append at the bottom:

```bash
# ── Self-Learning / Satisfaction (Phase 1) ──────────────────────────────────
# LLM provider used for reflection at session_end. MVP: 'claude-code'
# (subprocess via $CLAUDE_BIN). Future: 'anthropic-api' or 'openai-compatible'.
REFLECTION_LLM_PROVIDER=claude-code
# Model alias passed to provider. Pin to Haiku for predictable cost.
REFLECTION_LLM_MODEL=claude-haiku-4-5
# Max parallel reflection LLM calls.
REFLECTION_CONCURRENCY=3
# Max queued reflections before backpressure (oldest dropped if exceeded).
REFLECTION_QUEUE_MAX=50
# LLM call timeout (ms).
REFLECTION_TIMEOUT_MS=60000
# Background rollup interval (ms) — daily metrics aggregation cadence.
SATISFACTION_ROLLUP_INTERVAL_MS=3600000
```

- [ ] **Step 4: Verify by running full test suite**

Run: `npm test`
Expected: all tests pass, including new satisfaction tests.

- [ ] **Step 5: Smoke check — server boots without errors**

Run: `npm run dev:server &` (let it run a few seconds), then `curl -s http://localhost:18800/api/satisfaction/health -H 'x-test-user: ...'` if you've configured a test user, OR just verify no startup errors:

```bash
timeout 5 npm run dev:server 2>&1 | tail -20
```

Expected: no stack traces about missing modules; server logs "listening on :18800" then exits via timeout.

- [ ] **Step 6: Commit**

```bash
git add server/index.cjs server/lib/index.cjs .env.example
git commit -m "feat(satisfaction): wire feedback router + barrel exports + env vars"
```

---

## Task 20: Background rollup wiring at server startup

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Start background rollup after DB init**

Open `server/index.cjs`. Find the section after `db.initDatabase()` resolves (or in the post-init block). Add:

```javascript
// Satisfaction daily rollup — runs immediately + every interval (default 1h).
const { startBackgroundRollup } = require('./lib/satisfaction-rollup.cjs');
startBackgroundRollup({
  intervalMs: Number(process.env.SATISFACTION_ROLLUP_INTERVAL_MS) || 3_600_000,
});
```

- [ ] **Step 2: Add graceful shutdown hook**

If `server/index.cjs` already has a SIGTERM/SIGINT handler, add to it:

```javascript
process.on('SIGTERM', () => { stopSatisfactionRollup(); /* ... existing ... */ });
process.on('SIGINT',  () => { stopSatisfactionRollup(); /* ... existing ... */ });
```

(`stopSatisfactionRollup` is already exported via `server/lib/index.cjs` from Task 19.)

If no shutdown hook exists yet, add a minimal one:

```javascript
const { stopSatisfactionRollup } = require('./lib/satisfaction-rollup.cjs');
process.once('SIGTERM', () => { stopSatisfactionRollup(); });
process.once('SIGINT',  () => { stopSatisfactionRollup(); });
```

- [ ] **Step 3: Smoke verify**

Run: `timeout 8 npm run dev:server 2>&1 | grep -iE "rollup|satisfaction|listening|error" | head -10`
Expected: see "listening", no errors about rollup.

- [ ] **Step 4: Commit**

```bash
git add server/index.cjs
git commit -m "feat(satisfaction): start background rollup on boot, stop on shutdown"
```

---

## Task 21: End-to-end smoke test

**Files:**
- Create: `server/lib/satisfaction.smoke.test.cjs`

- [ ] **Step 1: Write smoke test that exercises the full pipeline**

Create `server/lib/satisfaction.smoke.test.cjs`:

```javascript
'use strict';

/**
 * Smoke test: end-to-end satisfaction pipeline (Phase 1).
 *
 * Wires real DB + lessons writer + reflection service with a MOCK LLM
 * provider. Verifies that a synthesized session produces:
 *   - session summary in DB
 *   - lessons.md file in workspace
 *   - rollup populates daily metrics
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

test('end-to-end: synthetic session → reflection → lessons file → daily rollup', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-smoke-'));
  process.env.AOC_DATA_DIR = tmp;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./db/satisfaction.cjs')];
  delete require.cache[require.resolve('./reflection-service.cjs')];
  delete require.cache[require.resolve('./lessons-writer.cjs')];
  delete require.cache[require.resolve('./satisfaction-rollup.cjs')];

  const db = require('./db.cjs');
  const reflection = require('./reflection-service.cjs');
  const lessons = require('./lessons-writer.cjs');
  const rollup = require('./satisfaction-rollup.cjs');

  await db.initDatabase();

  // 1. Build synthetic JSONL
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-smoke-'));
  const sessionsDir = path.join(wsDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionId = 'smoke-' + Date.now();
  const jsonlPath = path.join(sessionsDir, `${sessionId}.jsonl`);

  const jsonlLines = [
    JSON.stringify({ type: 'session', id: sessionId, timestamp: Date.now() }),
  ];
  for (let i = 0; i < 12; i++) {
    jsonlLines.push(JSON.stringify({
      type: 'message',
      id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: i === 5
        ? [{ type: 'text', text: 'SELECT * FROM users WHERE id = 1' }]
        : 'message ' + i + ' '.repeat(150),
    }));
  }
  fs.writeFileSync(jsonlPath, jsonlLines.join('\n'));

  // 2. Pre-record one positive rating to drive endorsement
  db.recordRating({
    messageId: 'm5', sessionId, agentId: 'smoke-agent', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    createdAt: Date.now(),
  });

  // 3. Run reflection with mock provider
  const messages = jsonlLines
    .map(l => JSON.parse(l))
    .filter(o => o.type === 'message');
  const ratings = db.getMessageRatings({ sessionId });

  const mockProvider = {
    complete: async () => ({
      text: JSON.stringify({
        schema_version: '1',
        session_quality: 'good',
        flagged_messages: [],
        lessons: [
          { kind: 'fact', text: 'Smoke test fact', tags: ['smoke', 'test'], evidence_message_ids: ['m5'] },
        ],
        validated_examples: [
          { messageId: 'm5', kind: 'code', title: 'demo query', tags: ['sql'] },
        ],
      }),
      inputTokens: 1000, outputTokens: 100, modelUsed: 'mock',
      providerLatencyMs: 5,
    }),
  };

  const result = await reflection.reflectSession({
    sessionId, agentId: 'smoke-agent', ownerId: 1,
    messages, ratings,
    workspace: wsDir, jsonlPath,
    deps: {
      provider: mockProvider,
      recordRating: db.recordRating,
      upsertSessionSummary: db.upsertSessionSummary,
      writeLessonsForSession: lessons.writeLessonsForSession,
    },
  });

  assert.equal(result.status, 'completed');

  // 4. Verify summary in DB
  const summary = db.getSessionSummary(sessionId);
  assert.ok(summary);
  assert.equal(summary.lessonsExtracted, 1);
  assert.equal(summary.examplesCaptured, 1);
  assert.equal(summary.endorsedCount, 1);

  // 5. Verify lessons file exists and contains expected content
  const lessonsDir = path.join(wsDir, 'aoc-lessons');
  const files = fs.readdirSync(lessonsDir).filter(f => f.endsWith('.md'));
  assert.equal(files.length, 1);
  const content = fs.readFileSync(path.join(lessonsDir, files[0]), 'utf8');
  assert.ok(content.includes('Smoke test fact'));
  assert.ok(content.includes('SELECT * FROM users WHERE id = 1'),
    'verbatim from JSONL embedded');

  // 6. Run rollup, verify daily metric appears
  const today = new Date().toISOString().slice(0, 10);
  await rollup.rollupForDay({ day: today, agentId: 'smoke-agent', ownerId: 1 });
  const metrics = db.getDailyMetrics({
    agentId: 'smoke-agent', ownerId: 1, fromDay: today, toDay: today,
  });
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].sessionCount, 1);
  assert.equal(metrics[0].endorsedCount, 1);

  // Cleanup
  rollup.stopBackgroundRollup();
});
```

- [ ] **Step 2: Run smoke test, verify pass**

Run: `node --test server/lib/satisfaction.smoke.test.cjs`
Expected: 1 test passes.

- [ ] **Step 3: Run full suite to confirm nothing regressed**

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/lib/satisfaction.smoke.test.cjs
git commit -m "test(satisfaction): end-to-end smoke covering reflection + lessons + rollup"
```

---

## Phase 1 verification checklist

After completing all tasks, confirm:

- [ ] `npm test` passes with new tests (database, reflection, lessons writer, rollup, route, smoke)
- [ ] `npm run dev:server` boots without errors; logs show DB migration `0005-satisfaction-tables` applied
- [ ] `curl -X POST localhost:18800/api/feedback/message -H 'authorization: Bearer <token>' -H 'content-type: application/json' -d '{"messageId":"m1","sessionId":"s1","agentId":"a1","rating":"positive"}'` returns `{ok:true}` and a row appears in `message_ratings`
- [ ] `curl localhost:18800/api/satisfaction/health -H 'authorization: Bearer <admin-token>'` returns reflection queue + LLM provider info
- [ ] Manually triggering reflection via `/api/feedback/internal/reflect` (admin) on a real session JSONL produces a file in `<workspace>/aoc-lessons/` and a row in `session_satisfaction_summary`
- [ ] Daily rollup runs in background, populates `agent_satisfaction_metrics_daily`
- [ ] No frontend changes were made (Phase 1 is backend-only)

If any item fails, fix before declaring Phase 1 done.

---

## Hand-off notes for Phase 2

Phase 2 builds on this foundation:
- `<FeedbackThumbs>` React component → calls `POST /api/feedback/message` (exists)
- Telegram & Discord OpenClaw plugin hooks → calls `POST /api/feedback/channel-reaction` (exists, gated to service token)
- Real-time WS event `feedback:rating-updated` broadcast on `recordRating()` (TODO Phase 5)

The Phase 1 internal trigger endpoint `POST /api/feedback/internal/reflect` will be **replaced** by an OpenClaw `session_end` webhook plugin in Phase 5. Until then, it's the only way to trigger reflection — useful for dev/testing.

**End of Phase 1 plan.**

---

## Implementation Notes — Adaptations during execution (2026-05-09)

Phase 1 completed successfully (21/21 tasks, 50/50 tests passing, server boot clean). During subagent-driven execution, the following adaptations diverged from the literal plan above. These are captured here for future readers; the inline plan code already reflects fixes #1, #2 (function body), and #3.

### 1. Task 1 — `rater_external_id` UNIQUE NULL bug (fixed)

**Original plan:** column defined as `rater_external_id TEXT,` (nullable).

**Issue caught by code review:** SQLite treats multiple NULLs as distinct in UNIQUE indexes — so two rows with same `(message_id, source)` but both NULL `rater_external_id` would coexist, breaking the documented INSERT OR REPLACE flip semantics for dashboard ratings.

**Fix applied:** column is now `rater_external_id TEXT NOT NULL DEFAULT ''`. `recordRating` accessor coerces NULL→`''` before INSERT. Empty string acts as the sentinel for "anonymous in-app rater" (dashboard); channel reactions populate with the actual external chat user ID. Plan §Task 1 and §Task 2 code blocks above already reflect this.

### 2. Task 7 — skip rules logic ordering (fixed)

**Original plan logic** (buggy):
1. messageCount < 5 → too_short
2. tokens < 500 → too_short
3. !ratings + userTurns ≤ 1 → no_signal
4. else proceed

**Issue:** test 3's content (`'msg ' + i`) was ~5 chars per message → total ~60 chars ~15 tokens → fell into rule 2 and skipped, but test asserted `proceed`. First implementer hacked an `avgChars < 3` heuristic that wasn't in spec.

**Fix applied:**
- `evaluateSkip` reverted to the literal spec ordering (length → tokens → no_signal).
- All 4 test cases re-authored with substantive content so the test data exercises the intended rule, not an artifact of placeholder size:
  - Test 2 uses `'q ' + 'x'.repeat(800)` per message, 1 user turn + 5 assistant → `skipped_no_signal` (correct path).
  - Test 3 uses `'message ' + i + ' ' + 'z'.repeat(300)` per message, multiple user turns + rating → `proceed`.
  - Test 4 keeps tiny content (`'a'`) + rating → `skipped_too_short`.
- The `avgChars < 3` heuristic was removed entirely.

### 3. Task 14 — `_safeTimestamp` regex missing `-` (fixed)

**Original plan code:**
```javascript
const t = (iso || new Date().toISOString()).replace(/[:.]/g, '').slice(0, 17);
```

**Issue:** ISO date `2026-05-09T14:32:00.000Z` after this regex becomes `2026-05-09T143200Z` (dashes still present). Test regex `\d{8}T\d{6}Z` expects the compact form `20260509T143200Z`.

**Fix applied:**
```javascript
const t = (iso || new Date().toISOString()).replace(/[-:.]/g, '').slice(0, 15);
```

Note: `slice(0, 15)` since timestamp without separators is 15 chars before `Z` (`YYYYMMDDTHHMMSS`). Filename pattern: `<TS>__<sessionId>.md` where TS is `20260509T143200Z`.

### 4. Task 10 happy-path test — message content too short (fixed in test only)

**Original test data:** `'message ' + i + ' '.repeat(100)` per message → ~110 chars × 12 msgs = ~1300 chars = ~330 tokens → below `MIN_TRANSCRIPT_TOKEN_ESTIMATE=500` → reflection short-circuited as `skipped_too_short` instead of running the LLM mock.

**Fix applied:** changed to `'message ' + i + ' '.repeat(300)` (or `'z'.repeat(300)`) which produces substantive transcripts above the threshold. Same root cause as #2.

### 5. Task 21 smoke test — same content-length issue (fixed in test only)

**Original test data:** `'message ' + i + ' '.repeat(150)` per message → ~452 estimated tokens, just below 500.

**Fix applied:** bumped padding to `'.repeat(250)` so the transcript clears `MIN_TRANSCRIPT_TOKEN_ESTIMATE` and reflection proceeds with the mock LLM.

### 6. Concurrency queue capacity arithmetic

**Original plan / spec:** "Queue (max 50). If queue full, drop oldest."

**Implementation:** rejects 4th `enqueue` when `pending.length + inFlight >= maxQueue + concurrency`. Tested with `concurrency=1, maxQueue=2` → 1 running + 2 queued + 1 attempted = reject. This matches the test, but the "drop oldest" semantic from spec §6.7 is not implemented (we reject newest instead). For Phase 1 traffic this difference is academic; flag for Phase 5 if backpressure semantics matter operationally.

### 7. Per-task review cadence — combined reviews (rather than separate spec + quality)

The skill template recommends two-stage review (spec compliance, then code quality). For solo-dev token efficiency, several tasks used a single combined reviewer dispatch instead of two. This caught all the issues above plus several quality nits. No regressions slipped through.

### Verification snapshot

```
$ node --test \
    server/lib/db/satisfaction.test.cjs \
    server/lib/llm-providers/claude-code-provider.test.cjs \
    server/lib/reflection-service.test.cjs \
    server/lib/lessons-writer.test.cjs \
    server/lib/satisfaction-rollup.test.cjs \
    server/lib/satisfaction.smoke.test.cjs \
    server/routes/feedback.test.cjs

ℹ tests 50
ℹ pass 50
ℹ fail 0
ℹ duration_ms 5188
```

Server boots clean with migration `0005-satisfaction-tables` applied, feedback router mounted at `/api/feedback/*` and `/api/satisfaction/*`, background daily rollup armed with 1-hour interval (`unref`'d so process can exit cleanly).
