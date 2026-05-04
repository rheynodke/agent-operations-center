'use strict';
/**
 * aoc-tasks — built-in skill bundle.
 *
 * Wraps the Task Board contract (update_task / check_tasks / save_output /
 * post_comment / fetch_attachment) as a proper skill at
 *   ~/.openclaw/skills/aoc-tasks/
 * with a thin SKILL.md playbook and the five shell scripts under scripts/.
 *
 * Auto-installed at startup. Auto-enabled for every agent (added to
 * config.agents.defaults.skills, and to each agent's explicit allowlist if
 * any). The skill replaces the legacy flat copies that used to live in
 * ~/.openclaw/scripts/ — those get purged by scripts.cjs.
 */
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');
const {
  UPDATE_TASK_SCRIPT_CONTENT,
  CHECK_TASKS_SCRIPT_CONTENT,
  FETCH_ATTACHMENT_SCRIPT_CONTENT,
  SAVE_OUTPUT_SCRIPT_CONTENT,
  POST_COMMENT_SCRIPT_CONTENT,
  PROJECT_MEMORY_SCRIPT_CONTENT,
} = require('../scripts.cjs');

const SKILL_SLUG    = 'aoc-tasks';
const BUNDLE_VERSION = '1.3.0';

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
name: aoc-tasks
description: Built-in AOC skill — Task Board contract. Teaches the agent how to report progress, save deliverables, comment on tasks, and pull attachments from the AOC dashboard. Auto-enabled for every agent.
type: built-in
layer: 1
---

# aoc-tasks — AOC Task Board contract

You are connected to the **AOC Task Board** via the dashboard backend. Use the
scripts below to coordinate with the human team.

## Path setup — once per shell session

\`\`\`bash
export PATH="$HOME/.openclaw/skills/aoc-tasks/scripts:$PATH"
\`\`\`

After that, the bare names below resolve.

## When you receive a task

Tasks arrive via the gateway as a turn that includes a task ID and brief.
**Always** acknowledge receipt by setting status to \`in_progress\` before
doing work:

\`\`\`bash
update_task.sh "<taskId>" in_progress "starting work — <one-line plan>"
\`\`\`

## Reporting progress mid-task

Use \`post_comment\` for in-flight updates that **don't** change status.
Status changes (in_review, blocked, done) can trigger re-dispatch — comments
don't, so they're cheap.

\`\`\`bash
post_comment.sh "<taskId>" "Pulled the data, now formatting"
\`\`\`

If you hit a blocker that needs human input, change status to \`blocked\`
with a clear note:

\`\`\`bash
update_task.sh "<taskId>" blocked "need DB credentials for staging — please assign a connection"
\`\`\`

## Delivering outputs

Anything substantive (a doc, a CSV, an image, a JSON payload) must be saved
to the task's output folder so it shows up on the board:

\`\`\`bash
save_output.sh "<taskId>" ./outputs/result.csv result.csv --description "Summary table for Q1"
# Or stream from stdout:
some_command | save_output.sh "<taskId>" - report.txt --description "Daily report"
\`\`\`

Always include \`--description\` — that's what the user sees on the board card.

## Pulling attachments

If a task has attachments (file uploads, links from a synced sheet), fetch
them into your working directory:

\`\`\`bash
fetch_attachment.sh "<url>" ./inputs
\`\`\`

The script auto-resolves AOC-served URLs (adds the auth token) and
auto-extracts \`.zip\` / converts \`.docx\` to plain text where possible.

## Project Workspace (when the task belongs to a bound project)

If the task brief includes a **📁 Project Workspace** section, the project
has a dedicated directory on disk that is shared across every agent on the
project. Treat it as the **primary working directory for this task**:

1. **Read the task context first.** A JSON file at
   \`<workspacePath>/.aoc/tasks/<taskId>/context.json\` summarizes the task,
   project metadata, branch, and (when applicable) ADLC stage + role. Read it
   at the start of every turn — it is rewritten on each dispatch.
2. **Where to save deliverables:**
   - Final, shareable outputs → \`<workspacePath>/outputs/\` (and within an
     ADLC subfolder like \`01-discovery/\` when the project is \`kind=adlc\`).
     These are committable.
   - Per-task scratch files → \`<workspacePath>/.aoc/tasks/<taskId>/outputs/\`.
     These are git-ignored.
   - You can still use \`save_output.sh\` for the legacy per-agent outputs
     folder — AOC's watcher will pick the file up regardless. But when a
     project workspace exists, prefer writing into the project so other
     agents on the project can see it.
3. **Brownfield projects** (existing codebases): read the source under the
   workspace as context, but do **not** modify user files unless the task
   explicitly asks for it. Stay inside \`outputs/\` and \`.aoc/\` for any
   files you create.
4. **Greenfield projects**: scaffold whatever structure the task calls for
   directly under the workspace path.

The branch shown in the brief is the active git branch for this dispatch —
respect it. Do not switch branches on your own; ask the operator (\`blocked\`
status) if a different branch is needed.

## Closing a task

When the work is verifiably complete and outputs are saved:

\`\`\`bash
update_task.sh "<taskId>" done "summary of what was delivered"
\`\`\`

Use \`in_review\` instead of \`done\` if a human should sign off before close.

## What you should NOT do

- Don't \`update_task.sh ... done\` without first calling \`save_output.sh\` for
  the deliverables (otherwise the board card has a "done" tag but nothing
  attached).
- Don't echo the auth token or any credential to chat / comments.
- Don't poll the board with \`check_tasks.sh\` mid-task — it's run for you on
  the heartbeat schedule.

## Status values

| Status | When |
|---|---|
| \`todo\` | Initial — set by user |
| \`in_progress\` | You're actively working |
| \`in_review\` | Awaiting human verification |
| \`blocked\` | You need input/access — \`note\` must explain what |
| \`done\` | Verifiably complete; outputs saved |

## Project memory (decisions / questions / risks / glossary)

Every dispatch's \`context.json\` includes a \`projectMemory\` snapshot when the
project has memory entries. Read it directly, or use the helper:

\`\`\`bash
project_memory.sh show                              # human-readable summary
project_memory.sh list decision                     # JSON: all decisions
project_memory.sh list question open                # JSON: open questions only
project_memory.sh add decision "Use SQLite v1" "Postgres adds ops cost we can't justify yet"
project_memory.sh add question "Should free tier include API access?"
project_memory.sh add risk "Users may not adopt new flow" "Onboarding feedback shows confusion" usability high
project_memory.sh add glossary "Dispatch" "Sending a task to an agent for execution"
project_memory.sh resolve <id> "Decided: yes, capped at 100 req/day"
project_memory.sh archive <id>
\`\`\`

**When to write:**
- **Decision** — after you (or human) make a non-obvious architectural / product choice. Saves re-litigation.
- **Question** — when you encounter an ambiguity you can't resolve alone. Better than blocking the task if it's a project-level concern.
- **Risk** — when you spot a likelihood-of-failure issue. Categories: \`value\` (will users want it?), \`usability\` (can they use it?), \`feasibility\` (can we build it?), \`viability\` (does it sustain the business?). Severity: \`low\`/\`medium\`/\`high\`.
- **Glossary** — when a domain term shows up that future-you / other agents would mis-translate.

Memory is project-scoped and persists across all sessions in the project.

### Closing reflection (auto-triggered)

When you set status to \`done\` or \`in_review\`, the dashboard sends you ONE
follow-up turn asking you to reflect on memory worth logging. This is the
natural moment to capture what you'd otherwise lose. **Treat it seriously**
— briefly review the work, log entries via \`project_memory.sh add ...\`, and
end the turn. If genuinely nothing notable, reply \`"no entries needed"\` and
end. **Do not change task status during the reflection turn** (the task is
already closed).

Examples of good closing reflection output:
\`\`\`
project_memory.sh add decision "Use bcrypt rounds=12" "Rounds=14 added 200ms p99 in load test; rounds=12 acceptable trade"
project_memory.sh add risk "SQLite WAL required in prod" "Without WAL, concurrent writers fail intermittently" feasibility medium
project_memory.sh add glossary "session" "JWT pair (access+refresh) — distinct from gateway chat session"
no other entries needed
\`\`\`

## Token usage reporting (optional)

When you finish a task, you can report token usage so the board can show
cost monitoring:

\`\`\`bash
update_task.sh "<taskId>" done "<note>" "<sessionId>" 12500 4200
\`\`\`

Args 5 and 6 are \`inputTokens\` and \`outputTokens\`. Skip them if unsure —
the board falls back to gateway-reported usage.
`;

