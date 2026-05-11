// server/lib/embed/proxy.cjs
// Embed Gateway Proxy core — ties together kill switch + origin auth +
// rate limit + gateway forwarding + DLP egress filter + audit log.
//
// Pipeline order (must remain stable):
//   1  Token → embed lookup (401 if missing)
//   2  Kill switch (503 if disabled)
//   3  Origin check (403 if mismatch) + audit
//   4  Rate limit per-IP per-embed (429 if over) + audit
//   5  Session resolve/create
//   6  Gateway forward (503 if no gateway or error) + audit on error
//   7  DLP egress filter
//   8  Audit log for DLP action + optional stage-B failure
//   9  Bump session activity counters
//   10 Return { status, body }
'use strict';

const db = require('../db.cjs');
const ks = require('./kill-switch.cjs');
const om = require('./origin-matcher.cjs');
const ipHash = require('./ip-hash.cjs');
const rl = require('./rate-limit.cjs');
const dlp = require('./dlp/index.cjs');
const auditLog = require('./audit-log.cjs');

/**
 * Build a structured error response.
 * `body` key in extra will override the default body shape.
 */
function _err(status, code, message, extra = {}) {
  const defaultBody = { error: code, message };
  const { body: extraBody, ...rest } = extra;
  return { status, body: extraBody || defaultBody, code, ...rest };
}

/**
 * handleMessage — Embed Gateway Proxy entry point.
 *
 * @param {object} opts
 * @param {string}      opts.embedToken    — public embed token from widget
 * @param {string|null} opts.origin        — value of HTTP Origin header
 * @param {string}      opts.visitorUuid   — anonymous visitor UUID from widget cookie
 * @param {string}      opts.content       — visitor message text
 * @param {string}      opts.clientIp      — resolved client IP (after proxy header handling)
 * @param {object|null} [opts.jwtClaims]   — decoded private-mode JWT claims (visitor_id, name, email, role)
 * @param {object|null} [opts.dlpProvider] — DLP Stage B provider object
 * @param {object|null} [opts.gateway]     — gateway object with sendMessage(opts): Promise<{text,tokens}>
 * @param {string}      [opts.trafficType] — default traffic type ('production' | 'dev'); overridden if origin matched dev
 * @returns {Promise<{ status: number, body: object, code?: string }>}
 */
