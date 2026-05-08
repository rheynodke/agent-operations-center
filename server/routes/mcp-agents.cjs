/**
 * routes/mcp-agents.cjs
 *
 * MCP tool invocation + Agent ↔ Connection assignments +
 * Agent-readable connections (decrypted credentials for agent scripts) +
 * Filesystem browser.
 * Step 9a of server modularization.
 */
'use strict';

module.exports = function mcpAgentsRouter(deps) {
  const { db, parsers, mcpPool, composio, syncBuiltinsForAgent, restartGateway } = deps;
  const router = require('express').Router();

// ─── MCP tool invocation ─────────────────────────────────────────────────────
// Called by mcp-call.sh. Resolves connection by name, enforces agent assignment,
// spawns/reuses the MCP child, forwards JSON-RPC call, returns raw tool response.
  router.post('/mcp/call', db.authMiddleware, async (req, res) => {
  try {
    const { connectionName, tool, args } = req.body || {};
    if (!connectionName || !tool) {
      return res.status(400).json({ error: 'connectionName and tool are required' });
    }
    const all = db.getAllConnections().filter(c => (c.type === 'mcp' || c.type === 'composio') && c.enabled);
    const match = all.find(c => c.name === connectionName);
    if (!match) return res.status(404).json({ error: `MCP connection "${connectionName}" not found or disabled` });

    // Agent assignment check (same pattern as /api/connections/:id/google-access-token)
    const agentId = req.user?.agentId || req.get('X-AOC-Agent-Id');
    if (agentId) {
      // Service tokens may not carry a user id — derive owner from the agent's
      // single-tenant lookup (rejects ambiguous cross-tenant slugs by design).
      const ownerHint = Number(req.user?.userId) || db.getAgentOwner(agentId);
      if (ownerHint == null) {
        return res.status(400).json({ error: 'Cannot resolve agent owner for assignment check — pass user context' });
      }
      const assigned = db.getAgentConnectionIds(agentId, ownerHint);
      if (!assigned.includes(match.id)) {
        return res.status(403).json({ error: 'Agent not assigned to this MCP connection' });
      }
    }

    const raw = db.getConnectionRaw(match.id);
    if (!raw) return res.status(404).json({ error: 'Connection not found' });
    const m = raw.metadata || {};

    let poolSpec;
    if (raw.type === 'composio') {
      const co = m.composio || {};
      // Lazy session refresh: if session is missing/expired, recreate before
      // building the MCP spec so tools never get a dead URL.
      if (!co.sessionId || !co.mcpUrl) {
        const fresh = await composio.createSession(raw.credentials, { userId: co.userId, toolkits: co.toolkits || [] });
        db.updateConnection(match.id, {
          metadata: { ...m, composio: { ...co, sessionId: fresh.sessionId, mcpUrl: fresh.mcpUrl, sessionCreatedAt: new Date().toISOString() } },
        });
        co.sessionId = fresh.sessionId;
        co.mcpUrl = fresh.mcpUrl;
      }
      poolSpec = composio.buildMcpSpec({ composio: co });
    } else {
      poolSpec = {
        transport: m.transport || 'stdio',
        command: m.command,
        args: m.args || [],
        env: m.env || {},
        url: m.url,
        headers: m.headers || {},
        credentials: raw.credentials || '',
        oauth: (m.oauth && m.oauth.enabled) ? { connId: match.id } : undefined,
      };
    }

    // --list-tools shortcut — avoids a second round-trip from the shell
    if (tool === '--list-tools' || tool === '__list__') {
      const tools = await mcpPool.listTools(match.id, poolSpec);
      return res.json({ ok: true, tools });
    }

    const response = await mcpPool.callTool(match.id, poolSpec, tool, args || {});

    // MCP callTool returns { content: [...], isError?: bool }
    res.json({ ok: !response.isError, response });
  } catch (err) {
    console.error('[api/mcp/call]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent ↔ Connection assignments ─────────────────────────────────────────

  router.get('/agents/:id/connections', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  // requireAgentOwnership already verified caller owns this slug → use their userId as scope.
  const ownerId = Number(req.user.userId);
  const ids = db.getAgentConnectionIds(req.params.id, ownerId);
  const connections = ids.map(id => db.getConnection(id)).filter(Boolean);
  res.json({ connectionIds: ids, connections });
});

  router.put('/agents/:id/connections', db.authMiddleware, db.requireAgentOwnership, async (req, res) => {
  try {
    const { connectionIds } = req.body;
    if (!Array.isArray(connectionIds)) return res.status(400).json({ error: 'connectionIds must be an array' });
    const composioCount = connectionIds
      .map(cid => db.getConnection(cid))
      .filter(c => c && c.type === 'composio').length;
    if (composioCount > 1) {
      return res.status(400).json({ error: 'An agent can be assigned at most one Composio connection' });
    }

    // requireAgentOwnership already proved caller owns this slug; scope by their userId.
    const ownerId = Number(req.user.userId);
    // Detect actual change so we only restart the gateway when the assignment
    // truly differs (avoids gratuitous restarts on no-op writes from the UI).
    const prevIds = new Set(db.getAgentConnectionIds(req.params.id, ownerId) || []);
    const nextIds = new Set(connectionIds);
    const changed = prevIds.size !== nextIds.size
      || [...nextIds].some(id => !prevIds.has(id));

    db.setAgentConnections(req.params.id, connectionIds, ownerId);
    try {
      const allConns = db.getAllConnections();
      const assigned = allConns.filter(c => connectionIds.includes(c.id));
      parsers.syncAgentConnectionsContext(req.params.id, assigned, parsers.getAgentFile, parsers.saveAgentFile);
    } catch (e) {
      console.warn(`[connections] Failed to sync context for ${req.params.id}:`, e.message);
    }
    if (typeof syncBuiltinsForAgent === 'function') syncBuiltinsForAgent(req.params.id);

    // Auto-restart the OWNING USER's gateway so any in-flight session picks up
    // the new connection list on its next thinking turn. Without this the agent
    // keeps using the stale TOOLS.md it loaded at session start and stays
    // confused about whether a freshly-assigned connection exists.
    let gatewayRestarted = false;
    if (changed) {
      try {
        if (Number(ownerId) !== 1) {
          // Non-admin: bounce per-user gateway via orchestrator.
          const orchestrator = require('../lib/gateway-orchestrator.cjs');
          // Fire-and-forget — we don't want the HTTP response to block on the
          // 5-10s gateway warm-up. UI's optimistic state already reflects the
          // new assignment, and the next chat turn will hit a fresh gateway.
          orchestrator.restartGateway(ownerId).catch((e) =>
            console.warn(`[connections] async gateway restart for uid=${ownerId} failed: ${e.message}`)
          );
          gatewayRestarted = true;
        } else if (typeof restartGateway === 'function') {
          // Admin: external systemd-managed gateway — best-effort signal.
          try { restartGateway(`connection assignment changed for ${req.params.id}`); gatewayRestarted = true; }
          catch (_) {}
        }
      } catch (e) {
        console.warn(`[connections] gateway restart trigger failed: ${e.message}`);
      }
    }

    res.json({ ok: true, connectionIds, gatewayRestarted });
  } catch (err) {
    // Surface 403 from setAgentConnections (user trying to assign a connection
    // they don't have access to) instead of swallowing it as 500.
    if (err && err.status === 403) {
      return res.status(403).json({ error: err.message, code: err.code });
    }
    res.status(500).json({ error: err.message });
  }
});


// ─── Agent-readable connections (returns decrypted credentials for agent scripts) ──
  router.get('/agent/connections', db.authMiddleware, (req, res) => {
  try {
    const agentId = req.query.agentId;
    if (!agentId) return res.json({ connections: [], error: 'agentId query param required' });
    // Scope assignment lookup by caller's userId (or the agent's resolvable
    // single owner for service tokens that don't carry one).
    const ownerHint = Number(req.user?.userId) || db.getAgentOwner(agentId);
    if (ownerHint == null) return res.status(400).json({ connections: [], error: 'Cannot resolve agent owner' });
    const conns = db.getAgentConnectionsRaw(agentId, ownerHint);
    const result = conns.map(c => {
      const meta = c.metadata || {};
      const out = { name: c.name, type: c.type };

      if (c.type === 'bigquery') {
        out.projectId = meta.projectId || null;
        out.datasets = meta.datasets || [];
        out.serviceAccountJson = c.credentials || null;
        out.description = meta.description || null;
        out.hint = 'Write service account JSON to a temp file, activate with gcloud auth, then use bq CLI.';
      } else if (c.type === 'postgres') {
        out.host = meta.host || 'localhost';
        out.port = meta.port || 5432;
        out.database = meta.database || null;
        out.username = meta.username || 'postgres';
        out.password = c.credentials || null;
        out.sslMode = meta.sslMode || null;
        out.description = meta.description || null;
        out.hint = 'Connect via psql or any PostgreSQL client with these credentials.';
      } else if (c.type === 'ssh') {
        out.host = meta.sshHost || null;
        out.port = meta.sshPort || 22;
        out.user = meta.sshUser || 'root';
        out.privateKey = c.credentials || null;
        out.description = meta.description || null;
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
        out.description = meta.description || null;
        out.hint = 'Use gws-call.sh <connection-name> <service> <method> [json-body] to call Google APIs. Credentials are handled automatically.';
      } else if (c.type === 'mcp') {
        out.preset = meta.preset || 'custom';
        out.transport = meta.transport || 'stdio';
        if (out.transport === 'stdio') {
          out.command = meta.command || null;
          out.args = meta.args || [];
        } else {
          out.url = meta.url || null;
        }
        out.tools = (meta.tools || []).map(t => ({ name: t.name, description: t.description || '' }));
        out.toolsDiscoveredAt = meta.toolsDiscoveredAt || null;
        out.description = meta.description || null;
        out.hint = `Use mcp-call.sh "${c.name}" <tool-name> '<json-args>' — credentials are handled automatically.`;
      }

      return out;
    });
    res.json({ connections: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agent/connections/by-name/:name/credentials?agentId=...
// Returns normalized credentials for one assigned connection. Used by
// browser-harness-odoo (and similar skills) so the agent doesn't have to
// parse the full /api/agent/connections payload. Only website/odoocli are
// supported for now — those are what login flows need.
  router.get('/agent/connections/by-name/:name/credentials', db.authMiddleware, (req, res) => {
  try {
    const agentId = req.query.agentId;
    if (!agentId) return res.status(400).json({ error: 'agentId query param required' });
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ error: 'connection name required' });

    const conns = db.getAgentConnectionsRaw(agentId);
    const c = conns.find(x => x.name === name);
    if (!c) return res.status(404).json({ error: `Connection "${name}" not assigned to agent ${agentId}` });

    const meta = c.metadata || {};
    let payload;
    if (c.type === 'website') {
      payload = {
        type: 'website',
        url: meta.url || null,
        loginUrl: meta.loginUrl ? `${(meta.url || '').replace(/\/$/, '')}${meta.loginUrl}` : null,
        username: meta.authUsername || null,
        password: meta.authType !== 'none' ? (c.credentials || null) : null,
      };
    } else if (c.type === 'odoocli') {
      payload = {
        type: 'odoocli',
        url: meta.odooUrl || null,
        db: meta.odooDb || null,
        username: meta.odooUsername || null,
        password: c.credentials || null,
        authType: meta.odooAuthType || 'password',
      };
    } else {
      return res.status(400).json({ error: `Connection type "${c.type}" does not support credential fetch (only website, odoocli)` });
    }

    // Lightweight audit log
    console.log(`[credentials/by-name] agent=${agentId} conn=${name} type=${c.type} user=${req.user?.username || 'service'}`);

    res.json(payload);
  } catch (err) {
    console.error('[agent/connections/by-name]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Filesystem browser (used by ProjectCreateWizard's directory picker) ────
//
// GET /api/projects/_browse-dir?path=~/projects&showHidden=false
//   - Defaults to the user's home directory when path is empty / "~".
//   - Refuses sensitive system paths via the same allowlist used for project
//     binding. Lists symlink children but skips them.
  router.get('/projects/_browse-dir', db.authMiddleware, (req, res) => {
  try {
    const raw = String(req.query.path || '~');
    const showHidden = String(req.query.showHidden || '') === 'true';

    const abs = projectWs.normalizeAbsolute(raw);
    if (!abs) return res.status(400).json({ error: 'path must be absolute or ~ prefixed' });

    const sens = projectWs.findSensitiveMatch(abs);
    if (sens) return res.status(403).json({ error: `sensitive directory: ${sens}` });

    let st;
    // For the cwd we follow symlinks (so /tmp -> /private/tmp works), but
    // children below still use lstat so symlink entries are skipped.
    try { st = fs.statSync(abs); } catch { return res.status(404).json({ error: 'path does not exist' }); }
    if (!st.isDirectory()) return res.status(400).json({ error: 'not a directory' });

    let names;
    try { names = fs.readdirSync(abs); }
    catch (e) { return res.status(403).json({ error: `cannot read directory: ${e.code || e.message}` }); }

    const entries = [];
    for (const name of names) {
      if (!showHidden && name.startsWith('.')) continue;
      const full = path.join(abs, name);
      let sst;
      try { sst = fs.lstatSync(full); } catch { continue; }
      const isLink = sst.isSymbolicLink();
      // Only descend into real dirs; mark symlinks unselectable.
      const kind = sst.isDirectory() ? 'dir' : (sst.isFile() ? 'file' : 'other');
      // Skip files entirely — picker is for directories.
      if (kind !== 'dir') continue;
      // Cheap "looks like a project" hint
      let isGitRepo = false;
      try { isGitRepo = fs.existsSync(path.join(full, '.git')); } catch {}
      let hasAocBinding = false;
      try { hasAocBinding = fs.existsSync(path.join(full, '.aoc', 'project.json')); } catch {}
      entries.push({ name, kind: 'dir', isSymlink: isLink, isGitRepo, hasAocBinding });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Compute breadcrumb segments (above home shown abbreviated as ~).
    const home = os.homedir();
    const isUnderHome = abs === home || abs.startsWith(home + path.sep);
    const display = isUnderHome ? '~' + abs.slice(home.length) : abs;

    const parent = path.dirname(abs);
    res.json({
      cwd: abs,
      display,
      home,
      parent: parent !== abs ? parent : null,
      isUnderHome,
      entries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



  return router;
};
