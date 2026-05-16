'use strict';
// Isolate from production port range (19000-19999). Must be set BEFORE
// gateway-orchestrator.cjs is required, since the range is read at module load.
process.env.AOC_GATEWAY_PORT_RANGE_START ||= '29000';
process.env.AOC_GATEWAY_PORT_RANGE_END   ||= '29999';
const TEST_PORT_RANGE_START = Number(process.env.AOC_GATEWAY_PORT_RANGE_START);
const TEST_PORT_RANGE_END   = Number(process.env.AOC_GATEWAY_PORT_RANGE_END);

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

let orchestrator;

// Safety net: if any test forgets to await stopGateway() (e.g. on assertion
// failure before cleanup), the mock-binary children survive the test process
// and keep the parent test runner's event loop alive — historically causing
// 10-minute hangs and "Promise resolution still pending" failures. Kill any
// mock-binary descendant on exit so a test bug never blocks CI shutdown.
function killStrayMocks() {
  try {
    const out = execSync(
      'pgrep -f gateway-orchestrator.mock-binary.cjs 2>/dev/null || true',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const myPid = process.pid;
    const pids = out.split('\n').map(s => Number(s.trim())).filter(p => p && p !== myPid);
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
  } catch (_) { /* best-effort */ }
}
process.on('exit', killStrayMocks);
process.on('SIGINT', () => { killStrayMocks(); process.exit(130); });
process.on('SIGTERM', () => { killStrayMocks(); process.exit(143); });
// Runs after the last test in this file completes — clears leaked mocks
// before Node tries to drain the event loop. Without this, lingering child
// sockets keep the loop alive past the test runner's exit-wait window.
test.after(killStrayMocks);

function freshOrchestrator(tmpDataDir) {
  process.env.AOC_DATA_DIR = tmpDataDir;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./config.cjs')];
  delete require.cache[require.resolve('./gateway-orchestrator.cjs')];
  return require('./gateway-orchestrator.cjs');
}

test('generateToken: 64-char hex string, unique per call', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const a = orchestrator._test.generateToken();
  const b = orchestrator._test.generateToken();
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test('allocatePort: returns first DB-free 3-port slot in configured range, advances when DB rows occupy slots', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u3', 'x', 'user')");

  // Each gateway needs 3 consecutive ports (WS / canvas / browser-control).
  // Allocator strides by 3 AND probes the OS to skip in-use ports.
  // First call: should land on a 3-slot starting at PORT_RANGE_START+3k for some k.
  const p1 = await orchestrator._test.allocatePort();
  assert.ok(p1 >= TEST_PORT_RANGE_START && p1 < TEST_PORT_RANGE_END);
  assert.equal((p1 - TEST_PORT_RANGE_START) % 3, 0, 'allocations align to 3-port boundaries');

  // Mark p1 used in DB; next call must return a different (later) slot.
  db.setGatewayState(2, { port: p1, pid: 1, state: 'running' });
  const p2 = await orchestrator._test.allocatePort();
  assert.ok(p2 > p1, `expected later slot than ${p1}, got ${p2}`);

  db.setGatewayState(3, { port: p2, pid: 2, state: 'running' });
  const p3 = await orchestrator._test.allocatePort();
  assert.ok(p3 > p2);
});

test('allocatePort: throws when range is exhausted', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  for (let i = 1; i <= 1000; i++) {
    raw.run("INSERT INTO users (username, password_hash, role) VALUES (?, 'x', 'user')", [`u${i}`]);
  }
  for (let i = 1; i <= 1000; i++) {
    db.setGatewayState(i, { port: (TEST_PORT_RANGE_START - 1) + i, pid: i, state: 'running' });
  }
  await assert.rejects(orchestrator._test.allocatePort(), /port pool exhausted/);
});

