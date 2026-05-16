'use strict';

/**
 * routes/gateway-metrics.cjs
 *
 * Admin-only chart data endpoints for the Gateway Metrics dashboard.
 * Spec: docs/superpowers/specs/2026-05-16-aoc-gateway-metrics-dashboard-design.md §6.5
 */

const queries = require('../lib/metrics/queries.cjs');

const VALID_LEADERBOARD_METRICS = new Set(['rss', 'cpu', 'messages_1h']);

function sendQueryError(res, err, label) {
  if (err instanceof RangeError) {
    return res.status(400).json({ error: err.message, code: err.code || 'BAD_INPUT' });
  }
  console.error(`[api/admin/gateway-metrics${label}]`, err);
  return res.status(500).json({ error: err.message });
}

function enrichUsernames(db, users) {
  if (!users.length) return;
  const rows = db.getUsersByIds(users.map((u) => u.userId));
  const byId = new Map(rows.map((r) => [r.id, r.username]));
  for (const u of users) {
    u.username = byId.get(u.userId) || null;
  }
}

module.exports = function gatewayMetricsRouter(deps) {
  const { db } = deps;
  const router = require('express').Router();

  // GET /timeseries?range=&userId?=&metric?=
  router.get('/timeseries', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const { range, userId } = req.query;
      const opts = {};
      if (userId != null && userId !== '') {
        const parsed = Number.parseInt(userId, 10);
        if (!Number.isFinite(parsed)) {
          return res.status(400).json({ error: 'Invalid userId', code: 'BAD_USER_ID' });
        }
        opts.userId = parsed;
      }
      const result = queries.timeseries(range, opts);
      enrichUsernames(db, result.users);
      res.json(result);
    } catch (err) {
      sendQueryError(res, err, '/timeseries');
    }
  });

  // GET /state-timeline?range=
  router.get('/state-timeline', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const result = queries.stateTimeline(req.query.range);
      res.json(result);
    } catch (err) {
      sendQueryError(res, err, '/state-timeline');
    }
  });

  // GET /aggregate?range=
  router.get('/aggregate', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const result = queries.aggregate(req.query.range);
      res.json(result);
    } catch (err) {
      sendQueryError(res, err, '/aggregate');
    }
  });

  // GET /leaderboard?range=&metric=&limit?=
  router.get('/leaderboard', db.authMiddleware, db.requireAdmin, (req, res) => {
    try {
      const { range, metric } = req.query;
      if (!metric || !VALID_LEADERBOARD_METRICS.has(metric)) {
        return res.status(400).json({
          error: `metric must be one of: ${Array.from(VALID_LEADERBOARD_METRICS).join(', ')}`,
          code: 'BAD_METRIC',
        });
      }
      const limit = req.query.limit != null && req.query.limit !== ''
        ? Number.parseInt(req.query.limit, 10)
        : 10;
      const result = queries.leaderboard(range, metric, limit);
      enrichUsernames(db, result);
      res.json(result);
    } catch (err) {
      sendQueryError(res, err, '/leaderboard');
    }
  });

  return router;
};
