'use strict';

/**
 * Admin announcements routes — broadcast a banner message to every user, with
 * per-user dismissal so it doesn't keep nagging readers who saw it.
 *
 *   GET  /api/announcements/active        — caller's undismissed list
 *   POST /api/announcements/:id/dismiss   — current user marks as read
 *   GET  /api/admin/announcements         — admin: every announcement (history)
 *   POST /api/admin/announcements         — admin: create + broadcast
 *   POST /api/admin/announcements/:id/deactivate — admin: soft-delete
 */

module.exports = function announcementsRouter(deps) {
  const { db } = deps;
  const router = require('express').Router();

  // Optional WS broadcaster — when wired, every connected dashboard reacts to
  // `announcement:new` (banner appears) or `announcement:dismissed` (multi-tab
  // sync). Falls back gracefully if the bootstrap module hasn't injected one.
  let _broadcast = null;
  try {
    const ws = require('../bootstrap/websocket.cjs');
    _broadcast = ws.broadcast || null;
  } catch (_) { /* websocket bootstrap optional in unit tests */ }
  function broadcast(event) {
    if (typeof _broadcast === 'function') {
      try { _broadcast(event); } catch (e) {
        console.warn('[announcements] broadcast failed:', e.message);
      }
    }
  }

  // ─── Caller-facing ─────────────────────────────────────────────────────────

  router.get('/announcements/active', db.authMiddleware, (req, res) => {
    try {
      const uid = Number(req.user.userId ?? req.user.id);
      if (!Number.isInteger(uid) || uid <= 0) {
        return res.status(400).json({ error: 'no user scope' });
      }
      res.json({ announcements: db.listActiveForUser(uid) });
    } catch (err) {
      console.error('[GET /announcements/active]', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/announcements/:id/dismiss', db.authMiddleware, (req, res) => {
    try {
      const uid = Number(req.user.userId ?? req.user.id);
      const aid = Number(req.params.id);
      if (!Number.isInteger(aid) || aid <= 0) {
        return res.status(400).json({ error: 'invalid announcement id' });
      }
      db.markAnnouncementRead(aid, uid);
      broadcast({ type: 'announcement:dismissed', payload: { announcementId: aid, userId: uid } });
      res.json({ ok: true });
    } catch (err) {
      console.error('[POST /announcements/:id/dismiss]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Admin ─────────────────────────────────────────────────────────────────

  router.get('/admin/announcements', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const rows = db.listAll().map(a => ({ ...a, readCount: db.getReadCount(a.id) }));
      res.json({ announcements: rows });
    } catch (err) {
      console.error('[GET /admin/announcements]', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/admin/announcements', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const { title, body, severity, expiresAt } = req.body || {};
      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title required' });
      }
      const created = db.createAnnouncement({
        title,
        body,
        severity,
        createdBy: Number(req.user.userId ?? req.user.id),
        expiresAt: expiresAt || null,
      });
      // Best-effort audit (resilient to module absence — same pattern as
      // /api/config/providers/sync).
      try {
        const audit = require('../lib/audit-log.cjs');
        audit.record(req, {
          action: 'announcement.created',
          targetType: 'announcement',
          targetId: String(created.id),
          after: { title: created.title, severity: created.severity },
        });
      } catch (_) { /* audit module may be absent in test fixtures */ }
      broadcast({ type: 'announcement:new', payload: created });
      res.json({ ok: true, announcement: created });
    } catch (err) {
      console.error('[POST /admin/announcements]', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/admin/announcements/:id/deactivate', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const aid = Number(req.params.id);
      if (!Number.isInteger(aid) || aid <= 0) {
        return res.status(400).json({ error: 'invalid id' });
      }
      const updated = db.deactivateAnnouncement(aid);
      if (!updated) return res.status(404).json({ error: 'not found' });
      broadcast({ type: 'announcement:deactivated', payload: { announcementId: aid } });
      res.json({ ok: true, announcement: updated });
    } catch (err) {
      console.error('[POST /admin/announcements/:id/deactivate]', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
