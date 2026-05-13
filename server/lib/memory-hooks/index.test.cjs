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

test('injectSoulHardLimits: appends block + idempotent + re-apply on drift', () => {
  const { injectSoulHardLimits, SOUL_HARD_LIMITS_BLOCK } = require('../memory-bootstrap.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-hl-test-'));
  fs.writeFileSync(path.join(tmp, 'SOUL.md'), '# SOUL\n\nbase character text\n');

  const r1 = injectSoulHardLimits(tmp);
  assert.strictEqual(r1, true);
  let soul = fs.readFileSync(path.join(tmp, 'SOUL.md'), 'utf-8');
  assert.ok(soul.includes('<!-- aoc:hard-limits:start -->'));
  assert.ok(soul.includes('Hard Limits (UNOVERRIDABLE)'));
  assert.ok(soul.includes('Tenant boundary'));
  assert.ok(soul.includes('Prompt injection defense'));
  assert.ok(soul.includes('Filesystem & environment disclosure'));
  assert.ok(soul.includes('Refusal protocol'));

  // Second call: idempotent (block already present + content matches).
  const r2 = injectSoulHardLimits(tmp);
  assert.strictEqual(r2, false);

  // Drift simulation: user edited block content. Re-apply restores authoritative version.
  const drifted = soul.replace('Tenant boundary', 'Tenant boundary (tampered)');
  fs.writeFileSync(path.join(tmp, 'SOUL.md'), drifted);
  const r3 = injectSoulHardLimits(tmp);
  assert.strictEqual(r3, true, 'drift should trigger re-apply');
  const restored = fs.readFileSync(path.join(tmp, 'SOUL.md'), 'utf-8');
  assert.ok(!restored.includes('(tampered)'), 'tampered content must be wiped');
  assert.ok(restored.includes('Tenant boundary'));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('injectSoulActiveMemoryReminder + injectSoulTimeAwareness: append + idempotent + drift recovery', () => {
  const { injectSoulActiveMemoryReminder, injectSoulTimeAwareness } = require('../memory-bootstrap.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-newblocks-'));
  fs.writeFileSync(path.join(tmp, 'SOUL.md'), '# SOUL\n\nbase\n');

  assert.strictEqual(injectSoulActiveMemoryReminder(tmp), true);
  assert.strictEqual(injectSoulTimeAwareness(tmp), true);
  let soul = fs.readFileSync(path.join(tmp, 'SOUL.md'), 'utf-8');
  assert.ok(soul.includes('<!-- aoc:active-memory-reminder:start -->'));
  assert.ok(soul.includes('IMPORTANT REMINDER'));
  assert.ok(soul.includes('If you do not write, you will not remember'));
  assert.ok(soul.includes('<!-- aoc:time-awareness:start -->'));
  assert.ok(soul.includes('Time awareness'));

  // Idempotent
  assert.strictEqual(injectSoulActiveMemoryReminder(tmp), false);
  assert.strictEqual(injectSoulTimeAwareness(tmp), false);

  // Drift recovery
  fs.writeFileSync(path.join(tmp, 'SOUL.md'),
    soul.replace('IMPORTANT REMINDER', 'IMPORTANT REMINDER (tampered)'));
  assert.strictEqual(injectSoulActiveMemoryReminder(tmp), true);
  soul = fs.readFileSync(path.join(tmp, 'SOUL.md'), 'utf-8');
  assert.ok(!soul.includes('(tampered)'));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('applyAllManagedSoulBlocks: 4 blocks injected at once on fresh SOUL', () => {
  const { applyAllManagedSoulBlocks } = require('../memory-bootstrap.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-allblocks-'));
  fs.writeFileSync(path.join(tmp, 'SOUL.md'), '# SOUL\n');

  const r = applyAllManagedSoulBlocks(tmp);
  assert.deepStrictEqual(r, {
    memoryProtocol: true,
    hardLimits: true,
    activeMemoryReminder: true,
    timeAwareness: true,
  });

  const soul = fs.readFileSync(path.join(tmp, 'SOUL.md'), 'utf-8');
  for (const tag of ['memory-protocol', 'hard-limits', 'active-memory-reminder', 'time-awareness']) {
    assert.ok(soul.includes(`<!-- aoc:${tag}:start -->`), `missing block ${tag}`);
    assert.ok(soul.includes(`<!-- aoc:${tag}:end -->`), `missing block end ${tag}`);
  }

  // Second pass — all idempotent
  const r2 = applyAllManagedSoulBlocks(tmp);
  assert.deepStrictEqual(r2, {
    memoryProtocol: false,
    hardLimits: false,
    activeMemoryReminder: false,
    timeAwareness: false,
  });

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('applyHardLimitsToAllWorkspaces: walks admin + per-user agents', () => {
  const { applyHardLimitsToAllWorkspaces } = require('../memory-bootstrap.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-hl-walk-'));
  // Admin layout
  fs.mkdirSync(path.join(tmp, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'workspace', 'SOUL.md'), '# admin soul\n');
  fs.writeFileSync(path.join(tmp, 'openclaw.json'), JSON.stringify({
    agents: { defaults: { workspace: path.join(tmp, 'workspace') }, list: [] },
  }, null, 2));
  // Per-user layout with one agent
  const userHome = path.join(tmp, 'users', '5', '.openclaw');
  const userWs = path.join(userHome, 'workspace');
  fs.mkdirSync(userWs, { recursive: true });
  fs.writeFileSync(path.join(userWs, 'SOUL.md'), '# user5 soul\n');
  fs.writeFileSync(path.join(userHome, 'openclaw.json'), JSON.stringify({
    agents: { defaults: { workspace: userWs }, list: [{ id: 'a1', workspace: userWs }] },
  }, null, 2));

  const r = applyHardLimitsToAllWorkspaces(tmp);
  assert.ok(r.scanned >= 2, `expected at least 2 workspaces, got ${r.scanned}`);
  assert.ok(r.changed >= 2);
  assert.strictEqual(r.errors.length, 0);
  // Each workspace should have all 4 managed blocks now (back-compat alias
  // applies the full set, not just hard-limits).
  assert.ok(r.perBlock.hardLimits >= 2);
  assert.ok(r.perBlock.memoryProtocol >= 2);
  assert.ok(r.perBlock.activeMemoryReminder >= 2);
  assert.ok(r.perBlock.timeAwareness >= 2);
  const adminSoul = fs.readFileSync(path.join(tmp, 'workspace', 'SOUL.md'), 'utf-8');
  const userSoul = fs.readFileSync(path.join(userWs, 'SOUL.md'), 'utf-8');
  assert.ok(adminSoul.includes('<!-- aoc:hard-limits:start -->'));
  assert.ok(userSoul.includes('<!-- aoc:active-memory-reminder:start -->'));

  // Second run: no-op
  const r2 = applyHardLimitsToAllWorkspaces(tmp);
  assert.strictEqual(r2.changed, 0);

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
  assert.strictEqual(cfg.plugins.entries['active-memory'].config.model, 'claude-cli/claude-haiku-3-5');

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
