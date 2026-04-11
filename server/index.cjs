require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
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

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
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
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
app.use('/api/', limiter);
app.use(express.json());

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
    },
  });
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

// POST /api/gateway/restart
let restartLock = false;
app.post('/api/gateway/restart', db.authMiddleware, (req, res) => {
  if (restartLock) {
    return res.status(429).json({ error: 'Restart already in progress' });
  }
  restartLock = true;

  console.log('[gateway] Restart requested by', req.user.username);

  findGatewayPid((pids) => {
    // Kill existing processes
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (e) {
        console.error(`[gateway] Failed to kill PID ${pid}:`, e.message);
      }
    }

    res.json({ ok: true, killedPids: pids, message: 'Gateway restarting…' });

    // Wait a moment for graceful shutdown, then spawn fresh gateway
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
app.patch('/api/agents/:id', db.authMiddleware, (req, res) => {
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

app.delete('/api/agents/:id', db.authMiddleware, (req, res) => {
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
app.post('/api/agents/:id/soul-standard', db.authMiddleware, (req, res) => {
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
app.put('/api/agents/:id/files/:filename', db.authMiddleware, (req, res) => {
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
app.patch('/api/agents/:id/profile', db.authMiddleware, (req, res) => {
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
app.put('/api/agents/:id/avatar', db.authMiddleware, (req, res) => {
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
app.put('/api/agents/:id/skills/:name/file', db.authMiddleware, (req, res) => {
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
app.post('/api/agents/:id/skills', db.authMiddleware, (req, res) => {
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
app.patch('/api/agents/:id/skills/:name/toggle', db.authMiddleware, (req, res) => {
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
app.delete('/api/agents/:id/skills/:name', db.authMiddleware, (req, res) => {
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
app.patch('/api/agents/:id/tools/:name/toggle', db.authMiddleware, (req, res) => {
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
app.post('/api/agents/:id/channels', db.authMiddleware, (req, res) => {
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
app.patch('/api/agents/:id/channels/:channelType/:accountId', db.authMiddleware, (req, res) => {
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
app.delete('/api/agents/:id/channels/:channelType/:accountId', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.removeAgentChannel(req.params.id, req.params.channelType, req.params.accountId);
    console.log(`[api/agents/channels] Removed ${req.params.channelType}/${req.params.accountId} from agent "${req.params.id}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/channels/remove]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
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
  const { url, target, agentId, bufferB64 } = req.body || {};
  if (!url || !target) {
    return res.status(400).json({ error: 'url and target are required' });
  }
  try {
    const result = await skillsInstall.installSkill({ urlOrSlug: url, target, agentId, bufferB64 });
    console.log(`[api/skills/clawhub] Installed "${result.slug}" to ${result.path}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/clawhub/install]', err);
    const code = err.message?.includes('already installed') ? 409 : 500;
    res.status(code).json({ error: err.message || 'Install failed' });
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
  const { skill, target, agentId } = req.body || {};
  if (!skill || !target) {
    return res.status(400).json({ error: 'skill and target are required' });
  }
  try {
    const result = await skillsInstall.installSkillsmpSkill({ skill, target, agentId });
    console.log(`[api/skills/skillsmp] Installed "${result.slug}" to ${result.path}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/skillsmp/install]', err);
    const code = err.message?.includes('already installed') ? 409 : 500;
    res.status(code).json({ error: err.message || 'Install failed' });
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
app.post('/api/skills', db.authMiddleware, (req, res) => {
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
app.delete('/api/skills/:slug', db.authMiddleware, (req, res) => {
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
app.put('/api/skills/:slug/anyfile', db.authMiddleware, (req, res) => {
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
app.put('/api/skills/:slug/file', db.authMiddleware, (req, res) => {
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

app.put('/api/agents/:id/skills/:name/anyfile', db.authMiddleware, (req, res) => {
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
app.put('/api/agents/:id/skills/:name/scripts/:filename', db.authMiddleware, (req, res) => {
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
app.delete('/api/agents/:id/skills/:name/scripts/:filename', db.authMiddleware, (req, res) => {
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

app.get('/api/sessions/:id', db.authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions();
    let session = sessions.find(s => s.id === req.params.id);

    // If the session isn't in the list yet (race condition during active writing:
    // sessions.json may not be flushed yet, or the file read got partial data),
    // try to load events directly — if a JSONL file exists, build a minimal session stub.
    let events = parsers.parseGatewaySessionEvents(req.params.id);
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
    let events = parsers.parseGatewaySessionEvents(req.params.sessionId);
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
    const { title, description, status, priority, agentId, tags } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const task = db.createTask({ title: title.trim(), description, status, priority, agentId, tags });
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
    // agentId in body = actor identifier (from agent script); assignTo = new assignment (from UI)
    const { agentId: actorAgentId, assignTo, note, status, priority, title, description, tags, cost, sessionId, inputTokens, outputTokens } = req.body;
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

    const after = db.updateTask(id, patch);

    // Write activity entries for all meaningful changes (independent, not mutually exclusive)
    if (status !== undefined && status !== before.status) {
      db.addTaskActivity({ taskId: id, type: 'status_change', fromValue: before.status, toValue: status, actor, note });
    }
    if (assignTo !== undefined && assignTo !== before.agentId) {
      db.addTaskActivity({ taskId: id, type: 'assignment', fromValue: before.agentId || null, toValue: assignTo || null, actor });
    }
    if (note && status === undefined) {
      db.addTaskActivity({ taskId: id, type: 'comment', actor, note });
    }

    // Auto-dispatch: if ticket moved to 'todo' or back to 'in_progress' (change request), auto-continue
    const shouldAutoDispatch =
      status !== undefined &&
      (status === 'todo' || (status === 'in_progress' && before.status === 'in_review')) &&
      before.status !== status &&
      after.agentId &&
      after.sessionId &&
      gatewayProxy.isConnected;
    if (shouldAutoDispatch) {
      const changeRequestNote = note || null;
      dispatchTaskToAgent(after, { changeRequestNote }).catch(err =>
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

  let message;

  if (isFirstDispatch) {
    // Full task briefing for first dispatch
    message = [
      `📋 **Task: ${task.title}**`,
      ``,
      `Task ID: \`${task.id}\``,
      `Priority: ${task.priority || 'medium'}`,
      tagsLine,
      ``,
      task.description ? `**Description:**\n${task.description}` : '',
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
  } else {
    // Continue message for re-dispatch — agent already has full context from prior messages
    const changeNote = opts.changeRequestNote;
    message = changeNote
      ? [
          `---`,
          `⚠️ **Change Request from reviewer:**`,
          changeNote,
          ``,
          `Please address the feedback above. You already have the full context from your previous work on this ticket.`,
          `When done, update status to "in_review" again.`,
        ].join('\n')
      : [
          `---`,
          `🔄 **Continue working on this ticket.**`,
          ``,
          `You already have the full context from your previous work. Please continue where you left off.`,
          `When done, update status to "in_review".`,
        ].join('\n');
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
app.post('/api/tasks/:id/dispatch', db.authMiddleware, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.agentId) return res.status(400).json({ error: 'Task must be assigned to an agent first' });
    if (!gatewayProxy.isConnected) return res.status(503).json({ error: 'Gateway not connected' });
    const result = await dispatchTaskToAgent(task);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/tasks/dispatch]', err);
    res.status(500).json({ error: err.message });
  }
})

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
    const { type, credentials, spreadsheetId, sheetName, mapping, syncIntervalMs, enabled } = req.body;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const adapter = integrations.getAdapter(type);

    // Encrypt credentials before storing
    const encryptedCredentials = credentials ? integrations.encrypt(
      typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
    ) : undefined;

    const config = { spreadsheetId, sheetName, mapping };
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

    const { credentials, spreadsheetId, sheetName, mapping, syncIntervalMs, enabled } = req.body;

    const newConfig = { ...existing.config };
    if (spreadsheetId !== undefined) newConfig.spreadsheetId = spreadsheetId;
    if (sheetName     !== undefined) newConfig.sheetName = sheetName;
    if (mapping       !== undefined) newConfig.mapping = mapping;
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

app.post('/api/agents/:id/custom-tools/:filename/toggle', db.authMiddleware, (req, res) => {
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

app.post('/api/agents/:id/sync-task-script', db.authMiddleware, (req, res) => {
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

app.put('/api/agents/:id/scripts/:filename', db.authMiddleware, (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: '`content` required' });
    const result = parsers.saveAgentScript(req.params.id, req.params.filename, content);
    vSave(`script:agent:${req.params.id}:${req.params.filename}`, content, req);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.patch('/api/agents/:id/scripts/:filename/rename', db.authMiddleware, (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ error: '`newName` required' });
    res.json(parsers.renameAgentScript(req.params.id, req.params.filename, newName));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.delete('/api/agents/:id/scripts/:filename', db.authMiddleware, (req, res) => {
  try { res.json(parsers.deleteAgentScript(req.params.id, req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.patch('/api/agents/:id/scripts/:filename/meta', db.authMiddleware, (req, res) => {
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

app.put('/api/scripts/:filename', db.authMiddleware, (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: '`content` string required' });
    const result = parsers.saveScript(req.params.filename, content);
    vSave(`script:global:${req.params.filename}`, content, req);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.patch('/api/scripts/:filename/rename', db.authMiddleware, (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ error: '`newName` required' });
    res.json(parsers.renameScript(req.params.filename, newName));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.delete('/api/scripts/:filename', db.authMiddleware, (req, res) => {
  try { res.json(parsers.deleteScript(req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.patch('/api/scripts/:filename/meta', db.authMiddleware, (req, res) => {
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
    // No QR = already linked
    return res.json({ qrDataUrl: null, message: message || 'WhatsApp already linked.' });
  } catch (err) {
    console.error('[api/channels/login/start]', err);
    res.status(500).json({ error: err.message || 'Failed to start login flow' });
  }
});

// Channel login: wait for QR scan completion (long-poll, up to 3 min)
// POST /api/channels/:channel/:account/login/wait
app.post('/api/channels/:channel/:account/login/wait', db.authMiddleware, async (req, res) => {
  const { account } = req.params;

  if (!gatewayProxy.isConnected) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }

  try {
    const result = await gatewayProxy.webLoginWait(account);
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
  // Security: resolve and ensure it's under OPENCLAW_HOME
  const resolved = path.resolve(filePath);
  const allowed = path.resolve(parsers.OPENCLAW_HOME);
  if (!resolved.startsWith(allowed + path.sep) && resolved !== allowed) {
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
    // Build content array for multimodal messages
    let message;
    if (images && images.length > 0) {
      const contentBlocks = [];
      for (const dataUrl of images) {
        // dataUrl: "data:<mediaType>;base64,<data>"
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: match[1], data: match[2] },
          });
        }
      }
      if (text?.trim()) {
        contentBlocks.push({ type: 'text', text: text.trim() });
      }
      message = contentBlocks;
    } else {
      message = text.trim();
    }
    // Ensure we're subscribed
    await gatewayProxy.sessionsMessagesSubscribe(sessionKey);
    const result = await gatewayProxy.chatSend(sessionKey, message, agentId);
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

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
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
  });
}

start().catch(err => {
  console.error('[FATAL] Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', () => { feedWatcher.stop(); server.close(); process.exit(0); });
process.on('SIGINT', () => { feedWatcher.stop(); server.close(); process.exit(0); });
