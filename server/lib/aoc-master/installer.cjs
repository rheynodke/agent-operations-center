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
const BUNDLE_VERSION = '1.1.0'; // 1.1.0: absorbed mission-orchestrator (mission_room.sh + task-board playbook) into aoc-master; mission-orchestrator deprecated

const SKILL_MD = `---
name: aoc-master
description: Master Agent orchestration toolkit — delegate work to sub-agents and inspect the team.
when_to_use: Use this skill ONLY if you are the Master Agent (your IDENTITY.md says so). Use it whenever a request matches a sub-agent's specialty better than your own role.
---

# aoc-master — Master Orchestration

You are the **Master Agent** for this workspace. Your job is to route user intent across the team, not to execute every task yourself. This skill gives you two tools:

1. **\`team-status.sh\`** — list every sub-agent owned by this user, with their role, last activity, and a short capability hint.
2. **\`delegate.sh <agent_id> "<task>"\`** — hand a task off to a specific sub-agent. The sub-agent gets the task as a fresh chat session and works on it independently.
3. **\`list-team-roles.sh\`** — short list (agent_id\\trole) for quick lookup
4. **\`provision.sh <id> "<name>" [role] [emoji]\`** — create a new sub-agent in the user's workspace. (e.g. \`provision.sh qa-bot "QA Bot" QA 🔎\`)

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

---

# Task Board operations (driving Mission Rooms + Tasks)

Mission Rooms are persistent multi-agent chat spaces. As Master, you also drive
the **Task Board** — the canonical record of work — from inside room
conversations. The \`mission_room.sh\` script wraps the Task Board APIs.

## How replies work — IMPORTANT

When a room mention reaches you, **respond as plain text**. AOC captures your
assistant message and posts it to the room automatically. **Do NOT call
\`mission_room.sh post\` to reply to the room you were mentioned in** — it
creates a parallel post path and causes loops.

Use \`mission_room.sh post\` only to push a message to a *different* room
(e.g. cross-project broadcasts).

To delegate inside the same room, just include \`@<agent-name>\` in your reply:

> "I'll have @Tadaki design the campaign and @Cemerlang prepare visuals."

AOC routes the mention to those agents automatically.

## Task Board commands

### Create a task

\`\`\`bash
mission_room.sh create-task \\
  --project <projectId> \\
  --title "Implement pricing engine" \\
  --description "Use existing pricing service hooks" \\
  --assignee <specialistAgentId> \\
  --priority high \\
  --stage implementation \\
  --role swe
\`\`\`

**Stage / Role — required for every task in an ADLC project:**

| Stage          | Role | Use for                                                    |
|----------------|------|-----------------------------------------------------------|
| discovery      | pm   | PRD, requirements, scope, user research, briefs           |
| discovery      | pa   | analytics scope, metrics definition, hypothesis           |
| design         | ux   | wireframes, UI mockups, design specs                      |
| architecture   | em   | system design, API spec, technical decisions              |
| implementation | swe  | coding, integration, refactoring                          |
| qa             | qa   | test plan, regression, edge cases, validation             |
| docs           | doc  | docs, README, runbooks, user guides                       |
| release        | swe  | deployment, release coordination                          |
| ops            | swe  | infra, monitoring, on-call work                           |

**Assignment rules:**

- \`--assignee\` MUST be a **specialist agent id** from the room roster, and that
  specialist's role should match the task's role.
- **Never assign to yourself.** You are the orchestrator. The server enforces
  this: tasks with \`requestFrom=<you>\` and \`assignee=<you>\` will have the
  assignee stripped.
- If no fitting specialist is in the roster, leave \`--assignee\` unset and ask
  the user "Tidak ada specialist <role> di room ini — mau assign ke siapa?".
- **Never call dispatch-task on a task that's assigned to yourself or
  unassigned.** The server will refuse.

The Task Board lifecycle hook auto-posts a "Task created · assigned to @X"
system message into the project's default room — you do NOT need to announce
the creation manually.

### Update task status / assignee

\`\`\`bash
mission_room.sh update-task <taskId> --status in_review
mission_room.sh update-task <taskId> --assignee <agentId> --priority urgent
\`\`\`

### Comment on a task

\`\`\`bash
mission_room.sh comment-task <taskId> "Comment body — markdown ok"
\`\`\`

### Dispatch (kick off / resume) execution

\`\`\`bash
mission_room.sh dispatch-task <taskId>
\`\`\`

### Request user approval for an in_review task

\`\`\`bash
mission_room.sh request-approval --room <roomId> --task <taskId> --reason "QA passed; ready to ship"
\`\`\`

### Approve an in_review task (close the loop)

\`\`\`bash
mission_room.sh approve <taskId> [--note "Looks good"]
\`\`\`

Marks status: in_review → done. Emits "Task approved" lifecycle msg in the
project room. Only valid on tasks currently in \`in_review\`.

### Request changes on an in_review task (loop back)

\`\`\`bash
mission_room.sh request-change <taskId> --reason "Add edge case for tier rollover"
\`\`\`

Atomic: appends \`[change_request]\` comment, reverts status to \`in_progress\`,
re-dispatches the agent (continue) so the comment becomes the brief for the
next turn. The task's session is preserved.

## Operating principles

- **Task Board is canonical.** Tasks, comments, activity log, attachments, and
  project memory live there — not duplicated in the room.
- **The room is the conversation surface.** Use it for clarifying intent,
  delegating, and summarizing. Avoid pasting full task bodies into chat.
- **Decompose ruthlessly.** When a user describes a goal, identify which
  specialist agent is best for each piece and create separate tasks.
- **Respect ownership.** A task's \`agentId\` is who executes it; only assign
  to specialists relevant to their role.
- **Don't paste secrets** into room messages or task descriptions.

> **History note**: \`mission_room.sh\` used to live in a separate skill called
> \`mission-orchestrator\`. That skill is deprecated as of \`aoc-master\` 1.1.0 —
> all its functionality is here now.
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

const PROVISION_SH = `#!/usr/bin/env bash
# aoc-master / provision.sh — provision a new agent
set -euo pipefail

