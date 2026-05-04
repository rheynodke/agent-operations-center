/**
 * routes/browser-harness.cjs
 *
 * Browser Harness (Layer 1 core) — pool, launcher, installer, Odoo endpoints.
 * Step 6c of server modularization.
 */
'use strict';

module.exports = function browserHarnessRouter(deps) {
  const { db, parsers } = deps;
  const router = require('express').Router();

// ─── Browser Harness (Layer 1 core) ──────────────────────────────────────────
//
// Built-in skill that bundles browser-use/browser-harness and manages a pool
// of real Chrome instances on the AOC host. Admin-only mutations.

// GET /api/browser-harness/status — install + Chrome detection + pool snapshot
  router.get('/browser-harness/status', db.authMiddleware, (req, res) => {
  try {
    const installer = parsers.browserHarnessInstaller;
    const launcher = parsers.browserHarnessLauncher;
    const pool = parsers.browserHarnessPool;
    res.json({
      install: installer.status(),
      chromePath: launcher.detectChromePath(),
      slots: pool.snapshot(),
    });
  } catch (err) {
    console.error('[browser-harness/status]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/browser-harness/install — clone or update upstream (admin)
// body: { commit?: string, force?: boolean }
  router.post('/browser-harness/install', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { commit, force } = req.body || {};
    const result = parsers.browserHarnessInstaller.installCore({ commit, force: !!force });
    res.json(result);
  } catch (err) {
    console.error('[browser-harness/install]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/browser-harness/boot — boot a Chrome slot (admin)
// body: { slotId?: number } — defaults to 1
  router.post('/browser-harness/boot', db.authMiddleware, db.requireAdmin, async (req, res) => {
  try {
    const slotId = Number(req.body?.slotId || 1);
    const result = await parsers.browserHarnessPool.boot(slotId);
    res.json({ ok: true, slot: result });
  } catch (err) {
    console.error('[browser-harness/boot]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/browser-harness/odoo/status — Layer 2 install state + module list
  router.get('/browser-harness/odoo/status', db.authMiddleware, (req, res) => {
  try {
    res.json(parsers.browserHarnessOdoo.status());
  } catch (err) {
    console.error('[browser-harness/odoo/status]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/browser-harness/odoo/install — re-write bundled files (admin)
// body: { force?: boolean } — force=true overwrites user-edited files
  router.post('/browser-harness/odoo/install', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const result = parsers.browserHarnessOdoo.install({ force: !!req.body?.force });
    // Re-sync built-in scripts for all agents — runbook-* scripts may have just
    // become available, so agents with browser-harness-odoo skill enabled need them injected.
    syncBuiltinsForAllAgents();
    res.json(result);
  } catch (err) {
    console.error('[browser-harness/odoo/install]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/browser-harness/acquire — agent-facing slot acquisition.
// Auto-boots Chrome if slot is down. Authenticated only (not admin) — agents
// authenticate via service token. body: { agentId?: string, slotId?: number }
  router.post('/browser-harness/acquire', db.authMiddleware, async (req, res) => {
  try {
    // slotId omitted → pool finds the best available slot (idle preferred,
    // then down). slotId=0 also means "any".
    const requested = Number(req.body?.slotId || 0);
    const slotId = requested > 0 ? requested : null;
    const agentId = String(req.body?.agentId || req.user?.username || 'unknown');
    const result = await parsers.browserHarnessPool.acquire(slotId, agentId);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[browser-harness/acquire]', err);
    res.status(503).json({ error: err.message });
  }
});

// POST /api/browser-harness/release — release a slot back to the pool
// body: { slotId?: number }
  router.post('/browser-harness/release', db.authMiddleware, (req, res) => {
  try {
    const slotId = Number(req.body?.slotId || 1);
    const released = parsers.browserHarnessPool.release(slotId);
    res.json({ ok: true, slotId, released });
  } catch (err) {
    console.error('[browser-harness/release]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/browser-harness/stop — stop a slot (admin)
// body: { slotId?: number } — defaults to 1; pass slotId=0 (or all=true) for all slots
  router.post('/browser-harness/stop', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    if (req.body?.all) {
      parsers.browserHarnessPool.stopAll();
      return res.json({ ok: true, stopped: 'all' });
    }
    const slotId = Number(req.body?.slotId || 1);
    parsers.browserHarnessPool.stop(slotId);
    res.json({ ok: true, slotId });
  } catch (err) {
    console.error('[browser-harness/stop]', err);
    res.status(500).json({ error: err.message });
  }
});


  return router;
};
