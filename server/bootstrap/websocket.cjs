/**
 * bootstrap/websocket.cjs
 *
 * WebSocket server setup, unified broadcast function, and heartbeat management.
 * Single source of truth for WS-related state — all route modules use
 * the broadcast/broadcastTasksUpdate functions exported here.
 */
'use strict';

const { WebSocketServer } = require('ws');

/** @type {WebSocketServer|null} */
let wss = null;

/**
 * Initialize the WebSocket server (noServer mode — upgrade handled externally).
 *
 * @returns {WebSocketServer}
 */
function init() {
  wss = new WebSocketServer({ noServer: true });

  // ─── Heartbeat ──────────────────────────────────────────────────────────
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeatInterval));

  return wss;
}

/**
 * Get the WSS instance (for upgrade handler, connection events, etc.).
 *
 * @returns {WebSocketServer}
 */
function getWss() {
  return wss;
}

/**
 * Broadcast an event to all connected dashboard WS clients.
 *
 * @param {object} event - { type: string, payload: any, timestamp?: string }
 */
function broadcast(event) {
  if (!wss) return;
  try {
    // Validate event.type against the registry — typos surface here instead
    // of silently breaking the matching frontend handler.
    if (event && event.type) {
      const { assertEventType } = require('../lib/ws-events.cjs');
      assertEventType(event.type);
    }
    const msg = JSON.stringify({ ...event, timestamp: event.timestamp || new Date().toISOString() });
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(msg);
    });
  } catch (err) {
    console.error('[broadcast]', err);
  }
}

/**
 * Broadcast a full task list refresh to all clients.
 *
 * @param {object} db
 */
function broadcastTasksUpdate(db) {
  try {
    const tasks = db.getAllTasks();
    broadcast({ type: 'tasks:updated', payload: tasks });
  } catch (err) {
    console.error('[broadcastTasksUpdate]', err);
  }
}

/**
 * Emit a room message event to all WS clients.
 *
 * @param {object} message - must have .roomId
 */
function emitRoomMessage(message) {
  if (!message?.roomId) return;
  broadcast({ type: 'room:message', payload: { roomId: message.roomId, message } });
}

module.exports = {
  init,
  getWss,
  broadcast,
  broadcastTasksUpdate,
  emitRoomMessage,
};
