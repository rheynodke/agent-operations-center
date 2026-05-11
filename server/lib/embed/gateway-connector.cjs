// server/lib/embed/gateway-connector.cjs
// Wraps gatewayPool.forUser(ownerId) to provide the sendMessage(...) interface
// that proxy.cjs (Task 17) expects.
//
// Lazy-connect pattern mirrors server/routes/master.cjs:
//   1. Check conn.isConnected.
//   2. If stale, use orchestrator.getGatewayState + getRunningToken to reconnect.
//   3. If no running gateway, attempt spawnGateway (non-admin users only).
//   4. Throw if still not connected after all that.
'use strict';

const { gatewayPool } = require('../gateway-ws.cjs');
const orchestrator = require('../gateway-orchestrator.cjs');

/**
 * Ensure the gateway connection for ownerId is live.
 * Mirrors the lazy-connect pattern from master.cjs.
 * @param {number} ownerId
 * @returns {Promise<GatewayConnection>}
 */
async function _ensureConnected(ownerId) {
  const conn = gatewayPool.forUser(ownerId);
  if (conn.isConnected) return conn;

  // Try to reconnect using existing running gateway state.
  const dbState = orchestrator.getGatewayState(ownerId);
  const token = orchestrator.getRunningToken(ownerId);

  if (dbState?.state === 'running' && dbState?.port && token) {
    conn.connect({ port: dbState.port, token });
    // Brief poll to let the WS handshake complete (same as master.cjs: 4s max).
    const start = Date.now();
    while (!conn.isConnected && Date.now() - start < 4000) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (conn.isConnected) return conn;
  }

  // No running gateway — attempt spawn (handles non-admin users).
  const spawnResult = await orchestrator.spawnGateway(ownerId);
  const spawnToken = orchestrator.getRunningToken(ownerId);
  const spawnPort = spawnResult?.port || dbState?.port;

  if (!spawnPort || !spawnToken) {
    throw new Error(`Gateway not running for owner ${ownerId}`);
  }

  conn.connect({ port: spawnPort, token: spawnToken });
  const start2 = Date.now();
  while (!conn.isConnected && Date.now() - start2 < 4000) {
    await new Promise(r => setTimeout(r, 100));
  }

  if (!conn.isConnected) {
    throw new Error(`Gateway not connected for owner ${ownerId} after spawn`);
  }

  return conn;
}

/**
 * Send a message from the embed widget to an agent via the user's gateway.
 *
 * @param {object} opts
 * @param {string}  opts.sessionKey   — embed-scoped session key (e.g. "embed:<id>:<visitor>")
 * @param {number}  opts.ownerId      — userId who owns the embed + agent
 * @param {string}  opts.agentId      — target agent id
 * @param {string}  opts.content      — visitor message text
 * @param {object}  [opts.visitorMeta] — optional { name, email, role } from JWT claims
 * @returns {Promise<{ text: string, tokens: { in: number, out: number }, raw: object }>}
 */
/**
 * After chatSend (fire-and-forget RPC), capture assistant text from any
 * chat:message events for the matching sessionKey, then resolve when chat:done
 * arrives (or chat:message with done=true). Times out after timeoutMs.
 *
 * Gateway emits two terminal patterns depending on event source:
 *  1. session.message → chat:message{done=true} + chat:done
 *  2. chat state=final → chat:message{done=true} (only if text non-empty) + chat:done
 *  3. session.done → chat:done only (no chat:message)
 *  4. agent lifecycle phase=end → chat:done only
 *
 * We accept whichever arrives first as completion, using the latest captured
 * assistant text. This handles all four termination patterns.
 */
function _awaitFinalResponse(conn, sessionKey, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let unsubscribe = null;
    let latestText = '';
    let latestRole = 'assistant';
    let latestRaw = null;

    const finalize = (reason) => {
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      resolve({ text: latestText, role: latestRole, raw: latestRaw, reason });
    };

    const timer = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      if (latestText) {
        // Got partial text but no terminal signal — treat as success.
        resolve({ text: latestText, role: latestRole, raw: latestRaw, reason: 'timeout-with-text' });
      } else {
        reject(new Error(`Timed out waiting for agent response (${timeoutMs}ms)`));
      }
    }, timeoutMs);

    // Gateway broadcasts events with sessionKey prefixed `agent:<agentId>:<key>`
    // (e.g. "agent:lumi:embed:f91d190b...:test-user-001"). Our subscription
    // session key is the inner part, so match by suffix to handle either form.
    const matchesSession = (eventSessionKey) => {
      if (!eventSessionKey || typeof eventSessionKey !== 'string') return false;
      return eventSessionKey === sessionKey || eventSessionKey.endsWith(`:${sessionKey}`);
    };

    let doneGraceTimer = null;

    unsubscribe = conn.addListener((event) => {
      if (!event) return;
      const p = event.payload || {};
      if (!matchesSession(p.sessionKey)) return;

      if (event.type === 'chat:message') {
        if (typeof p.text === 'string' && p.text.length) {
          latestText = p.text;
          latestRole = p.role || latestRole;
          latestRaw = event;
        }
        if (p.done && latestText) {
          if (doneGraceTimer) { clearTimeout(doneGraceTimer); doneGraceTimer = null; }
          finalize('chat:message-done');
        }
      } else if (event.type === 'chat:done') {
        // chat:done can arrive immediately before chat:message in some races.
        // Give chat:message 500ms grace to populate latestText. If still empty
        // after grace, finalize with whatever we have (possibly empty).
        if (latestText) {
          finalize('chat:done');
        } else if (!doneGraceTimer) {
          doneGraceTimer = setTimeout(() => finalize('chat:done-grace-expired'), 500);
        }
      }
    });
  });
}

async function sendMessage({ sessionKey, ownerId, agentId, content, visitorMeta = {} }) {
  const conn = await _ensureConnected(ownerId);

  // Create or reuse the gateway session keyed by embed session key.
  let resolvedSessionKey;
  try {
    // Use the unique sessionKey as both key and label — gateway requires labels to be
    // globally unique, and a fixed `embed:<agentId>` collides across visitors/playground.
    const createResult = await conn.sessionsCreate(agentId, {
      key: sessionKey,
      label: sessionKey,
    });
    resolvedSessionKey = createResult?.sessionKey || sessionKey;
  } catch (e) {
    throw new Error(`sessions.create failed: ${e.message}`);
  }

  // Subscribe BEFORE chatSend so we don't miss the response if it arrives fast.
  const responsePromise = _awaitFinalResponse(conn, resolvedSessionKey);

  // Fire the message — the response arrives later via WS broadcast.
  try {
    await conn.chatSend(resolvedSessionKey, content);
  } catch (e) {
    throw new Error(`chat.send failed: ${e.message}`);
  }

  const final = await responsePromise;

  return {
    text: final.text,
    tokens: { in: 0, out: 0 },  // gateway doesn't report token usage in chat:message broadcast
    raw: final.raw,
  };
}

module.exports = { sendMessage };