# Source AOC credentials. Order matters: cluster-wide .aoc_env FIRST so the
# per-agent .aoc_agent_env can override AOC_TOKEN with the scoped service
# token (Sprint 2). Reverse order = cluster DASHBOARD_TOKEN wins = isolation
# break.
[ -f "\${HOME}/.openclaw/.aoc_env" ] && source "\${HOME}/.openclaw/.aoc_env" 2>/dev/null || true
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env" 2>/dev/null || true
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" 2>/dev/null || true

: "\${AOC_URL:=http://localhost:18800}"
: "\${AOC_TOKEN:?AOC_TOKEN env required}"

if [ "\\$#" -lt 2 ]; then
  echo "usage: provision.sh <id> \\"<name>\\" [role] [emoji]" >&2
  echo "example: provision.sh web-dev \\"Web Developer\\" SWE 🧑‍💻" >&2
  exit 1
fi

ID="\\$1"
NAME="\\$2"
ROLE="\${3:-}"
EMOJI="\${4:-🤖}"

HEADERS=(-H "Authorization: Bearer \${AOC_TOKEN}" -H "Content-Type: application/json")
[ -n "\${AOC_AGENT_ID:-}" ] && HEADERS+=(-H "X-Agent-Id: \${AOC_AGENT_ID}")

PAYLOAD=$(python3 -c '
import json, sys
print(json.dumps({
    "id": sys.argv[1],
    "name": sys.argv[2],
    "adlcRole": sys.argv[3],
    "emoji": sys.argv[4]
}))
' "\$ID" "\$NAME" "\$ROLE" "\$EMOJI")

response=$(curl -sS -w '\\n%{http_code}' -X POST -d "\$PAYLOAD" "\${HEADERS[@]}" "\${AOC_URL}/api/agents")
body=$(printf '%s\\n' "\$response" | sed '\\$d')
status=$(printf '%s\\n' "\$response" | tail -n1)

if [ "\$status" != "200" ] && [ "\$status" != "201" ]; then
  echo "ERROR: HTTP \$status" >&2
  echo "\$body" >&2
  exit 1
fi

printf '%s\\n' "\$body" | python3 -c '
import json, sys
data = json.load(sys.stdin)
if data.get("ok"):
    print(f"Success! Agent provisioned: {data.get(\\"agentId\\")} ({data.get(\\"agentName\\")})")
    print("Run \`team-status.sh\` to verify.")
else:
    print(f"Error: {data}")
'
`;

// mission_room.sh — Task Board driver, absorbed from the deprecated
// mission-orchestrator skill. Same script content + invocation surface so
// agents already calling `mission_room.sh <verb>` keep working.
const MISSION_ROOM_SH = `#!/usr/bin/env bash
# mission_room — drive AOC Mission Rooms + Task Board from an agent session.
#
# Subcommands:
#   post <roomId> <body>                                 — post a message to a room (use sparingly: AOC auto-captures replies)
#   create-task --project <id> --title "..." [opts]      — create a task (opts: --description, --assignee, --priority, --stage, --role, --epic)
#   update-task <taskId> [opts]                          — update task (opts: --status, --assignee, --priority, --stage, --role)
#   comment-task <taskId> <body>                         — add a comment to a task
#   dispatch-task <taskId>                               — kick off / resume agent execution for a task
#   request-approval --room <roomId> --task <taskId> --reason "..."
#                                                        — post a system-style approval request linked to a task
#   approve <taskId> [--note "..."]                      — close in_review → done
#   request-change <taskId> --reason "..."               — kick task back to in_progress with reason

set -euo pipefail

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env" 2>/dev/null || true
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" 2>/dev/null || true

[ -n "\${AOC_TOKEN:-}" ]    || { echo "mission_room: AOC_TOKEN not set" >&2; exit 2; }
[ -n "\${AOC_AGENT_ID:-}" ] || { echo "mission_room: AOC_AGENT_ID not set" >&2; exit 2; }
AOC_URL="\${AOC_URL:-http://localhost:18800}"

CMD="\${1:-}"; shift || true

case "$CMD" in
  post|create-task|update-task|comment-task|dispatch-task|request-approval|approve|request-change) ;;
  *)
    cat <<HELP >&2
