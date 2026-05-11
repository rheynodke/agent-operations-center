// server/lib/embed/gateway-connector.test.cjs
// Unit tests for gateway-connector.cjs using require.cache injection to mock
// gatewayPool and orchestrator without touching real gateway infrastructure.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Load a fresh instance of gateway-connector.cjs with the provided mock
 * gatewayPool and orchestrator injected into require.cache before loading.
 */
function loadConnector({ mockConn, mockOrchestrator }) {
  // Resolve the keys we need to inject
  const gwWsKey = require.resolve('../gateway-ws.cjs');
  const orchKey = require.resolve('../gateway-orchestrator.cjs');
  const connKey = require.resolve('./gateway-connector.cjs');

  // Remove any previously loaded versions so we get a fresh module each test.
  delete require.cache[gwWsKey];
  delete require.cache[orchKey];
  delete require.cache[connKey];

  // Inject mocks
  require.cache[gwWsKey] = {
    id: gwWsKey,
    filename: gwWsKey,
    loaded: true,
    exports: { gatewayPool: { forUser(_ownerId) { return mockConn; } } },
  };
  require.cache[orchKey] = {
    id: orchKey,
    filename: orchKey,
    loaded: true,
    exports: mockOrchestrator,
  };

  return require('./gateway-connector.cjs');
}

// ─── Default mock objects ────────────────────────────────────────────────────

function makeOrchestrator(overrides = {}) {
  return {
    getGatewayState: () => ({ state: 'running', port: 12345 }),
    getRunningToken: () => 'mock-token',
    spawnGateway: async () => ({ port: 12345 }),
    ...overrides,
  };
}

// ─── Test 1: sendMessage returns text + tokens from gateway response ─────────

test('sendMessage returns text and tokens from gateway response', async () => {
  const mockConn = {
    isConnected: true,
    sessionsCreate: async (_agentId, _opts) => ({ sessionKey: 'test-session-key' }),
    chatSend: async (_sessionKey, _message) => ({
      final: { text: 'Hello from agent' },
      usage: { input_tokens: 42, output_tokens: 17 },
    }),
  };

  const { sendMessage } = loadConnector({
    mockConn,
    mockOrchestrator: makeOrchestrator(),
  });

  const result = await sendMessage({
    sessionKey: 'embed:embed-1:visitor-abc',
    ownerId: 2,
    agentId: 'my-agent',
    content: 'Hi there',
    visitorMeta: { name: 'Alice', email: 'alice@example.com', role: 'user' },
  });

  assert.equal(result.text, 'Hello from agent');
  assert.equal(result.tokens.in, 42);
  assert.equal(result.tokens.out, 17);
  assert.ok(result.raw, 'raw should be present');
  assert.equal(result.raw.final.text, 'Hello from agent');
});

// ─── Test 2: propagates gateway errors as throw ──────────────────────────────

test('sendMessage propagates gateway chatSend errors as thrown Error', async () => {
  const mockConn = {
    isConnected: true,
    sessionsCreate: async () => ({ sessionKey: 'test-key' }),
    chatSend: async () => { throw new Error('gateway timeout'); },
  };

  const { sendMessage } = loadConnector({
    mockConn,
    mockOrchestrator: makeOrchestrator(),
  });

  await assert.rejects(
    () => sendMessage({
      sessionKey: 'embed:embed-1:visitor-xyz',
      ownerId: 2,
      agentId: 'my-agent',
      content: 'Hello?',
    }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /gateway timeout/);
      return true;
    }
  );
});

// ─── Test 3: attempts reconnect when isConnected=false ───────────────────────

test('sendMessage reconnects when isConnected is false', async () => {
  let connectCallCount = 0;
  let isConnectedNow = false;  // starts disconnected

  const mockConn = {
    get isConnected() { return isConnectedNow; },
    connect({ port, token }) {
      connectCallCount++;
      // Simulate WS handshake completing immediately after connect is called.
      isConnectedNow = true;
    },
    sessionsCreate: async () => ({ sessionKey: 'reconnected-key' }),
    chatSend: async () => ({
      final: { text: 'reconnected reply' },
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  };

  const { sendMessage } = loadConnector({
    mockConn,
    mockOrchestrator: makeOrchestrator(),
  });

  const result = await sendMessage({
    sessionKey: 'embed:embed-2:visitor-def',
    ownerId: 3,
    agentId: 'my-agent',
    content: 'Anyone there?',
  });

  // connect should have been called exactly once to re-establish the session
  assert.equal(connectCallCount, 1, 'connect should be called once to reconnect');
  assert.equal(result.text, 'reconnected reply');
  assert.equal(result.tokens.in, 10);
  assert.equal(result.tokens.out, 5);
});
