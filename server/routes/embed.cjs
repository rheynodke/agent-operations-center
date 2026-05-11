// server/routes/embed.cjs
// Public-facing embed channel routes (no user JWT required — auth is via embed token
// + optional private-mode visitor JWT).
//
// Two routers are exported:
//   serve — mounted at /embed/*   (loader.js, config.json, static v1 widget)
//   api   — mounted at /api/embed/* (POST /session, /message, GET /history, DELETE /session)
'use strict';

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');

const db = require('../lib/db.cjs');
const proxy = require('../lib/embed/proxy.cjs');
const ipHash = require('../lib/embed/ip-hash.cjs');
const auditLog = require('../lib/embed/audit-log.cjs');
const ks = require('../lib/embed/kill-switch.cjs');
const om = require('../lib/embed/origin-matcher.cjs');
const authPrivate = require('../lib/embed/auth-private.cjs');
const claudeCodeProvider = require('../lib/llm-providers/claude-code-provider.cjs');
const gatewayConnector = require('../lib/embed/gateway-connector.cjs');
const avatarPresets = require('../lib/embed/avatar-presets.cjs');
const quota = require('../lib/embed/quota.cjs');

/**
 * Resolve an embed's avatar to an absolute URL the widget can load.
 *  - avatarSource === 'custom': prepend base to relative /embed-uploads/... path
 *  - avatarSource === 'agent':  look up bound agent's avatarPresetId → /avatars/bot-<id>.png
 * Returns null when no avatar is configured.
 */
function resolveEmbedAvatarUrl(embed, baseUrl) {
  if (!embed) return null;
  if (embed.avatarSource === 'custom' && embed.avatarUrl) {
    return embed.avatarUrl.startsWith('http') ? embed.avatarUrl : baseUrl + embed.avatarUrl;
  }
  if (embed.avatarSource === 'agent') {
    const profile = db.getAgentProfile(embed.agentId, embed.ownerId);
    const presetPath = avatarPresets.resolvePresetPath(profile?.avatarPresetId);
    if (presetPath) return baseUrl + presetPath;
  }
  return null;
}

/**
 * Public base URL used for ALL absolute URLs returned to the widget + dashboard:
 *  - Loader / config.json / embed-uploads / avatars
 *  - Snippet code copy-pasted into customer host sites
 *
 * Priority:
 *  1. FRONTEND_ORIGIN — the user's public domain (e.g. https://agents.dke.dev)
 *  2. PUBLIC_URL      — alias used elsewhere in the codebase
 *  3. EMBED_WIDGET_BASE_URL — legacy/dev-only direct backend address
 *  4. Request host    — fallback when no env var is set
 *
 * In production, set FRONTEND_ORIGIN to your public domain. In dev, the env file
 * may have it pointing at Vite (e.g. http://localhost:5173) — Vite proxies the
 * /embed, /avatars, /embed-uploads paths to Express, so it works transparently.
 */
function publicBaseUrlFor(req) {
  return (
    process.env.FRONTEND_ORIGIN ||
    process.env.PUBLIC_URL ||
    process.env.EMBED_WIDGET_BASE_URL ||
    `${req.protocol}://${req.get('host')}`
  );
}

// Alias kept for readability where the URL is consumed inside the widget (vs snippet).
const baseUrlFor = publicBaseUrlFor;

// Session JWTs are signed with the DLP master key (same entropy pool, separate purpose).
// Falls back to a dev-only constant so the server can start without the key in development,
// but the embed channel will refuse to issue sessions if missing (checked at POST /session).
const SESSION_JWT_SECRET = process.env.AOC_DLP_MASTER_KEY || 'dev-fallback-only-not-secure';

// ─── Public serve router ─────────────────────────────────────────────────────

const serve = express.Router();

/**
 * Cross-origin allowance for embed assets — these are designed to be loaded from
 * arbitrary host sites. Override Helmet's default same-origin CORP + SAMEORIGIN
 * X-Frame-Options for everything under /embed/*.
 */