async function handleMessage({
  embedToken,
  origin,
  visitorUuid,
  content,
  clientIp,
  jwtClaims = null,
  dlpProvider = null,
  gateway = null,
  trafficType = 'production',
}) {
  // ─── Step 1: Resolve embed ───────────────────────────────────────────────
  const embed = db.getEmbedByToken(embedToken);
  if (!embed) {
    return _err(401, 'invalid_token', 'Embed token not recognized');
  }

  // Playground sessions (launched from AOC dashboard with verified owner JWT in /session)
  // bypass kill switch + origin check — owner authorization already proven upstream.
  const isPlayground = trafficType === 'playground';

  // ─── Step 2: Kill switch ─────────────────────────────────────────────────
  if (!isPlayground) {
    const killState = ks.isEnabled(embed.id);
    if (!killState.enabled) {
      const message = killState.disableMode === 'emergency'
        ? 'Service unavailable'
        : (embed.offlineMessage || 'This service is temporarily unavailable.');
      return {
        status: 503,
        code: 'embed_disabled',
        body: {
          error: 'embed_disabled',
          message,
          disable_mode: killState.disableMode,
        },
      };
    }
  }

  // ─── Step 3: Origin check ────────────────────────────────────────────────
  let originMatch = { matched: true, source: 'production' };
  if (!isPlayground) {
    originMatch = om.matchOrigin(origin, {
      productionOrigin: embed.productionOrigin,
      devOrigins: embed.devOrigins || [],
    });
    if (!originMatch.matched) {
      const ipH = ipHash.hashIp({ ip: clientIp, ownerId: embed.ownerId });
      auditLog.writeEvent({
        embedId: embed.id,
        ownerId: embed.ownerId,
        eventType: 'auth_fail',
        severity: 'warning',
        origin,
        ipHash: ipH,
        publicContextData: { reason: 'origin_mismatch' },
      });
      return _err(403, 'origin_not_allowed', 'This domain is not authorized');
    }
  }

  // ─── Step 4: Rate limit (per-IP per-embed) ───────────────────────────────
  const ipH = ipHash.hashIp({ ip: clientIp, ownerId: embed.ownerId });
  const rateLimitMax = embed.rateLimitPerIp != null ? embed.rateLimitPerIp : 60;
  const rlRes = rl.hit({
    scopeKey: `embed:${embed.id}:ip:${ipH}`,
    windowMs: 60_000,
    max: rateLimitMax,
  });
  if (!rlRes.allowed) {
    auditLog.writeEvent({
      embedId: embed.id,
      ownerId: embed.ownerId,
      eventType: 'rate_limit',
      severity: 'info',
      origin,
      ipHash: ipH,
      publicContextData: { count: rlRes.count, retryAfterMs: rlRes.retryAfterMs },
    });
    return _err(429, 'rate_limit', "You're sending messages too quickly. Please wait a moment.", {
      body: {
        error: 'rate_limit',
        message: "You're sending messages too quickly. Please wait a moment.",
        retry_after_ms: rlRes.retryAfterMs,
      },
    });
  }

  // ─── Step 5: Resolve session ─────────────────────────────────────────────
  const trafficSource = originMatch.source === 'dev' ? 'dev' : trafficType;
  const visitorMeta = jwtClaims
    ? { name: jwtClaims.name, email: jwtClaims.email, role: jwtClaims.role }
    : {};
  const visitorKey = jwtClaims?.visitor_id || visitorUuid;
  const session = db.createOrResumeSession({
    embedId: embed.id,
    visitorUuid: visitorKey,
    visitorMeta,
    gatewaySessionKey: `embed:${embed.id}:${visitorKey}`,
    trafficType: trafficSource,
    origin,
  });

  // ─── Step 6: Gateway forward ─────────────────────────────────────────────
  if (!gateway || typeof gateway.sendMessage !== 'function') {
    return _err(503, 'gateway_unavailable', 'Agent is currently unavailable. Try again shortly.');
  }

  let gatewayResp;
  try {
    gatewayResp = await gateway.sendMessage({
      sessionKey: session.gatewaySessionKey,
      ownerId: embed.ownerId,
      agentId: embed.agentId,
      content,
      visitorMeta,
    });
  } catch (e) {
    auditLog.writeEvent({
      embedId: embed.id,
      sessionId: session.id,
      ownerId: embed.ownerId,
      eventType: 'errors',
      severity: 'critical',
      origin,
      ipHash: ipH,
      publicContextData: { phase: 'gateway', error: e.message },
    });
    return _err(503, 'gateway_error', 'Agent is currently unavailable. Try again shortly.');
  }

  // ─── Step 7: DLP egress filter ───────────────────────────────────────────
  const dlpResult = await dlp.filter(gatewayResp.text || '', {
    preset: embed.dlpPreset,
    provider: dlpProvider,
    allowlistPatterns: embed.dlpAllowlistPatterns || [],
  });

  // ─── Step 8: Audit log based on DLP action ───────────────────────────────
  if (dlpResult.action === 'redact') {
    const hasCritical = dlpResult.redactions.some(r => r.severity === 'critical');
    auditLog.writeEvent({
      embedId: embed.id,
      sessionId: session.id,
      ownerId: embed.ownerId,
      eventType: 'dlp_redaction',
      severity: hasCritical ? 'critical' : 'warning',
      origin,
      ipHash: ipH,
      sensitiveContextData: {
        redactions: dlpResult.redactions.map(r => ({
          originalSnippet: r.match,
          reason: r.reason,
          severity: r.severity,
        })),
        responsePreview: (gatewayResp.text || '').slice(0, 200),
      },
      publicContextData: {
        redactionCount: dlpResult.redactions.length,
        stageBRan: dlpResult.stageBRan,
      },
    });
  } else if (dlpResult.action === 'block') {
    auditLog.writeEvent({
      embedId: embed.id,
      sessionId: session.id,
      ownerId: embed.ownerId,
      eventType: 'dlp_block',
      severity: 'critical',
      origin,
      ipHash: ipH,
      sensitiveContextData: { responsePreview: (gatewayResp.text || '').slice(0, 500) },
      publicContextData: { redactionCount: dlpResult.redactions.length },
    });
  } else {
    // action === 'pass'
    auditLog.writeEvent({
      embedId: embed.id,
      sessionId: session.id,
      ownerId: embed.ownerId,
      eventType: 'message',
      severity: 'info',
      origin,
      ipHash: ipH,
      publicContextData: {
        contentLength: content ? content.length : 0,
        responseLength: gatewayResp.text ? gatewayResp.text.length : 0,
        tokensIn: gatewayResp.tokens?.in || 0,
        tokensOut: gatewayResp.tokens?.out || 0,
      },
    });
  }

  // Stage B failure — secondary audit entry (only if Stage B ran and failed)
  if (dlpResult.stageBFailed) {
    auditLog.writeEvent({
      embedId: embed.id,
      sessionId: session.id,
      ownerId: embed.ownerId,
      eventType: 'dlp_stage_b_failure',
      severity: 'warning',
      origin,
      ipHash: ipH,
      publicContextData: {},
    });
  }

  // ─── Step 9: Bump session activity ───────────────────────────────────────
  db.bumpSessionActivity(session.id, {
    messageDelta: 1,
    tokenDelta: (gatewayResp.tokens?.in || 0) + (gatewayResp.tokens?.out || 0),
  });

  // ─── Step 10: Return ─────────────────────────────────────────────────────
  return {
    status: 200,
    body: {
      text: dlpResult.text,
      session_id: session.id,
      action: dlpResult.action,
      redaction_count: dlpResult.redactions.length,
    },
  };
}

module.exports = { handleMessage };
