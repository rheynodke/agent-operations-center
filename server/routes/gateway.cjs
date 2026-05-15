/**
 * routes/gateway.cjs
 *
 * Gateway management + AI generation + metrics endpoints.
 * Step 5 of server modularization.
 */
'use strict';
const path = require('path');
const net = require('net');
const { exec, spawn } = require('child_process');
const orchestrator = require('../lib/gateway-orchestrator.cjs');
const { parseScopeUserId } = require('../helpers/access-control.cjs');

// ─── Gateway helpers (module-scoped state) ─────────────────────────────────────

function getGatewayConfig(parsers) {
  const configPath = path.join(parsers.OPENCLAW_HOME, 'openclaw.json');
  try {
    const raw = require('fs').readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    return config.gateway || {};
  } catch { return {}; }
}

function checkGatewayPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

function findGatewayPid(callback) {
  exec("pgrep -f 'openclaw-gateway'", (err, stdout) => {
    const pids = stdout.trim().split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
    callback(pids);
  });
}

let restartLock = false;

// macOS launchd label used by the admin gateway installer. When this service
// is loaded, launchd's KeepAlive=true will auto-respawn the gateway on exit —
// so AOC must NOT spawn its own copy after SIGTERM, or we get duplicate
// gateways (each running its own cron scheduler → duplicate Telegram sends
// scaled to the number of zombies).
const LAUNCHD_LABEL = process.env.OPENCLAW_LAUNCHD_LABEL || 'ai.openclaw.gateway';

function isLaunchdManaged(cb) {
  exec(`launchctl list ${LAUNCHD_LABEL}`, { timeout: 3000 }, (err, stdout) => {
    cb(!err && /"PID"\s*=\s*\d+/.test(stdout));
  });
}

function getLaunchdPid(cb) {
  exec(`launchctl list ${LAUNCHD_LABEL}`, { timeout: 3000 }, (err, stdout) => {
    const m = !err && stdout.match(/"PID"\s*=\s*(\d+)/);
    cb(m ? Number(m[1]) : null);
  });
}

/**
 * Identify admin gateways by inspecting OPENCLAW_HOME env. Per-user gateways
 * always have OPENCLAW_HOME=~/.openclaw/users/N/.openclaw; admin has
 * OPENCLAW_HOME=~/.openclaw with no /users/ segment.
 */
function isAdminGatewayPid(pid, cb) {
  exec(`ps eww -p ${pid} -o command=`, { timeout: 2000, maxBuffer: 256 * 1024 }, (err, stdout) => {
    if (err || !stdout) return cb(false);
    const m = stdout.match(/OPENCLAW_HOME=(\S+)/);
    if (!m) return cb(false);
    const home = m[1];
    cb(!home.includes('/users/'));
  });
}

/**
 * One-time sweep at AOC startup: kill any admin-gateway zombies left over
 * from previous AOC runs that used the legacy SIGTERM+spawn restart path.
 *
 * A "zombie" is an admin `openclaw-gateway` (identified by OPENCLAW_HOME with
 * no `/users/` segment) that is not the PID launchd currently owns. Such
 * processes were spawned by AOC's old restartGateway() and lost their port
 * race with launchd's KeepAlive respawn, but they kept running with the
 * telegram + cron plugins active, causing duplicate Telegram sends scaled
 * to the zombie count.
 */
function sweepAdminGatewayZombies() {
  getLaunchdPid((launchdPid) => {
    exec("pgrep -f 'openclaw-gateway'", (err, stdout) => {
      if (err) return;
      const gwPids = stdout.trim().split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
      if (gwPids.length === 0) return;

      let pending = gwPids.length;
      const zombies = [];
      gwPids.forEach((pid) => {
        if (pid === launchdPid) {
          if (--pending === 0) finalize();
          return;
        }
        isAdminGatewayPid(pid, (isAdmin) => {
          if (isAdmin) zombies.push(pid);
          if (--pending === 0) finalize();
        });
      });

      function finalize() {
        if (zombies.length === 0) return;
        console.warn(`[gateway] startup sweep: killing ${zombies.length} admin-gateway zombie(s) [${zombies.join(', ')}] (launchd owns pid=${launchdPid ?? 'unknown'})`);
        for (const pid of zombies) {
          try { process.kill(pid, 'SIGTERM'); } catch (_) {}
        }
        setTimeout(() => {
          for (const pid of zombies) {
            try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (_) {}
          }
        }, 2000);
      }
    });
  });
}

