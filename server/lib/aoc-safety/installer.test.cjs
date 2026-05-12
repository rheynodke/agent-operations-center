'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Sandbox each test in a temp OPENCLAW_HOME so we don't touch the real one.
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-safety-test-'));
  process.env.OPENCLAW_HOME = dir;
  // Clear cached config module so it re-reads OPENCLAW_HOME.
  delete require.cache[require.resolve('../config.cjs')];
  return dir;
}

test('installSafe writes core and worker SKILL.md files', () => {
  const home = makeSandbox();
  delete require.cache[require.resolve('./installer.cjs')];
  const installer = require('./installer.cjs');

  installer.installSafe();

  const coreSkill = path.join(home, 'skills', 'aoc-safety-core', 'SKILL.md');
  const workerSkill = path.join(home, 'skills', 'aoc-safety-worker', 'SKILL.md');

  assert.ok(fs.existsSync(coreSkill), 'core SKILL.md missing');
  assert.ok(fs.existsSync(workerSkill), 'worker SKILL.md missing');

  const coreContent = fs.readFileSync(coreSkill, 'utf-8');
  const workerContent = fs.readFileSync(workerSkill, 'utf-8');
  assert.match(coreContent, /# aoc-safety-core/);
  assert.match(workerContent, /# aoc-safety-worker/);
});

test('ensureCoreEnabledForAllAgents adds slug to admin defaults + agent allowlists', async () => {
  const home = makeSandbox();
  // Seed an admin openclaw.json with one agent that has an explicit skills list.
  const adminCfg = path.join(home, 'openclaw.json');
  fs.writeFileSync(adminCfg, JSON.stringify({
    agents: {
      defaults: { skills: ['x'] },
      list: [
        { id: 'main', name: 'Main', skills: ['existing'] },
        { id: 'helper', name: 'Helper' }, // no explicit skills → inherits defaults
      ],
    },
  }, null, 2));

  delete require.cache[require.resolve('./installer.cjs')];
  const installer = require('./installer.cjs');
  installer.installSafe();
  await installer.ensureCoreEnabledForAllAgents();

  const cfg = JSON.parse(fs.readFileSync(adminCfg, 'utf-8'));
  assert.ok(cfg.agents.defaults.skills.includes('aoc-safety-core'), 'core missing from defaults');
  assert.ok(cfg.agents.defaults.skills.includes('x'), 'x preserved');
  const main = cfg.agents.list.find(a => a.id === 'main');
  assert.ok(main.skills.includes('aoc-safety-core'), 'core missing from main agent');
  assert.ok(main.skills.includes('existing'), 'existing skill preserved');
  const helper = cfg.agents.list.find(a => a.id === 'helper');
  assert.ok(helper.skills === undefined, 'helper still inherits defaults');
});

test('ensureCoreEnabledForAllAgents patches every per-user openclaw.json', async () => {
  const home = makeSandbox();
  fs.writeFileSync(path.join(home, 'openclaw.json'), JSON.stringify({
    agents: { defaults: { skills: [] }, list: [] },
  }));
  const user27Cfg = path.join(home, 'users', '27', '.openclaw', 'openclaw.json');
  fs.mkdirSync(path.dirname(user27Cfg), { recursive: true });
  fs.writeFileSync(user27Cfg, JSON.stringify({
    agents: {
      defaults: { skills: [] },
      list: [{ id: 'lumi', name: 'Lumi', skills: [] }],
    },
  }, null, 2));

  delete require.cache[require.resolve('./installer.cjs')];
  const installer = require('./installer.cjs');
  installer.installSafe();
  await installer.ensureCoreEnabledForAllAgents();

  const userCfg = JSON.parse(fs.readFileSync(user27Cfg, 'utf-8'));
  assert.ok(userCfg.agents.defaults.skills.includes('aoc-safety-core'));
  assert.ok(userCfg.agents.list[0].skills.includes('aoc-safety-core'));
});

test('ensureWorkerEnabledForNonMasterAgents adds worker to defaults + non-master agents only', async () => {
  const home = makeSandbox();
  fs.writeFileSync(path.join(home, 'openclaw.json'), JSON.stringify({
    agents: {
      defaults: { skills: [] },
      list: [{ id: 'main', name: 'Main', skills: [] }],
    },
  }));
  const user27Cfg = path.join(home, 'users', '27', '.openclaw', 'openclaw.json');
  fs.mkdirSync(path.dirname(user27Cfg), { recursive: true });
  fs.writeFileSync(user27Cfg, JSON.stringify({
    agents: {
      defaults: { skills: [] },
      list: [
        { id: 'lumi', name: 'Lumi (master)', skills: [] },
        { id: 'fox',  name: 'Fox (sub)',     skills: [] },
      ],
    },
  }, null, 2));

  delete require.cache[require.resolve('./installer.cjs')];
  const installer = require('./installer.cjs');
  installer.installSafe();

  // Master map: userId → masterAgentId. Admin (1) → 'main'; user 27 → 'lumi'.
  const masterByUser = { 1: 'main', 27: 'lumi' };
  await installer.ensureWorkerEnabledForNonMasterAgents({ masterByUser });

  // Admin: 'main' is a master, must NOT get worker. Defaults still get it.
  const adminCfg = JSON.parse(fs.readFileSync(path.join(home, 'openclaw.json'), 'utf-8'));
  assert.ok(adminCfg.agents.defaults.skills.includes('aoc-safety-worker'),
    'worker should be in admin defaults so new sub-agents inherit it');
  const main = adminCfg.agents.list.find(a => a.id === 'main');
  assert.ok(!main.skills.includes('aoc-safety-worker'),
    'main is admin master — must not get worker');

  // User 27: 'lumi' is master, 'fox' is worker.
  const u27 = JSON.parse(fs.readFileSync(user27Cfg, 'utf-8'));
  assert.ok(u27.agents.defaults.skills.includes('aoc-safety-worker'));
  const lumi = u27.agents.list.find(a => a.id === 'lumi');
  const fox  = u27.agents.list.find(a => a.id === 'fox');
  assert.ok(!lumi.skills.includes('aoc-safety-worker'), 'lumi is master — must not get worker');
  assert.ok(fox.skills.includes('aoc-safety-worker'),   'fox is sub-agent — must get worker');
});
