'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const MOCK_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');

/** Load a fresh copy of gateway-ws.cjs and disconnect all its WS connections on gc */
function freshGwModule() {
  delete require.cache[require.resolve('./gateway-ws.cjs')];
  return require('./gateway-ws.cjs');
}

/** Disconnect all pool connections in a module and clear all reconnect timers */
function teardownModule(gw) {
  try {
    for (const c of gw.gatewayPool.list()) {
      gw.gatewayPool.disconnect(c.userId);
    }
  } catch (_) {}
}

function spawnMockGateway(port, token) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-gw-'));
  const child = spawn(process.execPath, [MOCK_BIN], {
    env: {
      ...process.env,
      OPENCLAW_GATEWAY_PORT: String(port),
      OPENCLAW_GATEWAY_TOKEN: token,
      OPENCLAW_HOME: tmp,
      // gateway-ws.cjs authenticates via connect RPC, not HTTP header
      MOCK_NO_HEADER_AUTH: '1',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
  });
  child.unref();
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      const sock = require('net').createConnection({ host: '127.0.0.1', port });
      sock.once('connect', () => { sock.end(); resolve(child.pid); });
      sock.once('error', () => {
        if (Date.now() - start > 5000) reject(new Error(`mock did not start on port ${port}`));
        else setTimeout(poll, 100);
      });
    })();
  });
}

function killPid(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
}

// Pick ports outside the orchestrator allocation range (19000-19999) to avoid clash.
let nextPort = 28100;
function pickPort() { return nextPort++; }

// ─── Tests ────────────────────────────────────────────────────────────────────
// All tests are serial (concurrency: false) because freshGwModule() mutates the
// require.cache and spawned mocks must not share ports across concurrent runs.

test('pool.forUser: returns same instance for same userId', (_, done) => {
  const gw = freshGwModule();
  const a = gw.gatewayPool.forUser(2);
  const b = gw.gatewayPool.forUser(2);
  assert.strictEqual(a, b);
  teardownModule(gw);
  done();
});

test('pool.forUser: different users get distinct connections', (_, done) => {
  const gw = freshGwModule();
  const a = gw.gatewayPool.forUser(2);
  const b = gw.gatewayPool.forUser(3);
  assert.notStrictEqual(a, b);
  assert.equal(a.userId, 2);
  assert.equal(b.userId, 3);
  teardownModule(gw);
  done();
});

test('pool.has: false until forUser is called, then true', (_, done) => {
  const gw = freshGwModule();
  assert.equal(gw.gatewayPool.has(99), false);
  gw.gatewayPool.forUser(99);
  assert.equal(gw.gatewayPool.has(99), true);
  teardownModule(gw);
  done();
});

test('pool.list: returns snapshot of registered connections', (_, done) => {
  const gw = freshGwModule();
  gw.gatewayPool.forUser(2);
  gw.gatewayPool.forUser(3);
  const list = gw.gatewayPool.list();
  const userIds = list.map(x => x.userId).sort();
  // user 1 is in there too because the module-level shim registered it
  assert.ok(userIds.includes(2));
  assert.ok(userIds.includes(3));
  teardownModule(gw);
  done();
});

test('connection.sendReq before connect: rejects with GatewayNotConnectedError', async () => {
  const gw = freshGwModule();
  const conn = gw.gatewayPool.forUser(7);
  await assert.rejects(
    conn.sendReq('ping', {}),
    (e) => e.name === 'GatewayNotConnectedError' && e.userId === 7,
  );
  teardownModule(gw);
});

test('shim identity: gatewayProxy === pool.forUser(1)', (_, done) => {
  const gw = freshGwModule();
  assert.strictEqual(gw.gatewayProxy, gw.gatewayPool.forUser(1));
  assert.equal(gw.gatewayProxy.userId, 1);
  teardownModule(gw);
  done();
});

