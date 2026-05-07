'use strict';

/**
 * Append-only audit log writer + reader.
 *
 * Routes call `audit.record(req, { action, targetType, targetId, before, after, reason })`
 * after a successful mutation. Never throws — audit failure should never
 * break the user-facing operation, just log + continue.
 *
 * Standard action verbs (extend as needed, but keep consistent):
 *   user.created               connection.created
 *   user.role_changed          connection.deleted
 *   user.password_reset        connection.assigned
 *   user.deleted               agent.created
 *   invitation.created         agent.deleted
 *   invitation.revoked         agent.renamed
 *   onboarding.master_linked   agent.role_changed
 *
 * Pattern: `<resource>.<verb>` — singular resource, past-tense verb.
 */

const dbMod = require('./db.cjs');

/**
 * @param {object} req     - Express req (used for actor + IP).
 * @param {object} entry   - { action, targetType?, targetId?, before?, after?, reason? }
 * @returns {void}
 */
function record(req, entry) {
  if (!entry || !entry.action) {
    console.warn('[audit] missing action — skipped');
    return;
  }
  try {
    const raw = dbMod.getDb();
    if (!raw) return;
    const actorId = req?.user?.userId ?? null;
    const actorRole = req?.user?.role ?? null;
    const ip = (req?.headers?.['x-forwarded-for'] || req?.ip || '').toString().split(',')[0].trim() || null;
    raw.run(
      `INSERT INTO audit_log
         (actor_id, actor_role, action, target_type, target_id, before, after, reason, request_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorId,
        actorRole,
        String(entry.action),
        entry.targetType || null,
        entry.targetId != null ? String(entry.targetId) : null,
        entry.before != null ? JSON.stringify(entry.before) : null,
        entry.after  != null ? JSON.stringify(entry.after)  : null,
        entry.reason || null,
        ip,
      ]
    );
    dbMod.persist();
  } catch (err) {
    console.error('[audit] record failed:', err.message, '— action:', entry.action);
  }
}

/**
 * Read audit entries with simple filters. Admin-only by route convention.
 *
 * @param {object} opts - { actorId?, targetType?, targetId?, action?, since?, limit?, offset? }
 * @returns {object[]}
 */
function list(opts = {}) {
  const raw = dbMod.getDb();
  if (!raw) return [];
  const where = [];
  const args = [];
  if (opts.actorId    != null) { where.push('actor_id = ?');    args.push(Number(opts.actorId)); }
  if (opts.targetType)         { where.push('target_type = ?'); args.push(String(opts.targetType)); }
  if (opts.targetId   != null) { where.push('target_id = ?');   args.push(String(opts.targetId)); }
  if (opts.action)             { where.push('action = ?');      args.push(String(opts.action)); }
  if (opts.since)              { where.push('created_at >= ?'); args.push(String(opts.since)); }
  const sql = `
    SELECT id, actor_id, actor_role, action, target_type, target_id, before, after, reason, request_ip, created_at
    FROM audit_log
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;
  args.push(Number(opts.limit) || 100, Number(opts.offset) || 0);
  const res = raw.exec(sql, args);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map((row) => {
    const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    if (obj.before) try { obj.before = JSON.parse(obj.before); } catch { /* keep raw */ }
    if (obj.after)  try { obj.after  = JSON.parse(obj.after);  } catch { /* keep raw */ }
    return obj;
  });
}

module.exports = { record, list };
