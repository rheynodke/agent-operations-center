// server/lib/connections/mcp-oauth.cjs
//
// OAuth flow for MCP connections that advertise an authorization server via
// .well-known/oauth-authorization-server (MCP spec 2025-03-26).
//
// Mirrors the google-workspace module: AOC is the OAuth client, credentials
// live encrypted in the connection's credentials column, metadata carries the
// public authState + endpoint URLs + clientId. Works with dashboard tunneling
// because the redirect_uri uses cfg.PUBLIC_URL, not localhost.
//
// Token shape (credentials JSON):
//   { accessToken, refreshToken, expiresAt, tokenType, clientSecret?, pkceVerifier? }
//
// Metadata oauth shape:
//   metadata.oauth = {
//     authState: 'pending' | 'connected' | 'expired' | 'disconnected',
//     serverUrl,                       // MCP endpoint (same as metadata.url)
//     authorizationEndpoint,
//     tokenEndpoint,
//     registrationEndpoint?,           // DCR endpoint if advertised
//     clientId,
//     scopes,                          // granted scopes
//     requestedScopes,                 // what we asked for
//     connectedAt, lastRefreshAt
//   }

'use strict';
const crypto = require('node:crypto');
const g = require('../oauth/google.cjs'); // reuse signStateJwt / verifyStateJwt / generatePkce
const cfg = require('../config.cjs');
const db = require('../db.cjs');

const STATE_TTL_SECONDS = 10 * 60;
const CLIENT_NAME = 'AOC Dashboard';
const CLIENT_URI = 'https://github.com/anthropics/claude-code'; // identifier only — not a real page
const DEFAULT_SCOPE = null; // let the server decide; some return default scopes