// Run the sweep at module load (i.e. AOC startup). Delay 8s so that
// orchestrator.cleanupOrphans has a chance to run its own user-gateway sweep
// first AND any user gateways being spawned at startup have time to bind
// their ports — keeps log output coherent and avoids racing.
setTimeout(sweepAdminGatewayZombies, 8000);

function restartGateway(reason) {
  if (restartLock) {
    console.log(`[gateway] Restart skipped (already in progress), reason: ${reason}`);
    return;
  }
  restartLock = true;
  console.log(`[gateway] Restart triggered: ${reason}`);

  isLaunchdManaged((managed) => {
    if (managed) {
      // Atomic kill+respawn via launchd. The `-k` flag SIGTERMs the running
      // job then immediately restarts it — no race window where AOC's own
      // spawn could collide with launchd's KeepAlive respawn.
      exec(`launchctl kickstart -k gui/$(id -u)/${LAUNCHD_LABEL}`, { timeout: 5000 }, (err) => {
        if (err) console.error(`[gateway] launchctl kickstart failed: ${err.message}`);
        else console.log(`[gateway] Restarted via launchctl kickstart (label=${LAUNCHD_LABEL})`);
        restartLock = false;
      });
      return;
    }

    // Fallback: no launchd service — manual kill+spawn (legacy path).
    findGatewayPid((pids) => {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (e) {
          console.error(`[gateway] Failed to kill PID ${pid}:`, e.message);
        }
      }

      setTimeout(() => {
        const fs = require('fs');
        const out = fs.openSync('/tmp/aoc_gw.log', 'a');
        const err = fs.openSync('/tmp/aoc_gw.log', 'a');
        const openclaw = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';

        const childEnv = { ...process.env };
        delete childEnv.OPENCLAW_HOME;

        const child = spawn(openclaw, ['gateway'], {
          detached: true,
          stdio: ['ignore', out, err],
          env: childEnv,
        });
        child.unref();

        console.log(`[gateway] Restarted (killed PIDs: [${pids.join(', ')}], new process spawned)`);
        restartLock = false;
      }, 1500);
    });
  });
}

// ─── Router factory ────────────────────────────────────────────────────────────

/**
 * @param {{ db, parsers, aiLib, metrics }} deps
 * @returns {import('express').Router}
 */
