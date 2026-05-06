'use strict';
/**
 * aoc-connections — built-in skill bundle.
 *
 * Wraps AOC's external connection layer (databases / SSH / web / GitHub /
 * MCP servers / Google Workspace) as a proper skill at
 *   ~/.openclaw/skills/aoc-connections/
 * with a SKILL.md contract and the four shell wrappers under scripts/.
 *
 * Auto-installed at startup. Auto-enabled for every agent (added to
 * config.agents.defaults.skills, plus each agent's explicit allowlist).
 *
 * Note: the per-agent "you have these connections assigned" block in
 * TOOLS.md is injected separately by syncAgentConnectionsContext (it's
 * dynamic per-agent runtime info). This skill provides the static
 * "how to call the scripts" knowledge.
 */
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');
const {
  AOC_CONNECT_SCRIPT_CONTENT,
  CHECK_CONNECTIONS_SCRIPT_CONTENT,
  MCP_CALL_SCRIPT_CONTENT,
  GWS_CALL_SCRIPT_CONTENT,
} = require('../scripts.cjs');

const SKILL_SLUG    = 'aoc-connections';
const BUNDLE_VERSION = '1.0.1';

function skillRoot() {
  return path.join(OPENCLAW_HOME, 'skills', SKILL_SLUG);
}
function manifestPath() { return path.join(skillRoot(), 'manifest.json'); }
function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf-8')); } catch { return null; }
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

const SKILL_MD = `---
name: aoc-connections
description: Built-in AOC skill — Connection layer contract. Teaches the agent how to use assigned external connections (DBs, SSH, websites, GitHub, MCP servers, Google Workspace) without ever handling raw credentials. Auto-enabled for every agent.
type: built-in
layer: 1
---

# aoc-connections — AOC Connection layer

You can be assigned **connections** by the user (Postgres / MySQL / BigQuery
/ SSH / Web / GitHub / MCP server / Google Workspace, etc.). Credentials are
held by the dashboard backend — you never see them. You access connections
through the wrappers below.

The current set of connections you have assigned is listed in a separate
\`## Connections\` block injected into your \`TOOLS.md\` automatically. Always
check that block first to know **what's available** before calling anything.

## Path setup — once per shell session

\`\`\`bash
export PATH="$HOME/.openclaw/skills/aoc-connections/scripts:$PATH"
\`\`\`

After that, the bare names below resolve.

## Discovering what you can use

\`\`\`bash
check_connections.sh          # list all connections assigned to me
check_connections.sh postgres # filter by type
\`\`\`

Output is JSON with each connection's \`name\`, \`type\`, and a sanitized
config preview. Names are stable identifiers — use them in subsequent calls.

## Generic wrapper — \`aoc-connect.sh\`

For most connection types, this is the entry point. Credentials are
attached server-side; **never appear in stdout / logs**:

\`\`\`bash
aoc-connect.sh "<connection-name>" <action> [args...]
\`\`\`

Common actions per type:

| Type | Action | Example |
|---|---|---|
| postgres / mysql | \`query\` | \`aoc-connect.sh prod-db query "SELECT count(*) FROM users"\` |
| bigquery | \`query\` | \`aoc-connect.sh dke-bq query "SELECT * FROM \\\`dataset.table\\\` LIMIT 10"\` |
| ssh | \`exec\` | \`aoc-connect.sh staging-host exec "df -h"\` |
| website | \`fetch\` | \`aoc-connect.sh dke-portal fetch /admin/metrics\` |
| github | \`api\` | \`aoc-connect.sh dke-repo api repos/owner/name/issues\` |
| odoocli | \`call\` | \`aoc-connect.sh dke-odoo call res.partner search_read [[]] '{"limit":5}'\` |

Prefer this over scraping or manual SSH — it handles auth, retries, and
output sanitization for you.

## MCP servers — \`mcp-call.sh\`

If you have an MCP-typed connection assigned, you can call any tool the
server exposes:

\`\`\`bash
mcp-call.sh <connection-name> --list-tools         # discover available tools
mcp-call.sh <connection-name> <tool-name> '<json-args>'
\`\`\`

Example:

\`\`\`bash
mcp-call.sh context7 resolve-library-id '{"query":"react"}'
mcp-call.sh playwright browser_snapshot '{}'
\`\`\`

The \`--list-tools\` form prints schemas — use it when you don't know what
the server offers.

## Google Workspace — \`gws-call.sh\`

For \`google_workspace\` connections (Docs, Sheets, Drive, Gmail, Calendar):

\`\`\`bash
gws-call.sh <connection-id> <service> <method> [json-body]
\`\`\`

Examples:

\`\`\`bash
gws-call.sh gws-1 drive files.list '{"q":"name=\\"DKE UAT Reports\\"","fields":"files(id,name)"}'
gws-call.sh gws-1 docs documents.create '{"title":"Q1 Report"}'
gws-call.sh gws-1 sheets spreadsheets.values.get '{"spreadsheetId":"abc...","range":"Sheet1!A1:D"}'
\`\`\`

The Drive/Docs/Sheets API surface is large — when in doubt, ask the user
what they want stored where, and use the \`drive files.list\` query first to
locate folders.

## Rules

1. **Never echo credentials.** The wrappers strip secrets, but don't
   intentionally print connection configs to chat or comments.
2. **Don't bypass.** If a Postgres connection is assigned, use
   \`aoc-connect.sh\`, not \`psql\` directly — \`psql\` won't have the password
   loaded and will fail anyway.
3. **Connection not found?** First run \`check_connections.sh\` — typo or
   missing assignment is more likely than a bug. If truly missing, ask the
   user: "Saya butuh connection ke <type> untuk <thing>, bisa di-assign?"
4. **Long output goes to file.** If a query returns a large result, pipe to
   \`save_output.sh\` (see aoc-tasks skill) instead of dumping to chat.
`;

