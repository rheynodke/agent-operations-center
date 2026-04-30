// Composio Tool Router REST wrapper.
//
// Composio's tool router exposes ~100 SaaS toolkits (GitHub, Gmail, Slack,
// Linear, Notion, etc.) through a single MCP endpoint. Each AOC `composio`
// connection holds:
//   - API key (encrypted in `credentials`)
//   - user_id (composio-side stable id, defaults to AOC user email)
//   - session_id + mcp.url (refreshed lazily; stored in metadata)
//   - toolkit allowlist (set at create time)
//
// Auth: all REST calls use `x-api-key: <apiKey>` header.
// MCP layer: the session URL itself authorizes — no extra headers needed.
//
// Spec source: https://backend.composio.dev/api/v3/openapi.json

'use strict';

const BASE_URL = process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev';
const REQ_TIMEOUT_MS = 20_000;

async function composioRequest(apiKey, method, path, body) {
  if (!apiKey) throw new Error('Composio API key required');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), REQ_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Composio ${method} ${path} timed out after ${REQ_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(t);
  }

  let data;
  const text = await resp.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!resp.ok) {
    // Composio sometimes returns nested error objects ({ error: { message, code } })
    // and sometimes a flat string. Normalize so callers don't see "[object Object]".
    const rawMsg = data?.error?.message || data?.message || data?.error || data?.raw;
    const msg = typeof rawMsg === 'string' ? rawMsg : (rawMsg ? JSON.stringify(rawMsg) : `HTTP ${resp.status}`);
    const err = new Error(`Composio ${method} ${path}: ${msg}`);
    err.status = resp.status;
    err.response = data;
    throw err;
  }
  return data;
}

// POST /api/v3/tool_router/session
// → { session_id, mcp: { type, url }, tool_router_tools, config }
async function createSession(apiKey, { userId, toolkits }) {
  if (!userId) throw new Error('userId required');
  const body = { user_id: userId };
  if (Array.isArray(toolkits) && toolkits.length > 0) {
    body.toolkits = { enable: toolkits };
  }
  const data = await composioRequest(apiKey, 'POST', '/api/v3/tool_router/session', body);
  return {
    sessionId: data.session_id,
    mcpUrl: data?.mcp?.url || null,
    mcpType: data?.mcp?.type || 'http',
    toolRouterTools: Array.isArray(data?.tool_router_tools) ? data.tool_router_tools : [],
  };
}

// GET /api/v3/tool_router/session/{session_id}
// Used to verify a stored session is still alive before reusing its mcp.url.
async function getSession(apiKey, sessionId) {
  return composioRequest(apiKey, 'GET', `/api/v3/tool_router/session/${encodeURIComponent(sessionId)}`);
}

// POST /api/v3/tool_router/session/{session_id}/link
// → { link_token, redirect_url, connected_account_id }
async function createLink(apiKey, sessionId, { toolkit, callbackUrl, alias }) {
  if (!sessionId) throw new Error('sessionId required');
  if (!toolkit) throw new Error('toolkit required');
  const body = { toolkit };
  if (callbackUrl) body.callback_url = callbackUrl;
  if (alias) body.alias = alias;
  const data = await composioRequest(apiKey, 'POST', `/api/v3/tool_router/session/${encodeURIComponent(sessionId)}/link`, body);
  return {
    linkToken: data.link_token,
    redirectUrl: data.redirect_url,
    connectedAccountId: data.connected_account_id,
  };
}

// GET /api/v3/connected_accounts?user_ids=...&statuses=...
// → list of { id, toolkit_slug, status, ... }
//
// IMPORTANT: array query params follow OpenAPI exploded form — multiple
// `?user_ids=A&user_ids=B`, NOT JSON-stringified `?user_ids=["A","B"]`.
// Composio silently returns 0 results for the JSON form.
async function listConnectedAccounts(apiKey, { userId, statuses, limit }) {
  const qs = new URLSearchParams();
  if (userId) qs.append('user_ids', String(userId));
  if (Array.isArray(statuses)) {
    for (const s of statuses) qs.append('statuses', String(s));
  }
  if (limit) qs.set('limit', String(limit));
  const path = `/api/v3/connected_accounts${qs.toString() ? `?${qs}` : ''}`;
  const data = await composioRequest(apiKey, 'GET', path);
  // Normalize: openapi shows `items` array; tolerate either shape.
  // Composio's v3 response shape: { toolkit: { slug }, auth_config, id, user_id, status, created_at, ... }
  // Older shape may have toolkit_slug/toolkit_name flat — keep those as fallbacks.
  const items = Array.isArray(data) ? data : (data?.items || data?.data || []);
  return items.map((it) => {
    const slug = (typeof it?.toolkit === 'object' && it.toolkit?.slug)
      || (typeof it?.toolkit === 'string' ? it.toolkit : null)
      || it?.toolkit_slug
      || null;
    const name = (typeof it?.toolkit === 'object' && (it.toolkit?.name || it.toolkit?.label))
      || it?.toolkit_name
      || slug;
    return {
      id: it.id || it.nano_id || it.nanoId,
      toolkit: slug,
      toolkitName: name,
      status: it.status,
      userId: it.user_id || it.userId,
      createdAt: it.created_at || it.createdAt,
      authConfigId: it?.auth_config?.id || it.auth_config_id || it.authConfigId,
    };
  });
}

// GET /api/v3/connected_accounts/{id}/status
async function getConnectionStatus(apiKey, connectedAccountId) {
  return composioRequest(apiKey, 'GET', `/api/v3/connected_accounts/${encodeURIComponent(connectedAccountId)}/status`);
}

// DELETE /api/v3/connected_accounts/{id}
async function deleteConnectedAccount(apiKey, connectedAccountId) {
  return composioRequest(apiKey, 'DELETE', `/api/v3/connected_accounts/${encodeURIComponent(connectedAccountId)}`);
}

// GET /api/v3/tool_router/session/{session_id}/toolkits
// Returns the toolkits enabled in the session (post-allowlist filter).
async function listSessionToolkits(apiKey, sessionId) {
  const data = await composioRequest(apiKey, 'GET', `/api/v3/tool_router/session/${encodeURIComponent(sessionId)}/toolkits`);
  const items = Array.isArray(data) ? data : (data?.items || data?.toolkits || []);
  return items;
}

// Build the MCP pool spec for a composio connection. Session URL embeds
// authorization, so we don't need credentials/headers on the MCP layer.
function buildMcpSpec(metadata) {
  const url = metadata?.composio?.mcpUrl;
  if (!url) throw new Error('Composio session not initialized — no mcpUrl in metadata');
  return {
    transport: 'http',
    url,
    headers: {},
    credentials: '',
  };
}

module.exports = {
  createSession,
  getSession,
  createLink,
  listConnectedAccounts,
  getConnectionStatus,
  deleteConnectedAccount,
  listSessionToolkits,
  buildMcpSpec,
  BASE_URL,
};
