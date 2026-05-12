'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Load module under test
const { _internal, captureUserTurn, getLastUserTurn } = require('./index.cjs');
const { fingerprint, topicShifted, parseExtractionOutput } = _internal;
const recall = require('./short-term-recall.cjs');

test('fingerprint extracts significant tokens', () => {
  const fp = fingerprint('isi timesheet seperti biasa di task brainstorming');
  assert.ok(fp.has('timesheet'));
  assert.ok(fp.has('biasa'));
  assert.ok(fp.has('task'));
  assert.ok(fp.has('brainstorming'));
  assert.ok(!fp.has('di')); // too short
});

test('topicShifted detects new topic vs continuation', () => {
  const a = fingerprint('isi timesheet brainstorming task');
  const b = fingerprint('isi timesheet brainstorming task lagi');
  const c = fingerprint('migration server germany singapore');
  assert.strictEqual(topicShifted(a, b), false, 'similar topic should not be shifted');
  assert.strictEqual(topicShifted(a, c), true, 'different topic should be shifted');
  assert.strictEqual(topicShifted(null, a), true, 'first turn always shifted');
});

test('parseExtractionOutput strips fences and parses JSON', () => {
  const fenced = '```json\n{"title":"timesheet rule","lesson":"check history first"}\n```';
  const r1 = parseExtractionOutput(fenced);
  assert.deepStrictEqual(r1, { title: 'timesheet rule', lesson: 'check history first' });
  const bare = '{"title":"x","lesson":"y"}';
  assert.deepStrictEqual(parseExtractionOutput(bare), { title: 'x', lesson: 'y' });
  assert.strictEqual(parseExtractionOutput('{"title":null,"lesson":null}'), null);
  assert.strictEqual(parseExtractionOutput('not json'), null);
});

test('captureUserTurn / getLastUserTurn round trips', () => {
  captureUserTurn('agent:test:abc', 'halo');
  assert.strictEqual(getLastUserTurn('agent:test:abc'), 'halo');
  assert.strictEqual(getLastUserTurn('agent:test:nope'), '');
});

