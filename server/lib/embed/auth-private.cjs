'use strict';

const jwt = require('jsonwebtoken');

/**
 * Maximum allowed seconds between "now" and the token's `exp` claim.
 * 5 minutes + 30 seconds clock skew tolerance.
 */
const MAX_EXP_WINDOW_SECONDS = 5 * 60 + 30;

/**
 * Verify a private-mode embed JWT signed with HS256.
 *
 * Returns `{ ok: true, claims }` on success, or `{ ok: false, reason, detail? }` on failure.
 *
 * Failure reasons:
 *   - 'missing_input'      — token or secret is falsy
 *   - 'expired'            — TokenExpiredError from jsonwebtoken
 *   - 'invalid_signature'  — signature mismatch (wrong secret or tampered payload)
 *   - 'invalid_token'      — any other JsonWebTokenError (malformed, wrong algorithm, etc.)
 *   - 'missing_visitor_id' — token is structurally valid but lacks the `visitor_id` claim
 *   - 'exp_too_far'        — `exp - now > MAX_EXP_WINDOW_SECONDS` (long-lived token blocked)
 *
 * Algorithm allowlist is strictly `['HS256']` to prevent algorithm confusion attacks
 * (e.g. a token signed with HS512, RS256, or `alg: none` will be rejected here).
 *
 * @param {string} token  - raw JWT string
 * @param {string} secret - HMAC secret used to sign the token
 * @returns {{ ok: boolean, claims?: object, reason?: string, detail?: string }}
 */
function verifyPrivateJwt(token, secret) {
  if (!token || !secret) return { ok: false, reason: 'missing_input' };

  let claims;
  try {
    claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return { ok: false, reason: 'expired' };
    }
    if (e.name === 'JsonWebTokenError' && /signature/.test(e.message)) {
      return { ok: false, reason: 'invalid_signature' };
    }
    return { ok: false, reason: 'invalid_token', detail: e.message };
  }

  if (!claims.visitor_id) {
    return { ok: false, reason: 'missing_visitor_id' };
  }

  if (claims.exp) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.exp - nowSec > MAX_EXP_WINDOW_SECONDS) {
      return { ok: false, reason: 'exp_too_far' };
    }
  }

  return { ok: true, claims };
}

module.exports = { verifyPrivateJwt, MAX_EXP_WINDOW_SECONDS };