function redirectUri() {
  const base = (cfg.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('PUBLIC_URL is not configured — required for OAuth redirect');
  return `${base}/api/connections/mcp/oauth/callback`;
}

function stateSecret() {
  return cfg.GOOGLE_OAUTH_STATE_SECRET || process.env.DASHBOARD_TOKEN || 'aoc-mcp-oauth';
}

// ── Discovery + DCR ─────────────────────────────────────────────────────────
// Use the MCP SDK's ESM-only discovery helpers via dynamic import (they are
// plain fetch calls underneath; we wrap in try/catch to give better errors).
async function discoverAuthServer(mcpServerUrl) {
  const url = new URL(mcpServerUrl);
  // Try MCP's canonical metadata path first: .well-known on the server's origin
  const wellKnown = `${url.origin}/.well-known/oauth-authorization-server`;
  const res = await fetch(wellKnown, { headers: { 'MCP-Protocol-Version': '2025-03-26' } });
  if (!res.ok) {
    const body = await safeText(res);
    const err = new Error(`Failed to discover OAuth metadata from ${wellKnown}: HTTP ${res.status} ${body.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }
  const meta = await res.json();
  // Validate minimum fields we need
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error('OAuth metadata missing authorization_endpoint or token_endpoint');
  }
  return {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint || null,
    revocationEndpoint: meta.revocation_endpoint || null,
    scopesSupported: meta.scopes_supported || null,
    // Stored for debugging
    _raw: meta,
  };
}

async function registerClient(registrationEndpoint, { scopes }) {
  if (!registrationEndpoint) {
    throw new Error('This MCP server does not advertise a Dynamic Client Registration endpoint. Register a client manually and pre-fill clientId in metadata.oauth.');
  }
  const body = {
    client_name: CLIENT_NAME,
    redirect_uris: [redirectUri()],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // public client + PKCE; most MCP servers accept this
    application_type: 'web',
  };
  if (scopes && scopes.length) body.scope = scopes.join(' ');

  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`DCR failed: HTTP ${res.status} ${data.error_description || data.error || ''}`);
    err.status = 502;
    err.body = data;
    throw err;
  }
  if (!data.client_id) {
    throw new Error('DCR response missing client_id');
  }
  return {
    clientId: data.client_id,
    clientSecret: data.client_secret || null, // null = public client
    registeredAt: Date.now(),
  };
}

// ── Auth URL + callback ─────────────────────────────────────────────────────

/**
 * Begin an OAuth flow for an existing MCP connection. Discovers metadata,
 * registers a client if needed (DCR), generates PKCE + state, persists
 * verifier + OAuth endpoint info into the connection, returns the authUrl.
 */
async function beginAuth(connectionId, { requestedScopes = [] } = {}) {
  const conn = db.getConnectionRaw(connectionId);
  if (!conn || conn.type !== 'mcp') {
    const e = new Error('Connection not found or wrong type'); e.status = 404; throw e;
  }
  const meta = conn.metadata || {};
  const serverUrl = meta.url;
  if (!serverUrl) {
    const e = new Error('MCP connection missing url in metadata'); e.status = 400; throw e;
  }

  // Discover + DCR if we don't already have a clientId
  let oauthMeta = meta.oauth || {};
  if (!oauthMeta.authorizationEndpoint || !oauthMeta.tokenEndpoint) {
    const discovered = await discoverAuthServer(serverUrl);
    oauthMeta = {
      ...oauthMeta,
      authorizationEndpoint: discovered.authorizationEndpoint,
      tokenEndpoint: discovered.tokenEndpoint,
      registrationEndpoint: discovered.registrationEndpoint,
      revocationEndpoint: discovered.revocationEndpoint,
      scopesSupported: discovered.scopesSupported,
    };
  }

  // Existing credentials (so we can stash clientSecret in the same record)
  let creds = {};
  try { creds = conn.credentials ? JSON.parse(conn.credentials) : {}; } catch {}

  if (!oauthMeta.clientId) {
    const registered = await registerClient(oauthMeta.registrationEndpoint, {
      scopes: requestedScopes,
    });
    oauthMeta.clientId = registered.clientId;
    oauthMeta.registeredAt = registered.registeredAt;
    if (registered.clientSecret) creds.clientSecret = registered.clientSecret;
  }

  const { verifier, challenge } = g.generatePkce();
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = g.signStateJwt({ connectionId, nonce }, stateSecret(), STATE_TTL_SECONDS);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: oauthMeta.clientId,
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (requestedScopes.length) params.set('scope', requestedScopes.join(' '));
  // MCP spec-defined resource parameter (RFC 8707)
  params.set('resource', serverUrl);

  const authUrl = `${oauthMeta.authorizationEndpoint}?${params.toString()}`;

  // Persist updated oauth meta + PKCE verifier
  oauthMeta.authState = 'pending';
  oauthMeta.requestedScopes = requestedScopes;
  oauthMeta.serverUrl = serverUrl;
  creds.pkceVerifier = verifier;
  db.updateConnection(connectionId, {
    metadata: { ...meta, oauth: oauthMeta },
    credentials: JSON.stringify(creds),
  });

  return { authUrl };
}

/**
 * Called from the public callback route. Verifies state, exchanges code,
 * persists tokens. Returns the connection id.
 */
async function completeAuth({ stateToken, code }) {
  let payload;
  try { payload = g.verifyStateJwt(stateToken, stateSecret()); }
  catch (err) { const e = new Error(`State verification failed: ${err.message}`); e.status = 400; throw e; }

  const { connectionId } = payload;
  const conn = db.getConnectionRaw(connectionId);
  if (!conn || conn.type !== 'mcp') {
    const e = new Error('Connection not found or wrong type'); e.status = 404; throw e;
  }
  const meta = conn.metadata || {};
  const oauthMeta = meta.oauth || {};
  if (!oauthMeta.tokenEndpoint || !oauthMeta.clientId) {
    const e = new Error('OAuth not initialized for this connection'); e.status = 400; throw e;
  }

  let creds = {};
  try { creds = conn.credentials ? JSON.parse(conn.credentials) : {}; } catch {}
  const verifier = creds.pkceVerifier;
  if (!verifier) {
    const e = new Error('Missing PKCE verifier; begin auth first'); e.status = 400; throw e;
  }

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: oauthMeta.clientId,
    code_verifier: verifier,
  });
  if (creds.clientSecret) body.set('client_secret', creds.clientSecret);

  const res = await fetch(oauthMeta.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Token exchange failed: HTTP ${res.status}`);
    err.status = 400; err.body = data; throw err;
  }

  const now = Date.now();
  const expiresAt = data.expires_in ? now + (data.expires_in * 1000) : null;

  // Persist
  const nextCreds = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken || null,
    expiresAt,
    tokenType: data.token_type || 'Bearer',
    clientSecret: creds.clientSecret || null,
    // pkceVerifier intentionally dropped
  };
  const nextOauth = {
    ...oauthMeta,
    authState: 'connected',
    scopes: data.scope ? data.scope.split(' ') : oauthMeta.requestedScopes || [],
    connectedAt: now,
    lastRefreshAt: now,
  };
  db.updateConnection(connectionId, {
    metadata: { ...meta, oauth: nextOauth },
    credentials: JSON.stringify(nextCreds),
  });

  return connectionId;
}

