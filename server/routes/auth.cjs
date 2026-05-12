/**
 * routes/auth.cjs
 *
 * Authentication, invitation, and user management endpoints.
 * Includes both public routes (login, setup, register-invite) and
 * protected admin routes (invitations CRUD, users CRUD).
 * Step 2 of server modularization.
 */
'use strict';

const orchestrator = require('../lib/gateway-orchestrator.cjs');
const { gatewayPool } = require('../lib/gateway-ws.cjs');
const audit = require('../lib/audit-log.cjs');
const { withKeyLock } = require('../lib/locks.cjs');

// Tenant-topology mutex. Serializes register flows so that two concurrent
// registrations cannot interleave createUser + spawnGateway + sandbox
// refresh. Without this, peer A's sandbox profile could miss peer B if B
// commits after A reads db.getAllUsers(). The window converges within a
// few seconds anyway (each peer's refresh restarts the others), but the
// lock closes it deterministically — important because newly-registered
// tenants start populating data within the first minute.
const TENANT_TOPOLOGY_LOCK = 'tenant-topology';

/** Per-user mutex so two simultaneous logins for the same user dedupe spawn. */
const _spawnInflight = new Map();

/**
 * Ensure user N has a running gateway connected to the pool.
 * - userId === 1: no-op (admin uses external manual gateway).
 * - userId !== 1: spawn if needed, connect pool, wait for handshake.
 */
async function ensureUserGateway(userId) {
  if (Number(userId) === 1) return;

  if (_spawnInflight.has(userId)) {
    return _spawnInflight.get(userId);
  }

  const work = (async () => {
    const dbState = orchestrator.getGatewayState(userId);
    let token;
    let port;
    if (dbState.state === 'running' && orchestrator.getRunningToken(userId)) {
      token = orchestrator.getRunningToken(userId);
      port = dbState.port;
    } else {
      if (dbState.pid != null) {
        try { await orchestrator.stopGateway(userId); } catch (_) {}
      }
      const spawned = await orchestrator.spawnGateway(userId);
      token = spawned.token;
      port = spawned.port;
    }

    const conn = gatewayPool.forUser(userId);
    if (!conn.isConnected) {
      conn.connect({ port, token });
      const start = Date.now();
      while (!conn.isConnected && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!conn.isConnected) {
        throw new Error(`pool connect timeout for user ${userId}`);
      }
    }
  })();

  _spawnInflight.set(userId, work);
  try {
    await work;
  } finally {
    _spawnInflight.delete(userId);
  }
}

/**
 * @param {{ db: object }} deps
 * @returns {import('express').Router}
 */
