/**
 * routes/connections.cjs
 *
 * Third-party data source connections + MCP OAuth + Google Workspace auth.
 * Step 6 of server modularization.
 */
'use strict';

module.exports = function connectionsRouter(deps) {
  const { db, parsers, broadcast, mcpOauth, composio } = deps;
  const router = require('express').Router();

// ─── Connections (third-party data sources) ──────────────────────────────────

// Feature flags for connection types — UI uses this to hide unconfigured options
  router.get('/connections/config/features', db.authMiddleware, (_req, res) => {
  const cfg = require('../lib/config.cjs');
  res.json({
    features: {
      googleWorkspace: !!cfg.GOOGLE_OAUTH_CONFIGURED,
    },
    redirectUri: cfg.GOOGLE_OAUTH_CONFIGURED ? parsers.googleRedirectUri() : null,
  });
});

  router.get('/connections', db.authMiddleware, (_req, res) => {
  res.json({ connections: db.getAllConnections() });
});

  router.get('/connections/assignments', db.authMiddleware, (_req, res) => {
  res.json({ assignments: db.getAllAgentConnectionAssignments() });
});

  router.get('/connections/:id', db.authMiddleware, (req, res) => {
  const conn = db.getConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  res.json({ connection: conn });
});

  router.post('/connections', db.authMiddleware, async (req, res) => {
  try {
    const { name, type, credentials, metadata, enabled } = req.body;
    let { id } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
    if (!id) id = require('crypto').randomUUID();

    if (type === 'google_workspace') {
      const cfgMod = require('../lib/config.cjs');
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

    if (type === 'composio') {
      const apiKey = (credentials || '').trim();
      if (!apiKey) return res.status(400).json({ error: 'Composio API key required (credentials field)' });
      const m = metadata || {};
      const userId = (m.composio && m.composio.userId) || req.user?.email || `aoc_user_${req.user?.userId || 'anon'}`;
      const toolkits = (m.composio && Array.isArray(m.composio.toolkits)) ? m.composio.toolkits : [];
      let session;
      try {
        session = await composio.createSession(apiKey, { userId, toolkits });
      } catch (err) {
        return res.status(err.status || 502).json({ error: `Failed to create Composio session: ${err.message}` });
      }
      const composioMeta = {
        ...m,
        composio: {
          userId,
          toolkits,
          sessionId: session.sessionId,
          mcpUrl: session.mcpUrl,
          mcpType: session.mcpType,
          sessionCreatedAt: new Date().toISOString(),
        },
      };
      const conn = db.createConnection({
        id, name, type,
        credentials: apiKey,
        metadata: composioMeta,
        enabled: enabled !== false,
        createdBy: req.user?.userId,
      });
      return res.json({ ok: true, connection: conn });
    }

    const conn = db.createConnection({ id, name, type, credentials, metadata, enabled, createdBy: req.user?.userId });

    // If this is an MCP connection with OAuth metadata, kick off the flow so
    // the UI can open a popup. Mirrors the google_workspace create flow.
    if (type === 'mcp' && metadata && metadata.oauth && metadata.oauth.enabled) {
      try {
        const { authUrl } = await mcpOauth.beginAuth(id, {
          requestedScopes: metadata.oauth.requestedScopes || [],
        });
        return res.json({ ok: true, connection: conn, authUrl });
      } catch (err) {
        // Leave the connection row in place so user can retry from the card
        console.warn(`[mcp-oauth] beginAuth failed for ${id}: ${err.message}`);
        return res.json({ ok: true, connection: conn, oauthError: err.message });
      }
    }
    res.json({ ok: true, connection: conn });
  } catch (err) {
    console.error('[api/connections POST]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Re-generate auth URL for an expired or disconnected google_workspace connection
  router.post('/connections/:id/google/reauth', db.authMiddleware, db.requireConnectionOwnership, (req, res) => {
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
  router.post('/connections/:id/google/disconnect', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
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
  router.get('/connections/:id/google/health', db.authMiddleware, async (req, res) => {
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
  router.get('/connections/google/callback', async (req, res) => {
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

// ─── MCP OAuth ──────────────────────────────────────────────────────────────

  router.post('/connections/:id/mcp-oauth/start', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
  try {
    const conn = db.getConnection(req.params.id);
    if (!conn || conn.type !== 'mcp') return res.status(404).json({ error: 'Not found' });
    const { authUrl } = await mcpOauth.beginAuth(req.params.id, {
      requestedScopes: req.body?.requestedScopes || (conn.metadata?.oauth?.requestedScopes) || [],
    });
    res.json({ authUrl });
  } catch (err) {
    console.error('[api/mcp-oauth/start]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});


  return router;
};
