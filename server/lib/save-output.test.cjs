// node --test server/lib/save-output.test.cjs
//
// End-to-end tests for the save_output.sh shared script.
// The script is rendered to disk via ensureSaveOutputScript(), then exercised
// against an isolated temp workspace.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-save-output-test-'));
const FAKE_HOME = path.join(TMP, 'openclaw');
const FAKE_WORKSPACE = path.join(TMP, 'workspace');
fs.mkdirSync(FAKE_HOME, { recursive: true });
fs.mkdirSync(FAKE_WORKSPACE, { recursive: true });

process.env.OPENCLAW_HOME = FAKE_HOME;
process.env.OPENCLAW_WORKSPACE = FAKE_WORKSPACE;

const scripts = require('./scripts.cjs');
scripts.ensureSaveOutputScript();
const SCRIPT = path.join(FAKE_HOME, 'scripts', 'save_output.sh');

function run(args, opts = {}) {
  return execFileSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, OPENCLAW_WORKSPACE: FAKE_WORKSPACE, ...(opts.env || {}) },
    input: opts.input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runExpectingFailure(args, opts = {}) {
  try {
    run(args, opts);
    return null;
  } catch (err) {
    return { status: err.status, stderr: err.stderr?.toString() || '' };
  }
}

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('copies a source file into the task output folder', () => {
  const src = path.join(TMP, 'src1.txt');
  fs.writeFileSync(src, 'hello world');
  const out = run(['task-copy', src, 'report.txt', '--description', 'first pass']).trim();

  const expected = path.join(FAKE_WORKSPACE, 'outputs', 'task-copy', 'report.txt');
  assert.equal(out, expected);
  assert.equal(fs.readFileSync(expected, 'utf-8'), 'hello world');

  const manifest = JSON.parse(fs.readFileSync(path.join(FAKE_WORKSPACE, 'outputs', 'task-copy', 'MANIFEST.json'), 'utf-8'));
  assert.equal(manifest.outputs.length, 1);
  assert.equal(manifest.outputs[0].filename, 'report.txt');
  assert.equal(manifest.outputs[0].description, 'first pass');
  assert.equal(manifest.outputs[0].size, 'hello world'.length);
});

test('reads from stdin when source is "-"', () => {
  run(['task-stdin', '-', 'from-stdin.md'], { input: 'piped content' });
  const dest = path.join(FAKE_WORKSPACE, 'outputs', 'task-stdin', 'from-stdin.md');
  assert.equal(fs.readFileSync(dest, 'utf-8'), 'piped content');
});

test('MANIFEST.json appends new entries and deduplicates by filename', () => {
  const src = path.join(TMP, 'src2.txt');
  fs.writeFileSync(src, 'v1');
  run(['task-many', src, 'a.txt']);
  fs.writeFileSync(src, 'v2-updated');
  run(['task-many', src, 'a.txt', '--description', 'v2']);   // same filename → replace
  run(['task-many', src, 'b.txt', '--description', 'sibling']);

  const manifest = JSON.parse(fs.readFileSync(path.join(FAKE_WORKSPACE, 'outputs', 'task-many', 'MANIFEST.json'), 'utf-8'));
  const names = manifest.outputs.map(o => o.filename).sort();
  assert.deepEqual(names, ['a.txt', 'b.txt']);
  const a = manifest.outputs.find(o => o.filename === 'a.txt');
  assert.equal(a.description, 'v2');
  assert.equal(a.size, 'v2-updated'.length);
});

test('rejects filenames with path separators or leading dot', () => {
  const src = path.join(TMP, 'src3.txt');
  fs.writeFileSync(src, 'x');
  for (const bad of ['../evil.txt', 'sub/f.txt', '.hidden']) {
    const res = runExpectingFailure(['task-guard', src, bad]);
    assert.ok(res, `expected failure for ${bad}`);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /plain basename/);
  }
});

test('does NOT sanitize task ids with a trailing underscore (regression for stripped newline)', () => {
  const src = path.join(TMP, 'src4.txt');
  fs.writeFileSync(src, 'z');
  const out = run(['abc123', src, 'ok.txt']).trim();
  // The folder should be exactly "abc123" — if newline bled through tr, it would be "abc123_"
  assert.equal(out, path.join(FAKE_WORKSPACE, 'outputs', 'abc123', 'ok.txt'));
  assert.equal(fs.existsSync(path.join(FAKE_WORKSPACE, 'outputs', 'abc123_')), false);
});

test('sanitizes unsafe task ids but still confines output under the outputs root', () => {
  const src = path.join(TMP, 'src5.txt');
  fs.writeFileSync(src, 'y');
  const out = run(['../escape', src, 'ok.txt']).trim();
  const root = path.join(FAKE_WORKSPACE, 'outputs');
  assert.equal(out.startsWith(root + path.sep), true);
  // '..' char gets replaced with '_' by tr
  assert.match(out, /outputs\/[a-zA-Z0-9_-]+\/ok\.txt$/);
});
