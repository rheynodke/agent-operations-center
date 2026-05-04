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
  const router = require('express').Router();

  // GET /health
  router.get('/health', db.authMiddleware, (req, res) => {
    res.json({ ok: true, ts: Date.now(), user: req.user.username });
  });

  // GET /overview — dashboard stats
  router.get('/overview', db.authMiddleware, (req, res) => {
    try {
      const stats = parsers.getDashboardStats();
      res.json(stats);
    } catch (err) {
      console.error('[api/overview]', err);
      res.status(500).json({ error: 'Failed to fetch overview' });
    }
  });

  return router;
};
