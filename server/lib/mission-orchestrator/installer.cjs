'use strict';
/**
 * mission-orchestrator — built-in skill bundle.
 *
 * Installs the room reply helper and keeps this skill enabled only for the
 * main agent. Specialist agents can be mentioned in rooms, but only main gets
 * the orchestration playbook by default.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');

const SKILL_SLUG = 'mission-orchestrator';
const BUNDLE_VERSION = '0.4.0';

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

const SKILL_MD = `---
name: mission-orchestrator
description: Built-in AOC skill for the main agent to coordinate Mission Rooms and reply back to room conversations.
type: built-in
layer: 1
---

# mission-orchestrator

You are the main Mission Room orchestrator. Mission Rooms are persistent
multi-agent chat spaces in AOC. Your job: coordinate the user and specialist
agents, decompose user intent into tasks, delegate, and keep the Task Board
canonical.

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

## Driving the Task Board

The mission_room.sh script wraps existing Task Board APIs so you can drive
plans, tasks, comments, and dispatches from a room conversation. Required
env (already set in your runtime): \`AOC_TOKEN\`, \`AOC_AGENT_ID\`, \`AOC_URL\`.

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

Examples:
- "Buat PRD game pingpong" → \`--stage discovery --role pm\`
- "Design landing page"     → \`--stage design --role ux\`
- "QA pricing flow"         → \`--stage qa --role qa\`

Never leave stage/role unset — every task should land in the correct board
column with the correct role tag.

**Assignment rules — IMPORTANT:**

- \`--assignee\` MUST be a **specialist agent id** from the ROOM MEMBERS list
  in your prompt context (the \`id="..."\` value), and that specialist's role
  should match the task's role.
- **Never assign to yourself (\`main\`).** You are the orchestrator — you
  delegate, you do not execute. The server enforces this: tasks with
  \`requestFrom=main\` and \`assignee=main\` will have the assignee stripped.
- If no fitting specialist is in the roster, leave \`--assignee\` unset (task
  is created with the right stage/role tag for someone to pick up later) and
  ask the user "Tidak ada specialist <role> di room ini — mau assign ke siapa?".
- **Never call dispatch-task on a task that\`s assigned to yourself or
  unassigned.** The server will refuse.

Returns the created task JSON. The Task Board lifecycle hook automatically
posts a system message ("Task created · assigned to @X") into the project's
default room — so you do NOT need to announce the creation manually.

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

Atomic operation: appends a \`[change_request]\` comment, reverts status to
\`in_progress\`, and re-dispatches the agent (continue) so the comment becomes
the brief for the next turn. The task's session is preserved.

## Operating principles

- **Task Board is canonical.** Tasks, comments, activity log, attachments,
  and project memory live there — not duplicated in the room.
- **The room is the conversation surface.** Use it for clarifying intent,
  delegating, and summarizing. Avoid pasting full task bodies into chat.
- **Decompose ruthlessly.** When a user describes a goal, identify which
  specialist agent is best for each piece and create separate tasks.
- **Respect ownership.** A task's \`agentId\` is who executes it; only assign
  tasks to specialists relevant to their role (swe / qa / ux / etc.).
- **Don't paste secrets** into room messages or task descriptions.
`;

const MISSION_ROOM_SCRIPT = `#!/usr/bin/env bash
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
    pos = [a for a in args if not a.startswith("--")]
    # Filter out values that follow flags
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
    { relPath: 'SKILL.md', content: SKILL_MD, protect: true },
    { relPath: 'scripts/mission_room.sh', content: MISSION_ROOM_SCRIPT, protect: true, exec: true },
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
    files: BUNDLE.files.map(f => ({ relPath: f.relPath, exists: fs.existsSync(path.join(root, f.relPath)), protect: !!f.protect })),
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
  fs.writeFileSync(manifestPath(), JSON.stringify(newManifest, null, 2));
  return { ok: true, written, kept, skippedUserEdit, total: BUNDLE.files.length, bundleVersion: BUNDLE_VERSION };
}

function installSafe() {
  try {
    const r = install();
    if (r.written > 0) console.log(`[mission-orchestrator] installed ${r.written}/${r.total} files`);
    return r;
  } catch (err) {
    console.warn('[mission-orchestrator] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

function ensureSkillEnabledForMainAgent() {
  const cfgPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const cfg = readJsonSafe(cfgPath);
  if (!cfg) return { changed: false, reason: 'no openclaw.json' };
  let changed = false;
  cfg.agents = cfg.agents || {};
  cfg.agents.defaults = cfg.agents.defaults || {};
  if (Array.isArray(cfg.agents.defaults.skills) && cfg.agents.defaults.skills.includes(SKILL_SLUG)) {
    cfg.agents.defaults.skills = cfg.agents.defaults.skills.filter(s => s !== SKILL_SLUG);
    changed = true;
  }
  for (const agent of cfg.agents.list || []) {
    if (!Array.isArray(agent.skills)) agent.skills = [];
    const has = agent.skills.includes(SKILL_SLUG);
    if (agent.id === 'main') {
      if (!has) { agent.skills.push(SKILL_SLUG); changed = true; }
    } else if (has) {
      agent.skills = agent.skills.filter(s => s !== SKILL_SLUG);
      changed = true;
    }
  }
  cfg.skills = cfg.skills || {};
  cfg.skills.entries = cfg.skills.entries || {};
  if (cfg.skills.entries[SKILL_SLUG]?.enabled === false) {
    delete cfg.skills.entries[SKILL_SLUG].enabled;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    console.log('[mission-orchestrator] enabled skill only for main agent');
  }
  return { changed };
}

module.exports = {
  SKILL_SLUG,
  BUNDLE_VERSION,
  skillRoot,
  status,
  install,
  installSafe,
  ensureSkillEnabledForMainAgent,
};