test('connection lifecycle: connect to mock → isConnected true → RPC echo → disconnect', async () => {
  const gw = freshGwModule();
  const port = pickPort();
  const token = 'test-token-' + port;
  const mockPid = await spawnMockGateway(port, token);
  try {
    const conn = gw.gatewayPool.forUser(42);
    conn.connect({ port, token });
    const start = Date.now();
    while (!conn.isConnected && Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(conn.isConnected, true, 'connection did not establish');

    const result = await conn.sendReq('ping', { hello: 'world' });
    // sendReq resolves with msg.payload → { echoed: { method, params } }
    assert.deepEqual(result, { echoed: { method: 'ping', params: { hello: 'world' } } });

    conn.disconnect();
    assert.equal(conn.isConnected, false);
  } finally {
    killPid(mockPid);
    teardownModule(gw);
    await new Promise(r => setTimeout(r, 200));
  }
});

test('listener isolation: events on conn-A do not leak to conn-B', async () => {
  const gw = freshGwModule();
  const portA = pickPort();
  const portB = pickPort();
  const tokenA = 'token-a-' + portA;
  const tokenB = 'token-b-' + portB;
  const pidA = await spawnMockGateway(portA, tokenA);
  const pidB = await spawnMockGateway(portB, tokenB);
  try {
    const connA = gw.gatewayPool.forUser(20);
    const connB = gw.gatewayPool.forUser(21);
    connA.connect({ port: portA, token: tokenA });
    connB.connect({ port: portB, token: tokenB });
    const start = Date.now();
    while ((!connA.isConnected || !connB.isConnected) && Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(connA.isConnected && connB.isConnected, 'both must connect');

    const eventsA = [];
    const eventsB = [];
    connA.addListener((e) => eventsA.push(e));
    connB.addListener((e) => eventsB.push(e));

    // Send a non-RPC message to A's mock → A's mock broadcasts back as { type:'broadcast', payload:{...} }
    connA.ws.send(JSON.stringify({ tag: 'A-only' }));

    await new Promise(r => setTimeout(r, 400));

    // A should have received its own broadcast; B should not.
    // The mock echoes non-RPC frames as { type:'event', event:'broadcast', payload: msg },
    // which _handleMessage routes via broadcast() as { type:'gateway:event', payload:{ event:'broadcast', data: msg } }.
    const hasATag = (e) =>
      e?.payload?.data?.tag === 'A-only' ||  // gateway:event shape
      e?.payload?.tag === 'A-only' ||         // direct payload shape
      e?.tag === 'A-only';                    // top-level shape
    assert.ok(eventsA.some(hasATag),
              'A missed its event; got: ' + JSON.stringify(eventsA));
    assert.ok(!eventsB.some(hasATag),
              'B leaked event from A');

    connA.disconnect();
    connB.disconnect();
  } finally {
    killPid(pidA);
    killPid(pidB);
    teardownModule(gw);
    await new Promise(r => setTimeout(r, 200));
  }
});

test('pool.disconnect: closes WS and removes from has()', async () => {
  const gw = freshGwModule();
  const port = pickPort();
  const token = 'tok-disc-' + port;
  const mockPid = await spawnMockGateway(port, token);
  try {
    const conn = gw.gatewayPool.forUser(55);
    conn.connect({ port, token });
    const start = Date.now();
    while (!conn.isConnected && Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(conn.isConnected);

    gw.gatewayPool.disconnect(55);

    assert.equal(gw.gatewayPool.has(55), false);
    assert.equal(conn.isConnected, false);
  } finally {
    killPid(mockPid);
    teardownModule(gw);
    await new Promise(r => setTimeout(r, 200));
  }
});

test('non-admin user with no port → connect() warns and skips (does not throw)', (_, done) => {
  const gw = freshGwModule();
  const conn = gw.gatewayPool.forUser(123);
  assert.doesNotThrow(() => conn.connect({}));
  assert.equal(conn.isConnected, false);
  teardownModule(gw);
  done();
});
