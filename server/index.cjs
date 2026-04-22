require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const parsers = require('./lib/index.cjs'); // modular barrel — replaces parsers.cjs
const { LiveFeedWatcher } = require('./lib/watchers.cjs');
const db = require('./lib/db.cjs');
const { gatewayProxy } = require('./lib/gateway-ws.cjs');
const aiLib = require('./lib/ai.cjs');
const versioning = require('./lib/versioning.cjs');
const integrations = require('./lib/integrations/index.cjs');
const { AGENTS_DIR } = require('./lib/config.cjs');

/**
 * Find all gateway JSONL session files for an agent that contain a given taskId,
 * parse them, and return a combined chronologically-ordered message array.
 * Used to reconstruct full multi-dispatch history for a ticket (1 Ticket = 1 Session,
 * but gateway creates a new JSONL file per chatSend round).
 */
function loadAllJSONLMessagesForTask(agentId, taskId) {
  try {
    const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
    if (!fs.existsSync(sessionsDir)) return [];

    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(sessionsDir, f));

    // Filter files that mention the taskId (agent tools return task context containing taskId)
    const matchingFiles = files.filter(f => {
      try { return fs.readFileSync(f, 'utf8').includes(taskId); }
      catch { return false; }
    });

    if (matchingFiles.length === 0) return [];

    // Parse each file and normalize messages to GatewayMessage-compatible format
    const allMessages = [];
    for (const file of matchingFiles) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'message' || !entry.message) continue;
          const { role, content, toolCallId, toolName } = entry.message;
          if (!role) continue;
          allMessages.push({
            id: entry.id,
            role,
            content,
            toolCallId,
            toolName,
            timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
            _file: path.basename(file, '.jsonl'), // for dedup
          });
        } catch { /* skip malformed lines */ }
      }
    }

    // Deduplicate by id, sort chronologically
    const seen = new Set();
    const deduped = allMessages.filter(m => {
      if (!m.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    deduped.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return deduped;
  } catch (err) {
    console.warn('[loadAllJSONLMessagesForTask]', err.message);
    return [];
  }
}

/** Shorthand: save a version snapshot after a successful file write */
function vSave(scopeKey, content, req, op = 'edit') {
  try {
    versioning.saveVersion(db.getDb(), {
      scopeKey,
      content,
      savedBy: req.user?.username || null,
      op,
      persist: db.persist,
    });
  } catch (e) {
    console.warn('[versioning] saveVersion failed:', e.message);
  }
}


const PORT = parseInt(process.env.PORT || '18800', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);

// Behind a reverse proxy (cloudflared tunnel → agents.dke.dev, or a local
// nginx / Cloudflare Zero Trust gateway). `trust proxy` lets Express honour
// `X-Forwarded-For` so rate-limiter keys off the real client IP instead of
// the loopback. Configurable via env; default "1" (trust first hop) — matches
// our production setup (a single tunnel in front).
const TRUST_PROXY = process.env.TRUST_PROXY ?? '1';
// Accept numeric hop counts, booleans, or a comma-separated list of IPs.
if (TRUST_PROXY === 'true' || TRUST_PROXY === 'false') {
  app.set('trust proxy', TRUST_PROXY === 'true');
} else if (/^\d+$/.test(TRUST_PROXY)) {
  app.set('trust proxy', parseInt(TRUST_PROXY, 10));
} else {
  app.set('trust proxy', TRUST_PROXY);
}

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "blob:"],
      workerSrc: ["'self'", "blob:"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGINS === '*' ? true : process.env.CORS_ORIGINS?.split(','),
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '500', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
app.use('/api/', limiter);
app.use(express.json({ limit: '25mb' }));

// ─── Auth Routes (public — no middleware) ─────────────────────────────────────

// Check if system needs initial setup
app.get('/api/auth/status', (req, res) => {
  res.json({
    needsSetup: !db.hasAnyUsers(),
    version: '2.0.0',
  });
});

// Initial admin setup (only works when NO users exist)
app.post('/api/auth/setup', (req, res) => {
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
app.post('/api/auth/login', (req, res) => {
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

// Returns a reason string if user isn't allowed to install with the given
// target/agent combination, or null if allowed.
// Returns a reason string if user isn't allowed to mutate the task, or null.
// Rule: admin bypass; else user must own the task's agent. Tasks without
// an agentId require admin.
function checkTaskAccess(req, taskId) {
  if (req.user?.role === 'admin' || req.user?.role === 'agent') return null;
  const task = db.getTask(taskId);
  if (!task) return 'Task not found';
  if (!task.agentId) return 'Only admin can modify unassigned tasks';
  if (!db.userOwnsAgent(req, task.agentId)) return 'You can only modify tasks on agents you own';
  return null;
}

async function checkCronAccess(req, jobId) {
  if (req.user?.role === 'admin' || req.user?.role === 'agent') return null;
  try {
    const jobs = parsers.parseCronJobs();
    const job = (jobs || []).find(j => j.id === jobId);
    if (!job) return null; // let handler return 404 naturally
    if (job.agentId && !db.userOwnsAgent(req, job.agentId)) {
      return 'You can only manage cron jobs for agents you own';
    }
  } catch { /* if list fails, fall through and let handler error */ }
  return null;
}

function checkSkillInstallTarget(req, target, agentId) {
  if (req.user?.role === 'admin' || req.user?.role === 'agent') return null;
  if (target === 'global') return 'Only admin can install to global library';
  if (target === 'agent' && agentId && !db.userOwnsAgent(req, agentId)) {
    return 'You can only install skills to agents you own';
  }
  return null;
}

// ─── Invitation-based registration (public) ──────────────────────────────────
// Validate an invitation token (used by /register page before submit)
app.get('/api/invitations/validate/:token', (req, res) => {
  const inv = db.getInvitationByToken(req.params.token);
  if (!inv) return res.status(404).json({ valid: false, error: 'Invitation not found' });
  if (inv.revokedAt) return res.status(410).json({ valid: false, error: 'Invitation revoked' });
  if (inv.expired)   return res.status(410).json({ valid: false, error: 'Invitation expired' });
  res.json({ valid: true, defaultRole: inv.defaultRole, expiresAt: inv.expiresAt });
});

// Register a new user via invitation token
app.post('/api/auth/register-invite', (req, res) => {
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

// ─── Admin: Invitations CRUD ─────────────────────────────────────────────────
app.get('/api/invitations', db.authMiddleware, db.requireAdmin, (req, res) => {
  res.json({ invitations: db.getAllInvitations() });
});

app.post('/api/invitations', db.authMiddleware, db.requireAdmin, (req, res) => {
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

app.post('/api/invitations/:id/revoke', db.authMiddleware, db.requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const inv = db.getInvitationById(id);
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  db.revokeInvitation(id);
  res.json({ invitation: db.getInvitationById(id) });
});

app.delete('/api/invitations/:id', db.authMiddleware, db.requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.deleteInvitation(id);
  res.json({ ok: true });
});

// ─── Admin: Users CRUD ───────────────────────────────────────────────────────
app.get('/api/users', db.authMiddleware, db.requireAdmin, (req, res) => {
  res.json({ users: db.getAllUsers() });
});

app.patch('/api/users/:id', db.authMiddleware, db.requireAdmin, (req, res) => {
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

app.delete('/api/users/:id', db.authMiddleware, db.requireAdmin, (req, res) => {
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
app.get('/api/auth/me', db.authMiddleware, (req, res) => {
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

// ─── Protected API ────────────────────────────────────────────────────────────

// Health
app.get('/api/health', db.authMiddleware, (req, res) => {
  res.json({ ok: true, ts: Date.now(), user: req.user.username });
});

// ─── Gateway Management ───────────────────────────────────────────────────────
const { exec, execFile, spawn } = require('child_process');
const net = require('net');

function getGatewayConfig() {
  const configPath = path.join(parsers.OPENCLAW_HOME, 'openclaw.json');
  try {
    const raw = require('fs').readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    return config.gateway || {};
  } catch { return {}; }
}

// Generic broadcast helper — function declaration is hoisted; wss is resolved at call time
function broadcast(event) {
  try {
    const msg = JSON.stringify({ ...event, timestamp: event.timestamp || new Date().toISOString() });
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(msg);
    });
  } catch (err) {
    console.error('[broadcast]', err);
  }
}

// Broadcast helper for task updates
function broadcastTasksUpdate() {
  try {
    const tasks = db.getAllTasks();
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: 'tasks:updated', payload: tasks, timestamp: new Date().toISOString() }));
      }
    });
  } catch (err) {
    console.error('[broadcastTasksUpdate]', err);
  }
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

// GET /api/gateway/status
app.get('/api/gateway/status', db.authMiddleware, async (req, res) => {
  try {
    const gwConfig = getGatewayConfig();
    const port = gwConfig.port || 18789;

    const [portOpen] = await Promise.all([checkGatewayPort(port)]);

    findGatewayPid((pids) => {
      res.json({
        running: pids.length > 0 && portOpen,
        pids,
        port,
        portOpen,
        mode: gwConfig.mode || 'local',
        bind: gwConfig.bind || 'loopback',
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/context — OS/environment context for AI prompt injection
app.get('/api/ai/context', db.authMiddleware, (req, res) => {
  try {
    res.json(aiLib.getOsContext());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/generate — SSE streaming AI content generation via Claude Code CLI
app.post('/api/ai/generate', db.authMiddleware, async (req, res) => {
  const { prompt, currentContent, fileType, agentName, agentId, extraContext } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };

  // Abort when the underlying TCP socket closes (client disconnects)
  // Note: req.on('close') can fire before generation is done in Express 5 — use socket instead
  const ac = new AbortController();
  const onSocketClose = () => ac.abort();
  req.socket?.on('close', onSocketClose);

  try {
    for await (const chunk of aiLib.generateStream({ prompt, currentContent, fileType, agentName, agentId, extraContext }, ac.signal)) {
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

// Reusable gateway restart helper (used by REST endpoint and post-provision)
let restartLock = false;
function restartGateway(reason) {
  if (restartLock) {
    console.log(`[gateway] Restart skipped (already in progress), reason: ${reason}`);
    return;
  }
  restartLock = true;
  console.log(`[gateway] Restart triggered: ${reason}`);

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
}

// POST /api/gateway/restart
app.post('/api/gateway/restart', db.authMiddleware, (req, res) => {
  if (restartLock) {
    return res.status(429).json({ error: 'Restart already in progress' });
  }
  console.log('[gateway] Restart requested by', req.user.username);
  restartGateway(`requested by ${req.user.username}`);
  findGatewayPid((pids) => {
    res.json({ ok: true, killedPids: pids, message: 'Gateway restarting…' });
  });
});

// POST /api/gateway/stop
app.post('/api/gateway/stop', db.authMiddleware, (req, res) => {
  findGatewayPid((pids) => {
    if (pids.length === 0) return res.json({ ok: true, message: 'Gateway already stopped' });
    
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (e) {
        console.error(`[gateway] Failed to kill PID ${pid}:`, e.message);
      }
    }
    
    console.log(`[gateway] Stopped (PIDs: [${pids.join(', ')}]) by ${req.user.username}`);
    res.json({ ok: true, killedPids: pids, message: 'Gateway stopped' });
  });
});



// Overview / stats
app.get('/api/overview', db.authMiddleware, (req, res) => {
  try {
    const stats = parsers.getDashboardStats();
    res.json(stats);
  } catch (err) {
    console.error('[api/overview]', err);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// ── Shared enrichment helper (used by REST and WS init) ──────────────────────

/** Read a single **Field:** value from markdown content */
function readMdField(content, fieldName) {
  if (!content) return '';
  const re = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : '';
}

/** Read IDENTITY.md vibe for an agent */
function readAgentVibe(agent) {
  const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR } = require('./lib/config.cjs');
  const fs = require('fs');
  const path = require('path');

  // Agent-specific workspace first, then agents dir, then global workspace
  const candidatePaths = [
    agent.workspace && require('path').join(agent.workspace, 'IDENTITY.md'),
    path.join(AGENTS_DIR, agent.id, 'IDENTITY.md'),
    agent.id === 'main' ? path.join(OPENCLAW_WORKSPACE, 'IDENTITY.md') : null,
  ].filter(Boolean);

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const vibe = readMdField(content, 'Vibe') || readMdField(content, 'Theme');
        if (vibe) return vibe;
      }
    } catch {}
  }
  return '';
}

function getEnrichedAgents() {
  const agents = parsers.parseAgentRegistry();

  // SQLite profiles
  const profiles = db.getAllAgentProfiles();
  const profileMap = Object.fromEntries(profiles.map(p => [p.agent_id, p]));

  // Per-agent session stats (single pass over gateway sessions)
  const allSessions = parsers.parseGatewaySessions();
  const statsMap = {};
  for (const s of allSessions) {
    const id = s.agent;
    if (!id) continue;
    if (!statsMap[id]) statsMap[id] = { sessionCount: 0, totalCost: 0, totalTokens: 0 };
    statsMap[id].sessionCount++;
    statsMap[id].totalCost   += parseFloat(s.cost) || 0;
    statsMap[id].totalTokens += (s.tokensIn || 0) + (s.tokensOut || 0);
  }

  // Channel type detection (single openclaw.json read)
  const { OPENCLAW_HOME } = require('./lib/config.cjs');
  const oclawPath = require('path').join(OPENCLAW_HOME, 'openclaw.json');
  const oclaw = (() => { try { return JSON.parse(require('fs').readFileSync(oclawPath, 'utf8')); } catch { return {}; } })();
  const bindings = oclaw.bindings  || [];
  const chCfg    = oclaw.channels  || {};
  const tgAccts  = chCfg.telegram?.accounts || {};
  const waAccts  = chCfg.whatsapp?.accounts || {};
  const dcAccts  = chCfg.discord?.accounts  || {};

  function agentChannelTypes(agentId) {
    const types = new Set();
    const keys = new Set([agentId, ...(agentId === 'main' ? ['default'] : [])]);
    if (bindings.some(b => b.agentId === agentId && b.match?.channel === 'telegram')) types.add('telegram');
    for (const k of keys) if (tgAccts[k]) types.add('telegram');
    if (bindings.some(b => b.agentId === agentId && b.match?.channel === 'whatsapp')) types.add('whatsapp');
    for (const k of keys) if (waAccts[k]) types.add('whatsapp');
    if (bindings.some(b => b.agentId === agentId && b.match?.channel === 'discord')) types.add('discord');
    for (const k of keys) if (dcAccts[k]) types.add('discord');
    if (chCfg.discord?.token && bindings.some(b => b.agentId === agentId && b.match?.channel === 'discord')) types.add('discord');
    return [...types];
  }

  return agents.map(a => {
    const st = statsMap[a.id] || {};
    return {
      ...a,
      color:          profileMap[a.id]?.color || null,
      description:    profileMap[a.id]?.description || null,
      hasAvatar:      !!profileMap[a.id]?.avatar_data,
      avatarPresetId: profileMap[a.id]?.avatar_preset_id || null,
      role:           profileMap[a.id]?.role || null,
      provisionedBy:  profileMap[a.id]?.provisioned_by ?? null,
      vibe:           readAgentVibe(a) || null,
      sessionCount:   st.sessionCount  || 0,
      totalCost:      st.totalCost  ? Math.round(st.totalCost  * 10000) / 10000 : null,
      totalTokens:    st.totalTokens || null,
      channels:       agentChannelTypes(a.id),
    };
  });
}

// Agents
app.get('/api/agents', db.authMiddleware, (req, res) => {
  try {
    res.json({ agents: getEnrichedAgents() });
  } catch (err) {
    console.error('[api/agents]', err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// Provision a new agent — creates config, workspace, channel bindings, and SQLite profile
app.post('/api/agents', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.provisionAgent(req.body, req.user?.userId);
    // Save profile to SQLite (including ADLC role if template was used)
    db.upsertAgentProfile({
      agentId: result.agentId,
      displayName: result.agentName,
      emoji: req.body.emoji,
      avatarPresetId: req.body.avatarPresetId || null,
      color: req.body.color || null,
      description: req.body.description || null,
      tags: req.body.tags || [],
      notes: null,
      provisionedBy: req.user?.userId || null,
      role: req.body.adlcRole || null,
    });
    result.profileSaved = true;
    console.log(`[api/agents/provision] Provisioned agent "${result.agentId}" with ${result.bindings.length} binding(s)`);

    // Restart gateway so heartbeat config for the new agent takes effect
    restartGateway(`agent provisioned: ${result.agentId}`);
    result.gatewayRestarted = true;

    res.status(201).json(result);
  } catch (err) {
    console.error('[api/agents/provision]', err);
    const code = err.message?.includes('already exists') ? 409
      : err.message?.includes('invalid') ? 400
      : err.message?.includes('required') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Apply research output standard to all agents (idempotent)
app.post('/api/agents/soul-standard', db.authMiddleware, (req, res) => {
  try {
    const { agentIds } = req.body || {};
    const config = require('./lib/config.cjs').readJsonSafe(require('path').join(require('./lib/config.cjs').OPENCLAW_HOME, 'openclaw.json'));
    const allAgents = config?.agents?.list || [];
    const targets = agentIds?.length
      ? allAgents.filter(a => agentIds.includes(a.id))
      : allAgents;
    const results = targets.map(a => parsers.injectSoulStandard(a.id));
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[api/agents/soul-standard]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/:id', db.authMiddleware, (req, res) => {
  try {
    const agents = parsers.parseAgentRegistry();
    const agent = agents.find(a => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// Agent detail (full profile with workspace files, soul, tools, etc.)
app.get('/api/agents/:id/detail', db.authMiddleware, (req, res) => {
  try {
    const detail = parsers.getAgentDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Agent not found' });
    // Enrich with SQLite profile (avatar preset, color)
    const profile = db.getAgentProfile(req.params.id);
    if (profile) {
      detail.profile = {
        avatarPresetId: profile.avatar_preset_id || null,
        color: profile.color || null,
      };
    }
    res.json(detail);
  } catch (err) {
    console.error('[api/agents/detail]', err);
    res.status(500).json({ error: 'Failed to fetch agent detail' });
  }
});

// Update agent config + workspace files
app.patch('/api/agents/:id', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.updateAgent(req.params.id, req.body);
    // If agent was renamed, migrate the SQLite profile to the new ID
    if (result.agentId && result.agentId !== req.params.id) {
      db.renameAgentProfile(req.params.id, result.agentId);
      console.log(`[api/agents] Migrated profile "${req.params.id}" → "${result.agentId}"`);
    }
    console.log(`[api/agents] Updated agent "${req.params.id}":`, result.changed);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/update]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

app.delete('/api/agents/:id', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const agentId = req.params.id;
    parsers.deleteAgent(agentId);
    // Remove profile from SQLite
    db.deleteAgentProfile(agentId);
    console.log(`[api/agents] Deleted agent "${agentId}"`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/agents/delete]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// Inject research output standard into a single agent's SOUL.md (idempotent)
app.post('/api/agents/:id/soul-standard', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.injectSoulStandard(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/:id/sessions', db.authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions().filter(s => s.agent === req.params.id || s.agentId === req.params.id);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent sessions' });
  }
});

// Read a single workspace file (IDENTITY.md, SOUL.md, etc.)
app.get('/api/agents/:id/files/:filename', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAgentFile(req.params.id, req.params.filename);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/files/get]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not allowed') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Save / overwrite a single workspace file
app.put('/api/agents/:id/files/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveAgentFile(req.params.id, req.params.filename, content);
    console.log(`[api/agents/files] Saved ${result.filename} for agent "${req.params.id}"`);
    vSave(`agent:${req.params.id}:${result.filename}`, content, req);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/files/put]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not allowed') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Agent Profile (SQLite) ──────────────────────────────────────────────────

// Get agent profile (dashboard-specific metadata)
app.get('/api/agents/:id/profile', db.authMiddleware, (req, res) => {
  try {
    const profile = db.getAgentProfile(req.params.id);
    res.json({ profile: profile || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent profile' });
  }
});

// Update agent profile metadata (color, description, tags, notes)
app.patch('/api/agents/:id/profile', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { color, description, tags, notes, emoji, displayName, avatarPresetId } = req.body;
    const profile = db.upsertAgentProfile({
      agentId: req.params.id,
      displayName, emoji, avatarPresetId, color, description, tags, notes,
      provisionedBy: req.user?.userId || null,
    });
    res.json({ ok: true, profile });
  } catch (err) {
    console.error('[api/agents/profile]', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload agent avatar (base64 encoded image)
app.put('/api/agents/:id/avatar', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { avatarData, avatarMime } = req.body;
    if (!avatarData) return res.status(400).json({ error: 'avatarData is required' });
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (avatarMime && !allowedMimes.includes(avatarMime)) {
      return res.status(400).json({ error: 'Invalid image MIME type' });
    }
    // Basic size check: base64 ~1.37x raw size; limit to ~2MB raw → ~2.7MB base64
    if (avatarData.length > 2_800_000) {
      return res.status(413).json({ error: 'Avatar image too large (max ~2MB)' });
    }
    db.upsertAgentProfile({ agentId: req.params.id, avatarData, avatarMime: avatarMime || 'image/png' });
    console.log(`[api/agents/avatar] Avatar updated for agent "${req.params.id}"`);
    res.json({ ok: true, agentId: req.params.id });
  } catch (err) {
    console.error('[api/agents/avatar]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get agent avatar (serves as data URL)
app.get('/api/agents/:id/avatar', db.authMiddleware, (req, res) => {
  try {
    const profile = db.getAgentProfile(req.params.id);
    if (!profile?.avatar_data) return res.status(404).json({ error: 'No avatar' });
    res.json({ avatarData: profile.avatar_data, avatarMime: profile.avatar_mime || 'image/png' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch avatar' });
  }
});



// List all skills visible to an agent
app.get('/api/agents/:id/skills', db.authMiddleware, (req, res) => {
  try {
    const skills = parsers.getAgentSkills(req.params.id);
    res.json({ skills });
  } catch (err) {
    console.error('[api/agents/skills]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get a skill's SKILL.md content
app.get('/api/agents/:id/skills/:name/file', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillFile(req.params.id, req.params.name);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/skills/file]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Save a skill's SKILL.md content
app.put('/api/agents/:id/skills/:name/file', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveSkillFile(req.params.id, req.params.name, content);
    console.log(`[api/agents/skills] Saved skill "${req.params.name}" for agent "${req.params.id}"`);
    vSave(`skill:${req.params.id}:${req.params.name}`, content, req);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/file/put]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not editable') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Create a new skill
app.post('/api/agents/:id/skills', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { name, scope, content } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!content) return res.status(400).json({ error: 'content is required' });
    const result = parsers.createSkill(req.params.id, name, scope || 'workspace', content);
    console.log(`[api/agents/skills] Created skill "${name}" (scope: ${scope || 'workspace'}) for agent "${req.params.id}"`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/create]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('already exists') ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Toggle skill enabled/disabled FOR THIS AGENT ONLY (via agents.list[].skills allowlist)
app.patch('/api/agents/:id/skills/:name/toggle', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled === undefined) return res.status(400).json({ error: 'enabled is required' });
    const result = parsers.toggleAgentSkill(req.params.id, req.params.name, !!enabled);
    console.log(`[api/agents/skills] Toggled skill "${req.params.name}" for agent "${req.params.id}" => enabled: ${enabled}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/toggle]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Delete an agent's workspace skill (only 'workspace' source allowed)
app.delete('/api/agents/:id/skills/:name', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.deleteAgentSkill(req.params.id, req.params.name);
    console.log(`[api/agents/skills] Deleted skill "${req.params.name}" for agent "${req.params.id}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/skills/delete]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('Cannot delete') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get built-in tools for a specific agent (with enabled/disabled state)
app.get('/api/agents/:id/tools', db.authMiddleware, (req, res) => {
  try {
    const tools = parsers.getAgentTools(req.params.id);
    res.json({ tools });
  } catch (err) {
    console.error('[api/agents/tools]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Toggle a built-in tool ON or OFF for a specific agent (via agents.list[].tools.deny)
app.patch('/api/agents/:id/tools/:name/toggle', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled === undefined) return res.status(400).json({ error: 'enabled is required' });
    const result = parsers.toggleAgentTool(req.params.id, req.params.name, !!enabled);
    console.log(`[api/agents/tools] Toggled tool "${req.params.name}" for agent "${req.params.id}" => enabled: ${enabled}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/tools/toggle]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Agent Channel Management ────────────────────────────────────────────────

// Get all channel bindings for an agent
app.get('/api/agents/:id/channels', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAgentChannels(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/channels/get]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// Add a new channel binding for an agent
app.post('/api/agents/:id/channels', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.addAgentChannel(req.params.id, req.body);
    console.log(`[api/agents/channels] Added ${req.body.type} channel for agent "${req.params.id}"`);
    res.status(201).json(result);
  } catch (err) {
    console.error('[api/agents/channels/add]', err);
    const code = err.message?.includes('not found') ? 404
      : err.message?.includes('required') || err.message?.includes('invalid') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Update an existing channel binding (dmPolicy, streaming, botToken, allowFrom)
app.patch('/api/agents/:id/channels/:channelType/:accountId', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.updateAgentChannel(req.params.id, req.params.channelType, req.params.accountId, req.body);
    console.log(`[api/agents/channels] Updated ${req.params.channelType}/${req.params.accountId} for agent "${req.params.id}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/channels/update]', err);
    const code = err.message?.includes('not found') ? 404
      : err.message?.includes('invalid') || err.message?.includes('required') || err.message?.includes('empty') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Remove a channel binding from an agent
app.delete('/api/agents/:id/channels/:channelType/:accountId', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.removeAgentChannel(req.params.id, req.params.channelType, req.params.accountId);
    console.log(`[api/agents/channels] Removed ${req.params.channelType}/${req.params.accountId} from agent "${req.params.id}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/channels/remove]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// ─── DM Pairing Approval ─────────────────────────────────────────────────────

// List pending pairing requests for a specific agent (across all channels)
app.get('/api/agents/:id/pairing', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.listAllPairingRequests(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/pairing/list]', err);
    res.status(500).json({ error: err.message });
  }
});

// List pending pairing requests for a specific channel (optionally filtered by account)
app.get('/api/pairing/:channel', db.authMiddleware, (req, res) => {
  try {
    const requests = parsers.listPairingRequests(req.params.channel, req.query.account || undefined);
    res.json({ channel: req.params.channel, requests });
  } catch (err) {
    console.error('[api/pairing/list]', err);
    const code = err.message?.includes('Unsupported') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Approve a pairing code
app.post('/api/pairing/:channel/approve', db.authMiddleware, async (req, res) => {
  try {
    const { code, accountId } = req.body;
    if (!code) return res.status(400).json({ error: 'Pairing code is required' });

    const result = await parsers.approvePairingCode(req.params.channel, code, accountId || undefined);
    if (result.ok) {
      console.log(`[api/pairing] Approved ${req.params.channel} pairing code ${code}${accountId ? ` (account: ${accountId})` : ''}`);
    }
    res.json(result);
  } catch (err) {
    console.error('[api/pairing/approve]', err);
    const code = err.message?.includes('Unsupported') || err.message?.includes('required') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ─── ClawHub Skill Install ────────────────────────────────────────────────────

const skillsInstall = require('./lib/skills-install.cjs');

// GET /api/skills/clawhub/targets — list install location options
app.get('/api/skills/clawhub/targets', db.authMiddleware, (req, res) => {
  try {
    res.json({ targets: skillsInstall.getInstallTargets() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/skills/clawhub/preview — fetch + scan skill without installing
// Body: { url: "https://clawhub.ai/author/slug" }
app.post('/api/skills/clawhub/preview', db.authMiddleware, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  try {
    const preview = await skillsInstall.previewSkill(url);
    res.json(preview);
  } catch (err) {
    console.error('[api/skills/clawhub/preview]', err);
    res.status(500).json({ error: err.message || 'Failed to fetch skill from ClawHub' });
  }
});

// POST /api/skills/clawhub/install — download + extract skill
// Body: { url, target, agentId?, bufferB64? }
app.post('/api/skills/clawhub/install', db.authMiddleware, async (req, res) => {
  const { url, target, agentId, bufferB64, overwrite } = req.body || {};
  if (!url || !target) {
    return res.status(400).json({ error: 'url and target are required' });
  }
  const gate = checkSkillInstallTarget(req, target, agentId);
  if (gate) return res.status(403).json({ error: gate });
  try {
    const result = await skillsInstall.installSkill({ urlOrSlug: url, target, agentId, bufferB64, overwrite: !!overwrite });
    console.log(`[api/skills/clawhub] ${result.updated ? 'Updated' : 'Installed'} "${result.slug}" to ${result.path}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/clawhub/install]', err);
    const code = err.code === 'ALREADY_INSTALLED' ? 409 : 500;
    res.status(code).json({ error: err.message || 'Install failed', code: err.code, slug: err.slug, installPath: err.installPath });
  }
});

// ─── Upload Skill (zip / .skill / raw SKILL.md) ───────────────────────────────

// POST /api/skills/upload/preview — scan an uploaded buffer without installing
// Body: { filename, bufferB64 }
app.post('/api/skills/upload/preview', db.authMiddleware, (req, res) => {
  const { filename, bufferB64 } = req.body || {};
  if (!bufferB64 || typeof bufferB64 !== 'string') {
    return res.status(400).json({ error: 'bufferB64 is required' });
  }
  try {
    const buffer = Buffer.from(bufferB64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty upload' });
    const preview = skillsInstall.previewFromUpload(buffer, filename);
    res.json(preview);
  } catch (err) {
    console.error('[api/skills/upload/preview]', err);
    res.status(400).json({ error: err.message || 'Failed to parse upload' });
  }
});

// POST /api/skills/upload/install — install from uploaded buffer
// Body: { filename, bufferB64, target, agentId?, slug? }
app.post('/api/skills/upload/install', db.authMiddleware, (req, res) => {
  const { filename, bufferB64, target, agentId, slug, overwrite } = req.body || {};
  if (!bufferB64 || !target) {
    return res.status(400).json({ error: 'bufferB64 and target are required' });
  }
  const gate = checkSkillInstallTarget(req, target, agentId);
  if (gate) return res.status(403).json({ error: gate });
  try {
    const result = skillsInstall.installFromUpload({ bufferB64, filename, target, agentId, slug, overwrite: !!overwrite });
    console.log(`[api/skills/upload] ${result.updated ? 'Updated' : 'Installed'} "${result.slug}" to ${result.path}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/upload/install]', err);
    const code = err.code === 'ALREADY_INSTALLED' ? 409 : 400;
    res.status(code).json({ error: err.message || 'Install failed', code: err.code, slug: err.slug, installPath: err.installPath });
  }
});

// ─── SkillsMP Integration ─────────────────────────────────────────────────────

const SKILLSMP_KEY = 'skillsmp_api_key';

// GET /api/settings/skillsmp — check if API key is configured (masked)
app.get('/api/settings/skillsmp', db.authMiddleware, (req, res) => {
  const key = db.getSetting(SKILLSMP_KEY);
  res.json({
    configured: !!key,
    // Return only first/last 4 chars for display
    preview: key ? `${key.slice(0, 11)}…${key.slice(-4)}` : null,
  });
});

// POST /api/settings/skillsmp — save API key
app.post('/api/settings/skillsmp', db.authMiddleware, (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'apiKey is required' });
  }
  if (!apiKey.startsWith('sk_live_')) {
    return res.status(400).json({ error: 'Invalid API key format. Must start with sk_live_' });
  }
  db.setSetting(SKILLSMP_KEY, apiKey.trim());
  res.json({ ok: true, preview: `${apiKey.slice(0, 11)}…${apiKey.slice(-4)}` });
});

// DELETE /api/settings/skillsmp — remove API key
app.delete('/api/settings/skillsmp', db.authMiddleware, (req, res) => {
  db.deleteSetting(SKILLSMP_KEY);
  res.json({ ok: true });
});

// GET /api/skills/skillsmp/search?q= — search SkillsMP
app.get('/api/skills/skillsmp/search', db.authMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || !q.trim()) {
    return res.status(400).json({ error: 'q (query) is required' });
  }
  const apiKey = db.getSetting(SKILLSMP_KEY);
  if (!apiKey) {
    return res.status(401).json({ error: 'SkillsMP API key not configured', code: 'NO_API_KEY' });
  }
  try {
    const skills = await skillsInstall.skillsmpSearch(q.trim(), apiKey);
    res.json({ skills });
  } catch (err) {
    console.error('[api/skills/skillsmp/search]', err);
    const code = err.message?.includes('auth failed') || err.message?.includes('Invalid') ? 401 : 500;
    res.status(code).json({ error: err.message });
  }
});

// POST /api/skills/skillsmp/preview — fetch SKILL.md content + basic security scan
app.post('/api/skills/skillsmp/preview', db.authMiddleware, async (req, res) => {
  const { skill } = req.body || {};
  if (!skill) return res.status(400).json({ error: 'skill is required' });
  try {
    const result = await skillsInstall.fetchSkillsmpSkillMd(skill);
    if (!result) {
      return res.status(404).json({ error: 'Could not fetch SKILL.md — GitHub source not available or inaccessible' });
    }
    // Run basic security scan on the SKILL.md content
    const { runSecurityScan } = skillsInstall;
    const security = runSecurityScan ? runSecurityScan({ 'SKILL.md': () => result.content }) : null;
    res.json({ content: result.content, sourceUrl: result.url, security });
  } catch (err) {
    console.error('[api/skills/skillsmp/preview]', err);
    res.status(500).json({ error: err.message || 'Failed to fetch skill preview' });
  }
});

// POST /api/skills/skillsmp/install — install from SkillsMP
app.post('/api/skills/skillsmp/install', db.authMiddleware, async (req, res) => {
  const { skill, target, agentId, overwrite } = req.body || {};
  if (!skill || !target) {
    return res.status(400).json({ error: 'skill and target are required' });
  }
  const gate = checkSkillInstallTarget(req, target, agentId);
  if (gate) return res.status(403).json({ error: gate });
  try {
    const result = await skillsInstall.installSkillsmpSkill({ skill, target, agentId, overwrite: !!overwrite });
    console.log(`[api/skills/skillsmp] ${result.updated ? 'Updated' : 'Installed'} "${result.slug}" to ${result.path}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/skillsmp/install]', err);
    const code = err.code === 'ALREADY_INSTALLED' ? 409 : 500;
    res.status(code).json({ error: err.message || 'Install failed', code: err.code, slug: err.slug, installPath: err.installPath });
  }
});

// ─── ADLC Role Templates (Phase 1: read-only) ───────────────────────────────

// GET /api/role-templates — list all templates with summary metadata
app.get('/api/role-templates', db.authMiddleware, (req, res) => {
  try {
    const templates = parsers.listRoleTemplates();
    // Strip heavy fields from list payload — UI fetches detail on demand
    const summary = templates.map(t => ({
      id:               t.id,
      adlcAgentNumber:  t.adlcAgentNumber,
      role:             t.role,
      emoji:            t.emoji,
      color:            t.color,
      description:      t.description,
      modelRecommendation: t.modelRecommendation,
      tags:             t.tags,
      origin:           t.origin,
      builtIn:          t.builtIn,
      skillCount:       Array.isArray(t.skillSlugs) ? t.skillSlugs.length : 0,
      scriptCount:      Array.isArray(t.scriptTemplates) ? t.scriptTemplates.length : 0,
      updatedAt:        t.updatedAt,
    }));
    res.json({ templates: summary });
  } catch (err) {
    console.error('[api/role-templates]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/role-templates/:id — full template including agent files,
// skill bundle, and script templates
app.get('/api/role-templates/:id', db.authMiddleware, (req, res) => {
  try {
    const template = parsers.getRoleTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: `Role template "${req.params.id}" not found` });
    res.json({ template });
  } catch (err) {
    console.error('[api/role-templates/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/role-templates/:id/usage — which agents reference this template?
app.get('/api/role-templates/:id/usage', db.authMiddleware, (req, res) => {
  try {
    const agentIds = parsers.listRoleTemplateUsage(req.params.id);
    res.json({ agentIds, count: agentIds.length });
  } catch (err) {
    console.error('[api/role-templates/:id/usage]', err);
    res.status(500).json({ error: err.message });
  }
});

function roleTemplateErrorStatus(err) {
  switch (err?.code) {
    case 'VALIDATION': return 400;
    case 'NOT_FOUND':  return 404;
    case 'CONFLICT':   return 409;
    case 'READ_ONLY':  return 403;
    case 'IN_USE':     return 409;
    default:           return 500;
  }
}

// POST /api/role-templates — create a custom template
// Body: { id, role, emoji?, color?, description?, modelRecommendation?,
//         adlcAgentNumber?, tags?, agentFiles?, skillSlugs?, skillContents?,
//         scriptTemplates?, fsWorkspaceOnly? }
app.post('/api/role-templates', db.authMiddleware, (req, res) => {
  try {
    const created = parsers.createRoleTemplate(req.body || {});
    console.log(`[api/role-templates] Created "${created.id}"`);
    res.status(201).json({ template: created });
  } catch (err) {
    console.error('[api/role-templates][POST]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code, details: err.details });
  }
});

// PATCH /api/role-templates/:id — update metadata / refs for a user template
// Built-ins are rejected with 403 — caller must fork first.
app.patch('/api/role-templates/:id', db.authMiddleware, (req, res) => {
  try {
    const updated = parsers.updateRoleTemplate(req.params.id, req.body || {});
    console.log(`[api/role-templates] Updated "${req.params.id}"`);
    res.json({ template: updated });
  } catch (err) {
    console.error('[api/role-templates][PATCH]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code, details: err.details });
  }
});

// DELETE /api/role-templates/:id — delete a user template
// Query: ?force=true to also clear `role` from agents referencing it
app.delete('/api/role-templates/:id', db.authMiddleware, (req, res) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';
    const result = parsers.deleteRoleTemplate(req.params.id, { force });
    console.log(`[api/role-templates] Deleted "${req.params.id}"${force ? ' (forced)' : ''}`);
    res.json(result);
  } catch (err) {
    console.error('[api/role-templates][DELETE]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code, usage: err.usage });
  }
});

// POST /api/role-templates/:id/fork — copy a template (built-in or custom)
// Body: { newId?, overrides? } — overrides is a partial template patch
app.post('/api/role-templates/:id/fork', db.authMiddleware, (req, res) => {
  try {
    const { newId, overrides } = req.body || {};
    const forked = parsers.forkRoleTemplate(req.params.id, newId, overrides || {});
    console.log(`[api/role-templates] Forked "${req.params.id}" → "${forked.id}"`);
    res.status(201).json({ template: forked });
  } catch (err) {
    console.error('[api/role-templates][fork]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// GET /api/role-templates/:id/preview-apply?agentId=X
// Returns per-file / skill / script changes that applying this template
// would produce for the given agent.
app.get('/api/role-templates/:id/preview-apply', db.authMiddleware, (req, res) => {
  try {
    const { agentId } = req.query;
    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agentId query param required' });
    }
    const preview = parsers.previewRoleTemplateApply(req.params.id, agentId);
    res.json({ preview });
  } catch (err) {
    console.error('[api/role-templates/preview-apply]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// POST /api/agents/:agentId/assign-role
// Body: {
//   templateId, overwriteFiles?, installSkills?, installScripts?,
//   overwriteConflictingScripts?
// }
app.post('/api/agents/:agentId/assign-role', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { templateId, overwriteFiles, installSkills, installScripts, overwriteConflictingScripts } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'templateId is required' });
    const savedBy = req.user?.username || 'dashboard';
    const result = parsers.applyRoleTemplateToAgent(templateId, req.params.agentId, {
      overwriteFiles, installSkills, installScripts, overwriteConflictingScripts, savedBy,
    });
    console.log(`[api/agents/assign-role] "${req.params.agentId}" ← "${templateId}": ${result.applied.files.length} files, ${result.applied.skillsAddedToAllowlist.length} skill refs, ${result.applied.scriptsWritten.length} scripts`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/assign-role]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// POST /api/agents/:agentId/unassign-role — clear agent role (files untouched)
app.post('/api/agents/:agentId/unassign-role', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.unassignAgentRole(req.params.agentId);
    console.log(`[api/agents/unassign-role] "${req.params.agentId}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/unassign-role]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// ─── Global Skills & Tools Library ──────────────────────────────────────────

// All skills across all scopes with per-agent assignment info
app.get('/api/skills', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAllSkills();
    res.json(result);
  } catch (err) {
    console.error('[api/skills]', err);
    res.status(500).json({ error: err.message });
  }
});

// Create a new skill globally (no agent context needed)
app.post('/api/skills', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { slug, scope, content } = req.body;
    if (!slug) return res.status(400).json({ error: 'slug is required' });
    const result = parsers.createGlobalSkill(slug, scope || 'workspace', content || '');
    console.log(`[api/skills] Created global skill "${slug}" (scope: ${scope})`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/skills/create]', err);
    const status = err.message?.includes('already exists') ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Delete a skill from the global library by slug
app.delete('/api/skills/:slug', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const result = parsers.deleteSkillBySlug(req.params.slug);
    console.log(`[api/skills] Deleted skill "${req.params.slug}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/delete]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not deletable') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/skills/:slug/tree — full directory tree of a skill
app.get('/api/skills/:slug/tree', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillDirTree(req.params.slug);
    res.json(result);
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/skills/:slug/anyfile?path=assets/AGENTS.md — read any file in skill dir
app.get('/api/skills/:slug/anyfile', db.authMiddleware, (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    const result = parsers.getSkillAnyFile(req.params.slug, filePath);
    res.json(result);
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('traversal') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/skills/:slug/anyfile?path=assets/AGENTS.md — save any file in skill dir
app.put('/api/skills/:slug/anyfile', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const filePath = req.query.path;
    const { content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveSkillAnyFile(req.params.slug, filePath, content);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('read-only') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Read a skill's SKILL.md directly by slug
app.get('/api/skills/:slug/file', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillFileBySlug(req.params.slug);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/file]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Save a skill's SKILL.md directly by slug
app.put('/api/skills/:slug/file', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveSkillFileBySlug(req.params.slug, content);
    console.log(`[api/skills] Saved SKILL.md for "${req.params.slug}"`);
    vSave(`skill:global:${req.params.slug}`, content, req);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/skills/file/put]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not editable') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// All built-in tools with per-agent status
app.get('/api/tools', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAllTools();
    res.json(result);
  } catch (err) {
    console.error('[api/tools]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Skill Directory Tree (all files, not just scripts/) ─────────────────────

app.get('/api/agents/:id/skills/:name/tree', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAgentSkillDirTree(req.params.id, req.params.name);
    res.json(result);
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/agents/:id/skills/:name/anyfile', db.authMiddleware, (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    const result = parsers.getAgentSkillAnyFile(req.params.id, req.params.name, filePath);
    res.json(result);
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('traversal') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.put('/api/agents/:id/skills/:name/anyfile', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const filePath = req.query.path;
    const { content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveAgentSkillAnyFile(req.params.id, req.params.name, filePath, content);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('traversal') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Skill Scripts Management ────────────────────────────────────────────────

// List scripts in a skill's scripts/ folder
app.get('/api/agents/:id/skills/:name/scripts', db.authMiddleware, (req, res) => {
  try {
    const scripts = parsers.listSkillScripts(req.params.id, req.params.name);
    res.json({ scripts });
  } catch (err) {
    console.error('[api/agents/skills/scripts/list]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get scripts directory path hint
app.get('/api/agents/:id/skills/:name/scripts-path', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillScriptsPath(req.params.id, req.params.name);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/skills/scripts/path]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get a single script content
app.get('/api/agents/:id/skills/:name/scripts/:filename', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillScript(req.params.id, req.params.name, req.params.filename);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/skills/scripts/get]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not allowed') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Save (create or overwrite) a script
app.put('/api/agents/:id/skills/:name/scripts/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { content, appendToSkillMd } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveSkillScript(
      req.params.id,
      req.params.name,
      req.params.filename,
      content,
      { appendToSkillMd: appendToSkillMd !== false }
    );
    console.log(`[api/agents/skills/scripts] Saved "${req.params.filename}" in skill "${req.params.name}" for agent "${req.params.id}" (new: ${result.isNew}, skillMdUpdated: ${result.skillMdUpdated})`);
    vSave(`skill-script:${req.params.id}:${req.params.name}:${req.params.filename}`, content, req, result.isNew ? 'create' : 'edit');
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/scripts/save]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not allowed') || err.message?.includes('Invalid filename') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Delete a script
app.delete('/api/agents/:id/skills/:name/scripts/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.deleteSkillScript(req.params.id, req.params.name, req.params.filename);
    console.log(`[api/agents/skills/scripts] Deleted "${req.params.filename}" from skill "${req.params.name}" for agent "${req.params.id}"`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/scripts/delete]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});


app.get('/api/sessions', db.authMiddleware, (req, res) => {
  try {
    const all = parsers.getAllSessions();
    const { type, status, agentId } = req.query;
    let sessions = all;
    if (type) sessions = sessions.filter(s => s.type === type);
    if (status) sessions = sessions.filter(s => s.status === status);
    if (agentId) sessions = sessions.filter(s => s.agentId === agentId);
    res.json({ sessions, total: sessions.length });
  } catch (err) {
    console.error('[api/sessions]', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * Collect all events for a session, including Claude CLI events when the session is
 * linked (or IS a claude-cli session). Returns events sorted oldest→newest by timestamp.
 */
function collectSessionEvents(sessionId, session) {
  const gatewayEvents = parsers.parseGatewaySessionEvents(sessionId) || [];
  let claudeCliEvents = [];

  // 1) Session has an explicit link → fetch by claude-cli UUID
  if (session?.claudeCliSessionId) {
    claudeCliEvents = parsers.parseClaudeCliSessionEvents(session.claudeCliSessionId) || [];
  }
  // 2) Session source is claude-cli (standalone) → the id IS a claude-cli UUID
  else if (session?.source === 'claude-cli') {
    claudeCliEvents = parsers.parseClaudeCliSessionEvents(sessionId) || [];
  }
  // 3) No session match yet — try both; whichever finds the id wins
  else if (!session) {
    claudeCliEvents = parsers.parseClaudeCliSessionEvents(sessionId) || [];
  }

  if (claudeCliEvents.length === 0) return gatewayEvents;
  if (gatewayEvents.length === 0) return claudeCliEvents;

  // Merge both streams, de-duplicate by (id || timestamp+role), sort by timestamp
  const seen = new Set();
  const combined = [];
  for (const e of [...gatewayEvents, ...claudeCliEvents]) {
    const key = e.id || `${e.timestamp}:${e.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(e);
  }
  combined.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });
  return combined;
}

app.get('/api/sessions/:id', db.authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions();
    let session = sessions.find(s => s.id === req.params.id);

    let events = collectSessionEvents(req.params.id, session);

    // If the session isn't in the list yet (race condition during active writing:
    // sessions.json may not be flushed yet, or the file read got partial data),
    // try to load events directly — if a JSONL file exists, build a minimal session stub.
    if (!session && events.length > 0) {
      session = {
        id: req.params.id,
        name: 'Session',
        agent: 'unknown',
        agentName: 'Agent',
        status: 'active',
        messageCount: events.length,
        updatedAt: Date.now(),
      };
    }

    if (!session) return res.status(404).json({ error: 'Session not found' });

    let result = null;
    if (events.length === 0) {
      const numericId = req.params.id.match(/\d+/)?.[0];
      events = numericId ? parsers.parseOpenCodeEvents(numericId) : [];
      result = numericId ? parsers.parseOpenCodeResult(numericId) : null;
    }
    res.json({ ...session, events, result });
  } catch (err) {
    console.error('[api/sessions/:id]', err);
    res.status(500).json({ error: 'Failed to fetch session detail' });
  }
});

// Session messages (for chat view)
app.get('/api/sessions/:agentId/:sessionId/messages', db.authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions();
    const session = sessions.find(s => s.id === req.params.sessionId);
    let events = collectSessionEvents(req.params.sessionId, session);
    if (events.length === 0) {
      const numericId = req.params.sessionId.match(/\d+/)?.[0];
      events = numericId ? parsers.parseOpenCodeEvents(numericId) : [];
    }
    const messages = events
      .filter(e => ['human', 'assistant', 'tool_use', 'tool_result'].includes(e.role))
      .map(e => ({
        role: e.role,
        content: typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
        timestamp: e.timestamp,
        toolName: e.tool_name || e.toolName,
        toolId: e.tool_use_id || e.toolId,
        inputTokens: e.usage?.input_tokens,
        outputTokens: e.usage?.output_tokens,
        cost: e.cost,
        model: e.model,
      }));
    res.json({ messages });
  } catch (err) {
    console.error('[api/sessions/messages]', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ─── Tasks (ticketing) ────────────────────────────────────────────────────────

app.get('/api/tasks', db.authMiddleware, (req, res) => {
  try {
    const { agentId, status, priority, tag, q, projectId } = req.query;
    const tasks = db.getAllTasks({ agentId, status, priority, tag, q, projectId });
    res.json({ tasks });
  } catch (err) {
    console.error('[api/tasks GET]', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.post('/api/tasks', db.authMiddleware, (req, res) => {
  try {
    const { title, description, status, priority, agentId, tags, requestFrom } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    if (agentId && !db.userOwnsAgent(req, agentId)) {
      return res.status(403).json({ error: 'You can only assign tasks to agents you own' });
    }
    const task = db.createTask({ title: title.trim(), description, status, priority, agentId, tags, requestFrom });
    db.addTaskActivity({ taskId: task.id, type: 'created', toValue: task.status, actor: 'user' });
    broadcastTasksUpdate();
    res.status(201).json({ task });
  } catch (err) {
    console.error('[api/tasks POST]', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.patch('/api/tasks/:id', db.authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const gate = checkTaskAccess(req, id);
    if (gate) return res.status(403).json({ error: gate });
    // agentId in body = actor identifier (from agent script); assignTo = new assignment (from UI)
    const { agentId: actorAgentId, assignTo, note, status, priority, title, description, tags, cost, sessionId, inputTokens, outputTokens, requestFrom } = req.body;
    const before = db.getTask(id);
    if (!before) return res.status(404).json({ error: 'Task not found' });

    const actor = actorAgentId || 'user';
    const patch = {};
    if (title       !== undefined) patch.title       = title;
    if (description !== undefined) patch.description = description;
    if (status      !== undefined) patch.status      = status;
    if (priority    !== undefined) patch.priority    = priority;
    if (tags         !== undefined) patch.tags         = tags;
    if (cost         !== undefined) patch.cost         = cost;
    if (inputTokens  !== undefined && inputTokens  !== '') patch.inputTokens  = inputTokens;
    if (outputTokens !== undefined && outputTokens !== '') patch.outputTokens = outputTokens;
    // Only update sessionId if a non-empty value is provided — empty string from
    // update_task.sh (missing 4th param) must not erase the existing sessionId.
    if (sessionId !== undefined && sessionId !== '') patch.sessionId = sessionId;
    if (assignTo    !== undefined) patch.agentId     = assignTo || null;
    if (requestFrom !== undefined) patch.requestFrom = requestFrom;

    const after = db.updateTask(id, patch);

    // Write activity entries for all meaningful changes (independent, not mutually exclusive)
    if (status !== undefined && status !== before.status) {
      db.addTaskActivity({ taskId: id, type: 'status_change', fromValue: before.status, toValue: status, actor, note });
    }
    if (assignTo !== undefined && assignTo !== before.agentId) {
      db.addTaskActivity({ taskId: id, type: 'assignment', fromValue: before.agentId || null, toValue: assignTo || null, actor });
    }

    // Auto-analyze: when agent assigned to a backlog ticket, run pre-flight analysis
    const shouldAutoAnalyze =
      assignTo && assignTo !== before.agentId &&
      (after.status === 'backlog') &&
      !after.analysis; // don't re-analyze if already done
    if (shouldAutoAnalyze) {
      analyzeTaskForAgent(after).then(analysis => {
        db.updateTask(id, { analysis });
        broadcastTasksUpdate();
        console.log(`[auto-analyze] Task ${id} analyzed for agent ${assignTo}`);
      }).catch(err => console.warn('[auto-analyze]', id, err.message));
    }

    if (note && status === undefined) {
      db.addTaskActivity({ taskId: id, type: 'comment', actor, note });
    }

    // Auto-dispatch: ticket moved to actionable status with an assigned agent
    // Cases: backlog→todo, blocked→todo, blocked→in_progress, in_review→in_progress (change request)
    const isMovingToTodo = status === 'todo';
    const isChangeRequest = status === 'in_progress' && before.status === 'in_review';
    const isBlockerResolved = (status === 'in_progress' || status === 'todo') && before.status === 'blocked';
    const shouldAutoDispatch =
      status !== undefined &&
      (isMovingToTodo || isChangeRequest || isBlockerResolved) &&
      before.status !== status &&
      after.agentId &&
      gatewayProxy.isConnected;
    if (shouldAutoDispatch) {
      const dispatchOpts = {};
      if (isChangeRequest) {
        dispatchOpts.changeRequestNote = note || null;
      } else if (isBlockerResolved) {
        dispatchOpts.blockerResolvedNote = note || null;
      } else if (isMovingToTodo) {
        dispatchOpts.additionalContext = note || null;
      }
      dispatchTaskToAgent(after, dispatchOpts).catch(err =>
        console.warn('[auto-dispatch]', after.id, err.message)
      );
    }

    broadcastTasksUpdate();
    res.json({ task: after });

    // Fire-and-forget: push status change to external source if applicable
    if (patch.status && patch.status !== before.status && after.externalId && after.externalSource) {
      const projectIntegrationsList = db.getProjectIntegrations(after.projectId || 'general');
      const integration = projectIntegrationsList.find(i => i.type === after.externalSource);
      if (integration) {
        const raw = db.getIntegrationRaw(integration.id);
        if (raw) {
          const adapter = integrations.getAdapter(raw.type);
          adapter.pushStatus(raw.config, after.externalId, patch.status).catch(err => {
            console.error('[integrations] pushStatus failed:', err.message);
          });
        }
      }
    }
  } catch (err) {
    console.error('[api/tasks PATCH]', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/tasks/:id', db.authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    if (!db.getTask(id)) return res.status(404).json({ error: 'Task not found' });
    const gate = checkTaskAccess(req, id);
    if (gate) return res.status(403).json({ error: gate });
    db.deleteTask(id);
    broadcastTasksUpdate();
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/tasks DELETE]', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

app.get('/api/tasks/:id/activity', db.authMiddleware, (req, res) => {
  try {
    if (!db.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const activity = db.getTaskActivity(req.params.id);
    res.json({ activity });
  } catch (err) {
    console.error('[api/tasks/:id/activity GET]', err);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// ── Shared dispatch logic (called by manual dispatch, PATCH hook, and startup sweep) ──
async function dispatchTaskToAgent(task, opts = {}) {
  if (!task.agentId) throw new Error('Task has no assigned agent');
  if (!gatewayProxy.isConnected) throw new Error('Gateway not connected');

  // ── 1 Ticket = 1 Session: reuse existing session if available ──
  const isFirstDispatch = !task.sessionId;
  let sessionKey;

  if (isFirstDispatch) {
    // First dispatch → create new session
    const sessionResult = await gatewayProxy.sessionsCreate(task.agentId);
    sessionKey = sessionResult.key || sessionResult.session_key || sessionResult.id;
    if (!sessionKey) throw new Error('Gateway did not return a session key');
  } else {
    // Subsequent dispatch → reuse the same session (context preserved)
    sessionKey = task.sessionId;
  }

  const aocToken = process.env.DASHBOARD_TOKEN || '';
  const aocPort  = process.env.PORT || '18800';
  const aocUrl   = `http://localhost:${aocPort}`;
  const curlBase = `curl -sf -X PATCH ${aocUrl}/api/tasks/${task.id} -H "Authorization: Bearer ${aocToken}" -H "Content-Type: application/json"`;
  const tagsLine = (task.tags || []).length > 0 ? `Tags: ${task.tags.join(', ')}` : '';

  // Build project context
  let projectContext = '';
  if (task.projectId && task.projectId !== 'general') {
    try {
      const project = db.getProject(task.projectId);
      if (project?.description) projectContext = `\n**Project Context:** ${project.description}\n`;
    } catch {}
  }

  // Build available connections context for the agent (NO inline credentials, filtered by assignment)
  let connectionsContext = '';
  try {
    const agentConnIds = db.getAgentConnectionIds(task.agentId);
    const allConns = db.getAllConnections().filter(c => c.enabled);
    const conns = allConns.filter(c => agentConnIds.includes(c.id));
    if (conns.length > 0) {
      const lines = conns.map(c => {
        const meta = c.metadata || {};
        if (c.type === 'bigquery') {
          const ds = meta.datasets?.length ? meta.datasets.join(', ') : '(discover via bq ls)';
          return `  - **${c.name}** (BigQuery): project \`${meta.projectId || '?'}\`, datasets: ${ds}\n    → \`aoc-connect.sh "${c.name}" query "SELECT ..."\``;
        }
        if (c.type === 'postgres') {
          return `  - **${c.name}** (PostgreSQL): host \`${meta.host || 'localhost'}\`, port ${meta.port || 5432}, db \`${meta.database || '?'}\`\n    → \`aoc-connect.sh "${c.name}" query "SELECT ..."\``;
        }
        if (c.type === 'ssh') {
          return `  - **${c.name}** (SSH/VPS): \`${meta.sshUser || 'root'}@${meta.sshHost || '?'}\` port ${meta.sshPort || 22}\n    → \`aoc-connect.sh "${c.name}" exec "command"\``;
        }
        if (c.type === 'website') {
          const baseUrl = meta.url || '?';
          const loginUrl = meta.loginUrl ? `${baseUrl.replace(/\/$/, '')}${meta.loginUrl}` : null;
          const desc = meta.description ? ` — ${meta.description}` : '';
          const authLabel = meta.authType === 'none' ? 'public' : `auth: ${meta.authType}`;
          return `  - **${c.name}** (Website): \`${baseUrl}\` (${authLabel})${loginUrl ? ` login: \`${loginUrl}\`` : ''}${desc}\n    → Browse: \`aoc-connect.sh "${c.name}" browse "/path"\`\n    → API: \`aoc-connect.sh "${c.name}" api "/endpoint"\``;
        }
        if (c.type === 'github') {
          const repo = `${meta.repoOwner || '?'}/${meta.repoName || '?'}`;
          const desc = meta.description ? ` — ${meta.description}` : '';
          return `  - **${c.name}** (GitHub): \`${repo}\` branch \`${meta.branch || 'main'}\`${desc}\n    → \`aoc-connect.sh "${c.name}" <info|prs|issues|files|diff|clone>\``;
        }
        if (c.type === 'odoocli') {
          const desc = meta.description ? ` — ${meta.description}` : '';
          return `  - **${c.name}** (Odoo XML-RPC): \`${meta.odooUrl || '?'}\` db \`${meta.odooDb || '?'}\`${desc}\n    → \`aoc-connect.sh "${c.name}" <odoocli-subcommand>\`\n    Example: \`aoc-connect.sh "${c.name}" record search sale.order --domain "[('state','=','draft')]" --fields name,partner_id,amount_total\``;
        }
        if (c.type === 'google_workspace') {
          const linked = meta.linkedEmail || '(not linked)';
          const preset = meta.preset || 'custom';
          const state  = meta.authState || 'unknown';
          return `  - **${c.name}** (Google Workspace): linked \`${linked}\` · preset \`${preset}\` · state \`${state}\`\n    → \`gws-call.sh "${c.name}" <service> <method> '<json-body>'\`\n    Services: drive, docs, sheets, slides, gmail, calendar. Example: \`gws-call.sh "${c.name}" docs documents.create '{"title":"..."}'\``;
        }
        return `  - **${c.name}** (${c.type})`;
      });
      connectionsContext = `\n**Available Connections** (use \`aoc-connect.sh\` — credentials are handled automatically, never hardcode them):\n${lines.join('\n')}\n\nTo list all connections: \`check_connections.sh\`\n`;
    }
  } catch {}

  let message;

  if (isFirstDispatch) {
    // Full task briefing for first dispatch
    const extraContext = opts.additionalContext;
    message = [
      `📋 **Task: ${task.title}**`,
      ``,
      `Task ID: \`${task.id}\``,
      `Priority: ${task.priority || 'medium'}`,
      tagsLine,
      ``,
      task.description ? `**Description:**\n${task.description}` : '',
      projectContext,
      extraContext ? `\n**Additional Context from operator:**\n${extraContext}` : '',
      connectionsContext,
      ``,
      `---`,
      `IMPORTANT: Report your progress using ONE of these methods:`,
      ``,
      `**Method 1 — Script (preferred):**`,
      `\`update_task.sh ${task.id} in_progress "Starting..." $SESSION_KEY\``,
      `\`update_task.sh ${task.id} in_review "Summary" "" <input_tokens> <output_tokens>\``,
      `\`update_task.sh ${task.id} blocked "Reason here"\``,
      ``,
      `Replace <input_tokens> and <output_tokens> with your actual token usage if available (integers, omit if unknown).`,
      ``,
      `**Method 2 — Direct curl (fallback if script fails):**`,
      `\`${curlBase} -d '{"status":"in_progress","note":"Starting"}'\``,
      `\`${curlBase} -d '{"status":"in_review","note":"Summary","inputTokens":1234,"outputTokens":567}'\``,
      `\`${curlBase} -d '{"status":"blocked","note":"Reason here"}'\``,
      ``,
      `When your work is complete, set status to "in_review" — NOT "done". A human will review and approve.`,
      `If you cannot complete the task for ANY reason, ALWAYS report it as "blocked".`,
    ].filter(l => l !== null && l !== undefined).join('\n');
  } else if (opts.blockerResolvedNote !== undefined) {
    // Blocker resolved — inform agent the issue is fixed and they should continue
    const resolvedNote = opts.blockerResolvedNote;
    message = resolvedNote
      ? [
          `---`,
          `✅ **Blocker resolved — please continue.**`,
          ``,
          `The issue that was blocking you has been fixed:`,
          resolvedNote,
          ``,
          `You already have the full context from your previous work. Please continue where you left off.`,
          `When done, update status to "in_review".`,
        ].join('\n')
      : [
          `---`,
          `✅ **Blocker resolved — please continue.**`,
          ``,
          `The issue that was blocking you has been fixed. You already have the full context from your previous work.`,
          `Please continue where you left off.`,
          `When done, update status to "in_review".`,
        ].join('\n');
  } else {
    // Continue message for re-dispatch — agent already has full context from prior messages
    const changeNote = opts.changeRequestNote;
    const extraContext = opts.additionalContext;
    if (changeNote) {
      message = [
        `---`,
        `⚠️ **Change Request from reviewer:**`,
        changeNote,
        ``,
        `Please address the feedback above. You already have the full context from your previous work on this ticket.`,
        `When done, update status to "in_review" again.`,
      ].join('\n');
    } else if (extraContext) {
      message = [
        `---`,
        `🔄 **Continue working on this ticket.**`,
        ``,
        `**Additional instructions from operator:**`,
        extraContext,
        ``,
        `You already have the full context from your previous work. Please continue where you left off.`,
        `When done, update status to "in_review".`,
      ].join('\n');
    } else {
      message = [
        `---`,
        `🔄 **Continue working on this ticket.**`,
        ``,
        `You already have the full context from your previous work. Please continue where you left off.`,
        `When done, update status to "in_review".`,
      ].join('\n');
    }
  }

  await gatewayProxy.chatSend(sessionKey, message);

  // Update task — always use the same sessionId (no allSessionIds tracking)
  const patch = { sessionId: sessionKey, status: 'in_progress' };
  db.updateTask(task.id, patch);
  db.addTaskActivity({
    taskId: task.id,
    type: 'status_change',
    fromValue: task.status,
    toValue: 'in_progress',
    actor: 'system',
    note: isFirstDispatch
      ? `Dispatched to agent ${task.agentId}`
      : `Continued by agent ${task.agentId}${opts.changeRequestNote ? ' (change request)' : ''}`,
  });
  broadcastTasksUpdate();

  console.log(`[dispatch] Task ${task.id} → ${task.agentId} (session: ${sessionKey}, first: ${isFirstDispatch})`);
  return { sessionKey, agentId: task.agentId };
}

// Dispatch task to agent via gateway chat session
// ── Pre-flight task analysis (lightweight AI, no gateway needed) ──────────────
async function analyzeTaskForAgent(task) {
  if (!task.agentId) throw new Error('Task has no assigned agent');

  // Gather agent's skills & tools for readiness check
  let agentSkills = [], agentTools = [];
  try { agentSkills = parsers.getAgentSkills(task.agentId).map(s => s.slug || s.name); } catch {}
  try { agentTools = parsers.getAgentTools(task.agentId).filter(t => t.enabled).map(t => t.name); } catch {}

  // Fetch project context
  let projectContext = '';
  if (task.projectId && task.projectId !== 'general') {
    try {
      const project = db.getProject(task.projectId);
      if (project?.description) projectContext = project.description;
    } catch {}
  }

  const prompt = [
    `You are a task analyst for an AI agent operations center. Analyze this task ticket and produce a structured pre-flight analysis in JSON format.`,
    ``,
    projectContext ? `## Project Context\n${projectContext}\n` : '',
    `## Task`,
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : '',
    task.requestFrom ? `Requested by: ${task.requestFrom}` : '',
    task.priority ? `Priority: ${task.priority}` : '',
    (task.tags || []).length > 0 ? `Tags: ${task.tags.join(', ')}` : '',
    ``,
    `## Agent Capabilities`,
    `Agent ID: ${task.agentId}`,
    `Available skills: ${agentSkills.length > 0 ? agentSkills.join(', ') : '(none)'}`,
    `Available tools: ${agentTools.length > 0 ? agentTools.join(', ') : '(standard)'}`,
    ...(() => {
      try {
        const agentConnIds = db.getAgentConnectionIds(task.agentId);
        const allConns = db.getAllConnections().filter(c => c.enabled);
        const conns = allConns.filter(c => agentConnIds.includes(c.id));
        if (conns.length === 0) return ['', '## Available Connections', '(none registered)'];
        const lines = conns.map(c => {
          const m = c.metadata || {};
          if (c.type === 'bigquery') return `  - ${c.name} (BigQuery): project ${m.projectId || '?'}, datasets: ${(m.datasets || []).join(', ') || '?'} → aoc-connect.sh "${c.name}" query "SQL"`;
          if (c.type === 'postgres') return `  - ${c.name} (PostgreSQL): ${m.host || 'localhost'}:${m.port || 5432}/${m.database || '?'} → aoc-connect.sh "${c.name}" query "SQL"`;
          if (c.type === 'ssh') return `  - ${c.name} (SSH/VPS): ${m.sshUser || 'root'}@${m.sshHost || '?'}:${m.sshPort || 22} → aoc-connect.sh "${c.name}" exec "cmd"`;
          if (c.type === 'website') {
            const baseUrl = m.url || '?';
            const loginUrl = m.loginUrl ? `${baseUrl.replace(/\/$/, '')}${m.loginUrl}` : null;
            const auth = m.authType === 'none' ? 'public' : `auth: ${m.authType}`;
            const loginHint = loginUrl ? ` — browser login at ${loginUrl}` : '';
            const desc = m.description ? ` — ${m.description}` : '';
            return `  - ${c.name} (Website): ${baseUrl} (${auth})${loginHint}${desc} → aoc-connect.sh "${c.name}" browse|api`;
          }
          if (c.type === 'github') {
            const repo = `${m.repoOwner || '?'}/${m.repoName || '?'}`;
            const desc = m.description ? ` — ${m.description}` : '';
            return `  - ${c.name} (GitHub): ${repo} branch ${m.branch || 'main'}${desc} → aoc-connect.sh "${c.name}" info|prs|issues|files|diff|clone`;
          }
          if (c.type === 'odoocli') {
            const desc = m.description ? ` — ${m.description}` : '';
            return `  - ${c.name} (Odoo XML-RPC): ${m.odooUrl || '?'} db ${m.odooDb || '?'}${desc} → aoc-connect.sh "${c.name}" <odoocli subcommand>`;
          }
          return `  - ${c.name} (${c.type})`;
        });
        return ['', '## Available Connections (use aoc-connect.sh — credentials handled automatically)', ...lines];
      } catch { return []; }
    })(),
    ``,
    `## Instructions`,
    `Respond with ONLY valid JSON (no markdown fences, no explanation) matching this exact structure:`,
    `{`,
    `  "intent": "1-2 sentence summary of what the user actually wants, in business terms",`,
    `  "dataSources": ["list of likely data sources/tables/APIs needed"],`,
    `  "executionPlan": ["step 1", "step 2", "...ordered steps the agent will take"],`,
    `  "estimatedOutput": "describe expected output format and volume",`,
    `  "potentialIssues": ["any ambiguities, missing info, or risks"],`,
    `  "readiness": {`,
    `    "ready": true/false,`,
    `    "missingSkills": ["skills agent needs but doesn't have"],`,
    `    "missingTools": ["tools agent needs but doesn't have"],`,
    `    "availableSkills": ["relevant skills agent already has"]`,
    `  }`,
    `}`,
    ``,
    `Analyze the ticket thoroughly based on what the task requires and what the agent can do.`,
    `For dataSources, infer what resources (databases, APIs, files, services, etc.) are likely needed based on the task description.`,
    `For readiness, compare the task requirements against the agent's available skills and tools listed above. Only flag a skill/tool as missing if the task clearly requires a capability the agent does not have.`,
    `If the task is general (e.g. writing, research, coding), standard agent tools may be sufficient — don't require specialized skills unnecessarily.`,
    `Answer in the same language as the ticket (Indonesian if ticket is in Indonesian).`,
  ].filter(Boolean).join('\n');

  // Direct Claude CLI call — bypass buildPrompt (which is for agent file generation)
  const { spawn } = require('child_process');
  const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';
  const model = process.env.AI_ASSIST_MODEL || 'haiku';
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ['--print', prompt, '--output-format', 'text', '--no-session-persistence', '--model', model], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(stderr.trim() || `Claude CLI exited with code ${code}`));
      else resolve(stdout.trim());
    });
  });

  // Parse JSON — strip markdown fences if AI added them
  const cleaned = result.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  const analysis = JSON.parse(cleaned);
  analysis.analyzedAt = new Date().toISOString();
  return analysis;
}

app.post('/api/tasks/:id/analyze', db.authMiddleware, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.agentId) return res.status(400).json({ error: 'Task must be assigned to an agent first' });
    const gate = checkTaskAccess(req, task.id);
    if (gate) return res.status(403).json({ error: gate });

    const analysis = await analyzeTaskForAgent(task);
    db.updateTask(task.id, { analysis });
    broadcastTasksUpdate();
    res.json({ ok: true, analysis });
  } catch (err) {
    console.error('[api/tasks/analyze]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/:id/dispatch', db.authMiddleware, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.agentId) return res.status(400).json({ error: 'Task must be assigned to an agent first' });
    const gate = checkTaskAccess(req, task.id);
    if (gate) return res.status(403).json({ error: gate });
    if (!gatewayProxy.isConnected) return res.status(503).json({ error: 'Gateway not connected' });
    const result = await dispatchTaskToAgent(task);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/tasks/dispatch]', err);
    res.status(500).json({ error: err.message });
  }
})

// ─── Connections (third-party data sources) ──────────────────────────────────

// Feature flags for connection types — UI uses this to hide unconfigured options
app.get('/api/connections/config/features', db.authMiddleware, (_req, res) => {
  const cfg = require('./lib/config.cjs');
  res.json({
    features: {
      googleWorkspace: !!cfg.GOOGLE_OAUTH_CONFIGURED,
    },
    redirectUri: cfg.GOOGLE_OAUTH_CONFIGURED ? parsers.googleRedirectUri() : null,
  });
});

app.get('/api/connections', db.authMiddleware, (_req, res) => {
  res.json({ connections: db.getAllConnections() });
});

app.get('/api/connections/assignments', db.authMiddleware, (_req, res) => {
  res.json({ assignments: db.getAllAgentConnectionAssignments() });
});

app.get('/api/connections/:id', db.authMiddleware, (req, res) => {
  const conn = db.getConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  res.json({ connection: conn });
});

app.post('/api/connections', db.authMiddleware, async (req, res) => {
  try {
    const { name, type, credentials, metadata, enabled } = req.body;
    let { id } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
    if (!id) id = require('crypto').randomUUID();

    if (type === 'google_workspace') {
      const cfgMod = require('./lib/config.cjs');
      if (!cfgMod.GOOGLE_OAUTH_CONFIGURED) {
        return res.status(503).json({ error: 'Google Workspace connections not configured' });
      }
      const preset = (metadata && metadata.preset) || 'full-workspace';
      const customScopes = (metadata && metadata.customScopes) || [];
      const pendingMeta = {
        linkedEmail: null,
        scopes: [],
        preset,
        customScopes,
        authState: 'pending',
      };
      const conn = db.createConnection({
        id, name, type,
        credentials: '',
        metadata: pendingMeta,
        enabled: enabled !== false,
        createdBy: req.user?.userId,
      });
      try {
        const { authUrl, codeVerifier, scopes } = parsers.googleBeginAuth({
          connectionId: id,
          userId: req.user?.id || 'default',
          preset,
          customScopes,
        });
        db.updateConnection(id, {
          metadata: { ...pendingMeta, scopes: scopes.map(s => s.replace(/^https:\/\/www\.googleapis\.com\/auth\//, '')), _pkceVerifier: codeVerifier },
        });
        return res.json({ connection: conn, authUrl });
      } catch (err) {
        db.deleteConnection(id);
        throw err;
      }
    }

    const conn = db.createConnection({ id, name, type, credentials, metadata, enabled, createdBy: req.user?.userId });
    res.json({ ok: true, connection: conn });
  } catch (err) {
    console.error('[api/connections POST]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Re-generate auth URL for an expired or disconnected google_workspace connection
app.post('/api/connections/:id/google/reauth', db.authMiddleware, db.requireConnectionOwnership, (req, res) => {
  try {
    const conn = db.getConnection(req.params.id);
    if (!conn || conn.type !== 'google_workspace') return res.status(404).json({ error: 'Not found' });
    const meta = conn.metadata || {};
    const { authUrl, codeVerifier } = parsers.googleBeginAuth({
      connectionId: req.params.id,
      userId: req.user?.id || 'default',
      preset: meta.preset || 'full-workspace',
      customScopes: meta.customScopes || [],
    });
    db.updateConnection(req.params.id, {
      metadata: { ...meta, authState: 'pending', _pkceVerifier: codeVerifier },
    });
    res.json({ authUrl });
  } catch (err) {
    console.error('[api/connections/reauth]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Disconnect (revoke + keep row) a google_workspace connection
app.post('/api/connections/:id/google/disconnect', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    await parsers.googleDisconnect(req.params.id, { fullDelete: false });
    broadcast({ type: 'connection:auth_expired', payload: { connectionId: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/connections/disconnect]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Manual health check for a google_workspace connection
app.get('/api/connections/:id/google/health', db.authMiddleware, async (req, res) => {
  try {
    const result = await parsers.googleTestConnection(req.params.id);
    if (!result.ok && result.code === 'invalid_grant') {
      broadcast({ type: 'connection:auth_expired', payload: { connectionId: req.params.id } });
    }
    res.json(result);
  } catch (err) {
    console.error('[api/connections/health]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// OAuth callback — PUBLIC (protected by signed state JWT)
app.get('/api/connections/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  function renderHtml({ type, connectionId, errorMsg }) {
    const payload = JSON.stringify({ type, connectionId, error: errorMsg });
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${type === 'oauth-success' ? 'Connected' : 'Error'}</title>
    <style>body{font-family:system-ui;padding:2rem;text-align:center;color:#222}.ok{color:#0a7a0a}.err{color:#a00}</style></head>
    <body>
      <h2 class="${type === 'oauth-success' ? 'ok' : 'err'}">${type === 'oauth-success' ? '\u2713 Connected' : '\u2717 Error'}</h2>
      <p>${errorMsg || 'You can close this window.'}</p>
      <script>
        try { window.opener && window.opener.postMessage(${payload}, '*'); } catch (e) {}
        setTimeout(function(){ window.close(); }, 1500);
      </script>
    </body></html>`;
  }

  if (error) {
    return res.status(400).send(renderHtml({ type: 'oauth-error', errorMsg: `Google returned: ${error}` }));
  }
  if (!code || !state) {
    return res.status(400).send(renderHtml({ type: 'oauth-error', errorMsg: 'Missing code or state' }));
  }

  try {
    const conn = await parsers.googleCompleteAuth({ stateToken: state, code });
    broadcast({ type: 'connection:auth_completed', payload: { connectionId: conn.id } });
    res.send(renderHtml({ type: 'oauth-success', connectionId: conn.id }));
  } catch (err) {
    console.error('[oauth/callback]', err);
    res.status(err.status || 500).send(renderHtml({ type: 'oauth-error', errorMsg: err.message }));
  }
});

// Dispense a short-lived Google access token to an assigned agent
app.get('/api/connections/:id/google-access-token', db.authMiddleware, async (req, res) => {
  try {
    const connId = req.params.id;
    const conn = db.getConnection(connId);
    if (!conn || conn.type !== 'google_workspace') return res.status(404).json({ error: 'Not found' });

    const agentId = req.user?.agentId || req.get('X-AOC-Agent-Id');
    if (agentId) {
      const assigned = db.getAgentConnectionIds(agentId);
      if (!assigned.includes(connId)) {
        return res.status(403).json({ error: 'Agent not assigned to this connection' });
      }
    }
    const out = await parsers.googleDispenseToken(connId);
    res.json(out);
  } catch (err) {
    console.error('[api/connections/google-access-token]', err);
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

app.patch('/api/connections/:id', db.authMiddleware, db.requireConnectionOwnership, (req, res) => {
  try {
    const conn = db.getConnection(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    const updated = db.updateConnection(req.params.id, req.body);
    res.json({ connection: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/connections/:id', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const conn = db.getConnection(req.params.id);
    if (conn && conn.type === 'google_workspace') {
      try { await parsers.googleDisconnect(req.params.id, { fullDelete: true }); }
      catch (err) { console.warn('[delete] google revoke failed (best-effort):', err.message); }
    } else {
      db.deleteConnection(req.params.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/connections DELETE]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connections/:id/test', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const conn = db.getConnection(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Not found' });
    if (conn.type === 'google_workspace') {
      const result = await parsers.googleTestConnection(req.params.id);
      if (!result.ok && result.code === 'invalid_grant') {
        broadcast({ type: 'connection:auth_expired', payload: { connectionId: req.params.id } });
      }
      return res.json(result);
    }
    const raw = db.getConnectionRaw(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Connection not found' });

    const { execSync } = require('child_process');
    let result = { ok: false, error: 'Unknown type' };

    if (raw.type === 'bigquery') {
      // Test: bq ls on the project
      const projectId = raw.metadata.projectId;
      if (!projectId) return res.json({ ok: false, error: 'projectId not set in metadata' });
      // Write SA key to temp file for test
      const tmpKey = `/tmp/aoc-bq-test-${Date.now()}.json`;
      require('fs').writeFileSync(tmpKey, raw.credentials, 'utf-8');
      try {
        // Activate + test
        execSync(`${process.env.GCLOUD_BIN || 'gcloud'} auth activate-service-account --key-file="${tmpKey}" 2>&1`, { timeout: 15000, encoding: 'utf-8' });
        const bqBin = process.env.BQ_BIN || 'bq';
        const output = execSync(`${bqBin} ls --project_id=${projectId} 2>&1 | head -5`, { timeout: 15000, encoding: 'utf-8' });
        result = { ok: true, message: `Connected to ${projectId}`, preview: output.trim() };
      } catch (e) {
        result = { ok: false, error: e.message || e.toString() };
      } finally {
        try { require('fs').unlinkSync(tmpKey); } catch {}
      }
    } else if (raw.type === 'postgres') {
      const m = raw.metadata;
      const connStr = `postgresql://${m.username || 'postgres'}:${encodeURIComponent(raw.credentials)}@${m.host || 'localhost'}:${m.port || 5432}/${m.database || 'postgres'}${m.sslMode ? `?sslmode=${m.sslMode}` : ''}`;
      try {
        const output = execSync(`psql "${connStr}" -c "SELECT version();" 2>&1 | head -3`, { timeout: 10000, encoding: 'utf-8' });
        result = { ok: true, message: 'Connected', preview: output.trim() };
      } catch (e) {
        result = { ok: false, error: e.message || e.toString() };
      }
    } else if (raw.type === 'ssh') {
      const m = raw.metadata;
      const host = m.sshHost; const port = m.sshPort || 22; const user = m.sshUser || 'root';
      if (!host) return res.json({ ok: false, error: 'sshHost not set' });
      // Write key to temp file
      const tmpKey = `/tmp/aoc-ssh-test-${Date.now()}`;
      require('fs').writeFileSync(tmpKey, raw.credentials, { mode: 0o600 });
      try {
        const output = execSync(
          `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "${tmpKey}" -p ${port} ${user}@${host} "hostname && uptime" 2>&1`,
          { timeout: 15000, encoding: 'utf-8' }
        );
        result = { ok: true, message: `Connected to ${host}`, preview: output.trim() };
      } catch (e) {
        result = { ok: false, error: e.message || e.toString() };
      } finally {
        try { require('fs').unlinkSync(tmpKey); } catch {}
      }
    } else if (raw.type === 'website') {
      const url = raw.metadata.url;
      if (!url) return res.json({ ok: false, error: 'URL not set in metadata' });
      try {
        const https = url.startsWith('https') ? require('https') : require('http');
        const status = await new Promise((resolve, reject) => {
          const req = https.get(url, { timeout: 10000 }, (res) => resolve(res.statusCode));
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
        });
        if (status >= 200 && status < 400) {
          result = { ok: true, message: `Reachable (HTTP ${status})`, preview: url };
        } else {
          result = { ok: false, error: `HTTP ${status}` };
        }
      } catch (e) {
        result = { ok: false, error: e.message || e.toString() };
      }
    } else if (raw.type === 'odoocli') {
      const m = raw.metadata;
      if (!m.odooUrl) return res.json({ ok: false, error: 'odooUrl not set' });
      try {
        const authFlag = m.odooAuthType === 'api_key' ? 'ODOOCLI_API_KEY' : 'ODOOCLI_PASSWORD';
        const env = `ODOOCLI_URL="${m.odooUrl}" ODOOCLI_DB="${m.odooDb || ''}" ODOOCLI_USERNAME="${m.odooUsername || ''}" ${authFlag}="${raw.credentials || ''}"`;
        const output = execSync(`${env} odoocli auth test 2>&1`, { timeout: 15000, encoding: 'utf-8', shell: '/bin/bash' });
        result = { ok: true, message: `Connected to ${m.odooUrl}`, preview: output.trim() };
      } catch (e) {
        result = { ok: false, error: e.message || e.toString() };
      }
    } else if (raw.type === 'github') {
      const m = raw.metadata;
      const repo = `${m.repoOwner || ''}/${m.repoName || ''}`;
      if (!repo || repo === '/') return res.json({ ok: false, error: 'repoOwner/repoName not set' });
      try {
        const token = raw.credentials || '';
        const cmd = token
          ? `GH_TOKEN="${token}" gh repo view ${repo} --json name,defaultBranchRef,visibility 2>&1 | head -5`
          : `gh repo view ${repo} --json name,defaultBranchRef,visibility 2>&1 | head -5`;
        const output = execSync(cmd, { timeout: 15000, encoding: 'utf-8', shell: '/bin/bash' });
        result = { ok: true, message: `Connected to ${repo}`, preview: output.trim() };
      } catch (e) {
        result = { ok: false, error: e.message || e.toString() };
      }
    }

    // Update test state
    db.updateConnection(req.params.id, { lastTestedAt: new Date().toISOString(), lastTestOk: result.ok });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent ↔ Connection assignments ─────────────────────────────────────────

app.get('/api/agents/:id/connections', db.authMiddleware, (req, res) => {
  const ids = db.getAgentConnectionIds(req.params.id);
  const connections = ids.map(id => db.getConnection(id)).filter(Boolean);
  res.json({ connectionIds: ids, connections });
});

app.put('/api/agents/:id/connections', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { connectionIds } = req.body;
    if (!Array.isArray(connectionIds)) return res.status(400).json({ error: 'connectionIds must be an array' });
    db.setAgentConnections(req.params.id, connectionIds);
    // Sync connections context into agent's TOOLS.md so it knows about assigned connections during chat
    try {
      const allConns = db.getAllConnections();
      const assigned = allConns.filter(c => connectionIds.includes(c.id));
      parsers.syncAgentConnectionsContext(req.params.id, assigned, parsers.getAgentFile, parsers.saveAgentFile);
    } catch (e) {
      console.warn(`[connections] Failed to sync context for ${req.params.id}:`, e.message);
    }
    res.json({ ok: true, connectionIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── Agent-readable connections (returns decrypted credentials for agent scripts) ──
app.get('/api/agent/connections', db.authMiddleware, (req, res) => {
  try {
    const agentId = req.query.agentId;
    if (!agentId) return res.json({ connections: [], error: 'agentId query param required' });
    const conns = db.getAgentConnectionsRaw(agentId);
    const result = conns.map(c => {
      const meta = c.metadata || {};
      const out = { name: c.name, type: c.type };

      if (c.type === 'bigquery') {
        out.projectId = meta.projectId || null;
        out.datasets = meta.datasets || [];
        out.serviceAccountJson = c.credentials || null;
        out.hint = 'Write service account JSON to a temp file, activate with gcloud auth, then use bq CLI.';
      } else if (c.type === 'postgres') {
        out.host = meta.host || 'localhost';
        out.port = meta.port || 5432;
        out.database = meta.database || null;
        out.username = meta.username || 'postgres';
        out.password = c.credentials || null;
        out.sslMode = meta.sslMode || null;
        out.hint = 'Connect via psql or any PostgreSQL client with these credentials.';
      } else if (c.type === 'ssh') {
        out.host = meta.sshHost || null;
        out.port = meta.sshPort || 22;
        out.user = meta.sshUser || 'root';
        out.privateKey = c.credentials || null;
        out.hint = 'Write private key to a temp file (chmod 600), use ssh -i to connect.';
      } else if (c.type === 'website') {
        out.url = meta.url || null;
        out.loginUrl = meta.loginUrl ? `${(meta.url || '').replace(/\/$/, '')}${meta.loginUrl}` : null;
        out.authType = meta.authType || 'none';
        out.username = meta.authUsername || null;
        out.password = meta.authType !== 'none' ? (c.credentials || null) : null;
        out.description = meta.description || null;
        if (meta.authType === 'basic' && meta.loginUrl) {
          out.hint = `Open browser to ${out.loginUrl}, login with username and password, then navigate the site.`;
        } else if (meta.authType === 'api_key') {
          out.hint = `Use header "${meta.authUsername || 'X-API-Key'}: <key>" for API requests.`;
        } else if (meta.authType === 'token') {
          out.hint = 'Use header "Authorization: Bearer <token>" for API requests.';
        } else {
          out.hint = 'Public website, no authentication required.';
        }
      } else if (c.type === 'github') {
        out.githubMode = meta.githubMode || 'remote';
        out.branch = meta.branch || 'main';
        out.description = meta.description || null;
        if (out.githubMode === 'local') {
          out.localPath = meta.localPath || null;
          out.hint = `Local git repo at ${meta.localPath || '?'}. Use git -C "${meta.localPath || '?'}" directly, or aoc-connect.sh "${c.name}" <action>.`;
        } else {
          out.repoOwner = meta.repoOwner || null;
          out.repoName = meta.repoName || null;
          out.repo = `${meta.repoOwner || ''}/${meta.repoName || ''}`;
          out.token = c.credentials || null;
          out.hint = `Use gh CLI with GH_TOKEN env var. Repo: ${out.repo}, branch: ${out.branch}.`;
        }
      } else if (c.type === 'odoocli') {
        out.odooUrl = meta.odooUrl || null;
        out.odooDb = meta.odooDb || null;
        out.odooUsername = meta.odooUsername || null;
        out.odooAuthType = meta.odooAuthType || 'password';
        out.credential = c.credentials || null;
        out.description = meta.description || null;
        out.hint = `Use odoocli CLI. Connection: ${meta.odooUrl} db ${meta.odooDb}.`;
      } else if (c.type === 'google_workspace') {
        out.linkedEmail = meta.linkedEmail || null;
        out.preset = meta.preset || null;
        out.scopes = meta.scopes || [];
        out.authState = meta.authState || 'unknown';
        out.hint = 'Use gws-call.sh <connection-name> <service> <method> [json-body] to call Google APIs. Credentials are handled automatically.';
      }

      return out;
    });
    res.json({ connections: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Projects ─────────────────────────────────────────────────────────────────
app.get('/api/projects', db.authMiddleware, (_req, res) => {
  res.json({ projects: db.getAllProjects() });
});

app.post('/api/projects', db.authMiddleware, (req, res) => {
  try {
    const { name, color, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const project = db.createProject({ name, color, description });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/projects/:id', db.authMiddleware, (req, res) => {
  try {
    const { name, color, description } = req.body;
    const project = db.updateProject(req.params.id, { name, color, description });
    if (!project) return res.status(404).json({ error: 'not found' });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', db.authMiddleware, (req, res) => {
  try {
    if (req.params.id === 'general') return res.status(403).json({ error: 'Cannot delete the default project' });
    db.deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Project Integrations ──────────────────────────────────────────────────────
app.get('/api/projects/:id/integrations', db.authMiddleware, (req, res) => {
  res.json({ integrations: db.getProjectIntegrations(req.params.id) });
});

app.post('/api/projects/:id/integrations', db.authMiddleware, async (req, res) => {
  try {
    const { type, credentials, spreadsheetId, sheetName, mapping, syncIntervalMs, enabled, syncFromRow, syncLimit } = req.body;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const adapter = integrations.getAdapter(type);

    // Encrypt credentials before storing
    const encryptedCredentials = credentials ? integrations.encrypt(
      typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
    ) : undefined;

    const config = {
      spreadsheetId, sheetName, mapping,
      ...(syncFromRow ? { syncFromRow: Number(syncFromRow) } : {}),
      ...(syncLimit   ? { syncLimit:   Number(syncLimit)   } : {}),
    };
    if (encryptedCredentials) config.credentials = encryptedCredentials;

    const validation = adapter.validateConfig(config);
    if (!validation.valid) return res.status(400).json({ error: validation.error });

    const integration = db.createIntegration({
      projectId: req.params.id,
      type,
      config,
      syncIntervalMs: syncIntervalMs || null,
      enabled: enabled !== false,
    });

    // Schedule if interval set
    if (integration.syncIntervalMs && integration.enabled) {
      integrations.scheduleIntegration(integration);
    }

    // Strip credentials before returning
    const { credentials: _c, ...safeConfig } = integration.config;
    res.json({ integration: { ...integration, config: safeConfig, hasCredentials: !!integration.config.credentials } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/projects/:id/integrations/:iid', db.authMiddleware, async (req, res) => {
  try {
    const existing = db.getIntegrationRaw(req.params.iid);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const { credentials, spreadsheetId, sheetName, mapping, syncIntervalMs, enabled, syncFromRow, syncLimit } = req.body;

    const newConfig = { ...existing.config };
    if (spreadsheetId !== undefined) newConfig.spreadsheetId = spreadsheetId;
    if (sheetName     !== undefined) newConfig.sheetName = sheetName;
    if (mapping       !== undefined) newConfig.mapping = mapping;
    if (syncFromRow   !== undefined) newConfig.syncFromRow = syncFromRow ? Number(syncFromRow) : undefined;
    if (syncLimit     !== undefined) newConfig.syncLimit   = syncLimit   ? Number(syncLimit)   : undefined;
    if (credentials) {
      newConfig.credentials = integrations.encrypt(
        typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
      );
    }

    const patch = { config: newConfig };
    if (syncIntervalMs !== undefined) patch.syncIntervalMs = syncIntervalMs || null;
    if (enabled        !== undefined) patch.enabled = enabled;

    const updated = db.updateIntegration(req.params.iid, patch);
    integrations.scheduleIntegration(updated); // reschedule (handles enable/disable/interval change)
    const { credentials: _c, ...safeConfig } = updated.config;
    res.json({ integration: { ...updated, config: safeConfig, hasCredentials: !!updated.config.credentials } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id/integrations/:iid', db.authMiddleware, (req, res) => {
  try {
    integrations.unscheduleIntegration(req.params.iid);
    db.deleteIntegration(req.params.iid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test connection — credentials passed in body, not yet saved
app.post('/api/projects/:id/integrations/:iid/test', db.authMiddleware, async (req, res) => {
  try {
    const { type, credentials, spreadsheetId } = req.body;
    const adapterType = type || 'google_sheets';
    const adapter = integrations.getAdapter(adapterType);
    const encCreds = credentials ? integrations.encrypt(
      typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
    ) : undefined;
    const result = await adapter.testConnection({ spreadsheetId, credentials: encCreds });
    res.json(result);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Get column headers for a given sheet name
// iid can be '_new' (during wizard before integration is saved) or an existing integration id
app.post('/api/projects/:id/integrations/:iid/headers', db.authMiddleware, async (req, res) => {
  try {
    const { sheetName, credentials, spreadsheetId } = req.body;
    let config;
    if (req.params.iid === '_new') {
      const encCreds = credentials ? integrations.encrypt(
        typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
      ) : undefined;
      config = { spreadsheetId, credentials: encCreds };
    } else {
      const raw = db.getIntegrationRaw(req.params.iid);
      if (!raw) return res.status(404).json({ error: 'not found' });
      config = raw.config;
    }
    const adapter = integrations.getAdapter('google_sheets');
    const headers = await adapter.getHeaders(config, sheetName);
    res.json({ headers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual sync trigger — responds immediately, runs sync async
app.post('/api/projects/:id/integrations/:iid/sync', db.authMiddleware, async (req, res) => {
  const integration = db.getIntegrationRaw(req.params.iid);
  if (!integration) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, message: 'Sync started' });
  integrations.syncIntegration(req.params.iid).catch(err => {
    console.error('[integrations] manual sync error:', err.message);
  });
});

// Cron — delivery targets (known channels + contacts from sessions)
app.get('/api/cron/delivery-targets', db.authMiddleware, (req, res) => {
  try {
    res.json({ channels: parsers.getDeliveryTargets() });
  } catch (err) {
    console.error('[api/cron/delivery-targets]', err.message);
    res.status(500).json({ error: 'Failed to fetch delivery targets' });
  }
});

// Cron — list
app.get('/api/cron', db.authMiddleware, (req, res) => {
  try {
    res.json({ jobs: parsers.parseCronJobs() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch cron jobs' });
  }
});

// Cron — create
app.post('/api/cron', db.authMiddleware, async (req, res) => {
  try {
    if (req.body?.agentId && !db.userOwnsAgent(req, req.body.agentId)) {
      return res.status(403).json({ error: 'You can only create cron jobs for agents you own' });
    }
    const result = await parsers.cronCreateJob(req.body, gatewayProxy);
    res.status(201).json(result);
  } catch (err) {
    console.error('[api/cron POST]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create cron job' });
  }
});

// Cron — run history for a job
app.get('/api/cron/:id/runs', db.authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await parsers.cronGetRuns(req.params.id, limit, gatewayProxy);
    res.json(result);
  } catch (err) {
    console.error('[api/cron/:id/runs]', err.message);
    res.status(500).json({ error: err.message || 'Failed to get cron runs' });
  }
});

// Cron — trigger job now
app.post('/api/cron/:id/run', db.authMiddleware, async (req, res) => {
  try {
    const gate = await checkCronAccess(req, req.params.id);
    if (gate) return res.status(403).json({ error: gate });
    const result = await parsers.cronRunJob(req.params.id, gatewayProxy);
    res.json(result);
  } catch (err) {
    console.error('[api/cron/:id/run]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to trigger cron job' });
  }
});

// Cron — toggle enabled/disabled
app.post('/api/cron/:id/toggle', db.authMiddleware, async (req, res) => {
  try {
    const gate = await checkCronAccess(req, req.params.id);
    if (gate) return res.status(403).json({ error: gate });
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: '`enabled` boolean required' });
    const result = await parsers.cronToggleJob(req.params.id, enabled, gatewayProxy);
    res.json(result);
  } catch (err) {
    console.error('[api/cron/:id/toggle]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to toggle cron job' });
  }
});

// Cron — edit
app.patch('/api/cron/:id', db.authMiddleware, async (req, res) => {
  try {
    const gate = await checkCronAccess(req, req.params.id);
    if (gate) return res.status(403).json({ error: gate });
    const result = await parsers.cronUpdateJob(req.params.id, req.body, gatewayProxy);
    res.json(result);
  } catch (err) {
    console.error('[api/cron PATCH]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update cron job' });
  }
});

// Cron — delete
app.delete('/api/cron/:id', db.authMiddleware, async (req, res) => {
  try {
    const gate = await checkCronAccess(req, req.params.id);
    if (gate) return res.status(403).json({ error: gate });
    const result = await parsers.cronDeleteJob(req.params.id, gatewayProxy);
    res.json(result);
  } catch (err) {
    console.error('[api/cron DELETE]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to delete cron job' });
  }
});

// ── Agent Custom Tools (scripts assigned via TOOLS.md) ───────────────────────

app.get('/api/agents/:id/custom-tools', db.authMiddleware, (req, res) => {
  try {
    const tools = parsers.listAgentCustomTools(req.params.id, parsers.getAgentFile);
    res.json({ tools });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/agents/:id/custom-tools/:filename/toggle', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { enabled, scope } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: '`enabled` boolean required' });
    const result = parsers.toggleAgentCustomTool(
      req.params.id, req.params.filename, enabled, scope || 'shared',
      parsers.getAgentFile, parsers.saveAgentFile
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/agents/:id/sync-task-script', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { id } = req.params;
    parsers.ensureUpdateTaskScript();
    parsers.toggleAgentCustomTool(id, 'update_task.sh', true, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/sync-task-script]', err);
    res.status(500).json({ error: err.message });
  }
});

// Agent workspace scripts (agentWorkspace/scripts/) — full CRUD
app.get('/api/agents/:id/scripts', db.authMiddleware, (req, res) => {
  try { res.json({ scripts: parsers.listAgentScripts(req.params.id) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/agents/:id/scripts/:filename', db.authMiddleware, (req, res) => {
  try { res.json(parsers.getAgentScript(req.params.id, req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.put('/api/agents/:id/scripts/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: '`content` required' });
    const result = parsers.saveAgentScript(req.params.id, req.params.filename, content);
    vSave(`script:agent:${req.params.id}:${req.params.filename}`, content, req);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.patch('/api/agents/:id/scripts/:filename/rename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ error: '`newName` required' });
    res.json(parsers.renameAgentScript(req.params.id, req.params.filename, newName));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.delete('/api/agents/:id/scripts/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try { res.json(parsers.deleteAgentScript(req.params.id, req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.patch('/api/agents/:id/scripts/:filename/meta', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try { res.json(parsers.updateAgentScriptMeta(req.params.id, req.params.filename, req.body)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Workspace Scripts ─────────────────────────────────────────────────────────

app.get('/api/scripts', db.authMiddleware, (req, res) => {
  try { res.json({ scripts: parsers.listScripts() }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/scripts/:filename', db.authMiddleware, (req, res) => {
  try { res.json(parsers.getScript(req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.put('/api/scripts/:filename', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: '`content` string required' });
    const result = parsers.saveScript(req.params.filename, content);
    vSave(`script:global:${req.params.filename}`, content, req);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.patch('/api/scripts/:filename/rename', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ error: '`newName` required' });
    res.json(parsers.renameScript(req.params.filename, newName));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.delete('/api/scripts/:filename', db.authMiddleware, db.requireAdmin, (req, res) => {
  try { res.json(parsers.deleteScript(req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.patch('/api/scripts/:filename/meta', db.authMiddleware, db.requireAdmin, (req, res) => {
  try { res.json(parsers.updateScriptMeta(req.params.filename, req.body)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Global channel configuration (sanitized — no tokens)
app.get('/api/channels', db.authMiddleware, (req, res) => {
  try {
    res.json(parsers.getChannelsConfig());
  } catch (err) {
    console.error('[api/channels]', err);
    res.status(500).json({ error: 'Failed to fetch channel config' });
  }
});

// Channel login: start QR flow via gateway RPC web.login.start
// POST /api/channels/:channel/:account/login/start
app.post('/api/channels/:channel/:account/login/start', db.authMiddleware, async (req, res) => {
  const { account } = req.params;

  if (!gatewayProxy.isConnected) {
    return res.status(503).json({ error: 'Gateway not connected. Start the gateway first.' });
  }

  try {
    // Params: { accountId?, force?, timeoutMs?, verbose? } — no channel field
    const result = await gatewayProxy.webLoginStart(account);
    const qrDataUrl = result?.qrDataUrl || null;
    const message = result?.message || null;

    if (qrDataUrl) return res.json({ qrDataUrl, message });

    // No QR = already linked — mark as authenticated if not already
    try {
      const { OPENCLAW_HOME, readJsonSafe } = require('./lib/config.cjs');
      const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
      const config = readJsonSafe(configPath);
      const acct = config?.channels?.whatsapp?.accounts?.[account];
      if (acct && !acct.authenticated) {
        acct.authenticated = true;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`[api/channels/login/start] Marked whatsapp/${account} as authenticated (already linked)`);
      }
    } catch (_) {}

    return res.json({ qrDataUrl: null, message: message || 'WhatsApp already linked.' });
  } catch (err) {
    console.error('[api/channels/login/start]', err);
    res.status(500).json({ error: err.message || 'Failed to start login flow' });
  }
});

// Channel login: wait for QR scan completion (long-poll, up to 3 min)
// POST /api/channels/:channel/:account/login/wait
app.post('/api/channels/:channel/:account/login/wait', db.authMiddleware, async (req, res) => {
  const { channel, account } = req.params;

  if (!gatewayProxy.isConnected) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }

  try {
    const result = await gatewayProxy.webLoginWait(account);

    // Mark the channel account as authenticated in openclaw.json
    try {
      const { OPENCLAW_HOME, readJsonSafe } = require('./lib/config.cjs');
      const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
      const config = readJsonSafe(configPath);
      if (config?.channels?.[channel]?.accounts?.[account]) {
        config.channels[channel].accounts[account].authenticated = true;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`[api/channels/login/wait] Marked ${channel}/${account} as authenticated`);
      }
    } catch (cfgErr) {
      console.warn('[api/channels/login/wait] Failed to update openclaw.json:', cfgErr.message);
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.warn('[api/channels/login/wait] failed:', err.message);
    res.status(500).json({ error: err.message || 'Login wait failed' });
  }

});

// Routes (channel bindings)
app.get('/api/routes', db.authMiddleware, (req, res) => {
  try {
    const routes = typeof parsers.parseRoutes === 'function' ? parsers.parseRoutes() : [];
    // Enrich with SQLite profile data (avatarPresetId, color)
    const enriched = routes.map(r => {
      const profile = db.getAgentProfile(r.agentId);
      return {
        ...r,
        avatarPresetId: profile?.avatarPresetId ?? profile?.avatar_preset_id ?? null,
        color: profile?.color ?? null,
      };
    });
    res.json({ routes: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

// ─── File Version History ─────────────────────────────────────────────────────

// GET /api/versions?scope=agent:tadaki:IDENTITY.md&limit=30
app.get('/api/versions', db.authMiddleware, (req, res) => {
  const { scope, limit = '30' } = req.query;
  if (!scope) return res.status(400).json({ error: 'scope is required' });
  try {
    const versions = versioning.listVersions(db.getDb(), { scopeKey: scope, limit: Math.min(parseInt(limit) || 30, 100) });
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/versions/:id — get a specific version (includes content)
app.get('/api/versions/:id', db.authMiddleware, (req, res) => {
  try {
    const v = versioning.getVersion(db.getDb(), parseInt(req.params.id));
    if (!v) return res.status(404).json({ error: 'Version not found' });
    res.json({ version: v });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/versions/:id/restore — restore a version (write content back to file)
app.post('/api/versions/:id/restore', db.authMiddleware, async (req, res) => {
  try {
    const v = versioning.getVersion(db.getDb(), parseInt(req.params.id));
    if (!v) return res.status(404).json({ error: 'Version not found' });

    const key = v.scope_key;
    const content = v.content;

    // Route to appropriate save function based on scope_key prefix
    if (key.startsWith('agent:')) {
      const parts = key.split(':');              // agent:{agentId}:{fileName}
      const agentId  = parts[1];
      const fileName = parts.slice(2).join(':');
      parsers.saveAgentFile(agentId, fileName, content);
    } else if (key.startsWith('skill:global:')) {
      const slug = key.slice('skill:global:'.length);
      parsers.saveSkillFileBySlug(slug, content);
    } else if (key.startsWith('skill:')) {
      const parts = key.split(':');              // skill:{agentId}:{skillName}
      parsers.saveSkillFile(parts[1], parts[2], content);
    } else if (key.startsWith('skill-script:')) {
      const parts = key.split(':');              // skill-script:{agentId}:{skill}:{file}
      parsers.saveSkillScript(parts[1], parts[2], parts[3], content, { appendToSkillMd: false });
    } else if (key.startsWith('script:agent:')) {
      const parts = key.split(':');              // script:agent:{agentId}:{file}
      parsers.saveAgentScript(parts[2], parts[3], content);
    } else if (key.startsWith('script:global:')) {
      const file = key.slice('script:global:'.length);
      parsers.saveScript(file, content);
    } else {
      return res.status(400).json({ error: `Cannot restore scope_key: ${key}` });
    }

    // Record the restore as a new version
    vSave(key, content, req, 'edit');

    console.log(`[api/versions] Restored version ${v.id} (${key}) by ${req.user?.username}`);
    res.json({ ok: true, scopeKey: key, restoredVersionId: v.id });
  } catch (err) {
    console.error('[api/versions/restore]', err);
    res.status(500).json({ error: err.message || 'Restore failed' });
  }
});

// DELETE /api/versions/:id
app.delete('/api/versions/:id', db.authMiddleware, (req, res) => {
  try {
    const v = versioning.getVersion(db.getDb(), parseInt(req.params.id));
    if (!v) return res.status(404).json({ error: 'Version not found' });
    versioning.deleteVersion(db.getDb(), parseInt(req.params.id), db.persist);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OpenClaw Config Management ──────────────────────────────────────────────

const EDITABLE_CONFIG_SECTIONS = new Set([
  'gateway', 'agents', 'tools', 'env', 'memory', 'hooks',
  'approvals', 'logging', 'commands', 'session', 'messages',
  'plugins', 'models',
]);

// GET /api/browse-dirs — list directories at a given path (for directory picker)
app.get('/api/browse-dirs', db.authMiddleware, (req, res) => {
  const targetPath = req.query.path || os.homedir();
  try {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return res.status(400).json({ error: 'Not a valid directory' });
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    // Check if this is a git repo
    const isGitRepo = fs.existsSync(path.join(resolved, '.git'));
    res.json({ path: resolved, dirs, isGitRepo, parent: path.dirname(resolved) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config — returns full openclaw.json
app.get('/api/config', db.authMiddleware, (req, res) => {
  const { readJsonSafe } = require('./lib/config.cjs');
  const configPath = path.join(parsers.OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) return res.status(404).json({ error: 'openclaw.json not found' });
  res.json({ config, path: configPath });
});

// PATCH /api/config/:section — update a single top-level section and write back
app.patch('/api/config/:section', db.authMiddleware, (req, res) => {
  const { section } = req.params;
  const { value } = req.body;

  if (!EDITABLE_CONFIG_SECTIONS.has(section)) {
    return res.status(400).json({ error: `Section "${section}" is not editable via this API` });
  }
  if (value === undefined) return res.status(400).json({ error: 'value is required' });

  const fs = require('fs');
  const configPath = path.join(parsers.OPENCLAW_HOME, 'openclaw.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    config[section] = value;
    if (config.meta) config.meta.lastTouchedAt = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(`[api/config] Section "${section}" updated by ${req.user.username}`);
    res.json({ ok: true, section });
  } catch (err) {
    console.error('[api/config/patch]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Hooks / Inbound Webhooks ─────────────────────────────────────────────────

// GET /api/hooks/config
app.get('/api/hooks/config', db.authMiddleware, (req, res) => {
  try {
    res.json(parsers.getHooksConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/hooks/config
app.put('/api/hooks/config', db.authMiddleware, (req, res) => {
  try {
    parsers.saveHooksConfig(req.body);
    res.json(parsers.getHooksConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hooks/token — generate + save a new random token
app.post('/api/hooks/token', db.authMiddleware, (req, res) => {
  try {
    const token = parsers.generateToken();
    parsers.saveHooksConfig({ token });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hooks/sessions
app.get('/api/hooks/sessions', db.authMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    res.json({ sessions: parsers.getHookSessions(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activity
app.get('/api/activity', db.authMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const logs = typeof parsers.parseCommandLog === 'function' ? parsers.parseCommandLog(limit) : [];
    res.json({ events: logs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// ─── Media Serve (inbound media from Telegram/WhatsApp/etc) ──────────────────
// Serves files from OPENCLAW_HOME only — paths outside are rejected.
// Accepts token as query param because <img> tags cannot send Authorization headers.
app.get('/api/media', (req, res) => {
  const fs = require('fs');
  const mime = require('mime-types');

  // Auth: accept Bearer header OR ?token= query param (needed for <img> src)
  const tokenFromHeader = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const tokenFromQuery = typeof req.query.token === 'string' ? req.query.token : null;
  const token = tokenFromHeader || tokenFromQuery;
  if (!token || !db.verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const filePath = req.query.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }
  // Security: resolve and ensure it's under one of the allowed staging roots.
  // Beyond OPENCLAW_HOME we also allow:
  //   - /tmp/openclaw/**          (claude-cli image uploads land here)
  //   - $TMPDIR/openclaw/**       (macOS per-user tmp)
  //   - OPENCLAW_WORKSPACE/**     (agent workspace files)
  // Each must be an exact-prefix match, no symlink escape.
  const resolved = path.resolve(filePath);
  const allowedRoots = [
    path.resolve(parsers.OPENCLAW_HOME),
    path.resolve(parsers.OPENCLAW_WORKSPACE || ''),
    '/tmp/openclaw',
    path.resolve(process.env.TMPDIR || '/tmp', 'openclaw'),
  ].filter(Boolean);
  const isAllowed = allowedRoots.some((root) =>
    root && (resolved === root || resolved.startsWith(root + path.sep)),
  );
  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden path' });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const contentType = mime.lookup(resolved) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(resolved).pipe(res);
});

// ─── Chat API (Gateway WebSocket Proxy) ──────────────────────────────────────

// Get gateway connection status
app.get('/api/chat/gateway/status', db.authMiddleware, (req, res) => {
  res.json({ connected: gatewayProxy.isConnected });
});

// List chat sessions (from gateway)
app.get('/api/chat/sessions', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayProxy.isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const agentId = req.query.agentId;
    const result = await gatewayProxy.sessionsList(agentId);
    // Normalize: extract agentId from key pattern "agent:{agentId}:{channel}:{uuid}"
    const sessions = (result.sessions || []).map(s => {
      const parts = (s.key || '').split(':');
      return {
        ...s,
        sessionKey: s.key,
        agentId: s.agentId || (parts[0] === 'agent' ? parts[1] : undefined),
        lastMessage: s.lastMessage || s.derivedTitle || undefined,
      };
    });
    res.json({ sessions });
  } catch (err) {
    console.error('[api/chat/sessions]', err);
    res.status(500).json({ error: err.message });
  }
});

// Create a new chat session
app.post('/api/chat/sessions', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayProxy.isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });
    if (!db.userOwnsAgent(req, agentId)) {
      return res.status(403).json({ error: 'You can only chat with agents you own' });
    }
    const result = await gatewayProxy.sessionsCreate(agentId);
    console.log('[api/chat/sessions/create] result:', JSON.stringify(result).slice(0, 500));
    res.json(result);
  } catch (err) {
    console.error('[api/chat/sessions/create]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get merged chat history for all sessions of a task
app.get('/api/chat/history-multi', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayProxy.isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const sessionKeys = (req.query.keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (!sessionKeys.length) return res.json({ messages: [], sessions: [] });

    const maxChars = parseInt(req.query.maxChars || '40000', 10);
    const results = await Promise.allSettled(
      sessionKeys.map(key =>
        gatewayProxy.chatHistory(key, maxChars).then(r => ({ key, messages: r.messages || [] }))
      )
    );

    // Subscribe to latest session for real-time updates
    const lastKey = sessionKeys[sessionKeys.length - 1];
    gatewayProxy.sessionsMessagesSubscribe(lastKey).catch(() => {});

    const sessions = results.map((r, i) => ({
      key: sessionKeys[i],
      messages: r.status === 'fulfilled' ? r.value.messages : [],
      ok: r.status === 'fulfilled',
    }));

    res.json({ sessions });
  } catch (err) {
    console.error('[api/chat/history-multi]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get chat history for a session
app.get('/api/chat/history/:sessionKey', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayProxy.isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { sessionKey } = req.params;
    const taskId = req.query.taskId;
    const maxChars = parseInt(req.query.maxChars || '80000', 10);

    // Also subscribe to real-time updates
    gatewayProxy.sessionsMessagesSubscribe(sessionKey).catch(() => {});

    // If taskId provided, merge all JSONL dispatch files for this task.
    // Gateway creates a new JSONL file per chatSend round, so each "Continue"
    // dispatch lives in a separate file — we need to combine them all.
    if (taskId) {
      // Extract agentId from session key: "agent:tadaki:dashboard:..." → "tadaki"
      const agentId = sessionKey.split(':')[1];
      if (agentId) {
        const merged = loadAllJSONLMessagesForTask(agentId, taskId);
        if (merged.length > 0) {
          return res.json({ messages: merged });
        }
      }
    }

    // For claude-cli backed sessions, gateway's chat.history only returns
    // plain text turns — no thinking, no tool_use, no tool_result. The full
    // trace lives in the claude-cli JSONL. Try to locate it and return those
    // parsed messages instead so the reload UI matches the live experience.
    const agentId = sessionKey.split(':')[1];
    if (agentId) {
      const { OPENCLAW_HOME, readJsonSafe } = require('./lib/config.cjs');
      const sessionsFile = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions', 'sessions.json');
      const gwSessions = readJsonSafe(sessionsFile) || {};
      const meta = gwSessions[sessionKey];
      if (meta) {
        const cli = parsers.findClaudeCliFileForGatewaySession(meta, agentId);
        if (cli?.fullPath) {
          const cliMessages = parsers.parseClaudeCliAsGatewayMessages(cli.fullPath);
          if (cliMessages.length > 0) {
            return res.json({ messages: cliMessages, source: 'claude-cli' });
          }
        }
      }
    }

    const result = await gatewayProxy.chatHistory(sessionKey, maxChars);
    res.json(result);
  } catch (err) {
    console.error('[api/chat/history]', err);
    res.status(500).json({ error: err.message });
  }
});

// Send a message to an agent
app.post('/api/chat/send', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayProxy.isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { sessionKey, text, agentId, images } = req.body;
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
    if (!text?.trim() && (!images || images.length === 0)) {
      return res.status(400).json({ error: 'text or images is required' });
    }
    // Ownership: sessionKey format is "agent:{agentId}:..." — enforce ownership
    const sessionAgentId = sessionKey.split(':')[1];
    if (sessionAgentId && !db.userOwnsAgent(req, sessionAgentId)) {
      return res.status(403).json({ error: 'You can only chat with agents you own' });
    }
    // Gateway's chat.send requires `message` as a plain string and carries
    // media via the separate `attachments` array (see ChatSendParamsSchema in
    // openclaw:src/gateway/protocol/schema/logs-chat.ts). Previous code shoved
    // content blocks into `message` which the schema rejects with
    // "invalid chat.send params: at /message: must be string".
    const message = (text || '').trim();
    const attachments = [];
    if (Array.isArray(images) && images.length > 0) {
      images.forEach((dataUrl, i) => {
        // Accept "data:<mediaType>;base64,<data>" — fall back to raw base64.
        const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
        const mimeType = match ? match[1] : 'image/png';
        const content  = match ? match[2] : (typeof dataUrl === 'string' ? dataUrl : '');
        if (!content) return;
        const extFromMime = (mimeType.split('/')[1] || 'bin').split('+')[0];
        attachments.push({
          type: 'image',
          mimeType,
          fileName: `upload-${Date.now()}-${i}.${extFromMime}`,
          content,
        });
      });
    }
    // Ensure we're subscribed
    await gatewayProxy.sessionsMessagesSubscribe(sessionKey);
    const result = await gatewayProxy.chatSend(sessionKey, message, attachments);
    // agentId is accepted by the legacy wrapper call signature but the gateway
    // does not use it for chat.send — session routing is by sessionKey.
    void agentId;
    res.json(result || { ok: true });
  } catch (err) {
    console.error('[api/chat/send]', err);
    res.status(500).json({ error: err.message });
  }
});

// Abort an active agent run
app.post('/api/chat/abort', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayProxy.isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { sessionKey } = req.body;
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
    const result = await gatewayProxy.chatAbort(sessionKey);
    res.json(result || { ok: true });
  } catch (err) {
    console.error('[api/chat/abort]', err);
    res.status(500).json({ error: err.message });
  }
});

// Subscribe to a session's real-time events
app.post('/api/chat/subscribe', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayProxy.isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { sessionKey } = req.body;
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
    await gatewayProxy.sessionsMessagesSubscribe(sessionKey);
    res.json({ ok: true, subscribed: sessionKey });
  } catch (err) {
    console.error('[api/chat/subscribe]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Serve Vite build in prod ─────────────────────────────────────────────────
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir, { etag: false }));
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(distDir, 'index.html'));
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

// One-shot startup sweep on first gateway connection
let startupSweepDone = false;
gatewayProxy.addListener((event) => {
  if (event.type === 'gateway:connected' && !startupSweepDone) {
    startupSweepDone = true;
    sweepPendingTasks().catch(err => console.warn('[startup-sweep]', err.message));
  }
});
const feedWatcher = new LiveFeedWatcher();

const terminal = require('./lib/terminal.cjs');

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/ws/terminal') {
    terminal.handleUpgrade(request, socket, head, db);
    return;
  }

  if (url.pathname !== '/ws') { socket.destroy(); return; }

  // Verify JWT token from query param
  const token = url.searchParams.get('token');
  if (!token || !db.verifyToken(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  console.log(`[ws] Client connected (${wss.clients.size} total)`);

  // Send current snapshot on connect (enriched — same as REST /api/agents)
  try {
    const agents = getEnrichedAgents();
    const sessions = parsers.getAllSessions();
    ws.send(JSON.stringify({ type: 'init', payload: { agents, sessions }, timestamp: new Date().toISOString() }));
  } catch { /* ignore */ }

  const unsubscribe = feedWatcher.addListener((event) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  });

  // Forward gateway real-time chat events to this dashboard WS client
  const unsubGateway = gatewayProxy.addListener((event) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  });

  ws.on('close', () => {
    unsubscribe();
    unsubGateway();
    console.log(`[ws] Client disconnected (${wss.clients.size} total)`);
  });
  ws.on('error', () => { unsubscribe(); unsubGateway(); });

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeatInterval));

// ─── Sync update_task.sh for all agents ──────────────────────────────────────
async function syncTaskScriptForAllAgents() {
  try {
    parsers.ensureUpdateTaskScript();
    const agents = parsers.parseAgentRegistry();
    for (const agent of agents) {
      try {
        const tools = parsers.listAgentCustomTools(agent.id, parsers.getAgentFile);
        const alreadyEnabled = [...(tools.agent || []), ...(tools.shared || [])].some(
          t => t.name === 'update_task' && t.enabled
        );
        if (!alreadyEnabled) {
          parsers.toggleAgentCustomTool(agent.id, 'update_task.sh', true, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
          console.log(`[task-sync] Enabled update_task for agent: ${agent.id}`);
        }
      } catch (err) {
        console.warn(`[task-sync] Failed for ${agent.id}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[task-sync] syncTaskScriptForAllAgents failed:', err.message);
  }
}

function syncConnectionsScriptForAllAgents() {
  try {
    parsers.ensureCheckConnectionsScript();
    parsers.ensureGwsCallScript();
    parsers.ensureAocConnectScript();
    const agents = parsers.parseAgentRegistry();
    const allConns = db.getAllConnections();
    for (const agent of agents) {
      try {
        const tools = parsers.listAgentCustomTools(agent.id, parsers.getAgentFile);
        const enabledNames = new Set(
          [...(tools.agent || []), ...(tools.shared || [])].filter(t => t.enabled).map(t => t.name)
        );
        // Always force-refresh these blocks so descriptions stay up to date
        parsers.toggleAgentCustomTool(agent.id, 'check_connections.sh', false, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
        parsers.toggleAgentCustomTool(agent.id, 'check_connections.sh', true, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
        parsers.toggleAgentCustomTool(agent.id, 'aoc-connect.sh', false, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
        parsers.toggleAgentCustomTool(agent.id, 'aoc-connect.sh', true, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
        // Sync connections context block in TOOLS.md
        const assignedIds = db.getAgentConnectionIds(agent.id);
        if (assignedIds.length > 0) {
          const assigned = allConns.filter(c => assignedIds.includes(c.id));
          parsers.syncAgentConnectionsContext(agent.id, assigned, parsers.getAgentFile, parsers.saveAgentFile);
        }
      } catch (err) {
        console.warn(`[connections-sync] Failed for ${agent.id}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[connections-sync] syncConnectionsScriptForAllAgents failed:', err.message);
  }
}

function syncHeartbeatForAllAgents() {
  try {
    parsers.ensureCheckTasksScript();
    const agents = parsers.parseAgentRegistry();
    for (const agent of agents) {
      try {
        const workspacePath = agent.workspace || parsers.OPENCLAW_WORKSPACE;
        parsers.injectHeartbeatTaskCheck(agent.id, workspacePath);
      } catch (err) {
        console.warn(`[heartbeat-sync] ${agent.id}:`, err.message);
      }
    }
    console.log(`[heartbeat-sync] Injected task check for ${agents.length} agents`);
  } catch (err) {
    console.warn('[heartbeat-sync] failed:', err.message);
  }
}

/**
 * Ensure all agents in openclaw.json have explicit `heartbeat: {}` config.
 * OpenClaw's heartbeat-runner only enables heartbeat for agents with explicit
 * heartbeat config once ANY agent has it — without this, only the default
 * (first) agent gets heartbeat polling.
 */
function ensureHeartbeatConfig() {
  try {
    const { readJsonSafe, OPENCLAW_HOME } = require('./lib/config.cjs');
    const configPath = require('path').join(OPENCLAW_HOME, 'openclaw.json');
    const config = readJsonSafe(configPath);
    if (!config?.agents?.list) return;

    let patched = 0;
    for (const agent of config.agents.list) {
      if (!agent.heartbeat) {
        agent.heartbeat = {};
        patched++;
      }
    }

    if (patched > 0) {
      require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`[heartbeat-config] Backfilled heartbeat config for ${patched} agent(s)`);
    }
  } catch (err) {
    console.warn('[heartbeat-config] failed:', err.message);
  }
}

async function sweepPendingTasks() {
  try {
    const tasks = db.getAllTasks({ status: 'todo' });
    const pending = tasks.filter(t => t.agentId);
    if (pending.length === 0) return;
    console.log(`[startup-sweep] Found ${pending.length} pending tasks, dispatching...`);
    for (const task of pending) {
      await dispatchTaskToAgent(task).catch(err =>
        console.warn(`[startup-sweep] task ${task.id}:`, err.message)
      );
    }
    console.log('[startup-sweep] Done');
  } catch (err) {
    console.warn('[startup-sweep] failed:', err.message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await db.initDatabase();

  // Seed built-in ADLC role templates on first run (idempotent)
  try {
    const seedResult = parsers.seedRoleTemplatesIfEmpty();
    if (seedResult.seeded > 0) {
      console.log(`[startup] Role templates seeded: ${seedResult.seeded}`);
    }
  } catch (err) {
    console.error('[startup] Role template seed failed:', err.message);
  }

  function broadcast(event) {
    const msg = JSON.stringify({ ...event, timestamp: event.timestamp || new Date().toISOString() });
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) client.send(msg);
    });
  }

  integrations.init(db, broadcast);
  integrations.startScheduler();

  feedWatcher.start();
  parsers.ensureAocEnvFile();   // write ~/.openclaw/.aoc_env with current token
  syncTaskScriptForAllAgents(); // non-blocking, fire-and-forget
  syncConnectionsScriptForAllAgents(); // ensure check_connections.sh is available
  ensureHeartbeatConfig();      // backfill heartbeat: {} in openclaw.json for all agents
  syncHeartbeatForAllAgents();  // inject HEARTBEAT task check into all agent workspaces

  // Ensure all agents have skills: [] field in openclaw.json
  try { parsers.ensureAgentSkillsFields(); } catch (e) { console.warn('[startup] ensureAgentSkillsFields failed:', e.message); }

  // Connect to OpenClaw Gateway for real-time chat
  gatewayProxy.connect();
  console.log('[gateway-ws] Connecting to OpenClaw Gateway...');

  const hasUsers = db.hasAnyUsers();
  console.log(`[auth] Database ready. ${hasUsers ? 'Users exist.' : 'No users — setup required.'}`);

  server.listen(PORT, HOST, () => {
    console.log(`
┌─────────────────────────────────────────┐
│  🐙 OpenClaw AOC v2.0                  │
│  API:  http://${HOST}:${PORT}/api       │
│  WS:   ws://${HOST}:${PORT}/ws          │
│  Auth: SQLite + JWT                     │
│  Dev:  http://localhost:5173            │
└─────────────────────────────────────────┘
    `);
    // Start periodic Google OAuth health check
    try { parsers.googleHealthCronStart(broadcast); } catch (e) { console.warn('[startup] googleHealthCronStart failed:', e.message); }

    // Idempotently inject SOUL.md standard blocks (research + connection protocol) into all agents
    try {
      const cfg = require('./lib/config.cjs');
      const registry = cfg.readJsonSafe(require('path').join(cfg.OPENCLAW_HOME, 'openclaw.json'));
      const list = registry?.agents?.list || [];
      let injected = 0, already = 0, errors = 0;
      for (const a of list) {
        const r = parsers.injectSoulStandard(a.id);
        if (r.status === 'injected') injected++;
        else if (r.status === 'already_applied') already++;
        else errors++;
      }
      console.log(`[startup] SOUL standards: ${injected} injected, ${already} already applied, ${errors} errors`);
    } catch (e) { console.warn('[startup] soul-standard injection failed:', e.message); }
  });
}

start().catch(err => {
  console.error('[FATAL] Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', () => { feedWatcher.stop(); server.close(); process.exit(0); });
process.on('SIGINT', () => { feedWatcher.stop(); server.close(); process.exit(0); });
