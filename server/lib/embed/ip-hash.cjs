// server/lib/embed/ip-hash.cjs
'use strict';

const crypto = require('crypto');

function _todayUtc() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function _ownerSalt(ownerId) {
  const base = process.env.AOC_DLP_MASTER_KEY || '';
  return crypto.createHash('sha256').update(`owner:${ownerId}:${base}`).digest('hex');
}

function hashIp({ ip, ownerId, dateOverride = null }) {
  const day = dateOverride || _todayUtc();
  const ownerSalt = _ownerSalt(ownerId);
  return crypto.createHash('sha256')
    .update(`${ip}|${ownerSalt}|${day}`)
    .digest('hex');
}

function extractClientIp(req, { trustedProxies = null } = {}) {
  const proxies = trustedProxies ?? (process.env.AOC_TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean);
  const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress || '0.0.0.0';
  if (proxies.includes(socketIp)) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const first = String(xff).split(',')[0].trim();
      if (first) return first;
    }
  }
  return socketIp;
}

module.exports = { hashIp, extractClientIp };
