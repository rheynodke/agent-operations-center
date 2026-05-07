/**
 * routes/health.cjs
 *
 * Health check and dashboard overview endpoints.
 * Step 1 of server modularization.
 */
'use strict';

/**
 * @param {{ db: object, parsers: object }} deps
 * @returns {import('express').Router}
 */
module.exports = function healthRouter(deps) {
  const { db, parsers } = deps;
  const { parseScopeUserId } = require('../helpers/access-control.cjs');
  const router = require('express').Router();

  // Reduce raw signals into a single status the admin UI can dot/badge.
  // Order: error > warn > healthy > unknown. Admin's external gateway never
  // raises 'error' from gateway state (it's managed outside AOC).
  function deriveHealth({ gwState, pidAlive, overQuota, hasMaster, isAdmin }) {
    const reasons = [];
    if (gwState === 'error') reasons.push('gateway_errored');
    if (gwState === 'running' && pidAlive === false) reasons.push('pid_dead');
    if (overQuota) reasons.push('token_quota_exceeded');
    if (!hasMaster && !isAdmin) reasons.push('no_master_agent');
    if (gwState === 'stopped' || gwState === 'never_spawned') reasons.push('gateway_not_running');

    let status = 'healthy';
    if (reasons.includes('gateway_errored') || reasons.includes('pid_dead')) status = 'error';
    else if (reasons.includes('token_quota_exceeded') || reasons.includes('no_master_agent')) status = 'warn';
    else if (reasons.includes('gateway_not_running') && !isAdmin) status = 'warn';
    return { status, reasons };
  }

  // GET /health
  router.get('/health', db.authMiddleware, (req, res) => {
    res.json({ ok: true, ts: Date.now(), user: req.user.username });
  });

  // GET /overview — dashboard stats (per-user; admin can impersonate via ?owner=N)
  router.get('/overview', db.authMiddleware, (req, res) => {
    try {
      const userId = parseScopeUserId(req);
      const stats = parsers.getDashboardStats(userId);
      res.json(stats);
    } catch (err) {
      console.error('[api/overview]', err);
      res.status(500).json({ error: 'Failed to fetch overview' });
    }
  });

  // GET /admin/tenant-health — aggregated per-tenant operational view.
  // For each user we surface the dimensions admin needs at a glance to spot
  // problems before they become tickets:
  //   - gateway state (running / stopped / error / never-spawned) + age of pid
  //   - port reservation
  //   - master agent presence
  //   - daily token quota + usage + remaining
  //   - last activity timestamp
  //
  // Admin-only. Cross-tenant by design — separate from the per-user scoped
  // dashboard. Future: alert thresholds, exit codes, error rates.
  router.get('/admin/tenant-health', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const orchestrator = require('../lib/gateway-orchestrator.cjs');
      const users = db.getAllUsers() || [];
      const gwRows = (typeof orchestrator.listGateways === 'function')
        ? (orchestrator.listGateways() || [])
        : [];
      const gwByUser = new Map(gwRows.map(r => [Number(r.userId ?? r.user_id ?? r.id), r]));

      const now = Date.now();
      const tenants = users.map((u) => {
        const gw = gwByUser.get(Number(u.id)) || null;
        const quota = Number(u.daily_token_quota) || 0;
        const used = Number(u.daily_token_used) || 0;
        const overQuota = quota > 0 && used >= quota;
        // Treat admin (uid=1) specially — they use external systemd gateway, not orchestrator-spawned.
        const gwState = (Number(u.id) === 1)
          ? 'external'
          : (gw?.state || 'never_spawned');
        let pidAlive = null;
        if (gw?.pid) {
          try { process.kill(gw.pid, 0); pidAlive = true; }
          catch { pidAlive = false; }
        }
        return {
          id: u.id,
          username: u.username,
          displayName: u.display_name,
          role: u.role,
          masterAgentId: u.master_agent_id || null,
          hasMaster: !!u.master_agent_id,
          gateway: {
            state: gwState,
            pid: gw?.pid ?? null,
            pidAlive,
            port: gw?.port ?? null,
            startedAt: gw?.started_at ?? gw?.startedAt ?? null,
          },
          tokens: {
            quota: quota || null,
            used,
            remaining: quota > 0 ? Math.max(0, quota - used) : null,
            overQuota,
            unlimited: quota <= 0,
          },
          lastLogin: u.last_login,
          lastActivity: u.last_activity_at || null,
          health: deriveHealth({ gwState, pidAlive, overQuota, hasMaster: !!u.master_agent_id, isAdmin: u.role === 'admin' }),
        };
      });

      const summary = {
        totalUsers: tenants.length,
        running: tenants.filter(t => t.gateway.state === 'running' && t.gateway.pidAlive !== false).length,
        external: tenants.filter(t => t.gateway.state === 'external').length,
        stopped: tenants.filter(t => t.gateway.state === 'stopped' || t.gateway.state === 'never_spawned').length,
        error: tenants.filter(t => t.health.status === 'error').length,
        warn: tenants.filter(t => t.health.status === 'warn').length,
        overQuota: tenants.filter(t => t.tokens.overQuota).length,
      };

      res.json({ ts: now, summary, tenants });
    } catch (err) {
      console.error('[api/admin/tenant-health]', err);
      res.status(500).json({ error: 'Failed to compute tenant health' });
    }
  });

  // GET /admin/backups — list snapshots (admin only)
  router.get('/admin/backups', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const backup = require('../lib/backup.cjs');
      res.json({ dir: backup.resolveBackupDir(), backups: backup.listBackups() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /admin/backups/now — force a snapshot
  router.post('/admin/backups/now', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const backup = require('../lib/backup.cjs');
      const out = backup.snapshotOnce();
      try {
        require('../lib/audit-log.cjs').record(req, {
          action: 'backup.created',
          targetType: 'backup',
          targetId: require('node:path').basename(out),
        });
      } catch (_) {}
      res.json({ ok: true, snapshot: out });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