const BUNDLE = {
  files: [
    { relPath: 'SKILL.md',                      content: SKILL_MD,                       protect: true },
    { relPath: 'scripts/update_task.sh',        content: UPDATE_TASK_SCRIPT_CONTENT,     protect: true, exec: true },
    { relPath: 'scripts/check_tasks.sh',        content: CHECK_TASKS_SCRIPT_CONTENT,     protect: true, exec: true },
    { relPath: 'scripts/fetch_attachment.sh',   content: FETCH_ATTACHMENT_SCRIPT_CONTENT, protect: true, exec: true },
    { relPath: 'scripts/save_output.sh',        content: SAVE_OUTPUT_SCRIPT_CONTENT,     protect: true, exec: true },
    { relPath: 'scripts/post_comment.sh',       content: POST_COMMENT_SCRIPT_CONTENT,    protect: true, exec: true },
    { relPath: 'scripts/project_memory.sh',     content: PROJECT_MEMORY_SCRIPT_CONTENT,  protect: true, exec: true },
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
  // Reconcile exec bit even when content unchanged but mode regressed.
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
    if (r.written > 0) console.log(`[aoc-tasks] installed ${r.written}/${r.total} files`);
    return r;
  } catch (err) {
    console.warn('[aoc-tasks] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/** Ensure aoc-tasks is in agents.defaults.skills (so brand-new agents inherit
 *  it) AND in every existing agent's explicit allowlist (if they have one).
 *  Idempotent. Writes openclaw.json only if a change is actually needed. */
function ensureSkillEnabledForAllAgents() {
  const cfgPath = path.join(OPENCLAW_HOME, 'openclaw.json');
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
    if (!Array.isArray(agent.skills)) continue; // inherits defaults — fine
    if (!agent.skills.includes(SKILL_SLUG)) {
      agent.skills.push(SKILL_SLUG);
      changed = true;
    }
  }

  // Also ensure skills.entries[aoc-tasks].enabled is not explicitly false
  cfg.skills = cfg.skills || {};
  cfg.skills.entries = cfg.skills.entries || {};
  const entry = cfg.skills.entries[SKILL_SLUG];
  if (entry && entry.enabled === false) {
    delete cfg.skills.entries[SKILL_SLUG].enabled;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    console.log('[aoc-tasks] enabled skill in openclaw.json (defaults + agent allowlists)');
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
  ensureSkillEnabledForAllAgents,
};
