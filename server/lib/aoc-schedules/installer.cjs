'use strict';
/**
 * aoc-schedules — built-in skill bundle for cron / scheduled tasks.
 *
 * Lets agents inspect their active schedules and help the user create new
 * ones from natural language intent in a mission room.
 *
 * Auto-installed at startup. Auto-enabled for every agent (added to admin's
 * agents.defaults.skills, every existing admin agent's allowlist, AND
 * propagated to every per-user openclaw.json).
 *
 * Pattern mirrors aoc-room/installer.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');

const SKILL_SLUG = 'aoc-schedules';
const BUNDLE_VERSION = '1.0.0';

// Source ~/.openclaw/.aoc_env (cluster-wide) THEN the agent's per-workspace
// .aoc_agent_env so AOC_TOKEN ends up bound to the per-agent service token.
const ENV_PRELUDE = `\\
source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env"
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env"
`;

const SKILL_MD = `---
name: aoc-schedules
description: Built-in AOC skill — cron / scheduled tasks. List active schedules, create/edit/toggle/delete schedules on behalf of the user, run a job on demand, inspect run history. Use when the user asks about jadwal / reminder / cron / "run X every Y" / "ingatkan saya".
type: built-in
layer: 1
---

# aoc-schedules — Scheduled Tasks Toolkit

You can read and manage **AOC scheduled tasks** (cron jobs) for your owner via
the dashboard backend. Use these scripts when the user asks about active
schedules or wants to create / pause / delete one.

## Setup — once per shell session

\`\`\`bash
export PATH="$HOME/.openclaw/skills/aoc-schedules/scripts:$PATH"
\`\`\`

## Core idea

- The owning **user** has a single per-user cron file. Every job optionally
  binds to one agent via \`agentId\`.
- These scripts run as **this agent's service token**, so they only see jobs
  in this agent's owner scope. Filter further by \`agentId == \$AOC_AGENT_ID\`
  to show "schedules belonging to me", or pass \`--all\` to see all of the
  owner's jobs (useful when the user asks "tampilkan semua jadwal saya").

## Listing active schedules

\`\`\`bash
schedules-list.sh                # MY schedules (agentId = me)
schedules-list.sh --all          # all of owner's schedules
schedules-list.sh --enabled      # MY enabled schedules only
\`\`\`

Output is a compact JSON list: \`{id, name, schedule, kind, agentId, enabled,
nextRunAt, sessionTarget, deliveryChannel}\`. Summarise it for the user in
natural language — don't dump the JSON unless they ask.

## Creating a schedule from user intent

When the user says something like *"ingatkan saya tiap pagi jam 9 untuk cek
inventory"* or *"jalankan analisa setiap 30 menit"*, translate the intent into
a job spec and call:

\`\`\`bash
schedules-create.sh \\
  --name  "Morning inventory check" \\
  --kind  cron        \\   # cron | every | at
  --schedule "0 9 * * *"  \\   # 5-field cron / "30m" / ISO timestamp
  --message "Cek inventory hari ini dan rangkum perubahan stok" \\
  [--tz Asia/Jakarta] \\
  [--session isolated|main|current] \\
  [--delivery-channel telegram --delivery-to <chat-id>] \\
  [--delete-after-run] \\
  [--timeout 300]
\`\`\`

\`schedule\` formats:
- **cron** kind: standard 5-field expression (\`0 9 * * *\`). \`--tz\` defaults to UTC.
- **every** kind: interval string \`5m\`, \`30m\`, \`1h\`, \`2d\`.
- **at** kind: ISO timestamp \`2026-05-08T09:00:00Z\` OR a relative offset \`20m\`.

The script always binds the new job to **this agent** (\`agentId = \$AOC_AGENT_ID\`).
Pass \`--no-bind\` to create an owner-level job not tied to any specific agent.

### Best-practice when creating

1. **Confirm with the user before creating** — read back the parsed schedule
   in plain language ("Setiap hari jam 9 WIB, saya akan menjalankan: ...").
2. **Respond after success** with: the job ID, the next run time, and a
   reminder that **gateway perlu restart untuk job baru aktif**. Offer to
   restart it for them via the dashboard.
3. **Pick \`session: isolated\`** as default unless the user asks for follow-up
   continuity (\`main\`/\`current\` keep the same session across runs).

## Editing a schedule

\`\`\`bash
schedules-update.sh <id> --schedule "0 8 * * *"
schedules-update.sh <id> --message "Updated reminder text"
schedules-update.sh <id> --tz Asia/Jakarta
\`\`\`

## Toggling enabled / disabled

\`\`\`bash
schedules-toggle.sh <id> on
schedules-toggle.sh <id> off
\`\`\`

## Trigger a run NOW

\`\`\`bash
schedules-run-now.sh <id>
\`\`\`

Useful for "test the job once". The owning gateway must be running.

## Run history

\`\`\`bash
schedules-runs.sh <id>           # last 10 runs
schedules-runs.sh <id> 50        # last 50 runs
\`\`\`

Output: \`{runId, status, startedAt, endedAt, duration, error?, summary?}\`.

## Deleting a schedule

\`\`\`bash
schedules-delete.sh <id>          # WILL prompt for --yes confirmation
schedules-delete.sh <id> --yes    # actually delete
\`\`\`

Always **ask the user before deleting** — pretend the schedule is precious.

## Sharp edges (tell the user when relevant)

1. **Gateway restart required** for any create / update / delete / toggle to
   take effect. The cron scheduler is the gateway process; it loads
   \`jobs.json\` once at startup. After mutations, the dashboard ribbon
   shows a "Restart gateway" affordance — direct the user there, or
   surface this caveat in your reply.
2. **Cross-agent visibility**: by default \`schedules-list.sh\` filters to
   \`agentId == \$AOC_AGENT_ID\`. The user's other agents have their own
   schedules visible only via \`--all\`.
3. **Time zones**: cron expressions default to UTC. For Indonesian users,
   pass \`--tz Asia/Jakarta\` (or \`--tz Asia/Makassar\` / \`Asia/Jayapura\`).
4. **Delivery channel**: a job can announce its result to telegram /
   whatsapp / discord. Only set \`--delivery-channel\` if the user explicitly
   asks for delivery — otherwise leave it off (default \`none\`).
5. **Confirm before destructive ops** — toggle off, delete, or running
   immediately on a job that posts to a channel.

## Environment variables

- \`AOC_URL\` — dashboard URL (default http://localhost:18800)
- \`AOC_TOKEN\` — bearer token (sourced from \`.aoc_agent_env\` automatically)
- \`AOC_AGENT_ID\` — your agent ID (used for filtering + binding new jobs)
`;

const SCHEDULES_LIST_SH = `#!/usr/bin/env bash
# aoc-schedules / schedules-list.sh — list cron jobs for this agent (or --all)
# Usage: schedules-list.sh [--all] [--enabled]
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AGENT="\${AOC_AGENT_ID:-}"

ALL=0; ENABLED_ONLY=0
for arg in "\$@"; do
  case "\$arg" in
    --all)     ALL=1 ;;
    --enabled) ENABLED_ONLY=1 ;;
    *) echo "Unknown arg: \$arg" >&2; exit 64 ;;
  esac
done

RESP=\$(curl -sf -H "Authorization: Bearer \$AOC_TOKEN" "\$AOC_URL/api/cron")
if [ -z "\$RESP" ]; then
  echo '{"jobs":[]}'; exit 0
fi

# Normalize each job into a compact summary, then optionally filter.
echo "\$RESP" | jq --arg agent "\$AGENT" --argjson all \$ALL --argjson enabledOnly \$ENABLED_ONLY '
  [ .jobs[]? | {
      id, name, kind, schedule, agentId,
      enabled: (.enabled // true),
      nextRunAt: (.nextRunAtMs // .schedule.nextRunAtMs // null),
      sessionTarget,
      deliveryChannel: (.delivery.channel // null),
      deliveryTo:      (.delivery.to // null),
      message: (.payload.message // .payload.text // null)
    } ]
  | (if \$all == 0 and \$agent != "" then map(select(.agentId == \$agent)) else . end)
  | (if \$enabledOnly == 1 then map(select(.enabled == true)) else . end)
'
`;

const SCHEDULES_CREATE_SH = `#!/usr/bin/env bash
# aoc-schedules / schedules-create.sh — create a new cron job bound to this agent.
# Usage: schedules-create.sh --name <n> --kind cron|every|at --schedule <expr> \\
#                            --message <body> [--tz <zone>] [--session iso|main|current] \\
#                            [--delivery-channel <ch> --delivery-to <id>] \\
#                            [--delete-after-run] [--timeout <secs>] [--no-bind]
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"

NAME=""; KIND="cron"; SCHEDULE=""; MESSAGE=""; TZ="UTC"
SESSION="isolated"; DELIVERY_CHANNEL=""; DELIVERY_TO=""
DELETE_AFTER=0; TIMEOUT=""; NO_BIND=0

while [ \$# -gt 0 ]; do
  case "\$1" in
    --name)              NAME="\$2"; shift 2 ;;
    --kind)              KIND="\$2"; shift 2 ;;
    --schedule)          SCHEDULE="\$2"; shift 2 ;;
    --message)           MESSAGE="\$2"; shift 2 ;;
    --tz)                TZ="\$2"; shift 2 ;;
    --session)           SESSION="\$2"; shift 2 ;;
    --delivery-channel)  DELIVERY_CHANNEL="\$2"; shift 2 ;;
    --delivery-to)       DELIVERY_TO="\$2"; shift 2 ;;
    --delete-after-run)  DELETE_AFTER=1; shift ;;
    --timeout)           TIMEOUT="\$2"; shift 2 ;;
    --no-bind)           NO_BIND=1; shift ;;
    *) echo "Unknown arg: \$1" >&2; exit 64 ;;
  esac
done

if [ -z "\$NAME" ] || [ -z "\$SCHEDULE" ]; then
  echo "Error: --name and --schedule are required" >&2; exit 64
fi
if [ -z "\$MESSAGE" ]; then
  echo "Error: --message is required (the prompt the agent will receive on each run)" >&2; exit 64
fi

# Build payload as a JSON object via jq.
DELIVERY_MODE="none"; [ -n "\$DELIVERY_CHANNEL" ] && DELIVERY_MODE="announce"

BODY=\$(jq -n \\
  --arg name      "\$NAME"      \\
  --arg kind      "\$KIND"      \\
  --arg schedule  "\$SCHEDULE"  \\
  --arg message   "\$MESSAGE"   \\
  --arg tz        "\$TZ"        \\
  --arg session   "\$SESSION"   \\
  --arg dmode     "\$DELIVERY_MODE" \\
  --arg dchannel  "\$DELIVERY_CHANNEL" \\
  --arg dto       "\$DELIVERY_TO" \\
  --arg agentId   "\${AOC_AGENT_ID:-}" \\
  --argjson noBind \$NO_BIND \\
  --argjson delAfter \$DELETE_AFTER \\
  --arg timeout   "\$TIMEOUT" \\
  '
    {
      name: \$name, kind: \$kind, schedule: \$schedule,
      message: \$message, tz: \$tz, session: \$session,
      deliveryMode: \$dmode
    }
    + (if \$dchannel != "" then {deliveryChannel: \$dchannel} else {} end)
    + (if \$dto       != "" then {deliveryTo: \$dto}           else {} end)
    + (if \$noBind == 0 and \$agentId != "" then {agentId: \$agentId} else {} end)
    + (if \$delAfter == 1 then {deleteAfterRun: true} else {} end)
    + (if \$timeout != "" then {timeoutSeconds: (\$timeout | tonumber)} else {} end)
  ')

curl -sf -X POST \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "\$BODY" \\
  "\$AOC_URL/api/cron" | jq '{job: .job, source: (.source // "gateway")}'

echo
echo "NOTE: Gateway restart may be required for the new schedule to be picked up." >&2
`;

const SCHEDULES_UPDATE_SH = `#!/usr/bin/env bash
# aoc-schedules / schedules-update.sh — patch an existing cron job
# Usage: schedules-update.sh <id> [--name n] [--schedule expr] [--message text] [--tz zone] [--kind cron|every|at]
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"

ID="\${1:?Usage: schedules-update.sh <id> [flags...]}"
shift

declare -a JQ_ARGS=()
JQ_FILTER='{}'
while [ \$# -gt 0 ]; do
  case "\$1" in
    --name)     JQ_ARGS+=(--arg name "\$2");     JQ_FILTER="\$JQ_FILTER + {name: \$name}";        shift 2 ;;
    --schedule) JQ_ARGS+=(--arg schedule "\$2"); JQ_FILTER="\$JQ_FILTER + {schedule: \$schedule}"; shift 2 ;;
    --message)  JQ_ARGS+=(--arg message "\$2");  JQ_FILTER="\$JQ_FILTER + {message: \$message}";   shift 2 ;;
    --tz)       JQ_ARGS+=(--arg tz "\$2");       JQ_FILTER="\$JQ_FILTER + {tz: \$tz}";              shift 2 ;;
    --kind)     JQ_ARGS+=(--arg kind "\$2");     JQ_FILTER="\$JQ_FILTER + {kind: \$kind}";          shift 2 ;;
    *) echo "Unknown arg: \$1" >&2; exit 64 ;;
  esac
done

BODY=\$(jq -n "\${JQ_ARGS[@]}" "\$JQ_FILTER")

curl -sf -X PATCH \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "\$BODY" \\
  "\$AOC_URL/api/cron/\$ID" | jq '{job: .job, source: (.source // "file")}'

echo
echo "NOTE: Gateway restart required for the change to take effect." >&2
`;

const SCHEDULES_TOGGLE_SH = `#!/usr/bin/env bash
# aoc-schedules / schedules-toggle.sh — enable / disable a cron job
# Usage: schedules-toggle.sh <id> on|off
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"

ID="\${1:?Usage: schedules-toggle.sh <id> on|off}"
STATE="\${2:?Usage: schedules-toggle.sh <id> on|off}"

case "\$STATE" in
  on|enable|enabled|true)   ENABLED=true ;;
  off|disable|disabled|false) ENABLED=false ;;
  *) echo "Error: state must be on/off (got: \$STATE)" >&2; exit 64 ;;
esac

curl -sf -X POST \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"enabled\\": \$ENABLED}" \\
  "\$AOC_URL/api/cron/\$ID/toggle" | jq '{enabled: .job.enabled, name: .job.name}'

echo
echo "NOTE: Gateway restart required to honor the toggle." >&2
`;

const SCHEDULES_RUN_NOW_SH = `#!/usr/bin/env bash
# aoc-schedules / schedules-run-now.sh — trigger a job immediately (gateway must be running)
# Usage: schedules-run-now.sh <id>
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"

ID="\${1:?Usage: schedules-run-now.sh <id>}"

curl -sf -X POST \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  "\$AOC_URL/api/cron/\$ID/run" | jq .
`;

const SCHEDULES_RUNS_SH = `#!/usr/bin/env bash
# aoc-schedules / schedules-runs.sh — show recent run history for a job
# Usage: schedules-runs.sh <id> [limit=10]
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"

ID="\${1:?Usage: schedules-runs.sh <id> [limit]}"
LIMIT="\${2:-10}"

curl -sf -H "Authorization: Bearer \$AOC_TOKEN" \\
  "\$AOC_URL/api/cron/\$ID/runs?limit=\$LIMIT" | jq '.runs'
`;

const SCHEDULES_DELETE_SH = `#!/usr/bin/env bash
# aoc-schedules / schedules-delete.sh — delete a cron job (always confirm with user first)
# Usage: schedules-delete.sh <id> [--yes]
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"

ID="\${1:?Usage: schedules-delete.sh <id> [--yes]}"
CONFIRM="\${2:-}"

if [ "\$CONFIRM" != "--yes" ]; then
  echo "Refusing to delete schedule \$ID without --yes confirmation." >&2
  echo "Ask the user explicitly, then re-run with --yes." >&2
  exit 65
fi

curl -sf -X DELETE \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  "\$AOC_URL/api/cron/\$ID" | jq .

echo
echo "NOTE: Gateway restart required to fully purge the schedule." >&2
`;

const BUNDLE = {
  files: [
    { rel: 'SKILL.md', content: SKILL_MD, mode: 0o644 },
    { rel: 'scripts/schedules-list.sh',    content: SCHEDULES_LIST_SH,    mode: 0o755 },
    { rel: 'scripts/schedules-create.sh',  content: SCHEDULES_CREATE_SH,  mode: 0o755 },
    { rel: 'scripts/schedules-update.sh',  content: SCHEDULES_UPDATE_SH,  mode: 0o755 },
    { rel: 'scripts/schedules-toggle.sh',  content: SCHEDULES_TOGGLE_SH,  mode: 0o755 },
    { rel: 'scripts/schedules-run-now.sh', content: SCHEDULES_RUN_NOW_SH, mode: 0o755 },
    { rel: 'scripts/schedules-runs.sh',    content: SCHEDULES_RUNS_SH,    mode: 0o755 },
    { rel: 'scripts/schedules-delete.sh',  content: SCHEDULES_DELETE_SH,  mode: 0o755 },
  ],
};

function skillRoot() { return path.join(OPENCLAW_HOME, 'skills', SKILL_SLUG); }
function manifestPath() { return path.join(skillRoot(), 'manifest.json'); }
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
    if (r.written > 0) console.log(`[aoc-schedules] installed ${r.written}/${r.total} files`);
    return r;
  } catch (err) {
    console.warn('[aoc-schedules] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// Patch a single openclaw.json file in place to ensure SKILL_SLUG is in
// agents.defaults.skills + every agent's explicit allowlist. Returns true if
// any change was written.
function patchConfig(cfgPath) {
  const cfg = readJsonSafe(cfgPath);
  if (!cfg) return false;

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
  }
  return changed;
}

/**
 * Ensure aoc-schedules is enabled in admin's openclaw.json AND in EVERY
 * already-bootstrapped per-user openclaw.json under
 * ~/.openclaw/users/<id>/.openclaw/openclaw.json. Idempotent.
 *
 * Per-user homes for users created AFTER this runs inherit the slug
 * automatically via ensureUserHome() (which copies admin's agents.defaults
 * at first gateway spawn).
 */
