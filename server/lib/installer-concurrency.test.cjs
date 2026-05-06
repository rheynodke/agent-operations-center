'use strict';

/**
 * installer-concurrency.test.cjs — Verifies that installer ensure* functions
 * don't clobber each other under concurrent execution.
 *
 * Pre-fix (before withFileLock wrap), running ensureSkillEnabledForAllAgents
 * for 4 distinct slugs in parallel against a stub openclaw.json would only
 * persist the LAST writer's view of agents.defaults.skills — losing the other
 * 3 slugs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Build an isolated OPENCLAW_HOME for this test run.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-installer-conc-'));
process.env.OPENCLAW_HOME = TMP;
process.env.OPENCLAW_BASE = TMP;

// Seed openclaw.json with 20 master agent stubs so ensure* has work to do.
const cfgPath = path.join(TMP, 'openclaw.json');
const seed = {
  agents: {
    defaults: { skills: [] },
    list: Array.from({ length: 20 }, (_, i) => ({
      id: `agent${i}`,
      skills: [],
    })),
  },
  skills: { entries: {} },
};
fs.writeFileSync(cfgPath, JSON.stringify(seed, null, 2));

// Now require installers — they read OPENCLAW_HOME at module load via config.cjs.
const aocTasks = require('./aoc-tasks/installer.cjs');
const aocConnections = require('./aoc-connections/installer.cjs');
const aocRoom = require('./aoc-room/installer.cjs');
const aocMaster = require('./aoc-master/installer.cjs');

test('parallel ensureSkillEnabledForAllAgents across 3 slugs — no slug lost', async () => {
  // Reset
  fs.writeFileSync(cfgPath, JSON.stringify(seed, null, 2));

  // Fire 30 parallel calls (10 each across 3 installers) to maximize chance
  // of read-modify-write interleaving.
  const work = [];
  for (let i = 0; i < 10; i++) {
    work.push(aocTasks.ensureSkillEnabledForAllAgents());
    work.push(aocConnections.ensureSkillEnabledForAllAgents());
    work.push(aocRoom.ensureSkillEnabledForAllAgents());
  }
  await Promise.all(work);

  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  const defaults = new Set(cfg.agents.defaults.skills);
  assert.ok(defaults.has('aoc-tasks'), 'aoc-tasks missing from defaults');
  assert.ok(defaults.has('aoc-connections'), 'aoc-connections missing from defaults');
  assert.ok(defaults.has('aoc-room'), 'aoc-room missing from defaults');

  // Every per-agent allowlist should also have all 3 slugs.
  for (const agent of cfg.agents.list) {
    const set = new Set(agent.skills);
    assert.ok(set.has('aoc-tasks'), `${agent.id} missing aoc-tasks`);
    assert.ok(set.has('aoc-connections'), `${agent.id} missing aoc-connections`);
    assert.ok(set.has('aoc-room'), `${agent.id} missing aoc-room`);
  }
});

test('parallel ensureSkillEnabledForUserMasters across 20 masters — no agent lost', async () => {
  fs.writeFileSync(cfgPath, JSON.stringify(seed, null, 2));

  // Each call enrols ONE agent. 20 parallel calls.
  await Promise.all(
    seed.agents.list.map((a) =>
      aocMaster.ensureSkillEnabledForUserMasters({ masterAgentIds: [a.id] }),
    ),
  );

  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  for (const agent of cfg.agents.list) {
    assert.ok(
      agent.skills.includes('aoc-master'),
      `${agent.id} missing aoc-master enrolment after parallel run`,
    );
  }
});

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});
