'use strict';

/**
 * Per-user daily token budget enforcement.
 *
 * Schema lives in `users`: `daily_token_quota`, `daily_token_used`,
 * `daily_token_reset_at` (YYYYMMDD UTC bucket).
 *
 * Quota of `null` / `0` ⇒ unlimited (free tier / trusted user). Anything
 * positive is the hard cap. The counter resets lazily on the first check
 * after a UTC date change — quiet users don't burn cron cycles.
 *
 * Admin role bypasses all checks.
 */

const handle = require('./_handle.cjs');

function _todayBucket() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/**
 * Lazy import of getUserById to avoid require cycles. The `users` module
 * may not finish loading before this file's `module.exports` is read by
 * the db.cjs barrel; resolving inside the function defers the lookup.
 */
function _getUserById(id) {
  return require('../db.cjs').getUserById(id);
}

/**
 * @returns {{ allowed: boolean, unlimited?: boolean, used?: number, quota?: number, remaining?: number, role?: string }}
 */
function checkTokenBudget(userId, tokens = 0) {
  const db = handle.getDb();
  if (!db || !userId) return { allowed: true, unlimited: true };
  const u = _getUserById(userId);
  if (!u) return { allowed: true, unlimited: true };
  if (u.role === 'admin') return { allowed: true, unlimited: true, role: 'admin' };
  const quota = Number(u.daily_token_quota) || 0;
  if (quota <= 0) return { allowed: true, unlimited: true };

  const today = _todayBucket();
  const lastReset = Number(u.daily_token_reset_at) || 0;
  let used = Number(u.daily_token_used) || 0;

  if (lastReset !== today) {
    db.run('UPDATE users SET daily_token_used = 0, daily_token_reset_at = ? WHERE id = ?', [today, Number(userId)]);
    used = 0;
    handle.persist();
  }

  const allowed = used + Math.max(0, Number(tokens) || 0) <= quota;
  return { allowed, unlimited: false, used, quota, remaining: Math.max(0, quota - used) };
}

function recordTokenUsage(userId, tokens) {
  const db = handle.getDb();
  if (!db || !userId || !tokens || tokens <= 0) return;
  const today = _todayBucket();
  const u = _getUserById(userId);
  if (!u) return;
  const lastReset = Number(u.daily_token_reset_at) || 0;
  const baseUsed = lastReset === today ? (Number(u.daily_token_used) || 0) : 0;
  db.run(
    'UPDATE users SET daily_token_used = ?, daily_token_reset_at = ? WHERE id = ?',
    [baseUsed + Math.floor(Number(tokens)), today, Number(userId)]
  );
  handle.persist();
}

module.exports = { checkTokenBudget, recordTokenUsage };
