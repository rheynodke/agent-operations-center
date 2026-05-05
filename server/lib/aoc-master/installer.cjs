'use strict';
/**
 * aoc-master — built-in skill bundle for Master Agent orchestration.
 *
 * Provides the Master with helpers (delegate.sh, team-status.sh,
 * list-team-roles.sh) that hit AOC's /api/master/* endpoints. The skill is
 * auto-enabled ONLY for agents flagged as Master (one per user), not for
 * sub-agents.
 *
 * Pattern mirrors aoc-tasks/installer.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');

const SKILL_SLUG = 'aoc-master';
const BUNDLE_VERSION = '1.0.1';

const SKILL_MD = `---
name: aoc-master
description: Master Agent orchestration toolkit — delegate work to sub-agents and inspect the team.
when_to_use: Use this skill ONLY if you are the Master Agent (your IDENTITY.md says so). Use it whenever a request matches a sub-agent's specialty better than your own role.
---

# aoc-master — Master Orchestration

You are the **Master Agent** for this workspace. Your job is to route user intent across the team, not to execute every task yourself. This skill gives you two tools:

1. **\`team-status.sh\`** — list every sub-agent owned by this user, with their role, last activity, and a short capability hint.
2. **\`delegate.sh <agent_id> "<task>"\`** — hand a task off to a specific sub-agent. The sub-agent gets the task as a fresh chat session and works on it independently.

## When to delegate vs handle yourself

| Situation | Action |
|---|---|
| Quick factual question, conversational reply | Handle yourself. |
| Task matches a specialist sub-agent's role (e.g. SWE, PM, QA, DocWriter) | Delegate. |
| Task spans multiple specialists | Decompose, delegate each part, then synthesize. |
| User is teaching you / updating your memory | Handle yourself, write to MEMORY.md. |
| User explicitly says "ask <agent>" / "have <agent> do …" | Always delegate to that agent. |

## Workflow

1. **Check the team first.** Before delegating to an agent you haven't talked to recently, run \`team-status.sh\` so you know who's available and what they specialize in.
2. **Pick the right agent.** Match by role (\`adlcRole\`) and recent activity.
3. **Write a clear task brief.** Include the user's goal, any context, and the deliverable shape you expect.
4. **Acknowledge to the user.** Tell the user which sub-agent you handed it to and what you asked.
5. **Don't poll.** The sub-agent works in their own session.

## Failure modes

- \`delegate.sh\` returns **403** — you are not the registered Master Agent. Stop and tell the user.
- No matching sub-agent — tell the user and offer to provision one.
- Sub-agent overloaded — flag before delegating.
`;

const TEAM_STATUS_SH = `#!/usr/bin/env bash
# aoc-master / team-status.sh — list this user's sub-agents.
set -euo pipefail
: "\${AOC_URL:=http://localhost:18800}"
: "\${AOC_TOKEN:?AOC_TOKEN env required}"

response=$(curl -sS -w '\\n%{http_code}' \\
  -H "Authorization: Bearer \${AOC_TOKEN}" \\
  "\${AOC_URL}/api/master/team")
body=$(printf '%s\\n' "\${response}" | sed '\$d')
status=$(printf '%s\\n' "\${response}" | tail -n1)

if [ "\${status}" != "200" ]; then
  echo "ERROR: HTTP \${status}" >&2
  echo "\${body}" >&2
  exit 1
fi

printf '%s\\n' "\${body}" | python3 -c '
import json, sys
data = json.load(sys.stdin)
agents = data.get("team", [])
if not agents:
    print("(no sub-agents yet — provision one before delegating)")
    sys.exit(0)
for a in agents:
    role = a.get("role") or "(no role)"
    last = a.get("lastActiveAt") or "-"
    aid = a["id"]
    aname = a.get("name", "")
    print(f"- {aid:24s} {aname:20s} role={role:14s} last_active={last}")
'
`;

const DELEGATE_SH = `#!/usr/bin/env bash
# aoc-master / delegate.sh — hand a task to a sub-agent.
set -euo pipefail
: "\${AOC_URL:=http://localhost:18800}"
: "\${AOC_TOKEN:?AOC_TOKEN env required}"

if [ "\$#" -lt 2 ]; then
  echo "usage: delegate.sh <target_agent_id> \\"<task>\\"" >&2
  exit 2
fi

target="\$1"; shift
task="\$*"
payload=\$(python3 -c '
import json, sys
print(json.dumps({"targetAgentId": sys.argv[1], "task": sys.argv[2]}))
' "\${target}" "\${task}")

response=\$(curl -sS -w '\\n%{http_code}' \\
  -X POST -H "Authorization: Bearer \${AOC_TOKEN}" -H "Content-Type: application/json" \\
  -d "\${payload}" "\${AOC_URL}/api/master/delegate")
body=\$(printf '%s\\n' "\${response}" | sed '\$d')
status=\$(printf '%s\\n' "\${response}" | tail -n1)

if [ "\${status}" = "403" ]; then
  echo "REJECTED: caller is not the user's Master Agent." >&2
  echo "\${body}" >&2
  exit 3
fi
if [ "\${status}" != "200" ] && [ "\${status}" != "201" ]; then
  echo "ERROR: HTTP \${status}" >&2
  echo "\${body}" >&2
  exit 1
fi
echo "\${body}"
`;

const LIST_TEAM_ROLES_SH = `#!/usr/bin/env bash
# aoc-master / list-team-roles.sh — short list: agent_id<TAB>role
set -euo pipefail
: "\${AOC_URL:=http://localhost:18800}"
: "\${AOC_TOKEN:?AOC_TOKEN env required}"
response=\$(curl -sS -w '\\n%{http_code}' \\
  -H "Authorization: Bearer \${AOC_TOKEN}" \\
  "\${AOC_URL}/api/master/team")
body=\$(printf '%s\\n' "\${response}" | sed '\$d')
status=\$(printf '%s\\n' "\${response}" | tail -n1)
if [ "\${status}" != "200" ]; then
  echo "ERROR: HTTP \${status}" >&2
  exit 1
fi
printf '%s\\n' "\${body}" | python3 -c '
import json, sys
for a in json.load(sys.stdin).get("team", []):
    role = a.get("role") or "(none)"
    print(f"{a[\"id\"]}\\t{role}")
'
`;

const BUNDLE = {
  files: [
    { rel: 'SKILL.md',                   content: SKILL_MD,            mode: 0o644 },
    { rel: 'scripts/team-status.sh',     content: TEAM_STATUS_SH,      mode: 0o755 },
    { rel: 'scripts/delegate.sh',        content: DELEGATE_SH,          mode: 0o755 },
    { rel: 'scripts/list-team-roles.sh', content: LIST_TEAM_ROLES_SH,  mode: 0o755 },
  ],
};

function skillRoot() {
  return path.join(OPENCLAW_HOME, 'skills', SKILL_SLUG);
}
function manifestPath() {
  return path.join(skillRoot(), 'manifest.json');
}
function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf-8')); } catch { return null; }
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function install() {
  const root = skillRoot();
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });

  const manifest = readManifest() || { version: null, files: {} };
  let written = 0;
  const newFiles = {};

  for (const f of BUNDLE.files) {
    const target = path.join(root, f.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const hash = sha256(f.content);
    newFiles[f.rel] = hash;

    const exists = fs.existsSync(target);
    const sameVersion = manifest.version === BUNDLE_VERSION;
    const sameContent = exists && manifest.files?.[f.rel] === hash;

    if (sameVersion && sameContent) continue;

    fs.writeFileSync(target, f.content, 'utf-8');
    fs.chmodSync(target, f.mode);
    written++;
  }

  fs.writeFileSync(manifestPath(),
    JSON.stringify({ version: BUNDLE_VERSION, files: newFiles, updatedAt: new Date().toISOString() }, null, 2));

  return { ok: true, written, total: BUNDLE.files.length, bundleVersion: BUNDLE_VERSION };
}

function installSafe() {
  try {
    const r = install();
    if (r.written > 0) console.log(`[aoc-master] installed ${r.written}/${r.total} files`);
    return r;
  } catch (err) {
    console.warn('[aoc-master] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Add `aoc-master` to the per-agent skill allowlist for ONLY the agents
 * listed in `masterAgentIds`. Sub-agents are explicitly NOT enrolled — the
 * skill is master-only.
 *
 * @param {{ masterAgentIds: string[] }} opts
 * @returns {{ changed: boolean }}
 */
function ensureSkillEnabledForUserMasters({ masterAgentIds = [] } = {}) {
  const cfgPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const cfg = readJsonSafe(cfgPath);
  if (!cfg) return { changed: false, reason: 'no openclaw.json' };
  if (!Array.isArray(cfg.agents?.list)) return { changed: false, reason: 'no agents.list' };

  const masterSet = new Set(masterAgentIds);
  let changed = false;
  for (const agent of cfg.agents.list) {
    if (!masterSet.has(agent.id)) continue;
    if (!Array.isArray(agent.skills)) agent.skills = [];
    if (!agent.skills.includes(SKILL_SLUG)) {
      agent.skills.push(SKILL_SLUG);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    console.log(`[aoc-master] enrolled ${masterAgentIds.length} master agent(s) into ${SKILL_SLUG} skill`);
  }
  return { changed };
}

module.exports = {
  SKILL_SLUG,
  BUNDLE_VERSION,
  skillRoot,
  install,
  installSafe,
  ensureSkillEnabledForUserMasters,
};