const BUNDLE = {
  files: [
    { relPath: 'SKILL.md',                    content: SKILL_MD,                       protect: true },
    { relPath: 'scripts/aoc-connect.sh',       content: AOC_CONNECT_SCRIPT_CONTENT,     protect: true, exec: true },
    { relPath: 'scripts/check_connections.sh', content: CHECK_CONNECTIONS_SCRIPT_CONTENT, protect: true, exec: true },
    { relPath: 'scripts/mcp-call.sh',          content: MCP_CALL_SCRIPT_CONTENT,        protect: true, exec: true },
    { relPath: 'scripts/gws-call.sh',          content: GWS_CALL_SCRIPT_CONTENT,        protect: true, exec: true },
  ],
};

function status() {
  const m = readManifest();
  const root = skillRoot();
  return {
    installed: !!m,
    bundleVersion: BUNDLE_VERSION,
    installedVersion: m?.bundleVersion || null,
    skillRoot: root,
    installedAt: m?.installedAt || null,
    files: BUNDLE.files.map(f => {
      const p = path.join(root, f.relPath);
      return { relPath: f.relPath, exists: fs.existsSync(p), protect: !!f.protect };
    }),
  };
}

function install({ force = false } = {}) {
  const root = skillRoot();
  fs.mkdirSync(root, { recursive: true });
  const m = readManifest() || { files: {} };
  const newManifest = { bundleVersion: BUNDLE_VERSION, installedAt: new Date().toISOString(), files: {} };

  let written = 0; let kept = 0; let skippedUserEdit = 0;
  for (const f of BUNDLE.files) {
    const target = path.join(root, f.relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const expectedSha = sha256(f.content);
    const lastSha = m.files?.[f.relPath]?.sha256 || null;

    if (fs.existsSync(target)) {
      const onDiskSha = sha256(fs.readFileSync(target, 'utf-8'));
      const userEdited = lastSha != null && onDiskSha !== lastSha;
      if (!force && !f.protect && userEdited) {
        skippedUserEdit++;
        newManifest.files[f.relPath] = { sha256: onDiskSha, source: 'user' };
        continue;
      }
      if (onDiskSha === expectedSha) {
        kept++;
        newManifest.files[f.relPath] = { sha256: expectedSha, source: 'aoc' };
        continue;
      }
    }
    fs.writeFileSync(target, f.content, { mode: f.exec ? 0o755 : 0o644 });
    if (f.exec) { try { fs.chmodSync(target, 0o755); } catch {} }
    written++;
    newManifest.files[f.relPath] = { sha256: expectedSha, source: 'aoc' };
  }
  for (const f of BUNDLE.files) {
    if (!f.exec) continue;
    const target = path.join(root, f.relPath);
    try {
      const stat = fs.statSync(target);
      if ((stat.mode & 0o111) === 0) fs.chmodSync(target, 0o755);
    } catch {}
  }
  fs.writeFileSync(manifestPath(), JSON.stringify(newManifest, null, 2));
  return { ok: true, written, kept, skippedUserEdit, total: BUNDLE.files.length, bundleVersion: BUNDLE_VERSION };
}

function installSafe() {
  try {
    const r = install();
    if (r.written > 0) console.log(`[aoc-connections] installed ${r.written}/${r.total} files`);
    return r;
  } catch (err) {
    console.warn('[aoc-connections] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function ensureSkillEnabledForAllAgents() {
  const { withFileLock } = require('../locks.cjs');
  const cfgPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  return withFileLock(cfgPath, async () => {
    const cfg = readJsonSafe(cfgPath);
    if (!cfg) return { changed: false, reason: 'no openclaw.json' };

    let changed = false;

    cfg.agents = cfg.agents || {};
    cfg.agents.defaults = cfg.agents.defaults || {};
    if (!Array.isArray(cfg.agents.defaults.skills)) {
      cfg.agents.defaults.skills = [];
      changed = true;
    }
    if (!cfg.agents.defaults.skills.includes(SKILL_SLUG)) {
      cfg.agents.defaults.skills.push(SKILL_SLUG);
      changed = true;
    }

    for (const agent of cfg.agents.list || []) {
      if (!Array.isArray(agent.skills)) continue;
      if (!agent.skills.includes(SKILL_SLUG)) {
        agent.skills.push(SKILL_SLUG);
        changed = true;
      }
    }

    cfg.skills = cfg.skills || {};
    cfg.skills.entries = cfg.skills.entries || {};
    const entry = cfg.skills.entries[SKILL_SLUG];
    if (entry && entry.enabled === false) {
      delete cfg.skills.entries[SKILL_SLUG].enabled;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
      console.log('[aoc-connections] enabled skill in openclaw.json');
    }
    return { changed };
  });
}

module.exports = {
  SKILL_SLUG,
  BUNDLE_VERSION,
  skillRoot,
  status,
  install,
  installSafe,
  ensureSkillEnabledForAllAgents,
};
