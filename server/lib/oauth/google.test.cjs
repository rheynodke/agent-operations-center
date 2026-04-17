'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const g = require('./google.cjs');

test('SCOPE_PRESETS contains 4 presets', () => {
  assert.deepStrictEqual(Object.keys(g.SCOPE_PRESETS).sort(),
    ['custom', 'full-workspace', 'prd-writer', 'sheets-analyst']);
});

test('buildScopes returns preset scopes', () => {
  const s = g.buildScopes('prd-writer');
  assert.ok(s.includes('https://www.googleapis.com/auth/documents'));
  assert.ok(s.includes('https://www.googleapis.com/auth/drive.file'));
  assert.ok(s.includes('openid'));
  assert.ok(s.includes('email'));
});

test('buildScopes with custom returns union', () => {
  const s = g.buildScopes('custom', ['gmail.send', 'calendar']);
  assert.ok(s.includes('https://www.googleapis.com/auth/gmail.send'));
  assert.ok(s.includes('https://www.googleapis.com/auth/calendar'));
});

test('buildScopes rejects unknown preset', () => {
  assert.throws(() => g.buildScopes('bogus'), /Unknown preset/);
});

test('signStateJwt and verifyStateJwt roundtrip', () => {
  const secret = 'test-secret';
  const payload = { connectionId: 'c1', userId: 'u1', nonce: 'abc' };
  const token = g.signStateJwt(payload, secret, 600);
  const decoded = g.verifyStateJwt(token, secret);
  assert.strictEqual(decoded.connectionId, 'c1');
  assert.strictEqual(decoded.userId, 'u1');
  assert.strictEqual(decoded.nonce, 'abc');
});

test('verifyStateJwt rejects bad signature', () => {
  const token = g.signStateJwt({ x: 1 }, 'secret-a', 600);
  assert.throws(() => g.verifyStateJwt(token, 'secret-b'), /signature/i);
});

test('verifyStateJwt rejects expired token', () => {
  const token = g.signStateJwt({ x: 1 }, 's', -10); // already expired
  assert.throws(() => g.verifyStateJwt(token, 's'), /expired/i);
});

test('generatePkce returns verifier and S256 challenge', () => {
  const { verifier, challenge, method } = g.generatePkce();
  assert.strictEqual(method, 'S256');
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.ok(challenge.length > 0);
});

test('generateAuthUrl includes all required params', () => {
  const url = g.generateAuthUrl({
    clientId: 'cid.apps.googleusercontent.com',
    redirectUri: 'https://example.dev/api/connections/google/callback',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/documents'],
    state: 'abc.def.ghi',
    codeChallenge: 'challenge123',
  });
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.strictEqual(u.searchParams.get('client_id'), 'cid.apps.googleusercontent.com');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://example.dev/api/connections/google/callback');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('access_type'), 'offline');
  assert.strictEqual(u.searchParams.get('prompt'), 'consent');
  assert.strictEqual(u.searchParams.get('include_granted_scopes'), 'true');
  assert.strictEqual(u.searchParams.get('code_challenge'), 'challenge123');
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(u.searchParams.get('state'), 'abc.def.ghi');
  assert.ok(u.searchParams.get('scope').includes('openid'));
});

test('decodeIdTokenEmail extracts email claim', () => {
  // Manually build an unsigned id_token-like string (middle segment is what matters)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ email: 'pm@dke.co.id', email_verified: true, sub: '123' })).toString('base64url');
  const idToken = `${header}.${payload}.fake-sig`;
  assert.strictEqual(g.decodeIdTokenEmail(idToken), 'pm@dke.co.id');
});

test('decodeIdTokenEmail returns null on malformed input', () => {
  assert.strictEqual(g.decodeIdTokenEmail('nope'), null);
  assert.strictEqual(g.decodeIdTokenEmail(''), null);
  assert.strictEqual(g.decodeIdTokenEmail(null), null);
});

test('exchangeCode posts correct body and returns tokens', async () => {
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'at', refresh_token: 'rt', expires_in: 3600,
        token_type: 'Bearer', scope: 'openid email',
        id_token: `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ email: 'x@y.z' })).toString('base64url')}.sig`,
      }),
      text: async () => '',
    };
  };
  const result = await g.exchangeCode({
    clientId: 'cid', clientSecret: 'sec', code: 'c', codeVerifier: 'v',
    redirectUri: 'https://r.example',
  }, { fetch: mockFetch });
  assert.strictEqual(result.accessToken, 'at');
  assert.strictEqual(result.refreshToken, 'rt');
  assert.strictEqual(result.linkedEmail, 'x@y.z');
  assert.strictEqual(calls[0].url, 'https://oauth2.googleapis.com/token');
  const bodyParams = new URLSearchParams(calls[0].opts.body);
  assert.strictEqual(bodyParams.get('grant_type'), 'authorization_code');
  assert.strictEqual(bodyParams.get('code'), 'c');
  assert.strictEqual(bodyParams.get('code_verifier'), 'v');
});

test('refreshAccessToken posts refresh grant', async () => {
  const mockFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ access_token: 'at2', expires_in: 3600, token_type: 'Bearer' }),
    text: async () => '',
  });
  const r = await g.refreshAccessToken({
    clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt',
  }, { fetch: mockFetch });
  assert.strictEqual(r.accessToken, 'at2');
});

test('refreshAccessToken throws with code on invalid_grant', async () => {
  const mockFetch = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: 'invalid_grant', error_description: 'Token revoked' }),
    text: async () => '',
  });
  await assert.rejects(
    g.refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }, { fetch: mockFetch }),
    (err) => err.code === 'invalid_grant'
  );
});

test('revokeToken posts to revoke endpoint', async () => {
  const calls = [];
  const mockFetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, text: async () => '' }; };
  await g.revokeToken('some-token', { fetch: mockFetch });
  assert.ok(calls[0].url.startsWith('https://oauth2.googleapis.com/revoke'));
});
