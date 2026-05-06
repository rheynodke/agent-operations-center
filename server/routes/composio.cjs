/**
 * routes/composio.cjs
 *
 * Composio sub-routes + MCP tool invocation + Agent ↔ Connection assignments
 * + agent-readable connections + connection deletion.
 * Step 7a of server modularization.
 */
'use strict';

module.exports = function composioRouter(deps) {
  const { db, parsers, broadcast, composio, mcpPool, mcpOauth } = deps;
  const router = require('express').Router();

// ─── Composio sub-routes ────────────────────────────────────────────────────
// All require connection ownership. Connect Link flow is initiated server-side
// (we hold the API key) and returns the hosted Composio URL for the UI to open
// in a new tab. Connection status polling is up to the client (refresh button).

function _loadComposio(req, res) {
  const raw = db.getConnectionRaw(req.params.id);
  if (!raw || raw.type !== 'composio') { res.status(404).json({ error: 'Composio connection not found' }); return null; }
  const co = (raw.metadata && raw.metadata.composio) || {};
  if (!raw.credentials) { res.status(400).json({ error: 'API key missing' }); return null; }
  return { raw, co };
}

// List connected accounts (toolkits the Composio user has authorized)
  router.get('/connections/:id/composio/connected', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const ctx = _loadComposio(req, res); if (!ctx) return;
    const statuses = req.query.statuses
      ? String(req.query.statuses).split(',').filter(Boolean)
      : ['ACTIVE', 'INITIATED', 'INITIALIZING', 'EXPIRED', 'FAILED'];
    const items = await composio.listConnectedAccounts(ctx.raw.credentials, {
      userId: ctx.co.userId,
      statuses,
      limit: 100,
    });
    res.json({ accounts: items });
  } catch (err) {
    console.error('[composio/connected]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// List toolkits enabled in this session (post-allowlist)
  router.get('/connections/:id/composio/toolkits', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const ctx = _loadComposio(req, res); if (!ctx) return;
    if (!ctx.co.sessionId) return res.status(400).json({ error: 'No active session' });
    const toolkits = await composio.listSessionToolkits(ctx.raw.credentials, ctx.co.sessionId);
    res.json({ toolkits });
  } catch (err) {
    console.error('[composio/toolkits]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Create a Connect Link for a toolkit. Body: { toolkit, alias? }
// Returns { redirectUrl, connectedAccountId } — UI opens redirectUrl in new tab.
  router.post('/connections/:id/composio/link', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const ctx = _loadComposio(req, res); if (!ctx) return;
    if (!ctx.co.sessionId) return res.status(400).json({ error: 'No active session' });
    const { toolkit, alias } = req.body || {};
    if (!toolkit) return res.status(400).json({ error: 'toolkit slug required' });
    const link = await composio.createLink(ctx.raw.credentials, ctx.co.sessionId, { toolkit, alias });
    res.json(link);
  } catch (err) {
    console.error('[composio/link]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Disconnect (revoke + delete) a connected account on Composio side.
  router.delete('/connections/:id/composio/connected/:accountId', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const ctx = _loadComposio(req, res); if (!ctx) return;
    await composio.deleteConnectedAccount(ctx.raw.credentials, req.params.accountId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[composio/disconnect-account]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Preview connected accounts during the New Connection flow — no stored
// connection yet. Body: { apiKey, userId? }
// Used by the "Discover from Composio" button in the create-connection modal
// so the toolkit allowlist can show actually-connected toolkits instead of a
// hardcoded list.
  router.post('/composio/discover', db.authMiddleware, async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
    const userId = String(req.body?.userId || '').trim()
      || req.user?.email
      || `aoc_user_${req.user?.userId || 'anon'}`;
    const accounts = await composio.listConnectedAccounts(apiKey, { userId });
    // Dedup toolkits from the live account list.
    const toolkitMap = new Map();
    for (const a of accounts) {
      if (!a.toolkit) continue;
      const slug = String(a.toolkit).toLowerCase();
      if (!toolkitMap.has(slug)) {
        toolkitMap.set(slug, { slug, label: a.toolkitName || slug, accountCount: 0 });
      }
      toolkitMap.get(slug).accountCount += 1;
    }
    res.json({
      userId,
      accountCount: accounts.length,
      toolkits: Array.from(toolkitMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
    });
  } catch (err) {
    console.error('[composio/discover]', err);
    // Don't propagate upstream 401/403 as-is — the dashboard's request() layer
    // would treat those as session expiry and force-logout the user. Map all
    // upstream failures to 502 (bad gateway) with a friendly message.
    const upstream = err.status >= 400 && err.status < 600 ? err.status : 0;
    const friendly = upstream === 401 || upstream === 403
      ? 'Composio rejected the API key (check it at app.composio.dev → Settings → API Keys)'
      : err.message || 'Composio discovery failed';
    res.status(upstream === 401 || upstream === 403 ? 502 : (upstream || 500)).json({ error: friendly });
  }
});

// Discover toolkits for an existing connection (uses its stored apiKey).
// Mirror of /api/composio/discover but for the edit flow where the apiKey
// isn't re-entered by the user.
  router.get('/connections/:id/composio/discover', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const ctx = _loadComposio(req, res); if (!ctx) return;
    const userId = ctx.co.userId || req.user?.email || `aoc_user_${req.user?.userId || 'anon'}`;
    const accounts = await composio.listConnectedAccounts(ctx.raw.credentials, { userId });
    const toolkitMap = new Map();
    for (const a of accounts) {
      if (!a.toolkit) continue;
      const slug = String(a.toolkit).toLowerCase();
      if (!toolkitMap.has(slug)) {
        toolkitMap.set(slug, { slug, label: a.toolkitName || slug, accountCount: 0 });
      }
      toolkitMap.get(slug).accountCount += 1;
    }
    res.json({
      userId,
      accountCount: accounts.length,
      toolkits: Array.from(toolkitMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
    });
  } catch (err) {
    console.error('[composio/discover (by-id)]', err);
    // Don't pass through upstream 401/403 — would force-logout the dashboard.
    const upstream = err.status >= 400 && err.status < 600 ? err.status : 0;
    const friendly = upstream === 401 || upstream === 403
      ? 'Composio rejected the API key (check it at app.composio.dev → Settings → API Keys)'
      : err.message || 'Composio discovery failed';
    res.status(upstream === 401 || upstream === 403 ? 502 : (upstream || 500)).json({ error: friendly });
  }
});

// Force-recreate the tool router session (e.g. after changing toolkit allowlist
// or if the session expired). Body: { toolkits?: string[] } — optional override.
  router.post('/connections/:id/composio/refresh-session', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const ctx = _loadComposio(req, res); if (!ctx) return;
    const toolkits = Array.isArray(req.body?.toolkits) ? req.body.toolkits : (ctx.co.toolkits || []);
    const fresh = await composio.createSession(ctx.raw.credentials, { userId: ctx.co.userId, toolkits });
    const meta = ctx.raw.metadata || {};
    db.updateConnection(req.params.id, {
      metadata: {
        ...meta,
        composio: { ...ctx.co, toolkits, sessionId: fresh.sessionId, mcpUrl: fresh.mcpUrl, sessionCreatedAt: new Date().toISOString() },
      },
    });
    // Tear down any live MCP client so next call uses the new session URL
    try { await mcpPool.teardown(req.params.id); } catch {}
    res.json({ ok: true, sessionId: fresh.sessionId });
  } catch (err) {
    console.error('[composio/refresh-session]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

  router.post('/connections/:id/mcp-oauth/disconnect', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const conn = db.getConnection(req.params.id);
    if (!conn || conn.type !== 'mcp') return res.status(404).json({ error: 'Not found' });
    // Drop any live transport so next call re-inits with fresh (or missing) tokens
    try { await mcpPool.teardown(req.params.id); } catch {}
    await mcpOauth.disconnect(req.params.id);
    broadcast({ type: 'connection:auth_expired', payload: { connectionId: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/mcp-oauth/disconnect]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PUBLIC OAuth callback — protected by signed state JWT
  router.get('/connections/mcp/oauth/callback', async (req, res) => {
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
    return res.status(400).send(renderHtml({ type: 'oauth-error', errorMsg: `Provider returned: ${error}` }));
  }
  if (!code || !state) {
    return res.status(400).send(renderHtml({ type: 'oauth-error', errorMsg: 'Missing code or state' }));
  }
  try {
    const connectionId = await mcpOauth.completeAuth({ stateToken: state, code });
    broadcast({ type: 'connection:auth_completed', payload: { connectionId } });
    res.send(renderHtml({ type: 'oauth-success', connectionId }));
  } catch (err) {
    console.error('[mcp oauth/callback]', err);
    res.status(err.status || 500).send(renderHtml({ type: 'oauth-error', errorMsg: err.message }));
  }
});

// Dispense a short-lived Google access token to an assigned agent
  router.get('/connections/:id/google-access-token', db.authMiddleware, async (req, res) => {
  try {
    const connId = req.params.id;
    const conn = db.getConnection(connId);
    if (!conn || conn.type !== 'google_workspace') return res.status(404).json({ error: 'Not found' });

    const agentId = req.user?.agentId || req.get('X-AOC-Agent-Id');
    if (agentId) {
      const ownerHint = Number(req.user?.userId) || db.getAgentOwner(agentId);
      if (ownerHint == null) return res.status(400).json({ error: 'Cannot resolve agent owner for assignment check' });
      const assigned = db.getAgentConnectionIds(agentId, ownerHint);
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

  router.patch('/connections/:id', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const conn = db.getConnection(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    const updated = db.updateConnection(req.params.id, req.body);
    // Drop any live MCP child so next call picks up new config/creds
    if (conn.type === 'mcp') { try { await mcpPool.teardown(req.params.id); } catch {} }
    res.json({ connection: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  router.delete('/connections/:id', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const conn = db.getConnection(req.params.id);
    if (conn && conn.type === 'google_workspace') {
      try { await parsers.googleDisconnect(req.params.id, { fullDelete: true }); }
      catch (err) { console.warn('[delete] google revoke failed (best-effort):', err.message); }
    } else {
      if (conn && conn.type === 'mcp') { try { await mcpPool.teardown(req.params.id); } catch {} }
      db.deleteConnection(req.params.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/connections DELETE]', err);
    res.status(500).json({ error: err.message });
  }
});

  router.post('/connections/:id/test', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
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
    } else if (raw.type === 'composio') {
      const m = raw.metadata || {};
      const co = m.composio || {};
      const apiKey = raw.credentials || '';
      if (!apiKey) {
        result = { ok: false, error: 'API key missing' };
      } else if (!co.sessionId || !co.mcpUrl) {
        result = { ok: false, error: 'Composio session not initialized — re-create connection' };
      } else {
        try {
          // Touch the session via REST first (cheap auth check) — if it 404s
          // we recreate transparently, since sessions can expire server-side.
          let sessionAlive = true;
          try { await composio.getSession(apiKey, co.sessionId); }
          catch (e) {
            if (e.status === 404 || e.status === 410) sessionAlive = false;
            else throw e;
          }
          if (!sessionAlive) {
            const fresh = await composio.createSession(apiKey, { userId: co.userId, toolkits: co.toolkits || [] });
            db.updateConnection(req.params.id, {
              metadata: { ...m, composio: { ...co, sessionId: fresh.sessionId, mcpUrl: fresh.mcpUrl, sessionCreatedAt: new Date().toISOString() } },
            });
            co.sessionId = fresh.sessionId;
            co.mcpUrl = fresh.mcpUrl;
          }
          // Now probe the MCP layer to confirm tools are reachable.
          try { await mcpPool.teardown(req.params.id); } catch {}
          const probe = await mcpPool.probe(composio.buildMcpSpec({ composio: co }));
          if (probe.ok) {
            const tools = (probe.tools || []).map(t => ({
              name: t.name, description: t.description || '', inputSchema: t.inputSchema || undefined,
            }));
            db.updateConnection(req.params.id, {
              metadata: { ...m, tools, toolsDiscoveredAt: new Date().toISOString() },
            });
            const preview = tools.slice(0, 5).map(t => t.name).join(', ') + (tools.length > 5 ? ` +${tools.length - 5} more` : '');
            result = { ok: true, message: `Connected · ${tools.length} meta-tool(s) available`, preview };
          } else {
            result = { ok: false, error: `MCP probe failed: ${probe.error}` };
          }
        } catch (e) {
          result = { ok: false, error: e.message || String(e) };
        }
      }
    } else if (raw.type === 'mcp') {
      const m = raw.metadata || {};
      const transport = m.transport || 'stdio';
      const needsUrl = transport === 'http' || transport === 'sse';
      const usesOauth = !!(m.oauth && m.oauth.enabled);
      if (!needsUrl && !m.command) {
        result = { ok: false, error: 'command not set in metadata' };
      } else if (needsUrl && !m.url) {
        result = { ok: false, error: 'url not set in metadata' };
      } else if (usesOauth && (m.oauth.authState !== 'connected')) {
        result = { ok: false, error: `OAuth not completed (state: ${m.oauth.authState || 'unknown'}). Use Connect to authorize first.` };
      } else {
        // Tear down any live instance so we probe with fresh config
        try { await mcpPool.teardown(req.params.id); } catch {}
        const probe = await mcpPool.probe({
          transport,
          command: m.command,
          args: m.args || [],
          env: m.env || {},
          url: m.url,
          headers: m.headers || {},
          credentials: raw.credentials || '',
          oauth: usesOauth ? { connId: req.params.id } : undefined,
        });
        if (probe.ok) {
          // Persist discovered tools (minimal fields — strip inputSchema from display)
          const tools = probe.tools.map(t => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || undefined,
          }));
          db.updateConnection(req.params.id, {
            metadata: { ...m, tools, toolsDiscoveredAt: new Date().toISOString() },
          });
          const preview = tools.slice(0, 3).map(t => t.name).join(', ') + (tools.length > 3 ? ` +${tools.length - 3} more` : '');
          result = { ok: true, message: `Connected · ${tools.length} tool(s) discovered`, preview };
        } else {
          result = { ok: false, error: probe.error };
        }
      }
    }

    // Update test state
    db.updateConnection(req.params.id, { lastTestedAt: new Date().toISOString(), lastTestOk: result.ok });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



  return router;
};