test('ensureUserHome: creates directory skeleton + symlinks for non-admin user', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  fs.mkdirSync(process.env.OPENCLAW_HOME, { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  // Providers file used to be referenced via $include; now inlined. Use a
  // recognizable provider so we can assert it ended up in the merged config.
  fs.writeFileSync(
    path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'),
    JSON.stringify({ providers: { foo: { kind: 'test' } } }),
  );

  orchestrator = freshOrchestrator(tmp);
  const userHome = path.join(process.env.OPENCLAW_HOME, 'users', '2', '.openclaw');
  orchestrator._test.ensureUserHome(2, userHome);

  for (const sub of ['agents', 'sessions', 'cron', 'credentials', 'logs']) {
    assert.ok(fs.existsSync(path.join(userHome, sub)), `missing ${sub}`);
  }
  assert.ok(fs.lstatSync(path.join(userHome, 'skills')).isSymbolicLink(),  'skills not symlink');
  assert.ok(fs.lstatSync(path.join(userHome, 'scripts')).isSymbolicLink(), 'scripts not symlink');

  const cfg = JSON.parse(fs.readFileSync(path.join(userHome, 'openclaw.json'), 'utf8'));
  // Providers must be inlined (not via $include — OpenClaw rejects paths outside config root).
  assert.equal(cfg.providers?.foo?.kind, 'test', 'shared providers must be inlined into per-user config');
  assert.equal(cfg.gateway?.mode, 'local', 'gateway.mode must be local');
  assert.equal(cfg.gateway?.bind, 'loopback', 'gateway.bind must be loopback');
  assert.equal(cfg.gateway?.auth?.mode, 'token', 'gateway.auth.mode must be token');

  const cron = JSON.parse(fs.readFileSync(path.join(userHome, 'cron', 'jobs.json'), 'utf8'));
  assert.deepEqual(cron, { jobs: [] });

  delete process.env.OPENCLAW_HOME;
});

test('ensureUserHome: idempotent — re-running on existing skeleton does not error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  fs.mkdirSync(process.env.OPENCLAW_HOME, { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });

  orchestrator = freshOrchestrator(tmp);
  const userHome = path.join(process.env.OPENCLAW_HOME, 'users', '2', '.openclaw');
  orchestrator._test.ensureUserHome(2, userHome);
  assert.doesNotThrow(() => orchestrator._test.ensureUserHome(2, userHome));

  delete process.env.OPENCLAW_HOME;
});

test('spawnGateway: spawns mock binary, waits for readiness, persists DB state', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  const result = await orchestrator.spawnGateway(2);
  assert.ok(result.port >= TEST_PORT_RANGE_START && result.port <= TEST_PORT_RANGE_END);
  assert.ok(result.pid > 0);
  assert.ok(typeof result.token === 'string' && result.token.length === 64,
            `expected 64-char hex token, got ${result.token}`);

  const state = db.getGatewayState(2);
  assert.equal(state.port, result.port);
  assert.equal(state.pid, result.pid);
  assert.equal(state.state, 'running');

  // Cleanup: stop the spawned mock
  await orchestrator.stopGateway(2);

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('spawnGateway: throws GatewaySpawnError if mock fails immediately', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  process.env.MOCK_FAIL_MODE = 'immediate';
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  await assert.rejects(orchestrator.spawnGateway(2), /readiness|spawn/i);

  const state = db.getGatewayState(2);
  assert.equal(state.state, null);

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
  delete process.env.MOCK_FAIL_MODE;
});

test('stopGateway: SIGTERM then update DB state to stopped', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  const { pid } = await orchestrator.spawnGateway(2);
  await orchestrator.stopGateway(2);

  await new Promise(r => setTimeout(r, 500));
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, `pid ${pid} still alive after stopGateway`);

  const state = db.getGatewayState(2);
  assert.equal(state.state, 'stopped');
  assert.equal(state.port, null);
  assert.equal(state.pid, null);

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('restartGateway: stops then spawns again, new pid', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  const r1 = await orchestrator.spawnGateway(2);
  const r2 = await orchestrator.restartGateway(2);
  assert.notEqual(r1.pid, r2.pid);

  await orchestrator.stopGateway(2);
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('crash supervisor: child exit triggers respawn (1× backoff, faster in test)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  process.env.GATEWAY_BACKOFF_MS = '50,100,200';
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  const r1 = await orchestrator.spawnGateway(2);

  // Kill externally (simulate crash)
  process.kill(r1.pid, 'SIGKILL');

  // Wait for supervisor to respawn
  await new Promise(r => setTimeout(r, 2000));

  const state = db.getGatewayState(2);
  assert.equal(state.state, 'running', `expected respawn, got state=${state.state}`);
  assert.notEqual(state.pid, r1.pid);

  await orchestrator.stopGateway(2);
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
  delete process.env.GATEWAY_BACKOFF_MS;
});

