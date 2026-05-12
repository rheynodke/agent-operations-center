'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { withKeyLock } = require('./locks.cjs');

const KEY = 'tenant-topology';

test('tenant-topology lock: concurrent register flows serialize', async () => {
  const events = [];
  const run = (label, delayMs) => withKeyLock(KEY, async () => {
    events.push(`${label}-start`);
    await new Promise(r => setTimeout(r, delayMs));
    events.push(`${label}-end`);
  });

  // Three concurrent registers — must serialize (start-end-start-end-...).
  await Promise.all([run('A', 30), run('B', 10), run('C', 5)]);

  // No interleaved start of next before prior end
  for (let i = 0; i < events.length - 1; i += 2) {
    assert.match(events[i], /-start$/, `event ${i} should be a start`);
    assert.match(events[i + 1], /-end$/, `event ${i + 1} should be the corresponding end`);
    const label = events[i].slice(0, 1);
    assert.strictEqual(events[i + 1].slice(0, 1), label, 'start and end labels must match');
  }
  assert.strictEqual(events.length, 6);
});

test('tenant-topology lock: error in one flow does NOT poison the lock', async () => {
  let secondRan = false;
  try {
    await withKeyLock(KEY, async () => { throw new Error('A failed'); });
  } catch (e) {
    assert.strictEqual(e.message, 'A failed');
  }
  await withKeyLock(KEY, async () => { secondRan = true; });
  assert.strictEqual(secondRan, true, 'subsequent acquire must still work after prior throw');
});