async function ensureSkillEnabledForAllAgents() {
  const { withFileLock } = require('../locks.cjs');
  const adminCfg = path.join(OPENCLAW_HOME, 'openclaw.json');

  // 1) Admin's config.
  let adminChanged = false;
  await withFileLock(adminCfg, async () => {
    adminChanged = patchConfig(adminCfg);
  });

  // 2) Every per-user config that already exists.
  const usersDir = path.join(OPENCLAW_HOME, 'users');
  const patched = [];
  if (fs.existsSync(usersDir)) {
    for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cfgPath = path.join(usersDir, entry.name, '.openclaw', 'openclaw.json');
      if (!fs.existsSync(cfgPath)) continue;
      try {
        await withFileLock(cfgPath, async () => {
          if (patchConfig(cfgPath)) patched.push(entry.name);
        });
      } catch (e) {
        console.warn(`[aoc-schedules] patch user ${entry.name} failed: ${e.message}`);
      }
    }
  }

  if (adminChanged || patched.length > 0) {
    const parts = [];
    if (adminChanged) parts.push('admin');
    if (patched.length > 0) parts.push(`${patched.length} per-user [${patched.join(', ')}]`);
    console.log(`[aoc-schedules] enabled skill in openclaw.json for: ${parts.join(' + ')}`);
  }
  return { changed: adminChanged || patched.length > 0, adminChanged, perUserPatched: patched };
}

module.exports = {
  SKILL_SLUG,
  BUNDLE_VERSION,
  skillRoot,
  install,
  installSafe,
  ensureSkillEnabledForAllAgents,
};
