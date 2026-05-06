'use strict';

/**
 * locks.cjs — In-memory promise-chain mutex.
 *
 * Single AOC instance, sql.js synchronous DB, in-process Express handlers.
 * No need for file locks or Redis; a per-key promise chain is enough.
 *
 * `withKeyLock(key, fn)` runs `fn` exclusively for that key. Different keys
 * run in parallel. Tail-prune avoids unbounded Map growth.
 */

const queues = new Map(); // key -> tail Promise

const SOFT_KEY_LIMIT = 10_000;
let warned = false;

async function withKeyLock(key, fn) {
  if (typeof key !== 'string' || !key) {
    throw new TypeError('withKeyLock: key must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('withKeyLock: fn must be a function');
  }

  const prev = queues.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => { release = r; });
  // Tail is whatever runs after `prev` AND `fn`'s release — we publish the
  // chained tail so subsequent acquirers wait for both.
  const tail = prev.then(() => next).catch(() => next);
  queues.set(key, tail);

  if (queues.size > SOFT_KEY_LIMIT && !warned) {
    warned = true;
    console.warn(`[locks] queues map exceeded ${SOFT_KEY_LIMIT} keys — possible leak`);
  }

  await prev.catch(() => {}); // we don't propagate prior errors to next holder
  try {
    return await fn();
  } finally {
    release();
    // Tail-prune: only the actual tail-holder may delete, otherwise we'd
    // race with a fresh waiter that just published its own tail.
    if (queues.get(key) === tail) queues.delete(key);
  }
}

const withFileLock = (absPath, fn) => withKeyLock(`file:${absPath}`, fn);
const withUserLock = (userId, fn) => withKeyLock(`user:${Number(userId)}`, fn);

function _stats() {
  return { keys: queues.size };
}

module.exports = {
  withKeyLock,
  withFileLock,
  withUserLock,
  _stats,
};
