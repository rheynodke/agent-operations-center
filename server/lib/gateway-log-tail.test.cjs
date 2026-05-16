'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tailFile, clampLines } = require('./gateway-log-tail.cjs');

test('clampLines: bounds value to 10..2000', () => {
  assert.equal(clampLines(0), 10);
  assert.equal(clampLines(500), 500);
  assert.equal(clampLines(5000), 2000);
  assert.equal(clampLines('abc'), 200);  // default for non-numeric
  assert.equal(clampLines(undefined), 200);
});

test('tailFile: returns last N lines', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-tail-'));
  const file = path.join(dir, 'log');
  fs.writeFileSync(file, Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'));
  try {
    const r = await tailFile({ file, lines: 10 });
    assert.equal(r.notFound, false);
    assert.deepEqual(r.lines, [
      'line 40', 'line 41', 'line 42', 'line 43', 'line 44',
      'line 45', 'line 46', 'line 47', 'line 48', 'line 49',
    ]);
    assert.equal(r.logFile, file);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tailFile: returns notFound for missing file', async () => {
  const r = await tailFile({ file: '/nonexistent/log', lines: 10 });
  assert.equal(r.notFound, true);
  assert.deepEqual(r.lines, []);
});
