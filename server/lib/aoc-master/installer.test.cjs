const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function setupHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-master-test-'));
  fs.writeFileSync(path.join(dir, 'openclaw.json'), JSON.stringify({
    agents: { list: [], defaults: {} },
  }));
  process.env.OPENCLAW_HOME = dir;
  process.env.OPENCLAW_STATE_DIR = dir;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/server/lib/config.cjs') || k.includes('/server/lib/aoc-master/')) delete require.cache[k];
  }
  return dir;
}

test('install writes SKILL.md and 3 executable scripts', () => {
  const home = setupHome();
  const inst = require('./installer.cjs');
  const r = inst.install();
  assert.equal(r.ok, true);
  assert.ok(r.written >= 4, `expected >=4 files written, got ${r.written}`);

  const root = path.join(home, 'skills', 'aoc-master');
  assert.ok(fs.existsSync(path.join(root, 'SKILL.md')));
  for (const s of ['team-status.sh', 'delegate.sh', 'list-team-roles.sh']) {
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

test('ensureSkillEnabledForUserMasters adds aoc-master to master agents only', () => {
  const home = setupHome();
  const cfgPath = path.join(home, 'openclaw.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    agents: {
      list: [
        { id: 'master-a', name: 'Master A', skills: [] },
        { id: 'sub-b', name: 'Sub B', skills: [] },
      ],
      defaults: { skills: [] },
    },
  }));

  const inst = require('./installer.cjs');
  const r = inst.ensureSkillEnabledForUserMasters({ masterAgentIds: ['master-a'] });
  assert.equal(r.changed, true);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  const master = cfg.agents.list.find(a => a.id === 'master-a');
  const sub = cfg.agents.list.find(a => a.id === 'sub-b');
  assert.ok(master.skills.includes('aoc-master'));
  assert.ok(!sub.skills.includes('aoc-master'));
});
