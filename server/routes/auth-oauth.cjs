'use strict';

/**
 * Google OAuth login + invitation-gated signup.
 *
 *   GET  /api/auth/google/url?intent=login|register&token=<inv?>
 *        → { url, state }
 *   GET  /api/auth/google/callback?code=...&state=...
 *        → HTML page that postMessages the result to window.opener
 *
 * Login: rejects if the Google email/sub is not already registered.
 * Register: requires a valid invitation token in the state; creates a new
 *           user keyed by google_sub + email.
 *
 * State map is in-memory (single AOC instance) with 10-min TTL. Each entry
 * carries the auth flow shape (intent, invitation token, PKCE verifier).
 */

const express = require('express');
const crypto = require('node:crypto');
const googleOAuth = require('../lib/oauth/google.cjs');
const { ensureUserGateway } = require('../lib/ensure-user-gateway.cjs');

const STATE_TTL_MS = 10 * 60 * 1000;
const ALLOWED_INTENTS = new Set(['login', 'register']);

function decodeIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const json = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function pkceVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}
function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function buildSlugFromEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const local = email.split('@')[0] || '';
  const slug = local.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30);
  return slug || null;
}

module.exports = function authOAuthRouter(deps) {
  const { db } = deps || {};
  const router = express.Router();

  const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 18800}/api/auth/google/callback`;
  const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('[auth-oauth] GOOGLE_OAUTH_CLIENT_ID/SECRET not set — Google sign-in disabled');
  }

  // In-memory state store. Map<stateId, { intent, invitationToken?, codeVerifier, createdAt }>
  const states = new Map();
  function pruneStates() {
    const now = Date.now();
    for (const [k, v] of states) if (now - v.createdAt > STATE_TTL_MS) states.delete(k);
  }
  setInterval(pruneStates, 60_000).unref();

  // ── 1. Generate authorize URL ──────────────────────────────────────────────
  router.get('/auth/google/url', (req, res) => {
    if (!CLIENT_ID) return res.status(503).json({ error: 'Google sign-in not configured on this server' });

    const intent = String(req.query.intent || 'login');
    if (!ALLOWED_INTENTS.has(intent)) return res.status(400).json({ error: 'invalid intent' });

    const invitationToken = intent === 'register' ? String(req.query.token || '') : null;
    if (intent === 'register' && !invitationToken) {
      return res.status(400).json({ error: 'invitation token is required for register intent' });
    }
    if (invitationToken) {
      const inv = db.getInvitationByToken(invitationToken);
      if (!inv) return res.status(404).json({ error: 'Invitation not found' });
      if (inv.revokedAt) return res.status(410).json({ error: 'Invitation revoked' });
      if (inv.expired)   return res.status(410).json({ error: 'Invitation expired' });
    }

    const stateId = crypto.randomBytes(24).toString('base64url');
    const codeVerifier = pkceVerifier();
    states.set(stateId, { intent, invitationToken, codeVerifier, createdAt: Date.now() });

    const url = googleOAuth.generateAuthUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      scopes: ['openid', 'email', 'profile'],
      state: stateId,
      codeChallenge: pkceChallenge(codeVerifier),
    });
    res.json({ url, state: stateId, expiresInMs: STATE_TTL_MS });
  });

  // ── 2. OAuth callback ──────────────────────────────────────────────────────
  router.get('/auth/google/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query || {};

    if (oauthError) return finishWithError(res, `Google cancelled: ${oauthError}`);
    if (!code || !state) return finishWithError(res, 'Missing code or state');

    const ctx = states.get(String(state));
    if (!ctx) return finishWithError(res, 'State expired or invalid — please retry');
    states.delete(String(state));

    let token;
    try {
      token = await googleOAuth.exchangeCode({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        code: String(code),
        codeVerifier: ctx.codeVerifier,
        redirectUri: REDIRECT_URI,
      });
    } catch (e) {
      console.error('[auth-oauth] code exchange failed:', e.message);
      return finishWithError(res, 'Code exchange failed');
    }

    // We need both `sub` (stable Google user id) and `email` from the id_token.
    const idPayload = decodeIdToken(token && token.idToken);
    const sub = idPayload?.sub;
    const email = idPayload?.email;
    const emailVerified = idPayload?.email_verified;
    const name = idPayload?.name || idPayload?.given_name || null;
    const picture = idPayload?.picture || null;

    if (!sub || !email) return finishWithError(res, 'Google did not return required identity claims');
    if (emailVerified === false) return finishWithError(res, 'Google email not verified — please verify it first');

    // ── LOGIN intent ─────────────────────────────────────────────────────────
    if (ctx.intent === 'login') {
      let user = db.getUserByGoogleSub(sub) || db.getUserByEmail(email);
      if (!user) {
        return finishWithError(res, 'Email belum terdaftar. Hubungi admin untuk invitation.');
      }
      // First-time link: user registered manually but signs in with Google for the first time.
      if (!user.google_sub) {
        try { db.linkGoogleIdentity(user.id, { sub, email }); user.google_sub = sub; user.email = email; }
        catch (e) { console.warn('[auth-oauth] linkGoogleIdentity failed:', e.message); }
      }
      try { await ensureUserGateway(user.id); } catch (e) {
        console.error(`[auth-oauth] gateway spawn failed uid=${user.id}: ${e.message}`);
      }
      db.updateLastLogin(user.id);
      return finishWithSession(res, user);
    }

    // ── REGISTER intent ──────────────────────────────────────────────────────
    if (ctx.intent === 'register') {
      // Re-validate invitation (could have expired between url + callback).
      const inv = db.getInvitationByToken(ctx.invitationToken);
      if (!inv) return finishWithError(res, 'Invitation tidak valid');
      if (inv.revokedAt) return finishWithError(res, 'Invitation sudah direvoke');
      if (inv.expired)   return finishWithError(res, 'Invitation sudah expired');

      // Refuse if Google identity already mapped to a user.
      if (db.getUserByGoogleSub(sub)) {
        return finishWithError(res, 'Akun Google ini sudah terdaftar — silakan login.');
      }
      if (db.getUserByEmail(email)) {
        return finishWithError(res, 'Email ini sudah terdaftar — silakan login.');
      }

      // Derive a unique username slug from the email local part.
      const baseSlug = buildSlugFromEmail(email) || 'user';
      let username = baseSlug;
      let suffix = 0;
      while (db.getUserByUsername(username)) {
        suffix += 1;
        username = `${baseSlug}${suffix}`;
        if (suffix > 999) return finishWithError(res, 'Tidak bisa generate username unik dari email ini');
      }

      let user;
      try {
        user = db.createGoogleUser({
          username,
          displayName: name || username,
          email,
          googleSub: sub,
          role: inv.defaultRole || 'user',
        });
      } catch (e) {
        return finishWithError(res, `Gagal membuat akun: ${e.message}`);
      }
      db.incrementInvitationUse(inv.id);

      try { await ensureUserGateway(user.id); } catch (e) {
        console.error(`[auth-oauth] gateway spawn failed for new uid=${user.id}: ${e.message}`);
      }

      console.log(`[auth-oauth] User "${username}" registered via Google (invitation #${inv.id}, email=${email})`);
      return finishWithSession(res, user);
    }

    return finishWithError(res, 'Unknown intent');
  });

  // ── helpers (closure: db, FRONTEND_ORIGIN) ────────────────────────────────
  function finishWithSession(res, user) {
    const jwtToken = db.generateToken(user);
    const masterAgentId = user.master_agent_id || null;
    const payload = {
      ok: true,
      token: jwtToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        canUseClaudeTerminal: Boolean(user.can_use_claude_terminal),
        hasMaster: Boolean(masterAgentId),
        masterAgentId,
        email: user.email || null,
      },
    };
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderCallbackHtml(payload));
  }

  function finishWithError(res, message) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(400).send(renderCallbackHtml({ ok: false, error: String(message) }));
  }

  function renderCallbackHtml(payload) {
    const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
    const allowedOrigin = JSON.stringify(FRONTEND_ORIGIN);
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Google Sign-In</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b0b14;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0}
.card{padding:24px 32px;border:1px solid #2a2a3a;border-radius:12px;text-align:center;max-width:360px}
h1{font-size:16px;margin:0 0 8px}p{font-size:13px;color:#94a3b8;margin:4px 0}</style>
</head><body>
<div class="card">
  <h1>${payload.ok ? '✅ Berhasil' : '❌ Gagal'}</h1>
  <p>${payload.ok ? 'Mengarahkan ke dashboard…' : (payload.error || 'Terjadi kesalahan')}</p>
</div>
<script>
(function(){
  var data = ${safeJson};
  var allowed = ${allowedOrigin};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'aoc-google-oauth', payload: data }, allowed);
      setTimeout(function(){ try { window.close(); } catch(_) {} }, ${payload.ok ? 400 : 2500});
    } else {
      // Direct navigation fallback (popup blocked)
      if (data.ok) {
        try { localStorage.setItem('aoc.googleOauthResult', JSON.stringify(data)); } catch(_) {}
        location.replace('/');
      }
    }
  } catch (e) { /* swallow */ }
})();
</script>
</body></html>`;
  }

  return router;
};