test('short-term-recall: recordRecalls writes openclaw-schema entries', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-recall-test-'));
  const r = recall.recordRecalls({
    workspaceDir: tmp,
    query: 'isi timesheet seperti biasa',
    results: [
      { path: 'memory/2026-05-11-timesheet-lesson.md', startLine: 1, endLine: 27, snippet: 'Rule: cek history dulu', score: 0.55 },
    ],
  });
  assert.strictEqual(r.recorded, 1);
  const store = recall.readStore(tmp);
  const keys = Object.keys(store.entries);
  assert.strictEqual(keys.length, 1);
  const entry = store.entries[keys[0]];
  assert.strictEqual(entry.source, 'memory');
  assert.strictEqual(entry.recallCount, 1);
  assert.strictEqual(entry.queryHashes.length, 1);
  assert.strictEqual(entry.recallDays.length, 1);
  assert.ok(entry.maxScore >= 0.55 - 1e-9);

  // Second call with different query bumps recallCount + queryHashes
  recall.recordRecalls({
    workspaceDir: tmp,
    query: 'timesheet rule pattern',
    results: [
      { path: 'memory/2026-05-11-timesheet-lesson.md', startLine: 1, endLine: 27, snippet: 'Rule: cek history dulu', score: 0.7 },
    ],
  });
  const after = recall.readStore(tmp);
  const e2 = after.entries[keys[0]];
  assert.strictEqual(e2.recallCount, 2);
  assert.strictEqual(e2.queryHashes.length, 2);
  assert.ok(e2.maxScore >= 0.7 - 1e-9);

  // cleanup
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('memory-bootstrap: active-memory + soul protocol', () => {
  const { ensureActiveMemoryEnabled, injectSoulMemoryProtocol } =
    require('../memory-bootstrap.cjs');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-am-test-'));
  const cfgPath = path.join(tmpHome, 'openclaw.json');
  const ws = path.join(tmpHome, 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({
    agents: { list: [{ id: 'a1' }, { id: 'a2' }] },
  }, null, 2));

  // Active memory enables + populates agents list from cfg
  const c1 = ensureActiveMemoryEnabled(cfgPath);
  assert.strictEqual(c1, true);
  let cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.strictEqual(cfg.plugins.entries['active-memory'].enabled, true);
  assert.deepStrictEqual(cfg.plugins.entries['active-memory'].config.agents, ['a1', 'a2']);
  assert.strictEqual(cfg.plugins.entries['active-memory'].config.model, 'claude-cli/claude-haiku-4-5');

  // Second call no-op
  const c2 = ensureActiveMemoryEnabled(cfgPath);
  assert.strictEqual(c2, false);

  // Adding a new agent to list, re-run should merge
  cfg.agents.list.push({ id: 'a3' });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const c3 = ensureActiveMemoryEnabled(cfgPath);
  assert.strictEqual(c3, true);
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.deepStrictEqual(cfg.plugins.entries['active-memory'].config.agents, ['a1', 'a2', 'a3']);

  // Soul patch
  fs.writeFileSync(path.join(ws, 'SOUL.md'), '# SOUL\n\nbase content\n');
  const s1 = injectSoulMemoryProtocol(ws);
  assert.strictEqual(s1, true);
  const soul = fs.readFileSync(path.join(ws, 'SOUL.md'), 'utf-8');
  assert.ok(soul.includes('<!-- aoc:memory-protocol:start -->'));
  assert.ok(soul.includes('LARANGAN KERAS'));
  // Idempotent
  const s2 = injectSoulMemoryProtocol(ws);
  assert.strictEqual(s2, false);

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('memory-bootstrap end-to-end', () => {
  const { bootstrapAgentMemory, ensureDreamingEnabled, ensureRecallStore, seedMemoryTemplate } =
    require('../memory-bootstrap.cjs');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-bootstrap-test-'));
  const cfgPath = path.join(tmpHome, 'openclaw.json');
  const ws = path.join(tmpHome, 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ agents: { list: [{ id: 'x', name: 'Test' }] } }, null, 2));

  const c1 = ensureDreamingEnabled(cfgPath);
  assert.strictEqual(c1, true);
  const c2 = ensureDreamingEnabled(cfgPath);
  assert.strictEqual(c2, false, 'second call should be no-op');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.strictEqual(cfg.plugins.entries['memory-core'].config.dreaming.enabled, true);

  // boilerplate MEMORY.md
  fs.writeFileSync(path.join(ws, 'MEMORY.md'), `# MEMORY.md — Test's Long-Term Memory\n\n_Nothing here yet. Test will fill this in over time._\n`);
  const s1 = seedMemoryTemplate(ws, 'Test');
  assert.strictEqual(s1, true);
  const seeded = fs.readFileSync(path.join(ws, 'MEMORY.md'), 'utf-8');
  assert.ok(seeded.includes('Self-correction protocol'), 'MEMORY.md should be seeded with rich template');
  const s2 = seedMemoryTemplate(ws, 'Test');
  assert.strictEqual(s2, false, 'should not overwrite customized memory');

  const r1 = ensureRecallStore(ws);
  assert.strictEqual(r1, true);
  const r2 = ensureRecallStore(ws);
  assert.strictEqual(r2, false);
  assert.ok(fs.existsSync(path.join(ws, 'memory', '.dreams', 'short-term-recall.json')));

  // idempotent combined
  const combined = bootstrapAgentMemory({ cfgPath, workspacePath: ws, agentName: 'Test' });
  assert.strictEqual(combined.configChanged, false);
  assert.strictEqual(combined.recallCreated, false);
  assert.strictEqual(combined.memorySeeded, false);

  fs.rmSync(tmpHome, { recursive: true, force: true });
});
