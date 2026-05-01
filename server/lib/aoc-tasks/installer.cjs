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
} = require('../scripts.cjs');

const SKILL_SLUG    = 'aoc-tasks';
const BUNDLE_VERSION = '1.0.0';

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