Usage:
  mission_room.sh post <roomId> <message>
  mission_room.sh create-task --project <id> --title "..." [--description "..."] [--assignee <agentId>] [--priority urgent|high|medium|low] [--stage ...] [--role ...] [--epic <id>]
  mission_room.sh update-task <taskId> [--status backlog|todo|in_progress|in_review|done|cancelled] [--assignee <agentId>] [--priority ...] [--stage ...] [--role ...]
  mission_room.sh comment-task <taskId> "<body>"
  mission_room.sh dispatch-task <taskId>
  mission_room.sh request-approval --room <roomId> --task <taskId> --reason "..."
  mission_room.sh approve <taskId> [--note "..."]
  mission_room.sh request-change <taskId> --reason "..."
HELP
    exit 2
    ;;
esac

python3 - "$AOC_URL" "$AOC_TOKEN" "$AOC_AGENT_ID" "$CMD" "$@" <<'PY'
import json, sys, urllib.request, urllib.error

base, token, agent_id, cmd = sys.argv[1:5]
args = sys.argv[5:]

def http(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{base}{path}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"HTTP {e.code} {method} {path}: {e.read().decode()}\\n")
        sys.exit(1)

def flag(name, required=True, default=None):
    if name in args:
        i = args.index(name)
        if i + 1 >= len(args):
            sys.exit(f"mission_room: {name} expects a value")
        return args[i+1]
    if required:
        sys.exit(f"mission_room: {name} required")
    return default

def positional(idx, name, required=True):
    pos_clean = []
    skip = False
    for a in args:
        if skip:
            skip = False
            continue
        if a.startswith("--"):
            skip = True
            continue
        pos_clean.append(a)
    if idx < len(pos_clean):
        return pos_clean[idx]
    if required:
        sys.exit(f"mission_room: {name} required")
    return None

if cmd == "post":
    room_id = positional(0, "roomId")
    body    = positional(1, "body")
    out = http("POST", f"/api/rooms/{room_id}/messages/agent", {"agentId": agent_id, "body": body})

