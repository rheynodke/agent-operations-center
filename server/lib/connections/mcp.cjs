// MCP (Model Context Protocol) pool — manages persistent stdio MCP servers
// per connection id. Spawns children lazily, caches clients, tears down on
// update/delete. Credentials merged into child env at launch — never returned
// to callers or logged.
//
// Usage:
//   const mcp = require('./mcp.cjs');
//   const tools = await mcp.listTools(connId, spec);     // [{name, description, inputSchema}]
//   const out   = await mcp.callTool(connId, spec, 'create_issue', { ... });
//   await mcp.teardown(connId);
//
// `spec` must come from db.getConnectionRaw() — includes decrypted credentials.

const crypto = require('node:crypto');

// SDK is ESM-packaged but ships a CJS build; require the CJS subpaths directly.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

// ── Pool state ──────────────────────────────────────────────────────────────
/** @type {Map<string, {client: any, transport: any, specHash: string, startedAt: number, restartCount: number}>} */
const pool = new Map();

// Safety rails
const MAX_RESTART = 3;
const RESTART_WINDOW_MS = 60_000;
const CALL_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 20_000;

function hashSpec(spec) {
  const payload = JSON.stringify({
    transport: spec.transport || 'stdio',
    command: spec.command,
    args: spec.args || [],
    env: spec.env || {},
    url: spec.url || '',
    headers: spec.headers || {},
    oauth: spec.oauth ? { connId: spec.oauth.connId } : null,
    // Only hash credentials if no OAuth — oauth tokens rotate and shouldn't
    // invalidate the pool entry on every refresh.
    credentials: spec.oauth ? '' : (spec.credentials || ''),
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function parseCredentialsEnv(credentialsJson) {
  // For stdio: credentials = JSON of secret env vars
  // For http/sse: credentials = JSON of secret header values (same shape)
  if (!credentialsJson) return {};
  try {
    const parsed = JSON.parse(credentialsJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {}
  return {};
}

function buildChildEnv(spec) {
  // Minimal inherited env — matches SDK's getDefaultEnvironment intent but keeps
  // us independent of the SDK's exact allowlist.
  const base = {};
  const inherit = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM'];
  for (const k of inherit) if (process.env[k] != null) base[k] = process.env[k];

  const nonSecret = spec.env || {};
  const secret = parseCredentialsEnv(spec.credentials);
  return { ...base, ...nonSecret, ...secret };
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function buildTransport(spec) {
  const kind = spec.transport || 'stdio';

  if (kind === 'http' || kind === 'sse') {
    if (!spec.url) throw new Error(`MCP spec missing url for ${kind} transport`);
    let parsedUrl;
    try { parsedUrl = new URL(spec.url); }
    catch { throw new Error(`MCP url is not a valid URL: ${spec.url}`); }

    // Merge header sources: static metadata headers + secret headers from
    // credentials + resolved OAuth Bearer token (if present).
    const headers = {
      ...(spec.headers || {}),
      ...parseCredentialsEnv(spec.credentials),
    };
    if (spec._bearerToken) {
      headers.Authorization = `Bearer ${spec._bearerToken}`;
    }
    const opts = {
      requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
    };
    return kind === 'http'
      ? new StreamableHTTPClientTransport(parsedUrl, opts)
      : new SSEClientTransport(parsedUrl, opts);
  }

  // stdio (default)
  if (!spec.command) throw new Error('MCP spec missing command for stdio transport');
  const childEnv = buildChildEnv(spec);
  // Substitute ${VAR} placeholders in args with values from the merged env.
  // This lets users reference secrets without leaking them into plaintext args.
  // Example: args: ['--token', '${MIXPANEL_TOKEN}'] with MIXPANEL_TOKEN in
  // credentials → expanded to ['--token', 'abc123'] at spawn time only.
  const rawArgs = Array.isArray(spec.args) ? spec.args : [];
  const substitutedArgs = rawArgs.map(a =>
    typeof a === 'string'
      ? a.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => childEnv[k] ?? '')
      : a
  );
  return new StdioClientTransport({
    command: spec.command,
    args: substitutedArgs,
    env: childEnv,
    stderr: 'pipe',
  });
}

async function spawnClient(connId, spec) {
  const transport = buildTransport(spec);

  const client = new Client(
    { name: 'aoc-dashboard', version: '1.0.0' },
    { capabilities: {} }
  );

  await withTimeout(client.connect(transport), INIT_TIMEOUT_MS, `MCP init (${connId})`);

  // Tap stderr for diagnostics (not stored, keeps creds out of logs).
  if (transport.stderr && typeof transport.stderr.on === 'function') {
    transport.stderr.on('data', (buf) => {
      const line = buf.toString().trimEnd();
      if (line) console.warn(`[mcp:${connId}] ${line}`);
    });
  }

  const entry = {
    client,
    transport,
    specHash: hashSpec(spec),
    bearerToken: spec._bearerToken || null,
    startedAt: Date.now(),
    restartCount: 0,
  };

  // Auto-teardown from pool if the child exits unexpectedly. Next call will
  // re-spawn via getClient().
  transport.onclose = () => {
    const current = pool.get(connId);
    if (current && current.transport === transport) {
      pool.delete(connId);
      console.warn(`[mcp:${connId}] transport closed, removed from pool`);
    }
  };
  transport.onerror = (err) => {
    console.warn(`[mcp:${connId}] transport error: ${err.message}`);
  };

  pool.set(connId, entry);
  return entry;
}

async function getClient(connId, spec) {
  // Resolve OAuth access token before hashing/spawning. Refreshes
  // transparently via mcp-oauth.getAccessToken when near expiry.
  const resolved = await resolveOAuthIfNeeded(spec);
  const existing = pool.get(connId);
  const nextHash = hashSpec(resolved);
  const tokenChanged =
    existing && existing.bearerToken !== resolved._bearerToken;

  if (existing && existing.specHash === nextHash && !tokenChanged) {
    return existing;
  }
  if (existing && (existing.specHash !== nextHash || tokenChanged)) {
    // Config/token changed — tear down and respawn
    await teardown(connId);
  }

  // Rate-limit restart loops: if we've restarted >MAX_RESTART in window, bail.
  const prev = pool.get(`__restart:${connId}`);
  const now = Date.now();
  if (prev && now - prev.first < RESTART_WINDOW_MS) {
    if (prev.count >= MAX_RESTART) {
      throw new Error(`MCP connection ${connId} failed to stay up (${prev.count} restarts in ${RESTART_WINDOW_MS}ms). Check logs.`);
    }
    prev.count += 1;
  } else {
    pool.set(`__restart:${connId}`, { first: now, count: 1 });
  }

  return spawnClient(connId, spec);
}

// Lazy-loaded to avoid a circular require at module load time.
let _mcpOauth = null;
function getMcpOauth() {
  if (_mcpOauth === null) {
    try { _mcpOauth = require('./mcp-oauth.cjs'); }
    catch { _mcpOauth = false; } // module missing — stdio-only build
  }
  return _mcpOauth;
}

async function resolveOAuthIfNeeded(spec) {
  if (!spec.oauth || !spec.oauth.connId) return spec;
  const oauth = getMcpOauth();
  if (!oauth) throw new Error('mcp-oauth module not available');
  const token = await oauth.getAccessToken(spec.oauth.connId);
  return { ...spec, _bearerToken: token };
}

async function teardown(connId) {
  const entry = pool.get(connId);
  if (!entry) return;
  pool.delete(connId);
  try { await entry.client.close(); } catch {}
  try { await entry.transport.close(); } catch {}
}

async function teardownAll() {
  const ids = [...pool.keys()].filter(k => !k.startsWith('__'));
  await Promise.all(ids.map(teardown));
}

async function listTools(connId, spec) {
  const { client } = await getClient(connId, spec);
  const resp = await withTimeout(client.listTools(), CALL_TIMEOUT_MS, `MCP listTools (${connId})`);
  return resp.tools || [];
}

async function callTool(connId, spec, name, args) {
  const { client } = await getClient(connId, spec);
  const resp = await withTimeout(
    client.callTool({ name, arguments: args || {} }),
    CALL_TIMEOUT_MS,
    `MCP callTool ${name} (${connId})`
  );
  return resp;
}

// Probe: spawn → listTools → teardown. Used by the "Test" button so we don't
// keep a process around just to validate config.
async function probe(spec) {
  const tempId = `__probe:${crypto.randomUUID()}`;
  try {
    const tools = await listTools(tempId, spec);
    return { ok: true, tools };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    await teardown(tempId);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => { teardownAll().catch(() => {}); });
process.on('SIGINT',  () => { teardownAll().catch(() => {}); });

module.exports = {
  getClient,
  listTools,
  callTool,
  probe,
  teardown,
  teardownAll,
  // internal — exported for tests
  _hashSpec: hashSpec,
  _parseCredentialsEnv: parseCredentialsEnv,
};
