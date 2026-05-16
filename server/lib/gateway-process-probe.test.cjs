'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parsePsOutput, psProbe } = require('./gateway-process-probe.cjs');

test('parsePsOutput: parses single line with HH:MM:SS etime', () => {
  const out = ' 12345  01:30:00 102400  4.2\n';
  const m = parsePsOutput(out);
  assert.equal(m.size, 1);
  const info = m.get(12345);
  assert.equal(info.uptimeSeconds, 5400);
  assert.equal(info.rssMb, 100);
  assert.equal(info.cpuPercent, 4.2);
});

test('parsePsOutput: parses MM:SS etime (no hour) and D-HH:MM:SS', () => {
  const out = ' 1  00:30 1024 0.1\n 2  1-02:00:00 2048 0.0\n';
  const m = parsePsOutput(out);
  assert.equal(m.get(1).uptimeSeconds, 30);
  assert.equal(m.get(2).uptimeSeconds, 1 * 86400 + 2 * 3600);
});

test('parsePsOutput: ignores blank lines and malformed rows', () => {
  const out = '\n  bogus row\n 9 10:00 5120 0.5\n';
  const m = parsePsOutput(out);
  assert.equal(m.size, 1);
  assert.equal(m.get(9).rssMb, 5);
});

test('psProbe: returns empty map for empty pid list (no ps spawn)', async () => {
  const r = await psProbe([]);
  assert.equal(r.size, 0);
});
