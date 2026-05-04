/**
 * bootstrap/middleware.cjs
 *
 * Applies all Express middleware to the app: security headers (helmet),
 * CORS, rate limiting, JSON body parser, and trust proxy configuration.
 */
'use strict';

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const express = require('express');

/**
 * Apply all middleware to the Express app.
 *
 * @param {import('express').Express} app
 */
function applyMiddleware(app) {
  // ─── Trust Proxy ──────────────────────────────────────────────────────────
  // Behind a reverse proxy (cloudflared tunnel → agents.dke.dev, or a local
  // nginx / Cloudflare Zero Trust gateway). `trust proxy` lets Express honour
  // `X-Forwarded-For` so rate-limiter keys off the real client IP instead of
  // the loopback. Configurable via env; default "1" (trust first hop) — matches
  // our production setup (a single tunnel in front).
  const TRUST_PROXY = process.env.TRUST_PROXY ?? '1';
  if (TRUST_PROXY === 'true' || TRUST_PROXY === 'false') {
    app.set('trust proxy', TRUST_PROXY === 'true');
  } else if (/^\d+$/.test(TRUST_PROXY)) {
    app.set('trust proxy', parseInt(TRUST_PROXY, 10));
  } else {
    app.set('trust proxy', TRUST_PROXY);
  }

  // ─── Security ─────────────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        scriptSrc: ["'self'", "'unsafe-inline'", "blob:"],
        workerSrc: ["'self'", "blob:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(cors({
    origin: process.env.CORS_ORIGINS === '*' ? true : process.env.CORS_ORIGINS?.split(','),
    credentials: true,
  }));

  // ─── Rate Limiting ────────────────────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '500', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  });
  app.use('/api/', limiter);

  // ─── Body Parsing ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: '25mb' }));
}

module.exports = { applyMiddleware };
