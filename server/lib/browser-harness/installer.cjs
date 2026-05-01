'use strict';
/**
 * browser-harness installer.
 *
 * Layer 1 of the AOC built-in browser-harness skill.
 * Auto-clones the upstream `browser-use/browser-harness` repo to:
 *   ~/.openclaw/skills/browser-harness-core/upstream/
 * pinned to a known commit. Idempotent — skips work when the on-disk commit
 * matches the pinned hash. The user can trigger a manual upgrade via
 * `installCore({ commit: <newSha> })` from the dashboard.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { OPENCLAW_HOME } = require('../config.cjs');

// Pinned to current main HEAD as of 2026-04-30. Bump explicitly when upgrading.
const PINNED_COMMIT = 'd1209ab99c72b6c69f8097afb6285a6d454d709b';
const UPSTREAM_REPO = 'https://github.com/browser-use/browser-harness.git';

function skillRoot() {
  return path.join(OPENCLAW_HOME, 'skills', 'browser-harness-core');
}
function upstreamDir() {
  return path.join(skillRoot(), 'upstream');
}
function manifestPath() {
  return path.join(skillRoot(), 'manifest.json');
}
function profilesRoot() {
  return path.join(OPENCLAW_HOME, 'browser-harness', 'profiles');
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf-8')); }
  catch { return null; }
}

function writeManifest(data) {
  fs.mkdirSync(skillRoot(), { recursive: true });
  fs.writeFileSync(manifestPath(), JSON.stringify(data, null, 2));
}

function currentCommit() {
  if (!fs.existsSync(path.join(upstreamDir(), '.git'))) return null;
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: upstreamDir(), encoding: 'utf-8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function status() {
  const have = currentCommit();
  const manifest = readManifest();
  return {
    installed: Boolean(have),
    pinnedCommit: PINNED_COMMIT,
    currentCommit: have,
    upToDate: have === PINNED_COMMIT,
    upstreamDir: upstreamDir(),
    skillRoot: skillRoot(),
    profilesRoot: profilesRoot(),
    installedAt: manifest?.installedAt || null,
  };
}

function ensureSkillScaffolding() {
  fs.mkdirSync(skillRoot(), { recursive: true });
  fs.mkdirSync(profilesRoot(), { recursive: true });

  const skillMd = path.join(skillRoot(), 'SKILL.md');
  if (!fs.existsSync(skillMd)) {
    fs.writeFileSync(skillMd, BUNDLED_SKILL_MD);
  }
}

/**
 * Install or upgrade the upstream browser-harness clone.
 * @param {{ commit?: string, force?: boolean }} opts
 */