serve.use((req, res, next) => {
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  // Allow iframe embedding from any parent origin. The widget itself runs on the
  // AOC origin (cookies/localStorage scoped there), so the parent page can't
  // exfiltrate visitor session data — origin allowlist enforcement happens at
  // /api/embed/session via the Origin header check.
  res.removeHeader('X-Frame-Options');
  res.set('Content-Security-Policy', "frame-ancestors *");
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/**
 * GET /embed/:embedId/loader.js
 * Returns a dynamic IIFE that fetches config.json, then lazy-mounts the widget bundle.
 * Cached 60 seconds by public caches.
 */
serve.get('/:embedId/loader.js', (req, res) => {
  const embed = db.getEmbedById(req.params.embedId);
  if (!embed) return res.status(404).type('text/plain').send('// embed not found');

  res.type('application/javascript');
  res.set('Cache-Control', 'public, max-age=60');

  const widgetBase = process.env.EMBED_WIDGET_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;
  const widgetVersion = embed.widgetVersion || 'v1';

  // Loader bootstraps in 3 steps:
  // 1. Fetch config
  // 2. Inject Shadow DOM floating button styled per config
  // 3. On button click, lazy-mount iframe to widget.html
  const loader = `(function(){
  var script = document.currentScript;
  var token = script && script.getAttribute('data-token');
  var embedId = ${JSON.stringify(embed.id)};
  var base = ${JSON.stringify(widgetBase)};
  var version = ${JSON.stringify(widgetVersion)};
  if (!token) { console.error('[aoc-embed] missing data-token attribute'); return; }
  var jwt = (typeof window.AOC_EMBED_JWT === 'string') ? window.AOC_EMBED_JWT : null;
  var parentOrigin = window.location.origin;
  fetch(base + '/embed/' + embedId + '/config.json').then(function(r){return r.json();}).then(function(cfg){
    if (cfg.error) { console.error('[aoc-embed] config error:', cfg.error); return; }
    if (!cfg.enabled) { console.warn('[aoc-embed] disabled (mode='+cfg.disableMode+')'); return; }
    var host = document.createElement('div');
    host.id = 'aoc-embed-host';
    host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;';
    var shadow = host.attachShadow({mode:'closed'});
    var btn = document.createElement('button');
    btn.setAttribute('aria-label','Open chat');
    btn.style.cssText = 'all:unset;cursor:pointer;width:60px;height:60px;border-radius:30px;background:'+cfg.brandColor+';color:'+cfg.brandColorText+';display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:transform 0.2s;';
    btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.onmouseenter = function(){btn.style.transform='scale(1.05)';};
    btn.onmouseleave = function(){btn.style.transform='scale(1)';};
    shadow.appendChild(btn);
    document.body.appendChild(host);
    var iframe = null;
    btn.addEventListener('click', function(){
      if (iframe) {
        iframe.style.display = iframe.style.display === 'none' ? 'block' : 'none';
        return;
      }
      iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;bottom:90px;right:20px;width:360px;height:600px;border:none;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.16);z-index:2147483646;background:white;';
      iframe.setAttribute('allow', 'clipboard-write');
      iframe.setAttribute('title', 'AOC Chat Widget');
      // Attach load listener BEFORE setting src/append to avoid race where
      // cached widget loads faster than the listener registers.
      var initPayload = {
        type: 'aoc:init',
        embedId: embedId,
        token: token,
        jwt: jwt,
        base: base,
        parentOrigin: parentOrigin,
        config: cfg,
      };
      var sentInit = false;
      function deliverInit() {
        if (!iframe || !iframe.contentWindow) return;
        try { iframe.contentWindow.postMessage(initPayload, base); sentInit = true; } catch(e){}
      }
      iframe.addEventListener('load', function(){
        deliverInit();
        // Belt-and-suspenders: re-deliver after a short tick in case the widget
        // registered its message listener slightly after first delivery.
        setTimeout(deliverInit, 50);
        setTimeout(deliverInit, 200);
      });
      // Also handle aoc:ready handshake from widget — widget can request init
      // explicitly if it missed the load-time delivery.
      window.addEventListener('message', function(e){
        if (e.source !== iframe.contentWindow) return;
        if (e.data && e.data.type === 'aoc:ready') deliverInit();
      });
      // Append loader render timestamp as cache-buster so widget.html refresh
      // tracks loader.js cache TTL (60s) rather than its own immutable cache.
      iframe.src = base + '/embed/' + version + '/widget.html?id=' + embedId + '&_=' + ${Date.now()};
      document.body.appendChild(iframe);
    });
    // Click-outside to close: any click that lands on the host page outside
    // both the floating button (Shadow DOM host) and the iframe panel will
    // hide the iframe. Clicks INSIDE the iframe never reach this listener
    // because they're cross-document and don't bubble to the parent. Use
    // composedPath() so Shadow DOM clicks are correctly attributed to the host.
    document.addEventListener('click', function(e){
      if (!iframe || iframe.style.display === 'none') return;
      var path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
      if (path.indexOf(host) !== -1 || host.contains(e.target)) return;
      if (path.indexOf(iframe) !== -1 || iframe.contains(e.target)) return;
      iframe.style.display = 'none';
    }, true);
    // Allow visitor to dismiss with Escape key
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && iframe && iframe.style.display !== 'none') {
        iframe.style.display = 'none';
      }
    });
    window.AOC_EMBED = {
      open: function(){ btn.click(); },
      close: function(){ if (iframe) iframe.style.display = 'none'; },
      sendMessage: function(text){
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({type:'aoc:send', text:text}, base);
        }
      },
      clearChat: function(){
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({type:'aoc:clear'}, base);
        }
      },
    };
  }).catch(function(e){console.error('[aoc-embed] init error:',e);});
})();`;

  res.send(loader);
});

/**
 * GET /embed/:embedId/config.json
 * Returns sanitised branding config — NO signingSecret, NO embedToken.
 * Cached 60 seconds by public caches.
 */
serve.get('/:embedId/config.json', (req, res) => {
  const embed = db.getEmbedById(req.params.embedId);
  if (!embed) return res.status(404).json({ error: 'not_found' });

  // Resolve avatar URL based on source — always absolute so the cross-origin iframe can load it.
  const resolvedAvatarUrl = resolveEmbedAvatarUrl(embed, baseUrlFor(req));

  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    embedId: embed.id,
    brandName: embed.brandName,
    brandColor: embed.brandColor,
    brandColorText: embed.brandColorText,
    avatarSource: embed.avatarSource,
    avatarUrl: resolvedAvatarUrl,
    welcomeTitle: embed.welcomeTitle,
    welcomeSubtitle: embed.welcomeSubtitle,
    quickReplies: embed.quickReplies,
    waitingText: embed.waitingText,
    offlineMessage: embed.offlineMessage,
    hidePoweredBy: embed.hidePoweredBy,
    consentText: embed.consentText,
    languageDefault: embed.languageDefault,
    typingPhrases: embed.typingPhrases,
    mode: embed.mode,
    widgetVersion: embed.widgetVersion,
    enabled: embed.enabled === 1 || embed.enabled === true,
    disableMode: embed.disableMode,
  });
});

