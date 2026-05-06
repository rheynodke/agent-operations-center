'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// ─── Isolation helpers ────────────────────────────────────────────────────────

function clearRequireCache() {
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./config.cjs')];
  delete require.cache[require.resolve('./room-context.cjs')];
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('room-context', () => {
  let ctx, db, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-ctx-'));
    process.env.AOC_DATA_DIR = tmpDir;
    process.env.OPENCLAW_HOME = tmpDir;

    clearRequireCache();
    db = require('./db.cjs');
    ctx = require('./room-context.cjs');

    await db.initDatabase();
  });

  after(() => {
    clearRequireCache();
    delete process.env.AOC_DATA_DIR;
    delete process.env.OPENCLAW_HOME;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  // ── getRoomContext ─────────────────────────────────────────────────────────

  it('getRoomContext returns empty string for new room', () => {
    const result = ctx.getRoomContext('room-new');
    assert.equal(result.content, '');
    assert.ok(result.path.includes('rooms/room-new/CONTEXT.md'));
  });

  // ── appendToContext ────────────────────────────────────────────────────────

  it('appendToContext creates file and adds entry', () => {
    const { content } = ctx.appendToContext('room-1', {
      authorId: 'agent-pm',
      body: 'Initial context entry.',
    });

    assert.ok(content.includes('---'), 'content has separator');
    assert.ok(content.includes('agent-pm'), 'content has author');
    assert.ok(content.includes('Initial context entry'), 'content has body');
  });

  it('appendToContext appends to existing content', () => {
    const result1 = ctx.appendToContext('room-2', {
      authorId: 'agent-pm',
      body: 'First entry.',
    });

    const result2 = ctx.appendToContext('room-2', {
      authorId: 'agent-ux',
      body: 'Second entry.',
    });

    assert.ok(result2.content.length > result1.content.length);
    assert.ok(result2.content.includes('agent-pm'));
    assert.ok(result2.content.includes('agent-ux'));
    assert.ok(result2.content.includes('First entry'));
    assert.ok(result2.content.includes('Second entry'));
  });

  it('appendToContext entry has correct format (separator, header, body)', () => {
    const { content } = ctx.appendToContext('room-3', {
      authorId: 'agent-test',
      body: 'Test body.',
    });

    // Check format: should have separator, ISO timestamp, author, body
    assert.ok(content.startsWith('---'), 'starts with separator');
    assert.ok(content.includes('###'), 'has header marker');
    assert.ok(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(content),
      'has ISO timestamp'
    );
    assert.ok(content.includes('agent-test'), 'has author');
    assert.ok(content.includes('Test body'), 'has body text');

    // Check structure: ---\n### timestamp — author\n\nbody\n\n
    const lines = content.split('\n');
    assert.equal(lines[0], '---');
    assert.ok(lines[1].includes('###'));
    assert.ok(lines[1].includes('agent-test'));
  });

  // ── clearContext ───────────────────────────────────────────────────────────

  it('clearContext resets file to empty', () => {
    ctx.appendToContext('room-4', {
      authorId: 'agent-test',
      body: 'Content to clear.',
    });

    let result = ctx.getRoomContext('room-4');
    assert.ok(result.content.length > 0, 'content exists before clear');

    ctx.clearContext('room-4');

    result = ctx.getRoomContext('room-4');
    assert.equal(result.content, '', 'content is empty after clear');
  });

  // ── getAgentRoomState ──────────────────────────────────────────────────────

  it('getAgentRoomState returns empty object for unknown agent', () => {
    const result = ctx.getAgentRoomState('agent-unknown', 'room-1');
    assert.deepStrictEqual(result.state, {});
  });

  it('getAgentRoomState returns empty object when no state for room', () => {
    // Create an agent profile
    db.getDb().run(
      'INSERT INTO agent_profiles (agent_id, display_name) VALUES (?, ?)',
      ['agent-state-test', 'State Test Agent']
    );
    db.persist();

    const result = ctx.getAgentRoomState('agent-state-test', 'room-nonexistent');
    assert.deepStrictEqual(result.state, {});
  });

  // ── setAgentRoomState ──────────────────────────────────────────────────────

  it('setAgentRoomState persists state for agent+room', () => {
    // Create an agent profile
    db.getDb().run(
      'INSERT INTO agent_profiles (agent_id, display_name) VALUES (?, ?)',
      ['agent-state-1', 'State Agent 1']
    );
    db.persist();

    const newState = { step: 1, status: 'active' };
    const result = ctx.setAgentRoomState('agent-state-1', 'room-5', newState);

    assert.deepStrictEqual(result.state, newState);

    // Verify it persists across reads
    const reread = ctx.getAgentRoomState('agent-state-1', 'room-5');
    assert.deepStrictEqual(reread.state, newState);
  });

  it('setAgentRoomState merges with existing state', () => {
    // Create an agent profile
    db.getDb().run(
      'INSERT INTO agent_profiles (agent_id, display_name) VALUES (?, ?)',
      ['agent-state-2', 'State Agent 2']
    );
    db.persist();

    // Set initial state
    ctx.setAgentRoomState('agent-state-2', 'room-6', { step: 1, status: 'init' });

    // Merge new state
    const mergeResult = ctx.setAgentRoomState('agent-state-2', 'room-6', {
      status: 'active',
    });

    // Should have both keys
    assert.equal(mergeResult.state.step, 1, 'original step preserved');
    assert.equal(mergeResult.state.status, 'active', 'status updated');

    // Verify persistent merge
    const reread = ctx.getAgentRoomState('agent-state-2', 'room-6');
    assert.equal(reread.state.step, 1);
    assert.equal(reread.state.status, 'active');
  });

  it('setAgentRoomState handles different rooms independently', () => {
    // Create an agent profile
    db.getDb().run(
      'INSERT INTO agent_profiles (agent_id, display_name) VALUES (?, ?)',
      ['agent-state-3', 'State Agent 3']
    );
    db.persist();

    // Set state for room-7
    ctx.setAgentRoomState('agent-state-3', 'room-7', { data: 'room7' });

    // Set state for room-8
    ctx.setAgentRoomState('agent-state-3', 'room-8', { data: 'room8' });

    // Verify isolation
    const state7 = ctx.getAgentRoomState('agent-state-3', 'room-7');
    const state8 = ctx.getAgentRoomState('agent-state-3', 'room-8');

    assert.equal(state7.state.data, 'room7');
    assert.equal(state8.state.data, 'room8');
  });
});
