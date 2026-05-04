/**
 * routes/auth.cjs
 *
 * Authentication, invitation, and user management endpoints.
 * Includes both public routes (login, setup, register-invite) and
 * protected admin routes (invitations CRUD, users CRUD).
 * Step 2 of server modularization.
 */
'use strict';

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
  router.post('/auth/login', (req, res) => {
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

    db.updateLastLogin(user.id);
    const token = db.generateToken(user);

    console.log(`[auth] User "${username}" logged in`);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        canUseClaudeTerminal: Boolean(user.can_use_claude_terminal),
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
  router.post('/auth/register-invite', (req, res) => {
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

    try {
      const user = db.createUser({
        username,
        password,
        displayName: displayName || username,
        role: inv.defaultRole || 'user',
      });
      db.incrementInvitationUse(inv.id);
      const jwtToken = db.generateToken(user);
      console.log(`[auth] User "${username}" registered via invitation #${inv.id}`);
      res.json({
        token: jwtToken,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
        },
      });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already exists' });
      }
      console.error('[auth/register-invite]', err);
      res.status(500).json({ error: 'Failed to create user' });
    }
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
    res.json({ invitation: db.getInvitationById(id) });
  });

  router.delete('/invitations/:id', db.authMiddleware, db.requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.deleteInvitation(id);
    res.json({ ok: true });
  });

  // ─── Admin: Users CRUD ──────────────────────────────────────────────────────

  router.get('/users', db.authMiddleware, db.requireAdmin, (req, res) => {
    res.json({ users: db.getAllUsers() });
  });

  router.patch('/users/:id', db.authMiddleware, db.requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const target = db.getUserById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const { displayName, role, password, canUseClaudeTerminal } = req.body || {};
    if (role !== undefined && !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    // Don't let an admin demote themselves if they are the last admin
    if (role === 'user' && id === req.user.userId) {
      const admins = db.getAllUsers().filter(u => u.role === 'admin');
      if (admins.length <= 1) return res.status(400).json({ error: 'Cannot demote the last admin' });
    }
    const updated = db.updateUser(id, { displayName, role, password, canUseClaudeTerminal });
    res.json({ user: updated });
  });

  router.delete('/users/:id', db.authMiddleware, db.requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
    const target = db.getUserById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') {
      const admins = db.getAllUsers().filter(u => u.role === 'admin');
      if (admins.length <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
    }
    db.deleteUser(id);
    res.json({ ok: true });
  });

  // Get current user profile (authenticated)
  router.get('/auth/me', db.authMiddleware, (req, res) => {
    const user = db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        canUseClaudeTerminal: Boolean(user.can_use_claude_terminal),
        createdAt: user.created_at,
        lastLogin: user.last_login,
      },
    });
  });

  return router;
};
