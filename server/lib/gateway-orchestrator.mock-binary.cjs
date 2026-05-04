#!/usr/bin/env node
'use strict';
/**
 * Test fixture: mimics OpenClaw gateway just enough for orchestrator unit tests.
 * Reads OPENCLAW_GATEWAY_PORT, OPENCLAW_GATEWAY_TOKEN, OPENCLAW_HOME from env.
 *
 * Behaviors (toggle via env):
 *   MOCK_FAIL_MODE=immediate  → exit(1) immediately (simulates spawn failure)
 *   MOCK_FAIL_MODE=after-200  → exit(1) after 200ms (simulates crash post-readiness)
 *   MOCK_REJECT_AUTH=1        → reject WS upgrades even with correct token
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const port  = Number(process.env.OPENCLAW_GATEWAY_PORT || 0);
const token = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const home  = process.env.OPENCLAW_HOME || '';
const failMode      = process.env.MOCK_FAIL_MODE || '';
const rejectAuth    = process.env.MOCK_REJECT_AUTH === '1';
// When set, skip the HTTP Authorization header check on WS upgrade.
// Used by gateway-ws tests where GatewayConnection authenticates via the
// connect RPC payload rather than the HTTP header.
const noHeaderAuth  = process.env.MOCK_NO_HEADER_AUTH === '1';

if (failMode === 'immediate') {
  console.error('[mock-gw] MOCK_FAIL_MODE=immediate → exiting');
  process.exit(1);
}

if (!port || !token || !home) {
  console.error('[mock-gw] missing env: port/token/home');
  process.exit(2);
}

const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const auth = req.headers['authorization'] || '';
  const ok = !rejectAuth && (noHeaderAuth || auth === `Bearer ${token}`);
  if (!ok) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send(JSON.stringify({ type: 'mock-hello', port, home }));
    // Step 1: send a connect.challenge so GatewayConnection triggers _sendConnect()
    ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'mock-nonce-1234' } }));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id != null && msg.method) {
          // connect RPC → respond with hello-ok so GatewayConnection sets connected=true
          if (msg.method === 'connect') {
            ws.send(JSON.stringify({
              type: 'res', id: msg.id, ok: true,
              payload: {
                type: 'hello-ok',
                protocol: 3,
                server: { version: 'mock-1.0' },
                features: { methods: ['chat.send', 'sessions.create', 'cron.list'] },
                auth: { scopes: ['operator.admin'] },
              },
            }));
            return;
          }
          // All other RPCs: echo as { type:'res', id, ok:true, payload:{ echoed:{ method, params } } }
          ws.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, payload: { echoed: { method: msg.method, params: msg.params } } }));
          return;
        }
        // Non-RPC messages (no id+method): echo back as a gateway event so
        // GatewayConnection._handleMessage routes it through broadcast().
        // Clients receive { type:'gateway:event', payload:{ event:'broadcast', data: msg } }.
        ws.send(JSON.stringify({ type: 'event', event: 'broadcast', payload: msg }));
      } catch (_) { /* ignore non-JSON */ }
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-gw] listening on 127.0.0.1:${port} home=${home}`);
});

if (failMode === 'after-200') {
  setTimeout(() => { console.error('[mock-gw] MOCK_FAIL_MODE=after-200 → exiting'); process.exit(1); }, 200);
}

process.on('SIGTERM', () => { console.log('[mock-gw] SIGTERM'); server.close(() => process.exit(0)); });
process.on('SIGINT',  () => process.exit(0));
