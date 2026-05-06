const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function setupHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-room-test-'));
  fs.writeFileSync(path.join(dir, 'openclaw.json'), JSON.stringify({
    agents: { list: [], defaults: {} },
  }));
  process.env.OPENCLAW_HOME = dir;
  process.env.OPENCLAW_STATE_DIR = dir;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/server/lib/config.cjs') || k.includes('/server/lib/aoc-room/')) delete require.cache[k];
  }
  return dir;
}

test('install writes SKILL.md and 6 executable scripts', () => {
  const home = setupHome();
  const inst = require('./installer.cjs');
  const r = inst.install();
  assert.equal(r.ok, true);
  assert.ok(r.written >= 7, `expected >=7 files written, got ${r.written}`);

  const root = path.join(home, 'skills', 'aoc-room');
  assert.ok(fs.existsSync(path.join(root, 'SKILL.md')));
  for (const s of ['room-publish.sh', 'room-list.sh', 'room-context-read.sh', 'room-context-append.sh', 'room-state-get.sh', 'room-state-set.sh']) {
    const p = path.join(root, 'scripts', s);
    assert.ok(fs.existsSync(p), `missing ${s}`);
    const stat = fs.statSync(p);
    assert.ok((stat.mode & 0o111) !== 0, `${s} not executable`);
  }
});

test('install is idempotent (second call writes 0 files)', () => {
  setupHome();
  const inst = require('./installer.cjs');
  inst.install();
  const r2 = inst.install();
  assert.equal(r2.ok, true);
  assert.equal(r2.written, 0);
});

test('ensureSkillEnabledForAllAgents adds aoc-room to all agents', () => {
  const home = setupHome();
  const cfgPath = path.join(home, 'openclaw.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    agents: {
      list: [
        { id: 'agent-a', name: 'Agent A', skills: [] },
        { id: 'agent-b', name: 'Agent B', skills: [] },
      ],
      defaults: { skills: [] },
    },
  }));

  const inst = require('./installer.cjs');
  const r = inst.ensureSkillEnabledForAllAgents();
  assert.equal(r.changed, true);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.ok(cfg.agents.defaults.skills.includes('aoc-room'));
  for (const agent of cfg.agents.list) {
    assert.ok(agent.skills.includes('aoc-room'), `${agent.id} missing aoc-room`);
  }
});