module.exports = function gatewayRouter(deps) {
  const { db, parsers, aiLib, metrics } = deps;
  const router = require('express').Router();

  // GET /gateway/status
  router.get('/gateway/status', db.authMiddleware, async (req, res) => {
    try {
      const userId = parseScopeUserId(req);

      if (Number(userId) === 1) {
        // Admin's external gateway — preserve legacy detection
        const gwConfig = getGatewayConfig(parsers);
        const port = gwConfig.port || 18789;
        const portOpen = await checkGatewayPort(port);
        return findGatewayPid((pids) => {
          res.json({
            running: pids.length > 0 && portOpen,
            pids,
            port,
            portOpen,
            mode:    gwConfig.mode || 'local',
            bind:    gwConfig.bind || 'loopback',
            managed: false,
          });
        });
      }

      // Non-admin / impersonated managed gateway
      const state = orchestrator.getGatewayState(userId) || {};
      res.json({
        running:  state.state === 'running',
        pids:     state.pid != null ? [state.pid] : [],
        port:     state.port ?? null,
        portOpen: state.state === 'running',
        mode:     'managed',
        bind:     'loopback',
        state:    state.state ?? 'stopped',
        managed:  true,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /ai/context
  router.get('/ai/context', db.authMiddleware, (req, res) => {
    try {
      const userId = parseScopeUserId(req);
      res.json(aiLib.getOsContext(userId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /ai/generate — SSE streaming AI content generation via Claude Code CLI
  router.post('/ai/generate', db.authMiddleware, async (req, res) => {
    const userId = parseScopeUserId(req);
    const { prompt, currentContent, fileType, agentName, agentId, extraContext } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };

    const ac = new AbortController();
    const onSocketClose = () => ac.abort();
    req.socket?.on('close', onSocketClose);

    try {
      for await (const chunk of aiLib.generateStream({ prompt, currentContent, fileType, agentName, agentId, extraContext, userId }, ac.signal)) {
        if (ac.signal.aborted) break;
        send({ text: chunk });
      }
      if (!ac.signal.aborted) send({ done: true });
    } catch (err) {
      if (!ac.signal.aborted) {
        console.error('[ai/generate]', err.message);
        send({ error: err.message });
      }
    } finally {
      req.socket?.off('close', onSocketClose);
      res.end();
    }
  });

  // ─── Self-service per-user gateway controls ─────────────────────────────────
  router.post('/gateway/start', db.authMiddleware, async (req, res) => {
    const userId = Number(req.user.userId ?? req.user.id);
    if (userId === 1) {
      return res.status(400).json({ error: 'Admin gateway is external — use /api/gateway/restart instead' });
    }
    try {
      // explicit:true bypasses AOC_DISABLE_AUTO_SPAWN — this endpoint is the
      // operator's explicit start action via dashboard or gw.sh.
      const out = await orchestrator.spawnGateway(userId, { explicit: true });
      res.json({ ok: true, port: out.port, pid: out.pid });
    } catch (err) {
      console.error(`[gateway/start uid=${userId}]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/gateway/restart', db.authMiddleware, async (req, res) => {
    const userId = Number(req.user.userId ?? req.user.id);
    if (userId === 1) {
      // Legacy admin restart preserved
      if (restartLock) return res.status(429).json({ error: 'Restart already in progress' });
      console.log('[gateway] Admin restart requested by', req.user.username);
      restartGateway(`requested by ${req.user.username}`);
      return findGatewayPid((pids) => res.json({ ok: true, killedPids: pids, message: 'Gateway restarting…' }));
    }
    try {
      const out = await orchestrator.restartGateway(userId);
      res.json({ ok: true, port: out.port, pid: out.pid });
    } catch (err) {
      console.error(`[gateway/restart uid=${userId}]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/gateway/stop', db.authMiddleware, async (req, res) => {
    const userId = Number(req.user.userId ?? req.user.id);
    if (userId === 1) {
      return findGatewayPid((pids) => {
        if (pids.length === 0) return res.json({ ok: true, message: 'Gateway already stopped' });
        for (const pid of pids) {
          try { process.kill(pid, 'SIGTERM'); } catch (e) {
            console.error(`[gateway] Failed to kill PID ${pid}:`, e.message);
          }
        }
        console.log(`[gateway] Stopped (PIDs: [${pids.join(', ')}]) by ${req.user.username}`);
        res.json({ ok: true, killedPids: pids, message: 'Gateway stopped' });
      });
    }
    try {
      await orchestrator.stopGateway(userId);
      res.json({ ok: true });
    } catch (err) {
      console.error(`[gateway/stop uid=${userId}]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Admin cross-user controls ──────────────────────────────────────────────
  router.post('/admin/users/:id/gateway/restart', db.authMiddleware, db.requireAdmin, async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetId === 1) {
      return res.status(400).json({ error: 'Admin gateway is external — use /api/gateway/restart for self' });
    }
    try {
      const out = await orchestrator.restartGateway(targetId);
      res.json({ ok: true, port: out.port, pid: out.pid });
    } catch (err) {
      console.error(`[admin/users/${targetId}/restart]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Ops-token endpoints (host-level managers like scripts/gw.sh) ──────────
  // These accept the cluster DASHBOARD_TOKEN directly so the host gateway
  // manager can drive lifecycle via the orchestrator (single source of truth)
  // instead of writing the SQLite file out-of-band — which the in-memory sql.js
  // copy doesn't observe, leading to onChildExit respawning a "stopped" gateway.
  function requireOpsToken(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const expected = process.env.DASHBOARD_TOKEN;
    if (!expected || token !== expected) {
      return res.status(401).json({ error: 'Ops token required (DASHBOARD_TOKEN)' });
    }
    next();
  }

  router.post('/ops/gateway/:id/stop', requireOpsToken, async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetId === 1) {
      return res.status(400).json({ error: 'Admin gateway is external' });
    }
    try {
      await orchestrator.stopGateway(targetId);
      res.json({ ok: true });
    } catch (err) {
      console.error(`[ops/gateway/${targetId}/stop]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/ops/gateway/:id/start', requireOpsToken, async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetId === 1) {
      return res.status(400).json({ error: 'Admin gateway is external' });
    }
    try {
      // explicit:true — admin ops endpoint is always considered explicit.
      const out = await orchestrator.spawnGateway(targetId, { explicit: true });
      res.json({ ok: true, port: out.port, pid: out.pid });
    } catch (err) {
      console.error(`[ops/gateway/${targetId}/start]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/ops/gateway/:id/restart', requireOpsToken, async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetId === 1) {
      return res.status(400).json({ error: 'Admin gateway is external' });
    }
    try {
      const out = await orchestrator.restartGateway(targetId);
      res.json({ ok: true, port: out.port, pid: out.pid });
    } catch (err) {
      console.error(`[ops/gateway/${targetId}/restart]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/admin/users/:id/gateway/stop', db.authMiddleware, db.requireAdmin, async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetId === 1) {
      return res.status(400).json({ error: 'Admin gateway is external — use /api/gateway/stop for self' });
    }
    try {
      await orchestrator.stopGateway(targetId);
      res.json({ ok: true });
    } catch (err) {
      console.error(`[admin/users/${targetId}/stop]`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Metrics dashboard ──────────────────────────────────────────────────────
  router.get('/metrics/summary', db.authMiddleware, (req, res) => {
    try {
      const userId    = parseScopeUserId(req);
      const range     = req.query.range || '30d';
      const projectId = req.query.projectId || null;
      const agentId   = req.query.agentId || null;
      const data = metrics.getSummary({ range, projectId, agentId, userId });
      res.json(data);
    } catch (err) {
      if (/Invalid range/.test(err.message)) return res.status(400).json({ error: err.message });
      console.error('[api/metrics/summary]', err);
      res.status(500).json({ error: 'Failed to compute summary' });
    }
  });

  router.get('/metrics/throughput', db.authMiddleware, (req, res) => {
    try {
      const userId    = parseScopeUserId(req);
      const range     = req.query.range || '30d';
      const projectId = req.query.projectId || null;
      const agentId   = req.query.agentId || null;
      const data = metrics.getThroughput({ range, projectId, agentId, userId });
      res.json(data);
    } catch (err) {
      if (/Invalid range/.test(err.message)) return res.status(400).json({ error: err.message });
      console.error('[api/metrics/throughput]', err);
      res.status(500).json({ error: 'Failed to compute throughput' });
    }
  });

  router.get('/metrics/agents', db.authMiddleware, (req, res) => {
    try {
      const userId    = parseScopeUserId(req);
      const range     = req.query.range || '30d';
      const projectId = req.query.projectId || null;
      const data = metrics.getAgentLeaderboard({ range, projectId, userId });

      let agentsById = {};
      try {
        const agents = parsers.parseAgentRegistry();
        for (const a of agents) agentsById[a.id] = a;
      } catch {}
      const enriched = data.agents.map(a => ({
        ...a,
        agentName:  agentsById[a.agentId]?.name  || a.agentId,
        agentEmoji: agentsById[a.agentId]?.emoji || null,
      }));
      res.json({ ...data, agents: enriched });
    } catch (err) {
      if (/Invalid range/.test(err.message)) return res.status(400).json({ error: err.message });
      console.error('[api/metrics/agents]', err);
      res.status(500).json({ error: 'Failed to compute agent leaderboard' });
    }
  });

  router.get('/metrics/lifecycle', db.authMiddleware, (req, res) => {
    try {
      const userId    = parseScopeUserId(req);
      const range     = req.query.range || '30d';
      const projectId = req.query.projectId || null;
      const agentId   = req.query.agentId || null;
      const data = metrics.getLifecycleFunnel({ range, projectId, agentId, userId });
      res.json(data);
    } catch (err) {
      if (/Invalid range/.test(err.message)) return res.status(400).json({ error: err.message });
      console.error('[api/metrics/lifecycle]', err);
      res.status(500).json({ error: 'Failed to compute lifecycle funnel' });
    }
  });

  router.get('/metrics/agents/:agentId/tasks', db.authMiddleware, (req, res) => {
    try {
      const userId    = parseScopeUserId(req);
      const { agentId } = req.params;
      const projectId = req.query.projectId || null;
      const limit = req.query.limit != null ? Number(req.query.limit) : 20;
      const tasks = metrics.getAgentRecentTasks({ agentId, projectId, limit, userId });

      let agent = null;
      try {
        const reg = parsers.parseAgentRegistry();
        const a = reg.find(x => x.id === agentId);
        if (a) agent = { id: a.id, name: a.name, emoji: a.emoji, workspace: a.workspace };
      } catch {}

      res.json({ agent, tasks });
    } catch (err) {
      console.error('[api/metrics/agents/:id/tasks]', err);
      res.status(500).json({ error: 'Failed to fetch agent tasks' });
    }
  });


  return router;
};

// Also export restartGateway for use by provision logic in index.cjs
module.exports.restartGateway = restartGateway;
