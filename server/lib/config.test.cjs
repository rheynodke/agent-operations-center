'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');

const config = require('./config.cjs');

const HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');

test('getUserHome: admin (user 1) maps to root OPENCLAW_HOME', () => {
  assert.equal(config.getUserHome(1), HOME);
});

test('getUserHome: admin (user "1" string) also maps to root', () => {
  assert.equal(config.getUserHome('1'), HOME);
});

test('getUserHome: user 2 maps to nested users subdir', () => {
  assert.equal(config.getUserHome(2), path.join(HOME, 'users', '2', '.openclaw'));
});

test('getUserHome: user 99 maps to nested users subdir', () => {
  assert.equal(config.getUserHome(99), path.join(HOME, 'users', '99', '.openclaw'));
});

test('getUserAgentsDir: composes user home with /agents suffix', () => {
  assert.equal(config.getUserAgentsDir(2), path.join(HOME, 'users', '2', '.openclaw', 'agents'));
  assert.equal(config.getUserAgentsDir(1), path.join(HOME, 'agents'));
});

test('getUserCronFile: composes user home with cron/jobs.json suffix', () => {
  assert.equal(config.getUserCronFile(2), path.join(HOME, 'users', '2', '.openclaw', 'cron', 'jobs.json'));
  assert.equal(config.getUserCronFile(1), path.join(HOME, 'cron', 'jobs.json'));
});

test('SHARED_SKILLS points to ~/.openclaw/skills (existing location, now treated as shared pool)', () => {
  assert.equal(config.SHARED_SKILLS, path.join(HOME, 'skills'));
});

test('SHARED_SCRIPTS points to ~/.openclaw/scripts', () => {
  assert.equal(config.SHARED_SCRIPTS, path.join(HOME, 'scripts'));
});

test('SHARED_PROVIDERS points to ~/.openclaw/shared/providers.json5', () => {
  assert.equal(config.SHARED_PROVIDERS, path.join(HOME, 'shared', 'providers.json5'));
});

test('back-compat: OPENCLAW_HOME equals SHARED resources parent (admin home)', () => {
  assert.equal(config.OPENCLAW_HOME, HOME);
});

test('back-compat: AGENTS_DIR equals admin agents dir', () => {
  assert.equal(config.AGENTS_DIR, path.join(HOME, 'agents'));
});
