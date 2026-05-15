/**
 * routes/connections.cjs
 *
 * Third-party data source connections + MCP OAuth + Google Workspace auth.
 * Step 6 of server modularization.
 */
'use strict';

const { parseOwnerParam } = require('../helpers/access-control.cjs');
const audit = require('../lib/audit-log.cjs');

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

  router.get('/connections', db.authMiddleware, (req, res) => {
  const allConnections = db.getAllConnections();
  const uid = req.user?.userId;
  const isAdmin = req.user?.role === 'admin';

  // Default scope = "accessible" (owned ∪ shared). `?owner=me` = strict-owned
  // (legacy), `?owner=all` = cross-tenant monitoring (admin only).
  const explicit = req.query?.owner ? parseOwnerParam(req) : 'accessible';

  function decorate(c) {
    return { ...c, sharedWithMe: c.createdBy !== uid && !!c.shared };
  }

  let connections;
  if (explicit === 'me') {
    connections = allConnections.filter(c => c.createdBy === uid).map(decorate);
  } else if (typeof explicit === 'number') {
    connections = isAdmin
      ? allConnections.filter(c => c.createdBy === explicit).map(decorate)
      : allConnections.filter(c => c.createdBy === uid).map(decorate);
  } else if (explicit === 'all') {
    if (isAdmin) {
      connections = allConnections.map(decorate);
    } else {
      connections = allConnections.filter(c => c.createdBy === uid || c.shared).map(decorate);
    }
  } else {
    // 'accessible' (default): owned ∪ shared for everyone, including admin.
    // Admin still uses ?owner=all to opt into the cross-tenant view.
    connections = allConnections
      .filter(c => c.createdBy === uid || c.shared)
      .map(decorate);
  }

  res.json({ connections });
});

  router.get('/connections/assignments', db.authMiddleware, (req, res) => {
    // Scope to caller — admin-cross-tenant view will be a separate feature.
    const ownerId = Number(req.user.userId);
    const raw = db.getAllAgentConnectionAssignments({ ownerId });
    // Flatten to legacy shape { connId: [agentId, ...] } for the frontend
    // since callers within this user's scope can't have ambiguous slugs.
    const assignments = {};
    for (const [connId, entries] of Object.entries(raw)) {
      assignments[connId] = entries.map(e => e.agentId);
    }
    res.json({ assignments });
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

// ─── Connection sharing (org-wide boolean) ──────────────────────────────────
//
// Owner (or admin) toggles `shared` on a connection. When ON, any user on
// this AOC instance may assign it to their own agents (dispatch reads
// decrypted creds at runtime). Editing/deleting/testing remains owner-only
// regardless. Turning OFF auto-cleans non-owner assignments to avoid silent
// dispatch failures.

  router.patch('/connections/:id/share', db.authMiddleware, db.requireConnectionOwnership, (req, res) => {
    try {
      const conn = db.getConnection(req.params.id);
      if (!conn) return res.status(404).json({ error: 'Connection not found' });
      const wantShared = !!(req.body && req.body.shared);
      const prevShared = !!conn.shared;
      if (wantShared === prevShared) return res.json({ ok: true, connection: conn });
      const updated = db.setConnectionShared(req.params.id, wantShared);
      try {
        audit.record(req, {
          action: wantShared ? 'connection.shared' : 'connection.unshared',
          targetType: 'connection',
          targetId: req.params.id,
          before: { shared: prevShared },
          after: { shared: wantShared },
        });
      } catch (_) {}
      try { broadcast({ type: 'connection:share_changed', payload: { connectionId: req.params.id, shared: wantShared } }); } catch (_) {}
      res.json({ ok: true, connection: updated });
    } catch (err) {
      console.error('[api/connections/share]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GitHub: Copy to Local (clone remote repo into tenant workspace) ──
  // Starts a background clone job. Returns the initial job descriptor; client
  // polls /connections/:id/clone-status until state === 'completed' | 'failed'.
  router.post('/connections/:id/clone-to-local', db.authMiddleware, db.requireConnectionOwnership, (req, res) => {
    try {
      const conn = db.getConnection(req.params.id);
      if (!conn) return res.status(404).json({ error: 'Connection not found' });
      if (conn.type !== 'github') return res.status(400).json({ error: 'only github connections support clone-to-local' });
      const meta = conn.metadata || {};
      if ((meta.githubMode || 'remote') !== 'remote') {
        return res.status(400).json({ error: 'connection is not in remote mode' });
      }
      if (!conn.credentials) {
        return res.status(400).json({ error: 'PAT required: set a Personal Access Token on the connection first (private repo clone needs auth, push always needs auth)' });
      }
      const githubClone = require('../lib/connections/github-clone.cjs');
      const ownerUserId = Number(conn.created_by || conn.createdBy || req.user?.userId);
      const job = githubClone.startCloneJob({ connection: conn, ownerUserId, db });
      try { audit.record(req, { action: 'connection.github.clone-started', targetType: 'connection', targetId: req.params.id, after: { repo: job.repo, branch: job.branch } }); } catch (_) {}
      res.json({ ok: true, job });
    } catch (err) {
      console.error('[api/connections/clone-to-local]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Poll job status. Frontend hits this every ~1s after starting clone.
  router.get('/connections/:id/clone-status', db.authMiddleware, db.requireConnectionOwnership, (req, res) => {
    try {
      const conn = db.getConnection(req.params.id);
      if (!conn) return res.status(404).json({ error: 'Connection not found' });
      const githubClone = require('../lib/connections/github-clone.cjs');
      const meta = conn.metadata || {};
      const liveJob = githubClone.getJobState(req.params.id);
      res.json({
        ok: true,
        clonePath: meta.clonePath || null,
        clonedAt: meta.clonedAt || null,
        lastSyncAt: meta.lastSyncAt || null,
        job: liveJob || meta.cloneJob || null,
      });
    } catch (err) {
      console.error('[api/connections/clone-status]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Sync existing clone with remote (fetch + report divergence). Does NOT
  // auto-rebase — caller's agent should explicitly run `aoc-connect.sh <name> pull`
  // when ready to apply remote changes.
  router.post('/connections/:id/clone-sync', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
    try {
      const conn = db.getConnection(req.params.id);
      if (!conn) return res.status(404).json({ error: 'Connection not found' });
      const githubClone = require('../lib/connections/github-clone.cjs');
      const result = await githubClone.syncClone({ connection: conn, db });
      try { audit.record(req, { action: 'connection.github.clone-synced', targetType: 'connection', targetId: req.params.id, after: result }); } catch (_) {}
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[api/connections/clone-sync]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Remove the local clone. Destructive — UI must confirm.
  router.post('/connections/:id/unclone', db.authMiddleware, db.requireConnectionOwnership, async (req, res) => {
    try {
      const conn = db.getConnection(req.params.id);
      if (!conn) return res.status(404).json({ error: 'Connection not found' });
      const githubClone = require('../lib/connections/github-clone.cjs');
      const result = await githubClone.unclone({ connection: conn, db });
      try { audit.record(req, { action: 'connection.github.uncloned', targetType: 'connection', targetId: req.params.id, after: result }); } catch (_) {}
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[api/connections/unclone]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Who is using this connection? Returns every (agent, owner) pair that
  // currently has it assigned. Visible to anyone who can use the connection
  // — owners, admin, and (if shared) all users — so the "5 agents are using
  // this" affordance works for everyone, not just the owner.
  router.get('/connections/:id/usage', db.authMiddleware, (req, res) => {
    const conn = db.getConnection(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    if (!db.userCanUseConnection(req, req.params.id)) {
      return res.status(403).json({ error: 'You do not have access to this connection' });
    }
    res.json({ usage: db.getConnectionUsage(req.params.id) });
  });

  // ─── odoocli profile materialization ───────────────────────────────────────
  // GET /api/connections/:idOrName/odoo-profile
  // Used by the `aoc-odoo` skill's wrapper script. Returns a rendered TOML
  // body the wrapper writes to a temp file (mode 0600) then runs odoocli with
  // `--config <tmp>`. Credentials never round-trip through the browser; this
  // endpoint exists for shell scripts running with $AOC_AGENT_TOKEN (or a
  // dashboard JWT). Gated by userCanUseConnection so the boolean `shared`
  // flag governs both "can assign" and "can fetch creds".
  router.get('/connections/:id/odoo-profile', db.authMiddleware, (req, res) => {
    try {
      const uid = req.user?.userId;
      const isAdmin = req.user?.role === 'admin';
      const idOrName = req.params.id;

      // Agent-scoping: when request carries an agent context (service token
      // sets req.user.agentId; dashboard users may pass ?agentId=…), the
      // connection must be ASSIGNED to that agent — not merely accessible.
      // This prevents an agent from operating on a connection the user has
      // access to but didn't assign to that specific agent.
      const requestedAgentId = String(req.user?.agentId || req.query?.agentId || '').trim() || null;
      const ownerHint = uid != null ? Number(uid) : (requestedAgentId ? db.getAgentOwner(requestedAgentId) : null);
      const assignedIds = requestedAgentId
        ? new Set(db.getAgentConnectionIds(requestedAgentId, ownerHint) || [])
        : null;

      // Resolve: try direct id lookup first, fall back to name match across
      // accessible (or, if agent-scoped, assigned) connections.
      let connId = idOrName;
      let raw = db.getConnectionRaw(connId);
      if (!raw) {
        const all = db.getAllConnections();
        const accessible = all.filter(c =>
          c.type === 'odoocli' && (c.createdBy === uid || c.shared || isAdmin)
        );
        const pool = assignedIds
          ? accessible.filter(c => assignedIds.has(c.id))
          : accessible;
        const byName = pool.filter(c => c.name === idOrName);
        if (byName.length === 0) {
          return res.status(404).json({ error: `connection '${idOrName}' not found or not accessible` });
        }
        if (byName.length > 1) {
          // Prefer owned, then shared. If still ambiguous, surface candidates.
          const owned = byName.filter(c => c.createdBy === uid);
          if (owned.length === 1) {
            raw = db.getConnectionRaw(owned[0].id);
            connId = owned[0].id;
          } else {
            return res.status(409).json({
              error: `connection name '${idOrName}' is ambiguous`,
              candidates: byName.map(c => ({ id: c.id, name: c.name, sharedWithMe: c.createdBy !== uid })),
            });
          }
        } else {
          raw = db.getConnectionRaw(byName[0].id);
          connId = byName[0].id;
        }
      }

      if (!raw) return res.status(404).json({ error: 'Connection not found' });
      if (raw.type !== 'odoocli') {
        return res.status(400).json({ error: `connection type is '${raw.type}', not 'odoocli'` });
      }
      if (!db.userIdCanUseConnection(uid, connId)) {
        return res.status(403).json({ error: 'You do not have access to this connection' });
      }
      if (assignedIds && !assignedIds.has(connId)) {
        return res.status(403).json({
          error: `Connection '${raw.name}' is not assigned to agent '${requestedAgentId}'. Ask the user to assign it via the Connections tab on the agent's detail page.`,
          code: 'CONNECTION_NOT_ASSIGNED',
          agentId: requestedAgentId,
          connectionId: connId,
        });
      }

      const meta = raw.metadata || {};
      const url      = String(meta.odooUrl || '').trim();
      const dbName   = String(meta.odooDb  || '').trim();
      const username = String(meta.odooUsername || '').trim();
      const authType = String(meta.odooAuthType || 'password');
      const credential = String(raw.credentials || '');

      if (!url || !dbName || !username || !credential) {
        return res.status(422).json({
          error: 'Connection is missing required odoocli fields',
          missing: [
            !url      && 'odooUrl',
            !dbName   && 'odooDb',
            !username && 'odooUsername',
            !credential && 'credentials',
          ].filter(Boolean),
        });
      }

      // Sanitize profile name: alnum / dash / underscore only. odoocli reads
      // `[<profile>]` as the TOML section header, so anything else risks
      // breaking the parser.
      //
      // CRITICAL: profile name must be unique across ALL connections in this
      // AOC instance, not just within one user. Reason: odoocli caches the
      // authenticated session at ~/.odoocli-session.json keyed by profile
      // name (odoocli/client.py: sessions[self.profile.name] = ...). Because
      // every per-user gateway runs as the same OS user (itdke), Path.home()
      // resolves to the same path and the session file is shared. Two users
      // with a connection both named "production" would collide — the second
      // request would reuse the first user's authenticated uid against the
      // second user's Odoo instance, producing auth failures or cross-tenant
      // calls. Appending a stable per-connection suffix isolates sessions.
      const connSlug = String(connId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'x';
      const safeName = (raw.name || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
      const profileName = safeName ? `${safeName}_${connSlug}` : `aoc-${connSlug}`;

      // Render TOML. Escape values: TOML basic-string requires backslash-
      // and double-quote-escaping. Newlines in a credential would break the
      // line; reject them rather than silently corrupting.
      const tomlEscape = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      if (/[\r\n]/.test(credential) || /[\r\n]/.test(url) || /[\r\n]/.test(dbName) || /[\r\n]/.test(username)) {
        return res.status(422).json({ error: 'Connection contains a newline character; refusing to render TOML' });
      }
      const lines = [
        `[${profileName}]`,
        `url = "${tomlEscape(url)}"`,
        `db = "${tomlEscape(dbName)}"`,
        `username = "${tomlEscape(username)}"`,
      ];
      if (authType === 'api_key') {
        lines.push(`api_key = "${tomlEscape(credential)}"`);
      } else {
        lines.push(`password = "${tomlEscape(credential)}"`);
      }
      const toml = lines.join('\n') + '\n';

      try {
        audit.record(req, {
          action: 'connection.creds_fetched',
          targetType: 'connection',
          targetId: connId,
          before: null,
          after: { profileName, format: 'odoocli-toml' },
        });
      } catch (_) {}

      res.json({ profileName, toml, connectionId: connId });
    } catch (err) {
      console.error('[api/connections/odoo-profile]', err);
      res.status(500).json({ error: err.message });
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
