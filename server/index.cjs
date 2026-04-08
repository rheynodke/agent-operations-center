require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const path = require('path');
const parsers = require('./lib/index.cjs'); // modular barrel — replaces parsers.cjs
const { LiveFeedWatcher } = require('./lib/watchers.cjs');
const db = require('./lib/db.cjs');
const { gatewayProxy } = require('./lib/gateway-ws.cjs');

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

// Agents
app.get('/api/agents', db.authMiddleware, (req, res) => {
  try {
    const agents = parsers.parseAgentRegistry();
    // Merge SQLite profiles for richer data (avatar, color, description)
    const profiles = db.getAllAgentProfiles();
    const profileMap = Object.fromEntries(profiles.map(p => [p.agent_id, p]));
    const enriched = agents.map(a => ({
      ...a,
      color: profileMap[a.id]?.color || null,
      description: profileMap[a.id]?.description || null,
      hasAvatar: !!profileMap[a.id]?.avatar_data,
      avatarPresetId: profileMap[a.id]?.avatar_preset_id || null,
    }));
    res.json({ agents: enriched });
  } catch (err) {
    console.error('[api/agents]', err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// Provision a new agent — creates config, workspace, channel bindings, and SQLite profile
app.post('/api/agents', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.provisionAgent(req.body, req.user?.userId);
    // Save profile to SQLite
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
    const code = err.message?.includes('not found') ? 404 : err.message?.includes('invalid') ? 400 : 500;
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

// Tasks (progress)
app.get('/api/tasks', db.authMiddleware, (req, res) => {
  try {
    res.json({ tasks: parsers.parseDevProgress() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Cron
app.get('/api/cron', db.authMiddleware, (req, res) => {
  try {
    res.json({ jobs: parsers.parseCronJobs() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch cron jobs' });
  }
});

// Routes (channel bindings)
app.get('/api/routes', db.authMiddleware, (req, res) => {
  try {
    const routes = typeof parsers.parseRoutes === 'function' ? parsers.parseRoutes() : [];
    res.json({ routes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routes' });
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

// Get chat history for a session
app.get('/api/chat/history/:sessionKey', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayProxy.isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const maxChars = parseInt(req.query.maxChars || '80000', 10);
    const result = await gatewayProxy.chatHistory(req.params.sessionKey, maxChars);
    // Also subscribe to real-time updates
    gatewayProxy.sessionsMessagesSubscribe(req.params.sessionKey).catch(() => {});
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

  // Send current snapshot on connect
  try {
    const agents = parsers.parseAgentRegistry();
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

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await db.initDatabase();
  feedWatcher.start();

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