test('getGatewayState: returns DB-backed state for any user', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");
  db.setGatewayState(2, { port: 19002, pid: 12345, state: 'running' });

  assert.deepEqual(orchestrator.getGatewayState(2), { port: 19002, pid: 12345, state: 'running' });
  assert.deepEqual(orchestrator.getGatewayState(99), { port: null, pid: null, state: null });
});

test('listGateways: returns all running entries from DB', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u3', 'x', 'user')");
  db.setGatewayState(2, { port: 19002, pid: 11111, state: 'running' });
  db.setGatewayState(3, { port: 19003, pid: 22222, state: 'running' });

  const list = orchestrator.listGateways();
  assert.equal(list.length, 2);
  assert.ok(list.find(x => x.userId === 2 && x.port === 19002));
  assert.ok(list.find(x => x.userId === 3 && x.port === 19003));
});

test('cleanupOrphans: re-attaches alive PIDs (does NOT kill running gateways)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  const r1 = await orchestrator.spawnGateway(2);
  // Forget from in-memory state to simulate AOC restart scenario
  orchestrator._test._dropFromMemory(2);

  await orchestrator.cleanupOrphans();

  // New behavior: gateway is RE-ATTACHED (still alive), not killed.
  await new Promise(r => setTimeout(r, 300));
  let alive = true; try { process.kill(r1.pid, 0); } catch { alive = false; }
  assert.equal(alive, true, 'gateway PID should still be alive after cleanupOrphans (re-attach, not kill)');
  // DB state preserved
  const state = db.getGatewayState(2);
  assert.equal(state.pid, r1.pid);
  assert.equal(state.port, r1.port);
  assert.equal(state.state, 'running');
  // Token persisted across "restart"
  assert.equal(orchestrator.getRunningToken(2), r1.token, 'token reattached from DB');

  // Cleanup: now stop it explicitly so we don't leak the mock
  await orchestrator.stopGateway(2);

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('getRunningToken: returns token after spawn, null after stop', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  assert.equal(orchestrator.getRunningToken(2), null, 'before spawn');

  const result = await orchestrator.spawnGateway(2);
  assert.equal(orchestrator.getRunningToken(2), result.token, 'after spawn');

  await orchestrator.stopGateway(2);
  assert.equal(orchestrator.getRunningToken(2), null, 'after stop');

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('gracefulShutdown: leaves per-user gateways running (clears in-memory map only)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u3', 'x', 'user')");

  const r1 = await orchestrator.spawnGateway(2);
  const r2 = await orchestrator.spawnGateway(3);

  await orchestrator.gracefulShutdown();
  await new Promise(r => setTimeout(r, 300));
  // New behavior: gateways MUST keep running so per-tenant isolation survives
  // an AOC pm2 restart. gracefulShutdown only clears the in-memory child map.
  for (const pid of [r1.pid, r2.pid]) {
    let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
    assert.equal(alive, true, `pid ${pid} should remain alive after gracefulShutdown (per-tenant isolation)`);
  }
  // DB rows retained so cleanupOrphans on next AOC start can re-attach
  const list = db.listGatewayStates();
  assert.equal(list.length, 2, 'DB rows preserved across graceful shutdown');

  // Test cleanup: explicitly stop both so the mocks don't leak across tests
  await orchestrator.stopGateway(2);
  await orchestrator.stopGateway(3);

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('spawnGateway: fails fast (< 5s) when mock exits immediately', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  process.env.MOCK_FAIL_MODE = 'immediate';
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  const start = Date.now();
  await assert.rejects(orchestrator.spawnGateway(2));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `expected fail-fast under 5s, took ${elapsed}ms`);

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
  delete process.env.MOCK_FAIL_MODE;
});

