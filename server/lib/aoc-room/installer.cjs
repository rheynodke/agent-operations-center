'use strict';
/**
 * aoc-room — built-in skill bundle for mission room collaboration.
 *
 * Provides agents with tools to publish artifacts, read/update shared context,
 * and track per-room state. Auto-installed at startup. Auto-enabled for every
 * agent (added to agents.defaults.skills).
 *
 * Pattern mirrors aoc-tasks/installer.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');

const SKILL_SLUG = 'aoc-room';
const BUNDLE_VERSION = '1.0.0';

const SKILL_MD = `---
name: aoc-room
description: Built-in AOC skill — Room Collaboration Toolkit. Publish artifacts, read/update shared context, and track per-room state. Auto-enabled for every agent.
type: built-in
layer: 1
---

# aoc-room — Room Collaboration Toolkit

You are connected to **AOC Mission Rooms** via the dashboard backend. Use the
scripts below to collaborate with your team on shared artifacts and context.

## Room setup — once per shell session

\`\`\`bash
export PATH="$HOME/.openclaw/skills/aoc-room/scripts:$PATH"
\`\`\`

After that, the bare script names below resolve.

## Publishing artifacts

Whenever you complete a significant piece of work (a deliverable, analysis, proposal,
decision log), publish it to the room so the team can find it:

\`\`\`bash
room-publish.sh ./outputs/report.md briefs "Q1 Market Analysis"
# category: briefs|outputs|research|decisions|assets (default: outputs)
# title: human-readable name (default: filename without extension)
\`\`\`

The artifact becomes discoverable via the room's artifact gallery and versioned
automatically by AOC.

## Reading the shared context

Every room maintains a **CONTEXT.md** that documents shared knowledge, decisions,
and the room's current state. Read it to understand what's already been done:

\`\`\`bash
room-context-read.sh
\`\`\`

## Updating shared context

When you complete work or discover important information, append an entry to the
room's CONTEXT.md:

\`\`\`bash
room-context-append.sh "Decided to use SQLite instead of PostgreSQL — lower ops cost"
\`\`\`

Each entry is timestamped and attributed to your agent ID automatically.

**When to update context:**
- After a significant decision or discovery
- When you hit a blocker that the team should know about
- When you finish a phase and want to document what you learned

## Tracking per-agent state

Each agent can maintain a status object in the room (what you're working on, progress,
blockers, etc.). Use this to keep the team informed without frequent chat messages:

\`\`\`bash
room-state-set.sh '{"status":"analyzing data","currentTask":"Q1 trends","blockedOn":null}'
room-state-get.sh
\`\`\`

State persists per room, per agent. Useful for long-running tasks where the team
needs to see your progress at a glance.

## Listing artifacts

Find what's already been published in a room:

\`\`\`bash
room-list.sh                    # all artifacts
room-list.sh research           # filter by category
\`\`\`

Output shows each artifact's ID, category, title, and pin status so you can decide
if you need to read it.

## Environment variables

- \`AOC_ROOM_ID\` — the target room (set automatically when a session is started from a room; defaults to agent's HQ room if not set)
- \`AOC_URL\` — dashboard URL (default: http://localhost:18800)
- \`AOC_TOKEN\` — auth bearer token (required)
- \`AOC_AGENT_ID\` — your agent ID (for context author attribution and state lookup)

## What you should NOT do

- Don't publish very large artifacts (>5MB) — use project workspace instead if available
- Don't overwrite context entries manually — archive or resolve them instead
- Don't treat per-agent state as a substitute for task status — update task status on the board separately
`;

const ROOM_PUBLISH_SH = `#!/usr/bin/env bash
# aoc-room / room-publish.sh — publish a file as an artifact to the room
# Usage: room-publish.sh <file> [category] [title]
set -euo pipefail

FILE="\${1:?Usage: room-publish.sh <file> [category] [title]}"
CATEGORY="\${2:-outputs}"
TITLE="\${3:-\$(basename "$FILE" | sed 's/\\.[^.]*$//')}"
ROOM_ID="\${AOC_ROOM_ID:-}"
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"

if [ -z "\$ROOM_ID" ]; then
  echo "Error: AOC_ROOM_ID not set. Start this session from a room or set AOC_ROOM_ID." >&2
  exit 1
fi

if [ ! -f "\$FILE" ]; then
  echo "Error: File not found: \$FILE" >&2
  exit 1
fi

CONTENT=\$(cat "\$FILE")
FILENAME=\$(basename "\$FILE")

curl -sf -X POST \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "\$(jq -n --arg category "\$CATEGORY" --arg title "\$TITLE" --arg content "\$CONTENT" --arg fileName "\$FILENAME" \\
    '{category: \$category, title: \$title, content: \$content, fileName: \$fileName}')" \\
  "\$AOC_URL/api/rooms/\$ROOM_ID/artifacts" | jq .
`;

const ROOM_LIST_SH = `#!/usr/bin/env bash
# aoc-room / room-list.sh — list artifacts in the room
# Usage: room-list.sh [category]
set -euo pipefail

CATEGORY="\${1:-}"
ROOM_ID="\${AOC_ROOM_ID:-}"
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"

if [ -z "\$ROOM_ID" ]; then
  echo "Error: AOC_ROOM_ID not set." >&2; exit 1
fi

URL="\$AOC_URL/api/rooms/\$ROOM_ID/artifacts"
[ -n "\$CATEGORY" ] && URL="\$URL?category=\$CATEGORY"

curl -sf -H "Authorization: Bearer \$AOC_TOKEN" "\$URL" | \\
  jq '.artifacts[] | {id, category, title, pinned, archived, latestVersionId}'
`;

const ROOM_CONTEXT_READ_SH = `#!/usr/bin/env bash
# aoc-room / room-context-read.sh — read the shared CONTEXT.md
set -euo pipefail
ROOM_ID="\${AOC_ROOM_ID:-}"
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
if [ -z "\$ROOM_ID" ]; then echo "Error: AOC_ROOM_ID not set." >&2; exit 1; fi
curl -sf -H "Authorization: Bearer \$AOC_TOKEN" "\$AOC_URL/api/rooms/\$ROOM_ID/context" | jq -r '.content'
`;

const ROOM_CONTEXT_APPEND_SH = `#!/usr/bin/env bash
# aoc-room / room-context-append.sh — append an entry to the shared CONTEXT.md
# Usage: room-context-append.sh "<body text>"
set -euo pipefail
BODY="\${1:?Usage: room-context-append.sh \\\"<body text>\\\"}"
ROOM_ID="\${AOC_ROOM_ID:-}"
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AOC_AGENT_ID="\${AOC_AGENT_ID:-unknown}"
if [ -z "\$ROOM_ID" ]; then echo "Error: AOC_ROOM_ID not set." >&2; exit 1; fi
curl -sf -X POST \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "\$(jq -n --arg body "\$BODY" --arg authorId "\$AOC_AGENT_ID" '{body: \$body, authorId: \$authorId}')" \\
  "\$AOC_URL/api/rooms/\$ROOM_ID/context/append" | jq -r '.content | split("\\n") | last(.[])' || true
echo "Context updated."
`;

const ROOM_STATE_GET_SH = `#!/usr/bin/env bash
# aoc-room / room-state-get.sh — get this agent's state for the room
set -euo pipefail
ROOM_ID="\${AOC_ROOM_ID:-}"
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AOC_AGENT_ID="\${AOC_AGENT_ID:?AOC_AGENT_ID not set}"
if [ -z "\$ROOM_ID" ]; then echo "Error: AOC_ROOM_ID not set." >&2; exit 1; fi
curl -sf -H "Authorization: Bearer \$AOC_TOKEN" \\
  "\$AOC_URL/api/rooms/\$ROOM_ID/agents/\$AOC_AGENT_ID/state" | jq .
`;

const ROOM_STATE_SET_SH = `#!/usr/bin/env bash
# aoc-room / room-state-set.sh — update this agent's state for the room
# Usage: room-state-set.sh '<json-object>'
# Example: room-state-set.sh '{"status":"working","task":"analyze Q1 data"}'
set -euo pipefail
STATE="\${1:?Usage: room-state-set.sh '<json-object>'}"
ROOM_ID="\${AOC_ROOM_ID:-}"
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AOC_AGENT_ID="\${AOC_AGENT_ID:?AOC_AGENT_ID not set}"
if [ -z "\$ROOM_ID" ]; then echo "Error: AOC_ROOM_ID not set." >&2; exit 1; fi
curl -sf -X PUT \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "\$(jq -n --argjson state "\$STATE" '{state: \$state}')" \\
  "\$AOC_URL/api/rooms/\$ROOM_ID/agents/\$AOC_AGENT_ID/state" | jq .
`;

const BUNDLE = {
  files: [
    { rel: 'SKILL.md', content: SKILL_MD, mode: 0o644 },
    { rel: 'scripts/room-publish.sh', content: ROOM_PUBLISH_SH, mode: 0o755 },
    { rel: 'scripts/room-list.sh', content: ROOM_LIST_SH, mode: 0o755 },
    { rel: 'scripts/room-context-read.sh', content: ROOM_CONTEXT_READ_SH, mode: 0o755 },
    { rel: 'scripts/room-context-append.sh', content: ROOM_CONTEXT_APPEND_SH, mode: 0o755 },
    { rel: 'scripts/room-state-get.sh', content: ROOM_STATE_GET_SH, mode: 0o755 },
    { rel: 'scripts/room-state-set.sh', content: ROOM_STATE_SET_SH, mode: 0o755 },
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
    if (r.written > 0) console.log(`[aoc-room] installed ${r.written}/${r.total} files`);
    return r;
  } catch (err) {
    console.warn('[aoc-room] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Ensure aoc-room is in agents.defaults.skills (so brand-new agents inherit
 * it) AND in every existing agent's explicit allowlist (if they have one).
 * Idempotent. Writes openclaw.json only if a change is actually needed.
 */
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
      console.log('[aoc-room] enabled skill in openclaw.json (defaults + agent allowlists)');
    }
    return { changed };
  });
}

module.exports = {
  SKILL_SLUG,
  BUNDLE_VERSION,
  skillRoot,
  install,
  installSafe,
  ensureSkillEnabledForAllAgents,
};
