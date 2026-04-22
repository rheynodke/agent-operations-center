// node --test server/lib/outputs.test.cjs
//
// Tests for the outputs module. Isolates filesystem state by pointing
// OPENCLAW_HOME + OPENCLAW_WORKSPACE at a temp directory before requiring
// the module under test.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Set up isolated home BEFORE requiring modules that capture env at load.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-outputs-test-'));
const FAKE_HOME = path.join(TMP, 'openclaw');
const FAKE_WORKSPACE = path.join(TMP, 'workspace');
fs.mkdirSync(FAKE_HOME, { recursive: true });
fs.mkdirSync(FAKE_WORKSPACE, { recursive: true });

const AGENT_ID = 'alice';
const AGENT_WORKSPACE = path.join(TMP, 'alice-workspace');
fs.mkdirSync(AGENT_WORKSPACE, { recursive: true });

// Minimal openclaw.json so getAgentWorkspacePath resolves to our fake workspace.
fs.writeFileSync(
  path.join(FAKE_HOME, 'openclaw.json'),
  JSON.stringify({ agents: { list: [{ id: AGENT_ID, workspace: AGENT_WORKSPACE }] } })
);

process.env.OPENCLAW_HOME = FAKE_HOME;
process.env.OPENCLAW_WORKSPACE = FAKE_WORKSPACE;

const outputs = require('./outputs.cjs');

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('ensureOutputsDir creates per-task folder under agent workspace', () => {
  const taskId = 'task-abc';
  const dir = outputs.ensureOutputsDir(AGENT_ID, taskId);
  assert.equal(dir, path.join(AGENT_WORKSPACE, 'outputs', taskId));
  assert.equal(fs.existsSync(dir), true);
  // Idempotent
  const dir2 = outputs.ensureOutputsDir(AGENT_ID, taskId);
  assert.equal(dir2, dir);
});

test('listOutputs returns [] when folder missing or empty', () => {
  assert.deepEqual(outputs.listOutputs(AGENT_ID, 'never-existed'), []);
  const empty = 'empty-task';
  outputs.ensureOutputsDir(AGENT_ID, empty);
  assert.deepEqual(outputs.listOutputs(AGENT_ID, empty), []);
});

test('listOutputs returns files sorted newest-first, skips dotfiles and subdirs', async () => {
  const taskId = 'task-list';
  const dir = outputs.ensureOutputsDir(AGENT_ID, taskId);
  fs.writeFileSync(path.join(dir, 'report.pdf'), 'PDF DATA');
  // Sleep briefly to guarantee a distinct mtime
  await new Promise(r => setTimeout(r, 15));
  fs.writeFileSync(path.join(dir, 'chart.png'), 'PNG DATA');
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'junk');
  fs.mkdirSync(path.join(dir, 'nested'));
  fs.writeFileSync(path.join(dir, 'nested', 'skip.txt'), 'skip me');

  const list = outputs.listOutputs(AGENT_ID, taskId);
  const names = list.map(e => e.filename);
  assert.deepEqual(names, ['chart.png', 'report.pdf']);

  const pdf = list.find(e => e.filename === 'report.pdf');
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(pdf.size, 'PDF DATA'.length);

  const png = list.find(e => e.filename === 'chart.png');
  assert.equal(png.mimeType, 'image/png');
});

test('resolveOutputFile rejects path traversal, absolute paths, subdirs, and dotfiles', () => {
  const taskId = 'task-resolve';
  const dir = outputs.ensureOutputsDir(AGENT_ID, taskId);
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'hello');

  const good = outputs.resolveOutputFile(AGENT_ID, taskId, 'ok.txt');
  assert.ok(good);
  assert.equal(good.filename, 'ok.txt');
  assert.equal(good.mimeType, 'text/plain');

  // Subdirectory components are blocked at the filename guard
  assert.equal(outputs.resolveOutputFile(AGENT_ID, taskId, '../../etc/passwd'), null);
  assert.equal(outputs.resolveOutputFile(AGENT_ID, taskId, 'nested/file.txt'), null);
  assert.equal(outputs.resolveOutputFile(AGENT_ID, taskId, '..'), null);
  assert.equal(outputs.resolveOutputFile(AGENT_ID, taskId, '.hidden'), null);
  assert.equal(outputs.resolveOutputFile(AGENT_ID, taskId, 'missing.txt'), null);
});

test('safeTaskId strips path separators and rejects empty ids', () => {
  // '../escape' loses the '.' and '/' chars, leaving 'escape' — which stays
  // under the outputs root. We verify the resolved path is a child of the
  // outputs root (i.e. it did not traverse up).
  const resolved = outputs.outputsDir(AGENT_ID, '../escape');
  const root = path.join(AGENT_WORKSPACE, 'outputs');
  assert.equal(resolved.startsWith(root + path.sep), true);
  assert.equal(path.basename(resolved), 'escape');

  // Empty or all-invalid ids throw — guards against accidentally operating on the outputs root.
  assert.throws(() => outputs.outputsDir(AGENT_ID, ''), /Invalid taskId/);
  assert.throws(() => outputs.outputsDir(AGENT_ID, '///'), /Invalid taskId/);
});

test('getAgentWorkspacePath expands ~ and falls back to OPENCLAW_WORKSPACE', () => {
  const resolved = outputs.getAgentWorkspacePath(AGENT_ID);
  assert.equal(resolved, AGENT_WORKSPACE);
  // Unknown agent falls back to default workspace
  const fallback = outputs.getAgentWorkspacePath('unknown-agent');
  assert.equal(fallback, FAKE_WORKSPACE);
});