/**
 * /embed/v1/... — static widget bundle (built by packages/aoc-embed).
 * widget.html: short cache (60s) so updates propagate without manual cache bust.
 * widget-<hash>.js: immutable 365-day cache (filename changes on every rebuild).
 */
serve.use('/v1', express.static(path.join(__dirname, '..', 'static', 'embed', 'v1'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'public, max-age=60');
    } else {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// ─── API router ──────────────────────────────────────────────────────────────

const api = express.Router();

/**
 * _embedAuth — reads X-Embed-Token header, looks up embed, attaches req.embed.
 * Returns 401 if missing or invalid.
 */
function _embedAuth(req, res, next) {
  const embedToken = req.headers['x-embed-token'];
  if (!embedToken) return res.status(401).json({ error: 'missing_embed_token' });
  const embed = db.getEmbedByToken(embedToken);
  if (!embed) return res.status(401).json({ error: 'invalid_embed_token' });
  req.embed = embed;
  next();
}

/**
 * _sessionAuth — reads Bearer token from Authorization header, verifies as session JWT,
 * attaches req.sessionClaims. Must be called after _embedAuth (needs req.embed.id).
 */
function _sessionAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ error: 'missing_session_token' });
  try {
    const claims = jwt.verify(m[1], SESSION_JWT_SECRET, { algorithms: ['HS256'] });
    if (claims.embed_id !== req.embed.id) {
      return res.status(401).json({ error: 'session_mismatch' });
    }
    req.sessionClaims = claims;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_session_token' });
  }
}

/**
 * POST /api/embed/session
 * Creates or resumes a visitor session. Returns a signed session JWT (6h).
 *
 * For private mode: expects a signed visitor JWT in Authorization: Bearer header
 *   (signed by the embed's signing_secret).
 * For public mode: expects visitor_uuid in request body.
 */
