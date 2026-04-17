// server/lib/connections/google-workspace.cjs
'use strict';
const crypto = require('node:crypto');
const path = require('path');
const g = require('../oauth/google.cjs');
const cfg = require('../config.cjs');
const db = require('../db.cjs');

const STATE_TTL_SECONDS = 10 * 60;

function redirectUri() {
  const base = cfg.PUBLIC_URL.replace(/\/+$/, '');
  return `${base}/api/connections/google/callback`;
}

function assertConfigured() {
  if (!cfg.GOOGLE_OAUTH_CONFIGURED) {
    const err = new Error('Google Workspace connections not configured');
    err.code = 'not_configured';
    err.status = 503;
    throw err;
  }
}

/**
 * Build the authorization URL and temporary state for a new or re-auth flow.
 * Returns { authUrl, codeVerifier, scopes } — caller persists codeVerifier in metadata.
 */
function beginAuth({ connectionId, userId, preset, customScopes }) {
  assertConfigured();
  const scopes = g.buildScopes(preset, customScopes || []);
  const { verifier, challenge } = g.generatePkce();
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = g.signStateJwt(
    { connectionId, userId, nonce },
    cfg.GOOGLE_OAUTH_STATE_SECRET,
    STATE_TTL_SECONDS
  );
  const authUrl = g.generateAuthUrl({
    clientId: cfg.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri: redirectUri(),
    scopes,
    state,
    codeChallenge: challenge,
  });
  return { authUrl, codeVerifier: verifier, scopes };
}

/**
 * Complete the OAuth callback: verify state, exchange code, persist tokens.
 * Returns the updated connection.
 */
async function completeAuth({ stateToken, code }) {
  assertConfigured();
  let statePayload;
  try {
    statePayload = g.verifyStateJwt(stateToken, cfg.GOOGLE_OAUTH_STATE_SECRET);
  } catch (err) {
    const e = new Error(`State verification failed: ${err.message}`);
    e.status = 400;
    throw e;
  }
  const { connectionId } = statePayload;
  const conn = db.getConnectionRaw(connectionId);
  if (!conn || conn.type !== 'google_workspace') {
    const e = new Error('Connection not found or wrong type');
    e.status = 404;
    throw e;
  }
  const meta = conn.metadata || {};
  const codeVerifier = meta._pkceVerifier;
  if (!codeVerifier) {
    const e = new Error('Missing PKCE verifier; auth URL expired');
    e.status = 400;
    throw e;
  }

  const tokens = await g.exchangeCode({
    clientId: cfg.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: cfg.GOOGLE_OAUTH_CLIENT_SECRET,
    code,
    codeVerifier,
    redirectUri: redirectUri(),
  });

  const newMeta = {
    ...meta,
    linkedEmail: tokens.linkedEmail || meta.linkedEmail || null,
    scopes: tokens.scope ? tokens.scope.split(' ') : meta.scopes || [],
    authState: 'connected',
    connectedAt: Date.now(),
    lastRefreshAt: Date.now(),
  };
  delete newMeta._pkceVerifier;

  const credsJson = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType,
  });

  db.updateConnection(connectionId, { credentials: credsJson, metadata: newMeta });
  return db.getConnection(connectionId);
}

/**
 * Return a valid access token for the connection, refreshing lazily if needed.
 * Throws with status 410 if the refresh token is revoked.
 */
async function dispenseToken(connectionId) {
  assertConfigured();
  const conn = db.getConnectionRaw(connectionId);
  if (!conn || conn.type !== 'google_workspace') {
    const e = new Error('Connection not found'); e.status = 404; throw e;
  }
  const meta = conn.metadata || {};
  if (meta.authState !== 'connected') {
    const e = new Error(`Connection is ${meta.authState || 'not connected'}`);
    e.status = 410; e.code = meta.authState || 'not_connected';
    throw e;
  }
  let creds;
  try { creds = JSON.parse(conn.credentials || '{}'); }
  catch { creds = {}; }
  if (!creds.refreshToken) {
    const e = new Error('No refresh token stored'); e.status = 500; throw e;
  }

  // Skew: refresh if token expires in <60s
  if (!creds.expiresAt || creds.expiresAt - 60_000 < Date.now()) {
    let refreshed;
    try {
      refreshed = await g.refreshAccessToken({
        clientId: cfg.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: cfg.GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken: creds.refreshToken,
      });
    } catch (err) {
      if (err.code === 'invalid_grant') {
        db.updateConnection(connectionId, {
          metadata: { ...meta, authState: 'expired', lastHealthCheckAt: Date.now() }
        });
        const e = new Error('Refresh token revoked at Google'); e.status = 410; e.code = 'invalid_grant';
        throw e;
      }
      throw err;
    }
    creds = {
      ...creds,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      refreshToken: refreshed.refreshToken || creds.refreshToken,
    };
    db.updateConnection(connectionId, {
      credentials: JSON.stringify(creds),
      metadata: { ...meta, lastRefreshAt: Date.now() },
    });
  }

  return {
    accessToken: creds.accessToken,
    expiresAt: creds.expiresAt,
    expiresIn: Math.max(0, Math.floor((creds.expiresAt - Date.now()) / 1000)),
    scopes: meta.scopes || [],
  };
}

/** Best-effort revoke + remove credentials. If fullDelete=false, keep the row. */
async function disconnect(connectionId, { fullDelete = false } = {}) {
  const conn = db.getConnectionRaw(connectionId);
  if (!conn) return { ok: true, alreadyGone: true };
  let creds = {};
  try { creds = JSON.parse(conn.credentials || '{}'); } catch {}
  if (creds.refreshToken) {
    try { await g.revokeToken(creds.refreshToken); } catch (_) { /* best-effort */ }
  }
  if (fullDelete) {
    db.deleteConnection(connectionId);
  } else {
    const meta = conn.metadata || {};
    db.updateConnection(connectionId, {
      credentials: '',
      metadata: { ...meta, authState: 'disconnected', connectedAt: null },
    });
  }
  return { ok: true };
}

/** Silent refresh to detect revoked tokens. */
async function testConnection(connectionId) {
  try {
    await dispenseToken(connectionId);
    db.updateConnection(connectionId, {
      lastTestedAt: new Date().toISOString(),
      lastTestOk: true,
    });
    return { ok: true, authState: 'connected' };
  } catch (err) {
    const meta = (db.getConnectionRaw(connectionId) || {}).metadata || {};
    db.updateConnection(connectionId, {
      lastTestedAt: new Date().toISOString(),
      lastTestOk: false,
      metadata: { ...meta, lastHealthCheckAt: Date.now() },
    });
    return { ok: false, authState: meta.authState || 'unknown', error: err.message, code: err.code };
  }
}

/** Iterate all google_workspace connections and test each. Returns per-id results. */
async function runHealthCheckAll() {
  const all = db.getAllConnections();
  const targets = all.filter(c => c.type === 'google_workspace' && c.metadata?.authState === 'connected');
  const results = {};
  for (const c of targets) {
    results[c.id] = await testConnection(c.id);
  }
  return results;
}

module.exports = {
  redirectUri,
  beginAuth,
  completeAuth,
  dispenseToken,
  disconnect,
  testConnection,
  runHealthCheckAll,
};
