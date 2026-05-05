'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function setupHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-prov-'));
  fs.writeFileSync(path.join(dir, 'openclaw.json'), JSON.stringify({
    agents: { list: [], defaults: { model: { primary: 'sonnet' } } },
    config: { bindings: [], channels: {} },
  }));
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'workspaces'), { recursive: true });
  return dir;
}

function freshRequire(home) {
  process.env.OPENCLAW_HOME = home;
  // Force re-require so OPENCLAW_HOME picks up the env override
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/server/lib/config.cjs') || key.includes('/server/lib/agents/')) {
      delete require.cache[key];
    }
  }
  return require('./provision.cjs');
}

test('provisionAgent with isMaster=true marks entry, returns flag, and appends SOUL addendum', () => {
  const home = setupHome();
  const { provisionAgent } = freshRequire(home);

  const result = provisionAgent({
    id: 'master-1',
    name: 'Master One',
    emoji: '🧭',
    soulContent: 'Custom soul.',
    isMaster: true,
  }, 1);

  assert.equal(result.ok, true);
  assert.equal(result.isMaster, true);

  // isMaster is tracked in SQLite, NOT in openclaw.json (OpenClaw rejects unknown keys).
  // The return value carries the flag; the JSON entry should NOT have isMaster.
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'openclaw.json'), 'utf-8'));
  const entry = cfg.agents.list.find(a => a.id === 'master-1');
  assert.ok(entry, 'agent entry must exist in openclaw.json');
  assert.equal(entry.isMaster, undefined, 'isMaster must not be written to openclaw.json');

  const soul = fs.readFileSync(path.join(result.workspacePath, 'SOUL.md'), 'utf-8');
  assert.match(soul, /Master Agent/, 'SOUL should contain Master addendum heading');
  assert.match(soul, /orchestrate/i, 'SOUL should describe orchestration role');
});

test('provisionAgent without isMaster does not set the flag', () => {
  const home = setupHome();
  const { provisionAgent } = freshRequire(home);

  const result = provisionAgent({ id: 'sub-1', name: 'Sub One' }, 1);

  assert.equal(result.isMaster, undefined);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'openclaw.json'), 'utf-8'));
  const entry = cfg.agents.list.find(a => a.id === 'sub-1');
  assert.equal(entry.isMaster, undefined);
});

test('provisionAgent with isMaster=true adds aoc-master to entry.skills allowlist', () => {
  const home = setupHome();
  const { provisionAgent } = freshRequire(home);

  const result = provisionAgent({
    id: 'mm', name: 'Master Master', isMaster: true,
  }, 1);

  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'openclaw.json'), 'utf-8'));
  const entry = cfg.agents.list.find(a => a.id === 'mm');
  assert.ok(Array.isArray(entry.skills), 'entry.skills must be an array for masters');
  assert.ok(entry.skills.includes('aoc-master'), `expected aoc-master in skills, got ${JSON.stringify(entry.skills)}`);
  assert.equal(result.isMaster, true);
});