api.post('/session', _embedAuth, async (req, res) => {
  try {
    // Gate: master key must exist to sign session tokens
    if (!process.env.AOC_DLP_MASTER_KEY) {
      return res.status(503).json({
        error: 'configuration_error',
        message: 'Embed channel not configured. AOC_DLP_MASTER_KEY is missing.',
      });
    }

    // Iframe widget runs on the AOC origin, so request Origin = AOC origin (not host site).
    // The host site origin is forwarded as X-Embed-Parent-Origin by the widget.
    // Allowlist check uses parent origin; falls back to Origin header for direct
    // host-site fetches (e.g. /embed/<id>/config.json).
    const parentOriginHeader = req.headers['x-embed-parent-origin'];
    const originHeader = req.headers.origin || '';
    const checkOrigin = parentOriginHeader || originHeader;

    // ── Playground mode detection (must run before origin check) ─────────────
    // Playground sessions are launched from the AOC dashboard origin, which is
    // NOT in the embed's productionOrigin/devOrigins allowlist. The owner JWT
    // proves authorization, so we bypass the origin check entirely for valid
    // playground requests.
    const requestedPlayground = req.body?.playground === true;
    let trafficType;
    let visitorKey;
    let visitorMeta = {};
    let originMatch = null;

    if (requestedPlayground) {
      const ownerJwtStr = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!ownerJwtStr) {
        return res.status(403).json({ error: 'playground requires owner authentication' });
      }

      const decoded = db.verifyToken(ownerJwtStr);
      if (!decoded) {
        return res.status(403).json({ error: 'playground requires owner authentication' });
      }
      // Reject agent-service tokens — playground requires a dashboard user JWT
      if (decoded.kind === 'agent-service') {
        return res.status(403).json({ error: 'playground requires user JWT, not agent token' });
      }
      // Owner or admin check: decoded.userId must match embed owner OR role=admin
      if (decoded.userId !== req.embed.ownerId && decoded.role !== 'admin') {
        return res.status(403).json({ error: 'playground requires owner authentication' });
      }

      trafficType = 'playground';
      // Use a deterministic visitor key so the owner always resumes the same playground session
      visitorKey = `playground-owner-${decoded.userId}`;
      visitorMeta = { name: decoded.displayName || decoded.username || 'Owner', role: 'owner' };
    } else {
      // Non-playground path — enforce origin allowlist
      originMatch = om.matchOrigin(checkOrigin, {
        productionOrigin: req.embed.productionOrigin,
        devOrigins: req.embed.devOrigins || [],
      });
      if (!originMatch.matched) {
        return res.status(403).json({ error: 'origin_not_allowed' });
      }
    }

    // Kill switch check — bypassed for playground so owners can debug a disabled embed.
    if (!requestedPlayground) {
      const killState = ks.isEnabled(req.embed.id);
      if (!killState.enabled) {
        return res.status(503).json({
          error: 'embed_disabled',
          message: killState.disableMode === 'emergency'
            ? 'Service unavailable'
            : (req.embed.offlineMessage || 'This service is temporarily unavailable.'),
        });
      }
    }

    if (!requestedPlayground) {
      if (req.embed.mode === 'private') {
        // Private mode: Authorization header must carry a visitor JWT signed by embed's signing_secret
        const authHeader = req.headers.authorization || '';
        const jwtStr = authHeader.replace(/^Bearer\s+/, '');
        if (!jwtStr) return res.status(401).json({ error: 'missing_jwt' });

        const verify = authPrivate.verifyPrivateJwt(jwtStr, req.embed.signingSecret);
        if (!verify.ok) return res.status(401).json({ error: 'jwt_' + verify.reason });

        visitorKey = verify.claims.visitor_id;
        visitorMeta = {
          name: verify.claims.name,
          email: verify.claims.email,
          role: verify.claims.role,
        };
      } else {
        // Public mode: visitor_uuid from body
        visitorKey = req.body && req.body.visitor_uuid;
        if (!visitorKey) return res.status(400).json({ error: 'missing_visitor_uuid' });
      }
      trafficType = originMatch.source === 'dev' ? 'dev' : 'production';
    }
    const session = db.createOrResumeSession({
      embedId: req.embed.id,
      visitorUuid: visitorKey,
      visitorMeta,
      gatewaySessionKey: `embed:${req.embed.id}:${visitorKey}`,
      trafficType,
      origin: checkOrigin,
    });

    const sessionToken = jwt.sign(
      { embed_id: req.embed.id, session_id: session.id, visitor_key: visitorKey },
      SESSION_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '6h' },
    );

    res.json({
      session_id: session.id,
      session_token: sessionToken,
      welcome_title: req.embed.welcomeTitle,
    });
  } catch (err) {
    console.error('[embed] POST /session error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /api/embed/message
 * Delegates to the Embed Gateway Proxy. Uses DLP + gateway connector.
 */
api.post('/message', _embedAuth, _sessionAuth, async (req, res) => {
  try {
    const content = (req.body && req.body.content) || '';
    if (!content.trim()) return res.status(400).json({ error: 'empty_content' });
    if (content.length > 10_000) return res.status(413).json({ error: 'content_too_long' });

    // Resolve session to get trafficType for quota decision
    const session = db.getSessionById(req.sessionClaims.session_id);
    const sessionTrafficType = session?.trafficType || 'production';

    // Daily quota check — playground sessions bypass message + token caps
    const quotaResult = quota.checkDailyQuota(
      db,
      req.embed.id,
      req.embed.dailyMessageQuota,
      req.embed.dailyTokenQuota,
      null, // use today
      sessionTrafficType,
    );
    if (!quotaResult.ok) {
      return res.status(429).json({
        error: 'quota_exceeded',
        reason: quotaResult.reason,
        message: 'Daily usage limit reached. Please try again tomorrow.',
      });
    }

    const clientIp = ipHash.extractClientIp(req);

    const result = await proxy.handleMessage({
      embedToken: req.headers['x-embed-token'],
      origin: req.headers['x-embed-parent-origin'] || req.headers.origin || '',
      visitorUuid: req.sessionClaims.visitor_key,
      content,
      clientIp,
      dlpProvider: claudeCodeProvider,
      gateway: gatewayConnector,
      trafficType: sessionTrafficType,
    });

    // Increment daily metrics counter for this traffic type
    if (result.status === 200) {
      const today = quota._today();
      quota.incrementDailyMetric(req.embed.id, req.embed.ownerId, today, sessionTrafficType, {
        messageDelta: 1,
        tokenDelta: 0, // token count comes from gateway response; not available here without parsing
      });
    }

    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[embed] POST /message error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * GET /api/embed/history
 * Returns message history for the current session.
 * Phase 1: always returns empty array (gateway JSONL integration is Phase 2).
 */
api.get('/history', _embedAuth, _sessionAuth, (req, res) => {
  try {
    const cursor = req.query.cursor || null;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const messages = db.getEmbedSessionMessages(req.sessionClaims.session_id, { cursor, limit });
    res.json({ messages, has_more: messages.length === limit });
  } catch (err) {
    console.error('[embed] GET /history error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * DELETE /api/embed/session
 * Clears the visitor's session (soft delete — sets cleared_at).
 */
api.delete('/session', _embedAuth, _sessionAuth, (req, res) => {
  try {
    db.clearSession(req.sessionClaims.session_id);
    auditLog.writeEvent({
      embedId: req.embed.id,
      sessionId: req.sessionClaims.session_id,
      ownerId: req.embed.ownerId,
      eventType: 'message',
      severity: 'info',
      publicContextData: { phase: 'session_cleared' },
    });
    res.status(204).end();
  } catch (err) {
    console.error('[embed] DELETE /session error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── Admin router (owner-authenticated CRUD) ─────────────────────────────────
// Mounted at /api/embed/admin/* by server/index.cjs.
// Uses AOC's standard authMiddleware (JWT or legacy DASHBOARD_TOKEN).

const { parseScopeUserId } = require('../helpers/access-control.cjs');
const dlpTester = require('../lib/embed/dlp-tester.cjs');
const multer = require('multer');
const avatarUpload = require('../lib/embed/avatar-upload.cjs');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: avatarUpload.MAX_BYTES },
});

const admin = express.Router();
admin.use(db.authMiddleware);

/**
 * POST /api/embed/admin/embeds
 * Creates a new embed. Phase 1: private mode only.
 */
admin.post('/embeds', (req, res) => {
  const ownerId = req.user.userId;
  const {
    agentId, mode, productionOrigin, devOrigins,
    brandName, brandColor, avatarSource, avatarUrl,
    welcomeTitle, welcomeSubtitle, quickReplies,
    waitingText, offlineMessage, dlpPreset,
    rateLimitPerIp, dailyTokenQuota, dailyMessageQuota,
  } = req.body || {};

  if (!agentId || !mode || !productionOrigin || !brandName || !welcomeTitle || !dlpPreset) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (mode !== 'private' && mode !== 'public') {
    return res.status(400).json({ error: 'invalid_mode' });
  }
  if (mode === 'public') {
    return res.status(403).json({ error: 'public_mode_not_yet_available' });
  }

  // Verify owner owns the agent
  const profile = db.getAgentProfile(agentId, ownerId);
  if (!profile) return res.status(404).json({ error: 'agent_not_found_or_not_owned' });

  const embed = db.createEmbed({
    agentId, ownerId, mode, productionOrigin,
    devOrigins, brandName, brandColor, avatarSource, avatarUrl,
    welcomeTitle, welcomeSubtitle, quickReplies,
    waitingText, offlineMessage, dlpPreset,
    rateLimitPerIp, dailyTokenQuota, dailyMessageQuota,
  });

  try {
    auditLog.writeEvent({
      embedId: embed.id, ownerId, eventType: 'embed_create', severity: 'info',
      publicContextData: { agentId, mode, productionOrigin },
    });
  } catch (e) {
    console.warn('[embed/admin] audit write failed on create:', e.message);
  }

  res.status(201).json(embed);
});

/**
 * GET /api/embed/admin/embeds
 * Lists embeds for the authenticated owner (secrets stripped).
 */
admin.get('/embeds', (req, res) => {
  const ownerId = parseScopeUserId(req);
  const list = db.listEmbedsForOwner(ownerId);
  const base = baseUrlFor(req);
  // Strip secrets from list view + attach resolved avatar URL
  res.json(list.map(e => {
    const copy = { ...e };
    delete copy.signingSecret;
    delete copy.turnstileSecret;
    copy.resolvedAvatarUrl = resolveEmbedAvatarUrl(e, base);
    return copy;
  }));
});

/**
 * GET /api/embed/admin/embeds/:id
 * Returns full embed detail including signingSecret (owner only — used in Snippet tab).
 */
admin.get('/embeds/:id', (req, res) => {
  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });
  if (embed.ownerId !== req.user.userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const base = baseUrlFor(req);
  res.json({
    ...embed,
    resolvedAvatarUrl: resolveEmbedAvatarUrl(embed, base),
    widgetBaseUrl: publicBaseUrlFor(req),
  });
});

/**
 * PATCH /api/embed/admin/embeds/:id
 * Partial update of an embed (owner only).
 */
admin.patch('/embeds/:id', (req, res) => {
  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });
  if (embed.ownerId !== req.user.userId) return res.status(403).json({ error: 'forbidden' });

  const body = req.body || {};

  // Validate avatarUrl if present — must be null or a /embed-uploads/... path
  // (use POST /avatar to upload; reject arbitrary external URLs)
  if ('avatarUrl' in body) {
    const u = body.avatarUrl;
    if (u !== null && (typeof u !== 'string' || !u.startsWith('/embed-uploads/'))) {
      return res.status(400).json({ error: 'avatarUrl must be null or a /embed-uploads/... path (use POST /avatar to upload)' });
    }
  }

  // Validate typingPhrases if present
  if ('typingPhrases' in body) {
    const v = body.typingPhrases;
    if (v !== null) {
      if (!Array.isArray(v)) return res.status(400).json({ error: 'typingPhrases must be array or null' });
      if (v.length > 5) return res.status(400).json({ error: 'typingPhrases max 5 entries' });
      if (!v.every(s => typeof s === 'string' && s.length > 0 && s.length <= 80)) {
        return res.status(400).json({ error: 'each phrase must be 1-80 chars' });
      }
    }
  }

  const updated = db.updateEmbed(req.params.id, body);

  try {
    auditLog.writeEvent({
      embedId: embed.id, ownerId: embed.ownerId, eventType: 'embed_update', severity: 'info',
      publicContextData: { fieldsChanged: Object.keys(req.body || {}) },
    });
  } catch (e) {
    console.warn('[embed/admin] audit write failed on update:', e.message);
  }

  const base2 = baseUrlFor(req);
  res.json({
    ...updated,
    resolvedAvatarUrl: resolveEmbedAvatarUrl(updated, base2),
    widgetBaseUrl: publicBaseUrlFor(req),
  });
});

/**
 * DELETE /api/embed/admin/embeds/:id
 * Deletes an embed (owner only).
 */
admin.delete('/embeds/:id', (req, res) => {
  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });
  if (embed.ownerId !== req.user.userId) return res.status(403).json({ error: 'forbidden' });

  db.deleteEmbed(req.params.id);

  try {
    auditLog.writeEvent({
      embedId: req.params.id, ownerId: embed.ownerId, eventType: 'embed_delete', severity: 'warning',
      publicContextData: {},
    });
  } catch (e) {
    console.warn('[embed/admin] audit write failed on delete:', e.message);
  }

  res.status(204).end();
});

/**
 * POST /api/embed/admin/embeds/:id/toggle
 * Toggles the kill switch for an embed (owner only).
 */
admin.post('/embeds/:id/toggle', (req, res) => {
  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });
  if (embed.ownerId !== req.user.userId) return res.status(403).json({ error: 'forbidden' });

  const { enabled, mode } = req.body || {};
  const result = ks.toggleEnabled(req.params.id, { enabled: !!enabled, mode: mode || 'maintenance' });

  try {
    auditLog.writeEvent({
      embedId: req.params.id, ownerId: embed.ownerId, eventType: 'kill_toggle', severity: 'warning',
      publicContextData: { enabled, mode, actor: req.user.userId },
    });
  } catch (e) {
    console.warn('[embed/admin] audit write failed on toggle:', e.message);
  }

  res.json({ ok: true, ...result });
});

/**
 * POST /api/embed/admin/embeds/:id/regenerate-secret
 * Regenerates the signing_secret for a private-mode embed (owner only).
 */
admin.post('/embeds/:id/regenerate-secret', (req, res) => {
  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });
  if (embed.ownerId !== req.user.userId) return res.status(403).json({ error: 'forbidden' });
  if (embed.mode !== 'private') return res.status(400).json({ error: 'no_secret_for_public_mode' });

  const secret = db.regenerateSigningSecret(req.params.id);

  try {
    auditLog.writeEvent({
      embedId: req.params.id, ownerId: embed.ownerId, eventType: 'embed_update', severity: 'critical',
      publicContextData: { action: 'regenerate_signing_secret', actor: req.user.userId },
    });
  } catch (e) {
    console.warn('[embed/admin] audit write failed on regenerate-secret:', e.message);
  }

  res.json({ signingSecret: secret });
});

/**
 * POST /api/embed/admin/disable-all
 * Disables all embeds owned by the authenticated user.
 */
admin.post('/disable-all', (req, res) => {
  const ownerId = req.user.userId;
  const ids = ks.disableAllForOwner(ownerId, { mode: req.body?.mode || 'emergency' });

  try {
    auditLog.writeEvent({
      embedId: 'multi', ownerId, eventType: 'kill_toggle', severity: 'critical',
      publicContextData: { action: 'disable_all', count: ids.length, mode: req.body?.mode || 'emergency' },
    });
  } catch (e) {
    console.warn('[embed/admin] audit write failed on disable-all:', e.message);
  }

  res.json({ disabled: ids });
});

/**
 * GET /api/embed/admin/embeds/:id/audit
 * Lists audit events for an embed with optional filters (owner only).
 */
admin.get('/embeds/:id/audit', (req, res) => {
  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });
  if (embed.ownerId !== req.user.userId) return res.status(403).json({ error: 'forbidden' });

  const events = db.listAuditEvents({
    embedId: req.params.id,
    eventType: req.query.event_type || null,
    severity: req.query.severity || null,
    cursor: req.query.cursor ? parseInt(req.query.cursor, 10) : null,
    limit: Math.min(parseInt(req.query.limit, 10) || 50, 200),
  });

  res.json({ events });
});

