'use strict';

/**
 * ensureUserGateway — single source of truth for "make sure user N's gateway
 * is up and the pool is connected". Used by auth (login + register) and the
 * Google OAuth flow.
 *
 *   userId === 1 → no-op (admin uses externally-managed gateway).
 *   else         → spawn if needed + connect pool + wait for handshake.
 *
 * In-flight de-duplication prevents two concurrent calls for the same user
 * from spawning twice. Different users still parallel.
 */

const orchestrator = require('./gateway-orchestrator.cjs');
const { gatewayPool } = require('./gateway-ws.cjs');

const _spawnInflight = new Map();

async function ensureUserGateway(userId) {
  if (Number(userId) === 1) return;

  if (_spawnInflight.has(userId)) {
    return _spawnInflight.get(userId);
  }

  const work = (async () => {
    const dbState = orchestrator.getGatewayState(userId);
    let token;
    let port;
    if (dbState.state === 'running' && orchestrator.getRunningToken(userId)) {
      token = orchestrator.getRunningToken(userId);
      port = dbState.port;
    } else {
      if (dbState.pid != null) {
        try { await orchestrator.stopGateway(userId); } catch (_) {}
      }
      const spawned = await orchestrator.spawnGateway(userId);
      token = spawned.token;
      port = spawned.port;
    }

    const conn = gatewayPool.forUser(userId);
    if (!conn.isConnected) {
      conn.connect({ port, token });
      const start = Date.now();
      while (!conn.isConnected && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!conn.isConnected) {
        throw new Error(`pool connect timeout for user ${userId}`);
      }
    }
  })();

  _spawnInflight.set(userId, work);
  try {
    await work;
  } finally {
    _spawnInflight.delete(userId);
  }
}

module.exports = { ensureUserGateway };