test('cleanupOrphans: alive PID is re-attached, NOT killed (per-tenant isolation)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");

  const userId = 2;
  // Spawn a real mock-binary child so we have a verifiable alive PID
  const { pid } = await orchestrator.spawnGateway(userId);

  // Sanity: PID is alive, DB row exists
  let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, true, 'pre: child must be alive');
  assert.equal(db.getGatewayState(userId).pid, pid);

  // Drop from in-memory map so cleanupOrphans treats it as an orphan
  orchestrator._test._dropFromMemory(userId);

  await orchestrator.cleanupOrphans();

  // New behavior: gateway is RE-ATTACHED, not killed (per-tenant isolation
  // across AOC pm2 restart). PID stays alive, DB state preserved.
  await new Promise(r => setTimeout(r, 300));
  alive = true; try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, true, 'cleanupOrphans must NOT kill running gateways');

  const row = db.getGatewayState(userId);
  assert.equal(row.pid, pid, 'DB row preserved');
  assert.equal(row.state, 'running');

  // Cleanup
  await orchestrator.stopGateway(userId);

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('orchestrator emits "spawned" event on successful spawn', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u11', 'x', 'user')");

  const events = [];
  const onSpawn = (payload) => events.push(payload);
  orchestrator.on('spawned', onSpawn);
  try {
    const userId = 2; // second inserted user gets id=2
    const { port, pid } = await orchestrator.spawnGateway(userId);
    assert.equal(events.length, 1);
    assert.equal(events[0].userId, userId);
    assert.equal(events[0].port, port);
    assert.equal(events[0].pid, pid);
  } finally {
    orchestrator.off('spawned', onSpawn);
    await orchestrator.stopGateway(2).catch(() => {});
  }

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('orchestrator emits "stopped" event on stopGateway', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
  process.env.OPENCLAW_BIN = path.join(__dirname, 'gateway-orchestrator.mock-binary.cjs');
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.OPENCLAW_HOME, 'shared', 'providers.json5'), '{}');

  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u12', 'x', 'user')");

  const userId = 2; // second inserted user gets id=2
  await orchestrator.spawnGateway(userId);

  const events = [];
  const onStop = (payload) => events.push(payload);
  orchestrator.on('stopped', onStop);
  try {
    await orchestrator.stopGateway(userId);
    assert.equal(events.length, 1);
    assert.equal(events[0].userId, userId);
  } finally {
    orchestrator.off('stopped', onStop);
  }

  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_BIN;
});

test('listGatewaysRich: returns user info + process probe + activity probe', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();

  const realList = db.listGatewayStates;
  const realAll = db.getAllUsers;
  db.listGatewayStates = () => [
    { userId: 99, port: 19090, pid: process.pid, state: 'running' },
    { userId: 100, port: 19091, pid: 1, state: 'running' },
  ];
  db.getAllUsers = () => [
    { id: 99, username: 'u99', display_name: null, role: 'user', master_agent_id: 'main' },
    { id: 100, username: 'u100', display_name: null, role: 'user', master_agent_id: 'main' },
    { id: 1, username: 'admin', display_name: null, role: 'admin', master_agent_id: 'main' },
  ];

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-home-'));
  fs.mkdirSync(path.join(tmpHome, 'agents', 'main', 'sessions'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, 'agents', 'main', 'sessions', 'sessions.json'),
    JSON.stringify({
      'agent:main:telegram:direct:1': { sessionId: 'a', updatedAt: Date.now() - 60_000 },
    }),
  );

  const out = await orchestrator.listGatewaysRich({
    homeResolver: () => tmpHome,
    agentResolver: () => 'main',
    now: Date.now(),
  });

  db.listGatewayStates = realList;
  db.getAllUsers = realAll;
  fs.rmSync(tmpHome, { recursive: true, force: true });

  assert.equal(Array.isArray(out), true);
  // 2 non-admin tenants returned; admin (uid=1) filtered out
  assert.equal(out.length, 2);

  const row = out.find((r) => r.userId === 99);
  assert.equal(row.state, 'running');
  assert.equal(row.username, 'u99');
  assert.equal(typeof row.uptimeSeconds, 'number');
  assert.equal(typeof row.rssMb, 'number');
  assert.ok(row.activity);
  assert.equal(row.activity.messagesLast1h, 1);
});