// ── Access token dispenser (used by the pool) ───────────────────────────────

/**
 * Return a non-expired access token for a connection. Refreshes via refresh
 * token if the cached access token is missing or within the skew window.
 * Marks the connection as 'expired' and throws if refresh fails.
 */
async function getAccessToken(connectionId, { skewMs = 60_000 } = {}) {
  const conn = db.getConnectionRaw(connectionId);
  if (!conn || conn.type !== 'mcp') {
    throw new Error('Connection not found or wrong type');
  }
  const meta = conn.metadata || {};
  const oauthMeta = meta.oauth || {};
  let creds = {};
  try { creds = conn.credentials ? JSON.parse(conn.credentials) : {}; } catch {}

  const now = Date.now();
  const stillValid =
    creds.accessToken &&
    (!creds.expiresAt || creds.expiresAt > now + skewMs);

  if (stillValid) return creds.accessToken;

  // Need a refresh
  if (!creds.refreshToken || !oauthMeta.tokenEndpoint || !oauthMeta.clientId) {
    const err = new Error('Re-authentication required — no refresh token available');
    err.code = 're_auth_required';
    markExpired(connectionId);
    throw err;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: oauthMeta.clientId,
  });
  if (creds.clientSecret) body.set('client_secret', creds.clientSecret);

  const res = await fetch(oauthMeta.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    markExpired(connectionId);
    const err = new Error(`Refresh failed: ${data.error_description || data.error || res.status}`);
    err.code = 're_auth_required';
    throw err;
  }

  const newExpiresAt = data.expires_in ? now + (data.expires_in * 1000) : null;
  const nextCreds = {
    ...creds,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken, // rotating refresh tokens supported
    expiresAt: newExpiresAt,
    tokenType: data.token_type || 'Bearer',
  };
  const nextOauth = { ...oauthMeta, authState: 'connected', lastRefreshAt: now };
  db.updateConnection(connectionId, {
    metadata: { ...meta, oauth: nextOauth },
    credentials: JSON.stringify(nextCreds),
  });

  return data.access_token;
}

function markExpired(connectionId) {
  const conn = db.getConnection(connectionId);
  if (!conn) return;
  const meta = conn.metadata || {};
  const oauthMeta = meta.oauth || {};
  db.updateConnection(connectionId, {
    metadata: { ...meta, oauth: { ...oauthMeta, authState: 'expired' } },
  });
}

async function disconnect(connectionId) {
  const conn = db.getConnectionRaw(connectionId);
  if (!conn || conn.type !== 'mcp') return;
  const meta = conn.metadata || {};
  const oauthMeta = meta.oauth || {};

  let creds = {};
  try { creds = conn.credentials ? JSON.parse(conn.credentials) : {}; } catch {}

  // Best-effort revoke
  if (oauthMeta.revocationEndpoint && creds.accessToken) {
    try {
      const body = new URLSearchParams({ token: creds.accessToken, client_id: oauthMeta.clientId || '' });
      if (creds.clientSecret) body.set('client_secret', creds.clientSecret);
      await fetch(oauthMeta.revocationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {}
  }

  // Clear tokens; keep clientId + endpoints so next connect skips DCR
  db.updateConnection(connectionId, {
    metadata: { ...meta, oauth: { ...oauthMeta, authState: 'disconnected', lastRefreshAt: null } },
    credentials: JSON.stringify({ clientSecret: creds.clientSecret || null }),
  });
}

// ── Internal utilities ──────────────────────────────────────────────────────
async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

module.exports = {
  redirectUri,
  beginAuth,
  completeAuth,
  getAccessToken,
  disconnect,
  markExpired,
  // Exposed for tests / debugging only
  _discoverAuthServer: discoverAuthServer,
  _registerClient: registerClient,
};
