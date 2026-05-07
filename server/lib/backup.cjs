'use strict';

/**
 * Backup engine — periodic, retention-bounded snapshots of the AOC SQLite DB.
 *
 * Design choices:
 *
 * - **DB only, hourly.** SQLite is the irreplaceable state (users, agent
 *   profiles, tasks, room messages, audit log). Per-user `~/.openclaw/users/<id>/`
 *   is much larger (logs + JSONL transcripts + workspaces) and can be
 *   regenerated on agent activity, so we don't snapshot it on the same cadence
 *   — operators can rsync workspace dirs with their preferred tool.
 *
 * - **Self-consistent copy via `db.export()`.** sql.js has no `.backup` API
 *   and `fs.copyFileSync` of an in-flight DB is unsafe. Instead we serialize
 *   from memory (which is the durable image since `persistNow()` runs on
 *   shutdown). Output is a vanilla SQLite file, so `sqlite3 backup.db` works.
 *
 * - **Atomic write + rotate.** Write to `<dir>/aoc-<ts>.db.tmp`, fsync, rename
 *   to final. Old snapshots beyond retention are deleted last so a crash
 *   leaves at least the previous good snapshot.
 *
 * - **Retention:** keep last N (default 24 = ~24 hours hourly), no time-based
 *   pruning. Deterministic disk usage.
 *
 * - **Off by default.** Opt-in via `AOC_BACKUP_ENABLED=1`. Production will
 *   set it; local dev doesn't pay the disk cost.
 *
 * Env knobs:
 *   AOC_BACKUP_ENABLED        — "1" to enable (default off)
 *   AOC_BACKUP_DIR            — output dir (default `<data>/backups`)
 *   AOC_BACKUP_INTERVAL_MS    — frequency (default 3600000 = 1h)
 *   AOC_BACKUP_RETENTION      — keep last N snapshots (default 24)
 */

const fs = require('node:fs');
const path = require('node:path');

let timer = null;

function _ts() {
  // 2026-05-06T13-47-22Z — filename-safe ISO without colons.
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

function _list(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^aoc-.*\.db$/.test(f))
    .map((f) => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Take a single snapshot now. Safe to call from external triggers (admin
 * "backup now" button, pre-deploy hook). Returns the new snapshot path.
 *
 * @param {{ db?: object, dir?: string }} [opts]
 */
function snapshotOnce(opts = {}) {
  const dbMod = opts.db || require('./db.cjs');
  const dir = opts.dir || resolveBackupDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const handle = dbMod.getDb && dbMod.getDb();
  if (!handle || typeof handle.export !== 'function') {
    throw new Error('backup: DB not initialized');
  }

  const data = handle.export();
  const buffer = Buffer.from(data);
  const final = path.join(dir, `aoc-${_ts()}.db`);
  const tmp = `${final}.tmp`;
  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  // Best-effort fsync — sql.js doesn't expose it; rely on the write+rename.
  fs.renameSync(tmp, final);
  return final;
}

function pruneOld(dir, keep) {
  const entries = _list(dir);
  if (entries.length <= keep) return [];
  const toDelete = entries.slice(keep);
  for (const e of toDelete) {
    try { fs.unlinkSync(e.path); } catch (err) { console.warn(`[backup] prune ${e.name}: ${err.message}`); }
  }
  return toDelete.map((e) => e.name);
}

function resolveBackupDir() {
  const envDir = process.env.AOC_BACKUP_DIR;
  if (envDir) return path.resolve(envDir);
  const dataDir = process.env.AOC_DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(dataDir, 'backups');
}

/**
 * Start the periodic snapshot loop. Idempotent — calling twice is a no-op.
 *
 * @returns {{ enabled: boolean, dir?: string, intervalMs?: number, retention?: number }}
 */
function start() {
  if (timer) return { enabled: true, alreadyRunning: true };
  if (process.env.AOC_BACKUP_ENABLED !== '1' && process.env.AOC_BACKUP_ENABLED !== 'true') {
    return { enabled: false, reason: 'AOC_BACKUP_ENABLED not set' };
  }
  const intervalMs = Math.max(60_000, Number(process.env.AOC_BACKUP_INTERVAL_MS) || 3600_000);
  const retention = Math.max(1, Number(process.env.AOC_BACKUP_RETENTION) || 24);
  const dir = resolveBackupDir();

  // Take an immediate snapshot so operators have a baseline.
  try {
    const p = snapshotOnce({ dir });
    console.log(`[backup] initial snapshot: ${p}`);
    pruneOld(dir, retention);
  } catch (e) {
    console.warn(`[backup] initial snapshot failed: ${e.message}`);
  }

  timer = setInterval(() => {
    try {
      const p = snapshotOnce({ dir });
      const pruned = pruneOld(dir, retention);
      console.log(`[backup] snapshot ${path.basename(p)}` + (pruned.length ? ` (pruned ${pruned.length})` : ''));
    } catch (e) {
      console.warn(`[backup] periodic snapshot failed: ${e.message}`);
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[backup] started — every ${intervalMs}ms, keep last ${retention}, dir=${dir}`);
  return { enabled: true, dir, intervalMs, retention };
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function listBackups(dir = resolveBackupDir()) {
  return _list(dir).map((e) => ({ name: e.name, path: e.path, mtime: new Date(e.mtime).toISOString(), bytes: fs.statSync(e.path).size }));
}

module.exports = { start, stop, snapshotOnce, listBackups, pruneOld, resolveBackupDir };
