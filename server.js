require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const path = require('path');
const parsers = require('./lib/parsers');
const { LiveFeedWatcher } = require('./lib/watchers');

const PORT = parseInt(process.env.PORT || '18800', 10);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.DASHBOARD_TOKEN;

if (!TOKEN) {
  console.error('[FATAL] DASHBOARD_TOKEN not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// --- Security ---
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
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);
  if (!timingSafeCompare(token, TOKEN)) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  next();
}

// --- REST API ---
app.get('/api/dashboard', authMiddleware, (req, res) => {
  try {
    res.json(parsers.getDashboardStats());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

app.get('/api/sessions', authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions();
    res.json({ sessions, total: sessions.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.get('/api/sessions/:id', authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions();
    const session = sessions.find(s => s.id === req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Try gateway JSONL events first, then fall back to OpenCode events
    let events = parsers.parseGatewaySessionEvents(req.params.id);
    let result = null;

    if (events.length === 0) {
      const numericId = req.params.id.match(/\d+/)?.[0];
      events = numericId ? parsers.parseOpenCodeEvents(numericId) : [];
      result = numericId ? parsers.parseOpenCodeResult(numericId) : null;
    }

    res.json({ ...session, events, result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch session detail' });
  }
});

app.get('/api/agents', authMiddleware, (req, res) => {
  try {
    res.json({ agents: parsers.parseAgentRegistry() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

app.get('/api/progress', authMiddleware, (req, res) => {
  try {
    res.json({ progress: parsers.parseDevProgress() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

app.get('/api/progress/:id', authMiddleware, (req, res) => {
  try {
    const all = parsers.parseDevProgress();
    const item = all.find(p => p.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Progress file not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch progress detail' });
  }
});

app.get('/api/cron', authMiddleware, (req, res) => {
  try {
    res.json({ jobs: parsers.parseCronJobs() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch cron jobs' });
  }
});

app.get('/api/logs', authMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    res.json({ logs: parsers.parseCommandLog(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.get('/api/subagents', authMiddleware, (req, res) => {
  try {
    res.json({ runs: parsers.parseSubagentRuns() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subagent runs' });
  }
});

// SPA fallback
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- WebSocket ---
const wss = new WebSocketServer({ noServer: true });
const feedWatcher = new LiveFeedWatcher();

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const token = url.searchParams.get('token');
  if (!token || !timingSafeCompare(token, TOKEN)) {
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

  ws.send(JSON.stringify({
    type: 'connected',
    timestamp: Date.now(),
    message: 'Live feed connected',
  }));

  const unsubscribe = feedWatcher.addListener((event) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(event));
    }
  });

  ws.on('close', () => {
    unsubscribe();
    console.log(`[ws] Client disconnected (${wss.clients.size} total)`);
  });

  ws.on('error', () => {
    unsubscribe();
  });

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

// --- Start ---
feedWatcher.start();

server.listen(PORT, HOST, () => {
  console.log(`
┌─────────────────────────────────────────┐
│  🐙 OpenClaw Dashboard                 │
│  Running on http://${HOST}:${PORT}          │
│  WebSocket on ws://${HOST}:${PORT}/ws       │
│  Auth: Bearer token required            │
└─────────────────────────────────────────┘
  `);
});

process.on('SIGTERM', () => {
  console.log('[server] Shutting down...');
  feedWatcher.stop();
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[server] Interrupted, shutting down...');
  feedWatcher.stop();
  server.close();
  process.exit(0);
});