test('listGatewaysRich: dead pid → state=stale, null metrics', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();

  const realList = db.listGatewayStates;
  const realAll = db.getAllUsers;
  db.listGatewayStates = () => [
    { userId: 99, port: 19090, pid: 999999, state: 'running' },
  ];
  db.getAllUsers = () => [
    { id: 99, username: 'u99', display_name: null, role: 'user', master_agent_id: 'main' },
  ];

  const out = await orchestrator.listGatewaysRich({
    homeResolver: () => '/nonexistent',
    agentResolver: () => 'main',
    now: Date.now(),
  });

  db.listGatewayStates = realList;
  db.getAllUsers = realAll;

  assert.equal(out[0].state, 'stale');
  assert.equal(out[0].uptimeSeconds, null);
  assert.equal(out[0].rssMb, null);
  assert.equal(out[0].cpuPercent, null);
  assert.equal(out[0].activity, null);
});

test('listGatewaysRich: includes users with no gateway row as stopped', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();

  const realList = db.listGatewayStates;
  const realAll = db.getAllUsers;
  // No state rows at all → every tenant must still appear, all stopped
  db.listGatewayStates = () => [];
  db.getAllUsers = () => [
    { id: 50, username: 'never-started-1', display_name: null, role: 'user', master_agent_id: 'main' },
    { id: 51, username: 'never-started-2', display_name: 'Alice', role: 'user', master_agent_id: 'main' },
    { id: 1,  username: 'admin', display_name: null, role: 'admin', master_agent_id: 'main' },
  ];

  const out = await orchestrator.listGatewaysRich({
    homeResolver: () => '/nonexistent',
    agentResolver: () => 'main',
    now: Date.now(),
  });

  db.listGatewayStates = realList;
  db.getAllUsers = realAll;

  assert.equal(out.length, 2, 'admin must be filtered, both tenants must appear');
  assert.equal(out[0].state, 'stopped');
  assert.equal(out[0].port, null);
  assert.equal(out[0].pid, null);
  assert.equal(out[1].displayName, 'Alice');
});

test('runBulkGatewayAction: serialises calls, returns per-user results, continues on failure', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const calls = [];
  const stubOrchestrator = {
    spawnGateway: async (uid) => {
      calls.push(['spawn', uid]);
      if (uid === 5) throw new Error('spawn boom');
      return { port: 19000 + uid, pid: 1000 + uid };
    },
    stopGateway: async (uid) => { calls.push(['stop', uid]); },
    restartGateway: async (uid) => {
      calls.push(['restart', uid]);
      return { port: 19000 + uid, pid: 2000 + uid };
    },
  };

  const r = await orchestrator.runBulkGatewayAction(
    { action: 'start', userIds: [3, 5, 8], delaySeconds: 0 },
    { lifecycle: stubOrchestrator },
  );

  assert.deepEqual(calls.map((c) => c[0]), ['spawn', 'spawn', 'spawn']);
  assert.equal(r.results.length, 3);
  assert.equal(r.results[0].ok, true);
  assert.equal(r.results[1].ok, false);
  assert.match(r.results[1].error, /spawn boom/);
  assert.equal(r.results[2].ok, true);
});

test('runBulkGatewayAction: rejects unknown action', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  await assert.rejects(
    orchestrator.runBulkGatewayAction({ action: 'nuke', userIds: [1] }),
    /unknown action/i,
  );
});