elif cmd == "create-task":
    payload = {
        "title":       flag("--title"),
        "projectId":   flag("--project"),
        "description": flag("--description", required=False),
        "agentId":     flag("--assignee",    required=False),
        "priority":    flag("--priority",    required=False),
        "stage":       flag("--stage",       required=False),
        "role":        flag("--role",        required=False),
        "epicId":      flag("--epic",        required=False),
        "requestFrom": agent_id,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    out = http("POST", "/api/tasks", payload)

elif cmd == "update-task":
    task_id = positional(0, "taskId")
    payload = {}
    for f, key in [("--status", "status"), ("--assignee", "agentId"), ("--priority", "priority"),
                   ("--stage", "stage"), ("--role", "role")]:
        v = flag(f, required=False)
        if v is not None:
            payload[key] = v
    if not payload:
        sys.exit("update-task: at least one update flag required")
    out = http("PATCH", f"/api/tasks/{task_id}", payload)

elif cmd == "comment-task":
    task_id = positional(0, "taskId")
    body    = positional(1, "body")
    out = http("POST", f"/api/tasks/{task_id}/comments", {"body": body, "agentId": agent_id})

elif cmd == "dispatch-task":
    task_id = positional(0, "taskId")
    out = http("POST", f"/api/tasks/{task_id}/dispatch", {})

elif cmd == "request-approval":
    room_id = flag("--room")
    task_id = flag("--task")
    reason  = flag("--reason")
    body    = f"🆗 Approval requested for task {task_id}: {reason}"
    out = http("POST", f"/api/rooms/{room_id}/messages/agent",
               {"agentId": agent_id, "body": body, "relatedTaskId": task_id})

elif cmd == "approve":
    task_id = positional(0, "taskId")
    note = flag("--note", required=False)
    payload = {"agentId": agent_id}
    if note is not None:
        payload["note"] = note
    out = http("POST", f"/api/tasks/{task_id}/approve", payload)

elif cmd == "request-change":
    task_id = positional(0, "taskId")
    reason = flag("--reason")
    out = http("POST", f"/api/tasks/{task_id}/request-change",
               {"agentId": agent_id, "reason": reason})

else:
    sys.exit(f"Unknown command: {cmd}")

print(json.dumps(out, indent=2))
PY
`;

const BUNDLE = {
  files: [
    { rel: 'SKILL.md',                   content: SKILL_MD,            mode: 0o644 },
    { rel: 'scripts/team-status.sh',     content: TEAM_STATUS_SH,      mode: 0o755 },
    { rel: 'scripts/delegate.sh',        content: DELEGATE_SH,          mode: 0o755 },
    { rel: 'scripts/list-team-roles.sh', content: LIST_TEAM_ROLES_SH,  mode: 0o755 },
    { rel: 'scripts/provision.sh',       content: PROVISION_SH,        mode: 0o755 },
    { rel: 'scripts/mission_room.sh',    content: MISSION_ROOM_SH,     mode: 0o755 },
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
async function ensureSkillEnabledForUserMasters({ masterAgentIds = [] } = {}) {
  const { withFileLock } = require('../locks.cjs');
  const cfgPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  return withFileLock(cfgPath, async () => {
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
  });
}

/**
 * Strip the legacy `mission-orchestrator` slug from every openclaw.json
 * (admin + per-user). Idempotent.
 *
 * Background: pre-1.1.0, `mission-orchestrator` was a separate skill
 * containing `mission_room.sh`. It only auto-enabled for admin's `main` agent
 * and was never inherited by per-user masters — leaving non-admin masters
 * without task-board operations. As of `aoc-master` 1.1.0, `mission_room.sh`
 * lives inside `aoc-master` itself and is enabled for every user's master.
 *
 * This migration removes the dead reference so users don't see "missing skill"
 * warnings at gateway boot.
 */
async function migrateRetireMissionOrchestrator() {
  const LEGACY_SLUG = 'mission-orchestrator';
  const { withFileLock } = require('../locks.cjs');

  function strip(cfgPath) {
    const cfg = readJsonSafe(cfgPath);
    if (!cfg) return false;
    let changed = false;
    if (Array.isArray(cfg.agents?.defaults?.skills) && cfg.agents.defaults.skills.includes(LEGACY_SLUG)) {
      cfg.agents.defaults.skills = cfg.agents.defaults.skills.filter(s => s !== LEGACY_SLUG);
      changed = true;
    }
    for (const agent of cfg.agents?.list || []) {
      if (Array.isArray(agent.skills) && agent.skills.includes(LEGACY_SLUG)) {
        agent.skills = agent.skills.filter(s => s !== LEGACY_SLUG);
        changed = true;
      }
    }
    if (cfg.skills?.entries?.[LEGACY_SLUG]) {
      delete cfg.skills.entries[LEGACY_SLUG];
      changed = true;
    }
    if (changed) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    return changed;
  }

  const adminCfg = path.join(OPENCLAW_HOME, 'openclaw.json');
  let adminChanged = false;
  await withFileLock(adminCfg, async () => { adminChanged = strip(adminCfg); });

  const usersDir = path.join(OPENCLAW_HOME, 'users');
  const patched = [];
  if (fs.existsSync(usersDir)) {
    for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cfgPath = path.join(usersDir, entry.name, '.openclaw', 'openclaw.json');
      if (!fs.existsSync(cfgPath)) continue;
      try {
        await withFileLock(cfgPath, async () => {
          if (strip(cfgPath)) patched.push(entry.name);
        });
      } catch (e) {
        console.warn(`[aoc-master] mission-orchestrator migration user ${entry.name} failed: ${e.message}`);
      }
    }
  }

  if (adminChanged || patched.length > 0) {
    const parts = [];
    if (adminChanged) parts.push('admin');
    if (patched.length > 0) parts.push(`${patched.length} per-user [${patched.join(', ')}]`);
    console.log(`[aoc-master] retired legacy 'mission-orchestrator' from: ${parts.join(' + ')}`);
  }
  return { adminChanged, perUserPatched: patched };
}

module.exports = {
  SKILL_SLUG,
  BUNDLE_VERSION,
  skillRoot,
  install,
  installSafe,
  ensureSkillEnabledForUserMasters,
  migrateRetireMissionOrchestrator,
};
