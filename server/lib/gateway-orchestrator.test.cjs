'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let orchestrator;

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

test('allocatePort: returns lowest-available port in 19000-19999 range', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aocgw-'));
  orchestrator = freshOrchestrator(tmp);
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u3', 'x', 'user')");

  assert.equal(await orchestrator._test.allocatePort(), 19000);

  db.setGatewayState(2, { port: 19000, pid: 1, state: 'running' });
  assert.equal(await orchestrator._test.allocatePort(), 19001);

  db.setGatewayState(3, { port: 19001, pid: 2, state: 'running' });
  assert.equal(await orchestrator._test.allocatePort(), 19002);
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
    db.setGatewayState(i, { port: 18999 + i, pid: i, state: 'running' });
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
  assert.ok(result.port >= 19000 && result.port <= 19999);
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

test('cleanupOrphans: kills alive PIDs and clears DB state for all users', async () => {
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

  await new Promise(r => setTimeout(r, 500));
  let alive = true; try { process.kill(r1.pid, 0); } catch { alive = false; }
  assert.equal(alive, false);

  assert.deepEqual(db.getGatewayState(2), { port: null, pid: null, state: null });
  assert.deepEqual(db.listGatewayStates(), []);

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

test('gracefulShutdown: SIGTERM all in-memory children, then return', async () => {
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
  await new Promise(r => setTimeout(r, 500));
  for (const pid of [r1.pid, r2.pid]) {
    let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
    assert.equal(alive, false, `pid ${pid} still alive after gracefulShutdown`);
  }

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

test('cleanupOrphans: kills alive child PID before clearing DB state (regression)', async () => {
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

  // Wait up to 1.5s for SIGTERM/SIGKILL to take effect
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    let stillAlive = true;
    try { process.kill(pid, 0); } catch { stillAlive = false; }
    if (!stillAlive) break;
    await new Promise(r => setTimeout(r, 50));
  }

  alive = true; try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, 'cleanupOrphans must kill alive child before clearing DB');

  const row = db.getGatewayState(userId);
  assert.ok(!row || row.pid == null, 'DB row must be cleared after kill');

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
