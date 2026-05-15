'use strict';
const crypto = require('node:crypto');

const GOOGLE_BASE = 'https://www.googleapis.com/auth/';

// Short-name → full URL. Short names are what the UI/API accepts.
const SCOPE_ALIASES = {
  'drive.file': GOOGLE_BASE + 'drive.file',
  'drive': GOOGLE_BASE + 'drive',
  'docs': GOOGLE_BASE + 'documents',
  'spreadsheets': GOOGLE_BASE + 'spreadsheets',
  'presentations': GOOGLE_BASE + 'presentations',
  'gmail.send': GOOGLE_BASE + 'gmail.send',
  'gmail.readonly': GOOGLE_BASE + 'gmail.readonly',
  'gmail.modify': GOOGLE_BASE + 'gmail.modify',
  'gmail.labels': GOOGLE_BASE + 'gmail.labels',
  'gmail.compose': GOOGLE_BASE + 'gmail.compose',
  'gmail.metadata': GOOGLE_BASE + 'gmail.metadata',
  'calendar': GOOGLE_BASE + 'calendar',
  'calendar.readonly': GOOGLE_BASE + 'calendar.readonly',
  'forms.body': GOOGLE_BASE + 'forms.body',
  'forms.body.readonly': GOOGLE_BASE + 'forms.body.readonly',
  'forms.responses.readonly': GOOGLE_BASE + 'forms.responses.readonly',
  'tasks': GOOGLE_BASE + 'tasks',
  'tasks.readonly': GOOGLE_BASE + 'tasks.readonly',
  'keep': GOOGLE_BASE + 'keep',
  'keep.readonly': GOOGLE_BASE + 'keep.readonly',
  'meetings.space.created': GOOGLE_BASE + 'meetings.space.created',
  'meetings.space.readonly': GOOGLE_BASE + 'meetings.space.readonly',
  'meetings.space.settings': GOOGLE_BASE + 'meetings.space.settings',
};

const ALWAYS_INCLUDED = ['openid', 'email']; // for linkedEmail extraction

// NOTE on `keep` scopes: Google Keep API does NOT support 3-legged user OAuth
// regardless of account type. Per Google's docs, Keep is admin-tier and
// requires service account + domain-wide delegation in a Workspace org. The
// scope aliases below are kept for advanced (service-account based) skills,
// but DO NOT include them in any user-OAuth preset — Google's authorization
// server returns `invalid_scope` and the entire reconnect flow fails.
const SCOPE_PRESETS = {
  'prd-writer':      ['drive.file', 'docs'],
  'sheets-analyst':  ['drive.file', 'spreadsheets'],
  'full-workspace':  ['drive', 'docs', 'spreadsheets', 'presentations',
                      'calendar', 'forms.body', 'forms.responses.readonly',
                      'tasks',
                      'meetings.space.created',
                      'gmail.modify'],
  'custom':          [], // filled by caller (Keep scopes excluded — see note above)
};

function expandScope(shortName) {
  if (shortName === 'openid' || shortName === 'email' || shortName === 'profile') return shortName;
  const full = SCOPE_ALIASES[shortName];
  if (!full) throw new Error(`Unknown scope alias: ${shortName}`);
  return full;
}

function buildScopes(preset, customList = []) {
  if (!(preset in SCOPE_PRESETS)) throw new Error(`Unknown preset: ${preset}`);
  const base = preset === 'custom' ? customList : SCOPE_PRESETS[preset];
  const all = [...ALWAYS_INCLUDED, ...base.map(expandScope)];
  return Array.from(new Set(all));
}

// ── Base64URL helpers ────────────────────────────────────────────────────────
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

// ── State JWT (HS256, minimal self-contained impl) ───────────────────────────
function signStateJwt(payload, secret, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64urlEncode(sig)}`;
}

function verifyStateJwt(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const [h, p, s] = parts;
  const expected = b64urlEncode(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) {
    throw new Error('Invalid signature');
  }
  const body = JSON.parse(b64urlDecode(p).toString('utf-8'));
  if (typeof body.exp !== 'number' || body.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return body;
}

// ── PKCE ─────────────────────────────────────────────────────────────────────
function generatePkce() {
  const verifier = b64urlEncode(crypto.randomBytes(32)); // 43-char base64url
  const challenge = b64urlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

// ── Auth URL ─────────────────────────────────────────────────────────────────
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

function generateAuthUrl({ clientId, redirectUri, scopes, state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ── Token endpoint ───────────────────────────────────────────────────────────
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

async function postForm(url, params, { fetch: fetchFn = fetch } = {}) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  let data;
  if (typeof res.json === 'function') {
    try { data = await res.json(); }
    catch {
      const text = typeof res.text === 'function' ? await res.text() : '';
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
  } else {
    const text = typeof res.text === 'function' ? await res.text() : '';
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `HTTP ${res.status}`);
    err.code = data.error || `http_${res.status}`;
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function decodeIdTokenEmail(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf-8'));
    return payload.email || null;
  } catch {
    return null;
  }
}

async function exchangeCode({ clientId, clientSecret, code, codeVerifier, redirectUri }, opts = {}) {
  const data = await postForm(TOKEN_ENDPOINT, {
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  }, opts);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || '',
    linkedEmail: decodeIdTokenEmail(data.id_token),
    idToken: data.id_token || null,
  };
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken }, opts = {}) {
  const data = await postForm(TOKEN_ENDPOINT, {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }, opts);
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || '',
    refreshToken: data.refresh_token || refreshToken,
  };
}

async function revokeToken(token, { fetch: fetchFn = fetch } = {}) {
  const url = `${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`;
  const res = await fetchFn(url, { method: 'POST' });
  return { ok: res.ok, status: res.status };
}

module.exports = {
  SCOPE_PRESETS, SCOPE_ALIASES,
  buildScopes, signStateJwt, verifyStateJwt,
  generatePkce, generateAuthUrl,
  exchangeCode, refreshAccessToken, revokeToken, decodeIdTokenEmail,
};