module.exports = function authRouter(deps) {
  const { db } = deps;
  const router = require('express').Router();

  // ─── Public Routes (no auth middleware) ──────────────────────────────────────

  // Check if system needs initial setup
  router.get('/auth/status', (req, res) => {
    res.json({
      needsSetup: !db.hasAnyUsers(),
      version: '2.0.0',
    });
  });

  // Initial admin setup (only works when NO users exist)
  router.post('/auth/setup', (req, res) => {
    if (db.hasAnyUsers()) {
      return res.status(403).json({ error: 'Setup already completed. Admin user exists.' });
    }

    const { username, password, displayName } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    try {
      const user = db.createUser({
        username,
        password,
        displayName: displayName || username,
        role: 'admin',
      });

      const token = db.generateToken(user);
      console.log(`[auth] Initial admin "${username}" created successfully`);

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
        },
      });
    } catch (err) {
      console.error('[auth/setup]', err);
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already exists' });
      }
      res.status(500).json({ error: 'Failed to create admin user' });
    }
  });

  // Login
  router.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!db.verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Ensure the user's gateway is running and connected before issuing JWT.
    try {
      await ensureUserGateway(user.id);
    } catch (e) {
      console.error(`[auth] gateway spawn failed for user ${user.id}: ${e.message}`);
      return res.status(503).json({
        error: 'Could not start your workspace',
        code: 'GATEWAY_SPAWN_FAILED',
        details: String(e?.message ?? e),
      });
    }

    db.updateLastLogin(user.id);
    const token = db.generateToken(user);

    console.log(`[auth] User "${username}" logged in (id=${user.id})`);

    const masterAgentId = user.master_agent_id || null;
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        canUseClaudeTerminal: Boolean(user.can_use_claude_terminal),
        hasMaster: Boolean(masterAgentId),
        masterAgentId,
      },
    });
  });

  // ─── Invitation-based registration (public) ─────────────────────────────────

  // Validate an invitation token (used by /register page before submit)
  router.get('/invitations/validate/:token', (req, res) => {
    const inv = db.getInvitationByToken(req.params.token);
    if (!inv) return res.status(404).json({ valid: false, error: 'Invitation not found' });
    if (inv.revokedAt) return res.status(410).json({ valid: false, error: 'Invitation revoked' });
    if (inv.expired)   return res.status(410).json({ valid: false, error: 'Invitation expired' });
    res.json({ valid: true, defaultRole: inv.defaultRole, expiresAt: inv.expiresAt });
  });

  // Register a new user via invitation token
  router.post('/auth/register-invite', async (req, res) => {
    const { token, username, password, displayName } = req.body || {};
    if (!token || !username || !password) {
      return res.status(400).json({ error: 'token, username and password are required' });
    }
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const inv = db.getInvitationByToken(token);
    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    if (inv.revokedAt) return res.status(410).json({ error: 'Invitation revoked' });
    if (inv.expired)   return res.status(410).json({ error: 'Invitation expired' });

    // Serialize the whole tenant-creation flow (createUser → spawnGateway →
    // sandbox refresh) so two concurrent registers cannot leave a peer with
    // a stale deny list. See TENANT_TOPOLOGY_LOCK comment up top.
    let user;
    try {
      user = await withKeyLock(TENANT_TOPOLOGY_LOCK, async () => {
        const u = db.createUser({
          username,
          password,
          displayName: displayName || username,
          role: inv.defaultRole || 'user',
        });
        db.incrementInvitationUse(inv.id);

        // Note: per-user "General" project is auto-created in onboarding/master
        // (after the master agent exists), NOT here — otherwise the project's
        // default mission room falls back to admin's `main` because
        // `getUserMasterAgentId(uid)` returns null at this point.

        // Provision the new user's gateway during registration. This is the
        // primary spawn point — login retains the call as a silent fallback for
        // post-AOC-restart recovery.
        await ensureUserGateway(u.id);

        // Refresh peer gateways so their sandbox profiles include the new
        // user in the cross-tenant deny list. AWAITED inside the lock so the
        // lock release guarantees full convergence — no race with the next
        // concurrent register.
        try {
          const r = await orchestrator.refreshTenantSandboxes(u.id);
          console.log(`[auth] sandbox refresh restarted peers:`, r.restarted);
        } catch (e) {
          console.warn(`[auth] sandbox refresh failed: ${e.message} — peers may have stale profiles; next register will fix`);
        }
        return u;
      });
    } catch (e) {
      if (e?.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already exists' });
      }
      console.error(`[auth/register-invite] tenant provisioning failed: ${e.message}`);
      return res.status(503).json({
        error: 'Account created but workspace setup failed. Please contact admin.',
        code: 'GATEWAY_SPAWN_FAILED',
        details: String(e?.message ?? e),
      });
    }

    const jwtToken = db.generateToken(user);
    console.log(`[auth] User "${username}" registered via invitation #${inv.id}`);
    res.json({
      token: jwtToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        hasMaster: false,
        masterAgentId: null,
      },
    });
  });

  // ─── Admin: Invitations CRUD ────────────────────────────────────────────────

  router.get('/invitations', db.authMiddleware, db.requireAdmin, (req, res) => {
    res.json({ invitations: db.getAllInvitations() });
  });

  router.post('/invitations', db.authMiddleware, db.requireAdmin, (req, res) => {
    const { expiresAt, defaultRole = 'user', note } = req.body || {};
    if (!expiresAt) return res.status(400).json({ error: 'expiresAt is required (ISO string)' });
    const expDate = new Date(expiresAt);
    if (isNaN(expDate.getTime())) return res.status(400).json({ error: 'Invalid expiresAt' });
    if (expDate.getTime() <= Date.now()) return res.status(400).json({ error: 'expiresAt must be in the future' });
    if (!['user', 'admin'].includes(defaultRole)) return res.status(400).json({ error: 'Invalid defaultRole' });
    try {
      const inv = db.createInvitation({
        createdBy: req.user.userId,
        expiresAt: expDate.toISOString(),
        defaultRole,
        note,
      });
      audit.record(req, {
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: inv.id,
        after: { defaultRole, expiresAt: expDate.toISOString(), note: note || null },
      });
      res.json({ invitation: inv });
    } catch (err) {
      console.error('[invitations/create]', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/invitations/:id/revoke', db.authMiddleware, db.requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const inv = db.getInvitationById(id);
    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    db.revokeInvitation(id);
    audit.record(req, { action: 'invitation.revoked', targetType: 'invitation', targetId: id });
    res.json({ invitation: db.getInvitationById(id) });
  });

  router.delete('/invitations/:id', db.authMiddleware, db.requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.deleteInvitation(id);
    audit.record(req, { action: 'invitation.deleted', targetType: 'invitation', targetId: id });
    res.json({ ok: true });
  });

  // ─── Admin: Users CRUD ──────────────────────────────────────────────────────

  router.get('/users', db.authMiddleware, db.requireAdmin, (req, res) => {
    res.json({ users: db.getAllUsers() });
  });

  // Admin-only password reset for any user (recovery flow).
  // Body: { password: string (min 6 chars) }
  router.post('/users/:id/reset-password', db.authMiddleware, db.requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
    const target = db.getUserById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    db.updateUser(id, { password });
    audit.record(req, {
      action: 'user.password_reset',
      targetType: 'user',
      targetId: id,
      reason: req.body?.reason || null,
    });
    console.log(`[users/reset-password] admin=${req.user.username} (id=${req.user.userId}) reset password for user="${target.username}" (id=${id})`);
    // Note: JWT is stateless so previously-issued tokens stay valid until expiry.
    // Acceptable for an admin-recovery flow; user should be told to log out & back in.
    res.json({ ok: true });
  });

  router.patch('/users/:id', db.authMiddleware, db.requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const target = db.getUserById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const { displayName, role, password, canUseClaudeTerminal, dailyTokenQuota } = req.body || {};
    if (role !== undefined && !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (dailyTokenQuota !== undefined && dailyTokenQuota !== null && dailyTokenQuota !== '') {
      const n = Number(dailyTokenQuota);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'dailyTokenQuota must be a non-negative number, or 0/null to disable the cap' });
      }
    }
    // Don't let an admin demote themselves if they are the last admin
    if (role === 'user' && id === req.user.userId) {
      const admins = db.getAllUsers().filter(u => u.role === 'admin');
      if (admins.length <= 1) return res.status(400).json({ error: 'Cannot demote the last admin' });
    }
    const before = {
      displayName: target.display_name,
      role: target.role,
      canUseClaudeTerminal: target.can_use_claude_terminal,
      dailyTokenQuota: target.daily_token_quota,
    };
    const updated = db.updateUser(id, { displayName, role, password, canUseClaudeTerminal, dailyTokenQuota });
    if (role !== undefined && role !== before.role) {
      audit.record(req, {
        action: 'user.role_changed',
        targetType: 'user', targetId: id,
        before: { role: before.role }, after: { role },
      });
    }
    if (password !== undefined) {
      audit.record(req, { action: 'user.password_changed', targetType: 'user', targetId: id });
    }
    if (dailyTokenQuota !== undefined && Number(dailyTokenQuota || 0) !== Number(before.dailyTokenQuota || 0)) {
      audit.record(req, {
        action: 'user.token_quota_changed',
        targetType: 'user', targetId: id,
        before: { dailyTokenQuota: before.dailyTokenQuota },
        after: { dailyTokenQuota: dailyTokenQuota || null },
      });
    }
    res.json({ user: updated });
  });

  router.delete('/users/:id', db.authMiddleware, db.requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
    if (id === req.user.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
    if (id === 1) return res.status(400).json({ error: 'Cannot delete the bootstrap admin (id=1)' });
    const target = db.getUserById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') {
      const admins = db.getAllUsers().filter(u => u.role === 'admin');
      if (admins.length <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
    }

    const fs = require('fs');
    const path = require('path');
    const orchestrator = require('../lib/gateway-orchestrator.cjs');
    const { getUserHome, OPENCLAW_BASE } = require('../lib/config.cjs');

    const summary = { gateway: null, fs: null, db: null };

    // 1) Stop the user's gateway (best-effort) so no in-flight writes hit the home dir
    //    while we wipe it. Orchestrator clears its in-memory state + DB row too,
    //    and now also sweeps orphan PIDs (gateways from prior AOC sessions whose
    //    OS process survived an AOC restart).
    try {
      await orchestrator.stopGateway(id);
      // Extra safety pass: catch any orphan that survived the in-target sweep
      // (e.g., a gateway from a previous session still bound to a port in our
      // managed range with no DB row).
      const stragglers = orchestrator.findAocManagedOrphanPids({ userId: id });
      for (const pid of stragglers) {
        try { process.kill(pid, 'SIGTERM'); } catch (_) {}
      }
      if (stragglers.length) {
        await new Promise((r) => setTimeout(r, 600));
        for (const pid of stragglers) {
          try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (_) {}
        }
      }
      summary.gateway = stragglers.length ? `stopped+killed ${stragglers.length} straggler(s)` : 'stopped';
    } catch (e) {
      summary.gateway = `stop-failed:${e.message}`;
    }

    // 2) Remove the user's filesystem home (~/.openclaw/users/<id>/.openclaw and
    //    its parent ~/.openclaw/users/<id>) — guarded by a strict prefix check
    //    so we never accidentally rm anything outside the per-user tree.
    try {
      const userHome = getUserHome(id);                 // .../users/<id>/.openclaw
      const userRoot = path.dirname(userHome);          // .../users/<id>
      const expectedPrefix = path.join(OPENCLAW_BASE, 'users') + path.sep;
      if (!userRoot.startsWith(expectedPrefix)) {
        throw new Error(`refusing to remove "${userRoot}" — outside per-user tree`);
      }
      if (fs.existsSync(userRoot)) {
        fs.rmSync(userRoot, { recursive: true, force: true });
        summary.fs = `removed:${userRoot}`;
      } else {
        summary.fs = 'no-home-dir';
      }
    } catch (e) {
      summary.fs = `remove-failed:${e.message}`;
    }

    // 3) Cascade DB rows owned by this user (and the user row itself).
    try {
      const result = db.purgeUserData(id);
      summary.db = result.counts;
    } catch (e) {
      summary.db = `purge-failed:${e.message}`;
    }

    audit.record(req, {
      action: 'user.deleted',
      targetType: 'user',
      targetId: id,
      before: { username: target.username, role: target.role },
      after: { summary },
    });
    console.log(`[users/delete] uid=${id} (${target.username}) summary=`, summary);
    res.json({ ok: true, summary });
  });

  // Get current user profile (authenticated)
  router.get('/auth/me', db.authMiddleware, (req, res) => {
    const user = db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const masterAgentId = user.master_agent_id || null;
    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        canUseClaudeTerminal: Boolean(user.can_use_claude_terminal),
        createdAt: user.created_at,
        lastLogin: user.last_login,
        hasMaster: Boolean(masterAgentId),
        masterAgentId,
      },
    });
  });

  // Admin-only read of the audit trail. Filterable; latest first.
  router.get('/audit-log', db.authMiddleware, db.requireAdmin, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const entries = audit.list({
      actorId: req.query.actorId ? Number(req.query.actorId) : undefined,
      targetType: req.query.targetType || undefined,
      targetId: req.query.targetId || undefined,
      action: req.query.action || undefined,
      since: req.query.since || undefined,
      limit,
      offset,
    });
    res.json({ entries });
  });

  return router;
};
