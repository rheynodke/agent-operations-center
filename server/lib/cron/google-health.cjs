// server/lib/cron/google-health.cjs
'use strict';
const cfg = require('../config.cjs');
const gw = require('../connections/google-workspace.cjs');

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let timer = null;

/**
 * Start the periodic health check. `broadcast` is the WS broadcast fn
 * (signature: (event, payload) => void). Safe to call multiple times.
 */
function start(broadcast) {
  if (!cfg.GOOGLE_OAUTH_CONFIGURED) {
    console.log('[google-health] skipping — GOOGLE_OAUTH not configured');
    return;
  }
  if (timer) return;
  const tick = async () => {
    try {
      const results = await gw.runHealthCheckAll();
      for (const [id, r] of Object.entries(results)) {
        if (!r.ok && r.code === 'invalid_grant') {
          broadcast?.('connection:auth_expired', { connectionId: id });
        }
      }
    } catch (err) {
      console.error('[google-health] tick failed:', err.message);
    }
  };
  timer = setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 30_000);
  console.log(`[google-health] started — interval ${INTERVAL_MS}ms`);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop };
