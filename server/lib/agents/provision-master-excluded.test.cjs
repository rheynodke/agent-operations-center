'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

test('provisionAgent strips MASTER_EXCLUDED_SKILLS from master skills list', async () => {
  // Sandbox OPENCLAW_HOME
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-provision-test-'));
  process.env.OPENCLAW_HOME = home;
  process.env.OPENCLAW_BIN = '/bin/true'; // dummy

  // Seed admin openclaw.json with defaults that include the worker slug.
  fs.writeFileSync(path.join(home, 'openclaw.json'), JSON.stringify({
    models: { default: 'sonnet' },
    agents: {
      defaults: {
        workspace: path.join(home, 'workspace'),
        skills: ['aoc-tasks', 'aoc-safety-core', 'aoc-safety-worker'],
        tools: { fs: { workspaceOnly: true } },
      },
      list: [],
    },
  }, null, 2));

  // Re-require config + provision to pick up fresh OPENCLAW_HOME.
  delete require.cache[require.resolve('../config.cjs')];
  delete require.cache[require.resolve('./provision.cjs')];
  const { provisionAgent } = require('./provision.cjs');

  try {
    await provisionAgent({
      id: 'lumi',
      name: 'Lumi',
      isMaster: true,
    }, 1); // userId=1 (admin), so writes go to admin's openclaw.json
  } catch (err) {
    // Some side effects (db, syncAgentBuiltins) may fail in sandbox; we only
    // care about the openclaw.json skills outcome below.
    // eslint-disable-next-line no-console
    console.warn('[test] provisionAgent threw (non-fatal for skills check):', err.message);
  }

  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'openclaw.json'), 'utf-8'));
  const lumi = cfg.agents.list.find(a => a.id === 'lumi');
  assert.ok(lumi, 'lumi not provisioned');
  assert.ok(lumi.skills.includes('aoc-safety-core'), 'master should keep core');
  assert.ok(!lumi.skills.includes('aoc-safety-worker'), 'master must NOT have worker');
  assert.ok(lumi.skills.includes('aoc-master'), 'master should have aoc-master');
});

test('provisionAgent keeps worker skill for non-master agents', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-provision-test-'));
  process.env.OPENCLAW_HOME = home;
  process.env.OPENCLAW_BIN = '/bin/true';
  fs.writeFileSync(path.join(home, 'openclaw.json'), JSON.stringify({
    models: { default: 'sonnet' },
    agents: {
      defaults: {
        workspace: path.join(home, 'workspace'),
        skills: ['aoc-tasks', 'aoc-safety-core', 'aoc-safety-worker'],
        tools: { fs: { workspaceOnly: true } },
      },
      list: [],
    },
  }, null, 2));
  delete require.cache[require.resolve('../config.cjs')];
  delete require.cache[require.resolve('./provision.cjs')];
  const { provisionAgent } = require('./provision.cjs');

  try {
    await provisionAgent({ id: 'fox', name: 'Fox' }, 1);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[test] provisionAgent threw (non-fatal for skills check):', err.message);
  }

  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'openclaw.json'), 'utf-8'));
  const fox = cfg.agents.list.find(a => a.id === 'fox');
  assert.ok(fox, 'fox not provisioned');
  assert.ok(fox.skills.includes('aoc-safety-core'));
  assert.ok(fox.skills.includes('aoc-safety-worker'), 'sub-agent should have worker');
});
