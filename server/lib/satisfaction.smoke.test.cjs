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
        : 'message ' + i + ' '.repeat(250),
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
