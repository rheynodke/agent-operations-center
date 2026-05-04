'use strict';
/**
 * One-shot backfill: assign rows missing ownership to the lowest-id admin user.
 * Idempotent — only updates rows where the ownership column is NULL.
 *
 * @param {object} rawDb - the underlying sql.js Database (db.getDb() return value)
 */
function run(rawDb) {
  const adminRes = rawDb.exec("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
  if (!adminRes[0] || !adminRes[0].values.length) {
    return { skipped: true, reason: 'no admin user' };
  }
  const adminId = Number(adminRes[0].values[0][0]);

  const updates = [
    { table: 'agent_profiles', col: 'provisioned_by' },
    { table: 'projects',       col: 'created_by' },
    { table: 'connections',    col: 'created_by' },
    { table: 'mission_rooms',  col: 'created_by' },
    { table: 'epics',          col: 'created_by' },
    { table: 'project_memory', col: 'created_by' },
    { table: 'pipelines',      col: 'created_by' },
    { table: 'invitations',    col: 'created_by' },
  ];

  const counts = {};
  for (const { table, col } of updates) {
    // Some tables may not exist on every install; guard each.
    try {
      const before = rawDb.exec(`SELECT COUNT(*) FROM ${table} WHERE ${col} IS NULL`);
      const orphans = Number(before[0]?.values?.[0]?.[0] ?? 0);
      if (orphans > 0) {
        rawDb.run(`UPDATE ${table} SET ${col} = ? WHERE ${col} IS NULL`, [adminId]);
      }
      counts[table] = orphans;
    } catch (e) {
      counts[table] = `error: ${e.message}`;
    }
  }

  return { adminId, counts };
}

module.exports = { run };
