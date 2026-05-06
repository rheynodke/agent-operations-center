'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withKeyLock, withFileLock, withUserLock, _stats } = require('./locks.cjs');

test('serializes calls with the same key', async () => {
  const log = [];
  const slow = (id, ms) => withKeyLock('a', async () => {
    log.push(`enter:${id}`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`exit:${id}`);
    return id;
  });
  const out = await Promise.all([slow(1, 30), slow(2, 10), slow(3, 5)]);
  assert.deepEqual(out, [1, 2, 3]);
  assert.deepEqual(log, [
    'enter:1', 'exit:1',
    'enter:2', 'exit:2',
    'enter:3', 'exit:3',
  ]);
});

test('different keys run in parallel', async () => {
  const t0 = Date.now();
  await Promise.all([
    withKeyLock('p', () => new Promise((r) => setTimeout(r, 60))),
    withKeyLock('q', () => new Promise((r) => setTimeout(r, 60))),
    withKeyLock('r', () => new Promise((r) => setTimeout(r, 60))),
  ]);
  const elapsed = Date.now() - t0;
  // All three sleep 60ms in parallel — wallclock should be ≪ 180ms.
  // Allow generous margin for CI slowness.
  assert.ok(elapsed < 150, `expected parallel <150ms, got ${elapsed}ms`);
});

test('errors do not poison subsequent acquirers', async () => {
  await assert.rejects(
    withKeyLock('e', async () => { throw new Error('boom'); }),
    /boom/,
  );
  const ok = await withKeyLock('e', async () => 'recovered');
  assert.equal(ok, 'recovered');
});

test('tail-prune cleans up keys after release', async () => {
  await withKeyLock('temp', async () => {});
  // Allow microtask-tail prune to settle.
  await new Promise((r) => setImmediate(r));
  const stats = _stats();
  assert.equal(stats.keys, 0);
});

test('many parallel calls with same key all complete in order', async () => {
  const N = 50;
  const order = [];
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      withKeyLock('hot', async () => {
        order.push(i);
        await new Promise((r) => setImmediate(r));
      })),
  );
  assert.deepEqual(order, Array.from({ length: N }, (_, i) => i));
});

test('withFileLock and withUserLock derive distinct keys', async () => {
  const out = [];
  await Promise.all([
    withFileLock('/tmp/x.json', async () => { out.push('file'); await new Promise((r) => setTimeout(r, 20)); }),
    withUserLock(1, async () => { out.push('user'); await new Promise((r) => setTimeout(r, 20)); }),
  ]);
  // Both ran to completion; order is timing-dependent but both must appear.
  assert.equal(out.length, 2);
  assert.ok(out.includes('file'));
  assert.ok(out.includes('user'));
});