function installCore(opts = {}) {
  const targetCommit = opts.commit || PINNED_COMMIT;
  ensureSkillScaffolding();

  const have = currentCommit();
  if (have === targetCommit && !opts.force) {
    return { ok: true, skipped: true, reason: 'already at target commit', commit: have };
  }

  const dir = upstreamDir();

  if (!fs.existsSync(path.join(dir, '.git'))) {
    // Fresh clone
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (fs.existsSync(dir)) {
      // empty/partial dir → wipe to ensure clean clone
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const clone = spawnSync('git', ['clone', '--quiet', UPSTREAM_REPO, dir], { encoding: 'utf-8' });
    if (clone.status !== 0) {
      throw new Error(`git clone failed: ${clone.stderr || clone.stdout || `exit ${clone.status}`}`);
    }
  } else {
    // Existing clone — fetch
    const fetch = spawnSync('git', ['fetch', '--quiet', 'origin'], { cwd: dir, encoding: 'utf-8' });
    if (fetch.status !== 0) {
      throw new Error(`git fetch failed: ${fetch.stderr || `exit ${fetch.status}`}`);
    }
  }

  // Checkout target commit (detached HEAD is fine for pinned mode)
  const checkout = spawnSync('git', ['checkout', '--quiet', targetCommit], { cwd: dir, encoding: 'utf-8' });
  if (checkout.status !== 0) {
    throw new Error(`git checkout ${targetCommit} failed: ${checkout.stderr || `exit ${checkout.status}`}`);
  }

  writeManifest({
    installedAt: new Date().toISOString(),
    commit: targetCommit,
    upstream: UPSTREAM_REPO,
  });

  return { ok: true, skipped: false, commit: targetCommit, dir };
}

/**
 * Best-effort install at AOC startup. Logs but doesn't throw — gateway shouldn't
 * fail to boot just because git is unreachable.
 */
function installCoreSafe() {
  try {
    const r = installCore();
    if (!r.skipped) console.log(`[browser-harness] installed core at ${r.commit}`);
    return r;
  } catch (err) {
    console.warn('[browser-harness] auto-install skipped:', err.message);
    return { ok: false, error: err.message };
  }
}

// Bundled SKILL.md — written on first install. User can edit; we don't overwrite.
const BUNDLED_SKILL_MD = `---
name: browser-harness-core
description: Built-in skill — connect to a real Chrome via CDP for high-fidelity browser automation. Layer 1 base. Inherit this for site-specific skills (Odoo, etc.).
type: built-in
layer: 1
---

# Browser Harness — Core

This skill lets the agent drive a real Chrome instance over the Chrome DevTools
Protocol (CDP). The AOC dashboard manages a pool of Chrome processes — when
you need a browser, you call \`browser-harness-acquire.sh\`; AOC auto-boots
Chrome if no slot is up and hands you the connection details.

## Quickstart (agent-facing)

\`\`\`bash
# 1. Reserve a browser slot — Chrome auto-boots if needed.
eval "$(browser-harness-acquire.sh --export)"
echo "Browser ready on port $AOC_BROWSER_PORT (slot $AOC_BROWSER_SLOT_ID)"
echo "WebSocket: $AOC_BROWSER_WS_URL"
echo "Profile dir: $AOC_BROWSER_PROFILE"

# 2. Drive Chrome via CDP. Use the Python harness helpers below or any CDP
#    library of your choice.
python3 - <<'PY'
import os, json, urllib.request
# Minimal CDP probe — just verify the slot is healthy
r = urllib.request.urlopen(f"http://127.0.0.1:{os.environ['AOC_BROWSER_PORT']}/json/version")
print(json.load(r)["Browser"])
PY

# 3. Always release the slot when done. AOC auto-quits idle Chromes after 5 min.
browser-harness-release.sh
\`\`\`

The \`--export\` flag emits \`export AOC_BROWSER_*=...\` lines so \`eval "$(...)"\`
sets four env vars in your shell:

| Env var                   | Meaning                                              |
| ------------------------- | ---------------------------------------------------- |
| \`AOC_BROWSER_SLOT_ID\`     | Pool slot number (1, 2, 3 — for release)             |
| \`AOC_BROWSER_PORT\`        | Local CDP port (e.g. 9222)                           |
| \`AOC_BROWSER_PROFILE\`     | Isolated Chrome user-data dir for this slot          |
| \`AOC_BROWSER_WS_URL\`      | \`ws://127.0.0.1:<port>/devtools/browser/<id>\`        |

## Using the upstream Python helpers

The full upstream \`browser-use/browser-harness\` repo is bundled at
\`upstream/\`. Helpers you'll typically use:

- \`upstream/src/browser_harness/\` — protected CDP wrapper. Read-only.
- \`upstream/agent-workspace/agent_helpers.py\` — generic helpers (screenshot,
  navigate, wait_for, fill, click). Extend as you go.
- \`upstream/agent-workspace/domain-skills/<site>/\` — site-specific selectors
  and flows. Each skill teaches the agent something the next run reuses.

\`\`\`python
import os
from browser_harness import connect

page = connect(ws_url=os.environ["AOC_BROWSER_WS_URL"])
page.goto("https://example.com")
page.screenshot("./outputs/example.png", full_page=True)
\`\`\`

## What you should NOT do

- Don't edit \`upstream/src/browser_harness/\` — protected core.
- Don't hardcode credentials. Pull them via the \`aoc_connect\` shared script
  when you need to log into a site (Odoo, Google, etc.).
- Don't skip \`browser-harness-release.sh\`. Stale "busy" slots block other
  agents.

## See also

- \`browser-harness-odoo\` (Layer 2) — login flow + Odoo navigation +
  UAT/manual formatters. Inherits this skill.
- Upstream docs: \`upstream/SKILL.md\`, \`upstream/install.md\`.
- Dashboard: Settings → Account → Browser Harness for pool status and
  manual admin controls (boot/stop/install).
`;

module.exports = {
  PINNED_COMMIT,
  status,
  installCore,
  installCoreSafe,
  upstreamDir,
  skillRoot,
  profilesRoot,
};