/**
 * POST /api/embed/admin/embeds/:id/avatar
 * Upload a custom avatar image (PNG/JPG/WEBP, max 256 KB) for an embed widget.
 *
 * Auth: dashboard JWT only (NOT agent-service token).
 * Owner or admin; cross-owner → 403.
 *
 * Multipart body field: file (the image binary)
 *
 * Response 200: { avatarUrl }
 *   avatarUrl — relative path e.g. /embed-uploads/<embedId>/avatar.png
 */
admin.post('/embeds/:id/avatar', (req, res, next) => {
  // Reject agent-service tokens (role='agent') — requires a dashboard user JWT
  if (req.user.kind === 'agent-service' || req.user.role === 'agent') {
    return res.status(403).json({ error: 'agent_service_token_not_allowed' });
  }
  next();
}, (req, res, next) => {
  // Run multer, catching parse errors (e.g. malformed boundary) as 400
  memoryUpload.single('file')(req, res, (err) => {
    if (err) {
      // MulterError or boundary parse failure — treat as bad request
      return res.status(400).json({ error: err.message || 'invalid_multipart' });
    }
    next();
  });
}, async (req, res) => {
  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });

  // Owner or admin only (same pattern as dlp-test and GET /embeds/:id)
  if (embed.ownerId !== req.user.userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'file required (multipart field "file")' });
  }

  try {
    const { url } = await avatarUpload.saveAvatarBuffer({
      embedId: embed.id,
      buffer: req.file.buffer,
      mime: req.file.mimetype,
    });

    db.updateEmbed(embed.id, { avatarSource: 'custom', avatarUrl: url });

    const updated = db.getEmbedById(embed.id);
    res.json({
      avatarUrl: url,
      resolvedAvatarUrl: resolveEmbedAvatarUrl(updated, baseUrlFor(req)),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/embed/admin/embeds/:id/avatar
 * Removes the custom avatar and reverts embed to avatarSource='agent', avatarUrl=null.
 *
 * Auth: dashboard JWT only (NOT agent-service token).
 * Owner or admin; cross-owner → 403.
 */
admin.delete('/embeds/:id/avatar', (req, res, next) => {
  // Reject agent-service tokens (role='agent') — requires a dashboard user JWT
  if (req.user.kind === 'agent-service' || req.user.role === 'agent') {
    return res.status(403).json({ error: 'agent_service_token_not_allowed' });
  }
  next();
}, (req, res) => {
  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });

  // Owner or admin only
  if (embed.ownerId !== req.user.userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  avatarUpload.deleteAvatar(embed.id);
  db.updateEmbed(embed.id, { avatarSource: 'agent', avatarUrl: null });

  const updated = db.getEmbedById(embed.id);
  res.json({ ok: true, resolvedAvatarUrl: resolveEmbedAvatarUrl(updated, baseUrlFor(req)) });
});

/**
 * POST /api/embed/admin/embeds/:id/dlp-test
 * DLP allowlist tester — owner can paste text and see what stage-A DLP
 * would match + what the redacted output looks like, using either the
 * saved allowlist or a draft allowlist override for this call only.
 *
 * Auth: dashboard JWT only (NOT agent-service token, NOT embed token).
 * Owner or admin; cross-owner → 403.
 *
 * Body:
 *   text              {string}   required — text to test (max 10_000 chars)
 *   allowlistOverride {string[]} optional — overrides saved allowlist for this call only
 *
 * Response 200: { matches, redacted, warnings }
 *   matches  — Array<{type, text, start, end}>
 *   redacted — stage-A redacted output string
 *   warnings — Array<string> (e.g. "invalid regex: [pattern] (error msg)")
 */
admin.post('/embeds/:id/dlp-test', (req, res) => {
  // Reject agent-service tokens (role='agent') — requires a dashboard user JWT
  if (req.user.kind === 'agent-service' || req.user.role === 'agent') {
    return res.status(403).json({ error: 'agent_service_token_not_allowed' });
  }

  const embed = db.getEmbedById(req.params.id);
  if (!embed) return res.status(404).json({ error: 'not_found' });

  // Owner or admin only
  if (embed.ownerId !== req.user.userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body || {};
  const { text, allowlistOverride } = body;

  // Validate text
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'text must be a string' });
  }
  if (text.length > 10_000) {
    return res.status(400).json({ error: 'text_too_long', maxLength: 10_000 });
  }

  // Resolve allowlist: use override if provided, else fall back to embed's saved allowlist
  let allowlist;
  if (Array.isArray(allowlistOverride)) {
    allowlist = allowlistOverride;
  } else {
    allowlist = embed.dlpAllowlistPatterns || [];
  }

  const result = dlpTester.testText({
    text,
    preset: embed.dlpPreset || 'internal-tool-default',
    allowlist,
  });

  res.json(result);
});

module.exports = { api, serve, admin };
