'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { buildSandboxProfile, writeProfileForUser } = require('./sandbox-profile.cjs');

test('buildSandboxProfile: denies cross-tenant subpaths but not own tenant', () => {
  const profile = buildSandboxProfile({
    ownerUserId: 3,
    peerUserIds: [1, 2, 4, 5],
    openclawBase: '/tmp/oc-test-home',
  });
  assert.match(profile, /\(version 1\)/);
  assert.match(profile, /\(allow default\)/);
  // Cross-tenant denies should include peers 2,4,5 (admin uid=1 excluded because
  // admin's home is openclawBase root, not openclawBase/users/1).
  assert.match(profile, /subpath "\/tmp\/oc-test-home\/users\/2"/);
  assert.match(profile, /subpath "\/tmp\/oc-test-home\/users\/4"/);
  assert.match(profile, /subpath "\/tmp\/oc-test-home\/users\/5"/);
  // Own tenant must NOT appear in deny list
  assert.doesNotMatch(profile, /subpath "\/tmp\/oc-test-home\/users\/3"/);
  // users/ parent must NOT be literally denied (would break realpath traversal)
  assert.doesNotMatch(profile, /\(deny file-read\* \(literal "\/tmp\/oc-test-home\/users"\)/);
  // Admin secrets
  assert.match(profile, /literal "\/tmp\/oc-test-home\/openclaw\.json"/);
  assert.match(profile, /literal "\/tmp\/oc-test-home\/exec-approvals\.json"/);
  assert.match(profile, /subpath "\/tmp\/oc-test-home\/credentials"/);
  assert.match(profile, /subpath "\/tmp\/oc-test-home\/identity"/);
});

test('buildSandboxProfile: handles no peers gracefully', () => {
  const profile = buildSandboxProfile({
    ownerUserId: 3,
    peerUserIds: [],
    openclawBase: '/tmp/oc-test-home',
  });
  assert.match(profile, /no peer tenants yet/);
  // Admin secrets block still applies
  assert.match(profile, /openclaw\.json/);
});

test('buildSandboxProfile: filters owner from peer list', () => {
  const profile = buildSandboxProfile({
    ownerUserId: 3,
    peerUserIds: [3, 4], // self accidentally included
    openclawBase: '/tmp/oc',
  });
  assert.doesNotMatch(profile, /subpath "\/tmp\/oc\/users\/3"/, 'must not deny self');
  assert.match(profile, /subpath "\/tmp\/oc\/users\/4"/);
});

test('writeProfileForUser: writes file with mode 0600', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-'));
  const file = writeProfileForUser({
    ownerUserId: 7,
    peerUserIds: [8],
    userHome: tmp,
    openclawBase: '/tmp/oc',
  });
  assert.ok(fs.existsSync(file));
  const stat = fs.statSync(file);
  assert.strictEqual(stat.mode & 0o777, 0o600);
  const content = fs.readFileSync(file, 'utf-8');
  assert.match(content, /subpath "\/tmp\/oc\/users\/8"/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('buildSandboxProfile: escapes special characters in paths', () => {
  const profile = buildSandboxProfile({
    ownerUserId: 3,
    peerUserIds: [4],
    openclawBase: '/tmp/with"quote',
  });
  // Profile must remain valid SBPL — literal `"` inside quotes must be escaped
  assert.match(profile, /with\\"quote/);
});
