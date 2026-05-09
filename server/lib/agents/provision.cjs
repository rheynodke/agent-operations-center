'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR, getUserHome, getUserAgentsDir, readJsonSafe } = require('../config.cjs');

/** Resolve home/agentsDir/workspace for a userId. userId == null/1 → admin paths. */
function _homeFor(userId) {
  return userId == null || Number(userId) === 1 ? OPENCLAW_HOME : getUserHome(userId);
}
function _agentsDirFor(userId) {
  return userId == null || Number(userId) === 1 ? AGENTS_DIR : getUserAgentsDir(userId);
}
function _workspaceFor(userId) {
  return userId == null || Number(userId) === 1
    ? OPENCLAW_WORKSPACE
    : path.join(getUserHome(userId), 'workspace');
}
const { ensureUpdateTaskScript, ensureCheckTasksScript, ensureCheckConnectionsScript, ensureGwsCallScript, ensureAocConnectScript, ensureMcpCallScript, ensureFetchAttachmentScript, ensureSaveOutputScript, ensurePostCommentScript, injectHeartbeatTaskCheck, ensureSharedAdlcScripts, syncAgentBuiltins, stampBuiltinSharedMeta } = require('../scripts.cjs');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'agent';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function readFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  } catch {}
  return null;
}

// ── Bootstrap file generators ─────────────────────────────────────────────────

function generateIdentityMd({ name, emoji, theme, description }) {
  return [
    `# IDENTITY.md - Who Am I?`,
    '',
    `- **Name:** ${name}`,
    `- **Emoji:** ${emoji || '🤖'}`,
    theme ? `- **Vibe:** ${theme}` : null,
    description ? `- **Role:** ${description}` : null,
  ].filter(l => l !== null).join('\n') + '\n';
}

const RESEARCH_STANDARD_BLOCK = `
<!-- aoc:research-standard:start -->
## Output Standard: Research & Web Search

Whenever you perform web searches, browse URLs, or gather information from external sources, **always include a Sources section at the end of your response**.

**Format:**

**Sources:**
- https://example.com/article-you-read
- https://another-source.com/reference

**Rules:**
- List every URL you actually accessed, read, or referenced
- Only include URLs you genuinely visited — never fabricate sources
- If no web search or URL retrieval was performed in this response, omit the Sources section entirely
- Sources allow humans to verify your findings and build trust in your work
<!-- aoc:research-standard:end -->`;

function generateSoulMd({ name, theme, soulContent }) {
  const base = (soulContent && soulContent.trim())
    ? `# Soul of ${name}\n\n${soulContent.trim()}`
    : [
        `# Soul of ${name}`,
        '',
        `_${theme || 'A focused, reliable autonomous agent'}_`,
        '',
        `**Clear.** Gives precise, actionable responses without unnecessary filler.`,
        `**Reliable.** Follows through on tasks completely before reporting back.`,
        `**Adaptive.** Adjusts tone and depth to what the situation actually needs.`,
      ].join('\n');

  return base.trimEnd() + RESEARCH_STANDARD_BLOCK + '\n';
}

const MASTER_AGENTS_ADDENDUM = `

---

## Master Agent Orchestration

You are the **Master Agent** for this workspace — the user's entry point and conductor for the team. Operational habits specific to this role:

### Routing decisions

| Situation | Action |
|---|---|
| Casual chat, quick fact, memory update | Handle yourself. |
| Task matches a sub-agent's role (PM, SWE, QA, DocWriter, dst) | **Delegate.** |
| Task spans multiple specialists | Decompose, delegate each part. |
| User explicitly says "ask <agent>" | Always delegate to that agent. |
| User asks something risky (delete data, send public messages, modify shared infra) | **Clarify first** — ask user to confirm scope/intent before acting. |

### Tools you have (via the \`aoc-master\` skill)

- \`team-status.sh\` — list user's sub-agents + their roles + last activity
- \`delegate.sh <agent_id> "<task>"\` — open/reuse a session against a sub-agent and post the task
- \`list-team-roles.sh\` — short list (agent_id\\trole) for quick lookup
- \`provision.sh <id> "<name>" [role] [emoji]\` — create a new sub-agent in the user's workspace

Run \`team-status.sh\` whenever you're not sure who to delegate to. After delegating, **acknowledge to the user**: "Saya delegate ke X karena Y. Update akan datang via Z."

### Risk-aware operating style

You have broad filesystem access (not workspace-only) and the user's gateway runs without exec approval gates. **That's a privilege, not a license.** Use the prompting-with-clarification approach:

- **Safe ops (read, list, search, write within workspace):** just do it.
- **Risky ops (delete, overwrite outside workspace, network calls that write, send messages on user's behalf):** announce + ask one clarifying question before acting. "Saya mau hapus folder X dengan ~100 file di dalamnya. Yakin lanjut?"
- **Hard-stop ops (delete master agent's own files, drop user data, force-push, send public messages):** refuse and surface to user as "this needs your explicit go-ahead in plain text."

The principle: **be careful, not blocked.** The user picked you to be helpful, not to wait for approval on every command. Clarify, then act.

### Slash Command Execution Protocol

You are the **single entry point** for all slash commands in the room. When a user sends a message starting with "/":

1. **Parse the command** — identify which command (e.g., /provision)
2. **Extract parameters** — use NLP to find required + optional fields:
   - Explicit flags: \`role=SWE\`, \`name=Oracle\`
   - NLP patterns: \`namanya X\`, \`nama X\`, \`role X\`, \`sebagai X\`
   - First token = name (if not specified otherwise)
3. **Validate required fields** — if missing, ask user (conversational)
4. **Execute** — run the corresponding shell script
5. **Report** — reply with result in Indonesian

**Missing field handling:**

- Required field missing → ask user: "Boleh sebutin [field]?"
- Optional field missing (e.g., role) → proceed with defaults
- Ambiguous input → ask user to clarify

**Error handling:**

- Translate HTTP errors to friendly Indonesian messages
- 409 Conflict → "Nama sudah dipakai. Coba nama lain?"
- 404 Not Found → "Agent/room tidak ditemukan."
- 403 Forbidden → "Tidak punya izin untuk ini."

### Memory habits for the Master role

- Keep a "team map" in MEMORY.md: \`agent_id: role + 1-line capability hint\`. Update when sub-agents are added/removed.
- Track recurring user patterns. If user always asks PM agent for X, note it.
- Log delegation failures. If a sub-agent rejected/struggled with a task, note why so next time you route differently.
`;

function generateAgentsMd({ name, isMaster = false }) {
  return `# AGENTS.md - ${name}'s Workspace

This folder is home. Treat it that way.

## First Run

If \`BOOTSTRAP.md\` exists, that's your birth certificate. Follow it, figure out who you are, then delete it. You won't need it again.

## Every Session

Before doing anything else:

1. Read \`SOUL.md\` — this is who you are
2. Read \`USER.md\` — this is who you're helping
3. List \`memory/\` directory, then read any files whose name starts with today's or yesterday's date (format: \`YYYY-MM-DD\`) — there may be multiple files per day (e.g. \`2026-04-09-greeting.md\`, \`2026-04-09-task.md\`)
4. Read \`MEMORY.md\` — your long-term curated memory (always present, may be empty at first)

Don't ask permission. Just do it.

## Memory

You wake up fresh each session. These files are your continuity:

- **Daily notes:** \`memory/YYYY-MM-DD-description.md\` — raw logs of what happened each day. Multiple files per day is normal. Always name with a date prefix + short description (e.g. \`memory/2026-04-09-odoo-fix.md\`).
- **Long-term:** \`MEMORY.md\` — your curated memories, the distilled essence. Always read this at session start.

Capture what matters. Decisions, context, things to remember. Skip the secrets unless asked to keep them.

### 🧠 MEMORY.md - Your Long-Term Memory

- Always present in your workspace (created at provisioning, may be empty initially)
- Read it every session — it's your continuity across conversations
- You can **read, edit, and update** MEMORY.md freely
- Write significant events, thoughts, decisions, opinions, lessons learned
- Over time, review your daily files and update MEMORY.md with what's worth keeping long-term

### 📝 Write It Down - No "Mental Notes"!

- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- "Mental notes" don't survive session restarts. Files do.
- When someone says "remember this" → create \`memory/YYYY-MM-DD-description.md\` or update \`MEMORY.md\`
- When you learn a lesson → update AGENTS.md, TOOLS.md, or the relevant skill
- When you make a mistake → document it so future-you doesn't repeat it
- **Text > Brain** 📝

## Saving Outputs / Artifacts

When you produce a file the user will want to keep, share, or download
(reports, analyses, data dumps, generated images, scripts, etc.), put it in
\`outputs/\`. The dashboard's chat panel reads this folder to surface
"what came out of this conversation" — files written elsewhere are flagged
as out-of-convention and pollute the workspace tree.

- ✅ \`outputs/<file>\` — single deliverable
- ✅ \`outputs/<descriptive-slug>/<file>\` — multi-file deliverable (group
  related files under ONE slug folder, kebab-case, no spaces)
- ❌ Do NOT create new top-level workspace folders like \`reports/\`,
  \`analysis/\`, \`product_sync_audit/\`, etc. Those bypass the convention
  and don't show up in the dashboard's Outputs tab cleanly.
- \`memory/\` is for YOUR notes (daily logs, recall) — not user-facing
  artifacts. Don't dump deliverables there.
- For task-driven runs the path is \`outputs/<taskId>/\` (handled by
  \`save_output.sh\` from aoc-tasks). Never write task artifacts elsewhere.

## Safety

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- \`trash\` > \`rm\` (recoverable beats gone forever)
- When in doubt, ask.

## External vs Internal

**Safe to do freely:**

- Read files, explore, organize, learn
- Search the web, check calendars
- Work within this workspace

**Ask first:**

- Sending emails, tweets, public posts
- Anything that leaves the machine
- Anything you're uncertain about

## Group Chats

You have access to your human's stuff. That doesn't mean you _share_ their stuff. In groups, you're a participant — not their voice, not their proxy. Think before you speak.

### 💬 Know When to Speak!

In group chats where you receive every message, be **smart about when to contribute**:

**Respond when:**

- Directly mentioned or asked a question
- You can add genuine value (info, insight, help)
- Something witty/funny fits naturally
- Correcting important misinformation

**Stay silent (HEARTBEAT_OK) when:**

- It's just casual banter between humans
- Someone already answered the question
- Your response would just be "yeah" or "nice"
- The conversation is flowing fine without you

**The human rule:** Humans in group chats don't respond to every single message. Neither should you. Quality > quantity.

**Avoid the triple-tap:** Don't respond multiple times to the same message. One thoughtful response beats three fragments.

### 😊 React Like a Human!

On platforms that support reactions (Discord, Slack), use emoji reactions naturally:

- React when you appreciate something but don't need to reply (👍, ❤️, 🙌)
- React when something made you laugh (😂, 💀)
- React when you find it interesting (🤔, 💡)
- Don't overdo it: one reaction per message max.

## Tools

Skills provide your tools. When you need one, check its \`SKILL.md\`. Keep local notes (camera names, SSH details, voice preferences) in \`TOOLS.md\`.

**📝 Platform Formatting:**

- **WhatsApp/Telegram:** Avoid markdown tables — use bullet lists instead
- **WhatsApp:** No headers — use **bold** or CAPS for emphasis
- **Telegram:** Supports basic markdown but test before assuming

## 💓 Heartbeats - Be Proactive!

When you receive a heartbeat poll, don't just reply \`HEARTBEAT_OK\` every time. Use heartbeats productively!

Default heartbeat prompt:
\`Read HEARTBEAT.md if it exists. Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.\`

You are free to edit \`HEARTBEAT.md\` with a short checklist or reminders. Keep it small to limit token burn.

**When to reach out:**

- Important message arrived
- Something time-sensitive coming up
- Something interesting you found
- It's been >8h since you said anything

**When to stay quiet (HEARTBEAT_OK):**

- Late night (23:00-08:00) unless urgent
- Human is clearly busy
- Nothing new since last check
- You just checked <30 minutes ago

### 🔄 Memory Maintenance (During Heartbeats)

Periodically (every few days), use a heartbeat to:

1. Read through recent \`memory/YYYY-MM-DD.md\` files
2. Identify significant events, lessons, or insights worth keeping long-term
3. Update \`MEMORY.md\` with distilled learnings
4. Remove outdated info from MEMORY.md that's no longer relevant

## Coordination

- Multi-agent tasks are coordinated through the main agent.
- Spawn subagents for parallel workstreams when needed.
- This workspace belongs to **${name}** — other agents are guests, not residents.

## Make It Yours

This is a starting point. Add your own conventions, style, and rules as you figure out what works.
${isMaster ? MASTER_AGENTS_ADDENDUM : ''}`;
}

function generateToolsMd({ name, isMaster = false }) {
  const lines = [
    `# Tools`,
    '',
    `## Available to ${name}`,
    '',
    '### Core (built-in OpenClaw runtime)',
    '- **exec** — run shell commands. Full security profile (no approval gates); use the prompting-with-clarification rules in AGENTS.md before risky ops.',
    '- **fs** — read / write / edit files. ' + (isMaster ? '**Broad access** (workspace-only OFF) — you can reach skills, scripts, and other agents\' workspaces under this user\'s home.' : 'Workspace-scoped by default.'),
    '- **web** — `web_search` + `web_fetch` (URL fetch). Search provider follows the gateway config (`tools.web.search.provider` in `openclaw.json`). Always cite sources per the SOUL.md research standard.',
    '- **memory** — `memory_search` / `memory_get` for retrieving prior session context.',
    '',
    '### Sessions (gateway RPC)',
    '- **sessions_spawn** — start a new chat session.',
    '- **sessions_send** — post a message to an existing session.',
    '- **sessions_yield** — hand control back to user.',
    '- **agents_list** / **sessions_list** — discovery.',
    '',
  ];

  if (isMaster) {
    lines.push(
      '### Built-in AOC skills (auto-enabled for Master)',
      '',
      '| Skill | What it does | Key entry points |',
      '|---|---|---|',
      '| **aoc-master** | Orchestration — list team + delegate tasks. Read SKILL.md inside the skill. | `team-status.sh`, `delegate.sh <agent_id> "<task>"`, `list-team-roles.sh` |',
      '| **aoc-tasks** | Task board contract — update task status, post comments, save outputs, fetch attachments. | `update_task.sh`, `check_tasks.sh`, `post_comment.sh`, `save_output.sh`, `fetch_attachment.sh` |',
      '| **aoc-connections** | Connection layer — call MCP servers, gateway RPCs, list bound connections. | `aoc-connect`, `check_connections.sh`, `mcp-call.sh`, `gws-call.sh` |',
      '| **browser-harness-odoo** | Headless-browser automation (Odoo focus). Use when a sub-agent isn\'t a better fit. | `browser-harness-acquire`, `runbook-run`, plus more under the skill\'s `scripts/` |',
      '',
      'Skills get added to your `skills` array in `openclaw.json` automatically. To call a script: read the skill\'s `SKILL.md` first for arg shape, then run via your shell tool. Output of a skill script is what you should pass back to the user (or to a delegate via `delegate.sh`).',
      '',
      '### Orchestration habits',
      '',
      'See **AGENTS.md → Master Agent Orchestration** for the routing decision table, risk-aware operating style, and team-map memory habits. That section is the load-bearing playbook for this role.',
      '',
    );
  } else {
    lines.push(
      '### Skills',
      '',
      'Default built-in skills inherited from your user\'s gateway: **aoc-tasks** (task board) and **aoc-connections** (connection layer). Read each skill\'s `SKILL.md` for the contract.',
      '',
      'User can add or remove skills any time via the AOC dashboard\'s Skills tab.',
      '',
    );
  }

  return lines.join('\n');
}

// ── Provider/id hints ─────────────────────────────────────────────────────────

function validateProvision(opts, agentList) {
  const { id, name, channels } = opts;

  if (!id) throw new Error('Agent ID is required');
  if (!VALID_ID_RE.test(id)) {
    throw new Error(`Agent ID "${id}" is invalid. Use lowercase letters, numbers, and hyphens (max 30 chars).`);
  }
  if (agentList.some(a => a.id === id)) {
    throw new Error(`Agent with ID "${id}" already exists`);
  }
  if (!name || !name.trim()) throw new Error('Agent name is required');

  // Channels are optional — agent can be provisioned without any channel binding
  // and channels can be added later via the Agent Detail page.
  const telegramChannels = (channels || []).filter(c => c.type === 'telegram');
  for (const ch of telegramChannels) {
    if (!ch.botToken || !ch.botToken.trim()) {
      throw new Error('Telegram bot token is required');
    }
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(ch.botToken.trim())) {
      throw new Error('Telegram bot token format is invalid (expected: 123456:ABC-DEF...)');
    }
  }
}

// ── Main provisioning function ────────────────────────────────────────────────

async function provisionAgent(opts, userId) {
  const { withFileLock } = require('../locks.cjs');
  const home = _homeFor(userId);
  const configPath = path.join(home, 'openclaw.json');
  return withFileLock(configPath, () => provisionAgentLocked(opts, userId, home, configPath));
}

function provisionAgentLocked(opts, userId, home, configPath) {
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentList = config.agents?.list || [];
  const defaultModel = config.agents?.defaults?.model?.primary || '';
  // Source of truth for sub-agent skill set. Inherited from admin during
  // ensureUserHome and may be tweaked per-user later. Always-on AOC skills
  // (aoc-tasks, aoc-connections) live here.
  // Always-on built-in skills every agent should have. Used as a safety net so
  // a master provisioned during the startup race (before installers finished
  // populating admin's defaults.skills) still gets the AOC contract skills.
  const BUILTIN_DEFAULT_SKILLS = ['aoc-tasks', 'aoc-connections', 'aoc-room'];
  const inheritedSkills = Array.isArray(config.agents?.defaults?.skills)
    ? config.agents.defaults.skills
    : [];
  // Merge inherited + built-in defaults (deduped) so a fresh user spawned
  // before installers completed still gets the canonical set.
  const defaultSkills = Array.from(new Set([...inheritedSkills, ...BUILTIN_DEFAULT_SKILLS]));
  // Persist any built-ins we just added back into the user's defaults so future
  // sub-agent provisions also inherit them (idempotent — only writes if changed).
  if (defaultSkills.length !== inheritedSkills.length) {
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.skills = defaultSkills;
  }
  // Master-only skills layered on top of the defaults. aoc-master is the
  // orchestration toolkit; browser-harness-odoo extends master's testing reach.
  const MASTER_EXTRA_SKILLS = ['aoc-master', 'browser-harness-odoo'];

  // 1. Validate
  validateProvision(opts, agentList);

  const {
    id,
    name,
    emoji    = '🤖',
    model    = defaultModel,
    theme    = '',
    description = '',
    color    = '',
    soulContent = '',
    channels = [],
    fsWorkspaceOnly = undefined,
    // ADLC role template fields
    adlcRole = '',
    agentFiles: templateFiles = null,
    skillSlugs = [],
    skillContents = {},
    scriptTemplates = [],
    isMaster = false,
  } = opts;

  // 2. Resolve paths (per-tenant).
  // Master Agent uses the user's global workspace dir (`<home>/workspace`) — same
  // layout admin uses for `main`. Sub-agents nest under `<home>/workspaces/<id>`.
  // This keeps the master == "default agent" semantic consistent across users.
  const workspacePath = isMaster
    ? path.join(home, 'workspace')
    : path.join(home, 'workspaces', id);
  const agentStatePath = path.join(_agentsDirFor(userId), id, 'agent');

  // 3. Mutate openclaw.json ──────────────────────────────────────────────────

  // 3a. Add to agents.list
  // Note: per-agent "env" is not supported in OpenClaw 2026.4.8+
  // AOC env vars (AOC_TOKEN, AOC_URL, AOC_AGENT_ID) are injected at runtime
  // via the agent's update_task.sh script, not via openclaw.json agent config.

  const agentEntry = {
    id,
    name,
    workspace: workspacePath,
    agentDir: agentStatePath,
    identity: {
      name,
      emoji,
      ...(theme ? { theme } : {}),
    },
    ...(model ? { model } : {}),
    // OpenClaw treats an explicit `skills` array (even `[]`) as a full override
    // of `agents.defaults.skills` — there is NO merge. So we must list every
    // skill we want the agent to have, explicitly, here. We read the current
    // user's `agents.defaults.skills` (inherited from admin during ensureUserHome)
    // as the source of truth for the always-on AOC built-ins.
    //   - Sub-agents: defaults verbatim.
    //   - Master: defaults + master-only extras (aoc-master, browser-harness-odoo).
    skills: isMaster
      ? Array.from(new Set([...MASTER_EXTRA_SKILLS, ...defaultSkills]))
      : [...defaultSkills],
    // Enable heartbeat for this agent (OpenClaw requires explicit config per agent).
    // Budget-friendly defaults: isolatedSession + lightContext drop per-heartbeat
    // input from ~99K to <5K tokens by skipping transcript replay and bootstrap
    // files. Model pinned to local LM Studio so heartbeat does not consume cloud
    // tokens at all. Override any field per-agent as needed.
    heartbeat: {
      isolatedSession: true,
      lightContext: true,
      suppressToolErrorWarnings: true,
      model: 'lmstudio/qwen/qwen3.6-35b-a3b',
    },
    // NOTE: adlcRole and isMaster are tracked in SQLite (agent_profiles.role,
    // agent_profiles.is_master + users.master_agent_id), NOT in openclaw.json
    // — OpenClaw rejects unknown keys via schema validation.
    // fsWorkspaceOnly: false for ADLC agents AND Master Agents — both need
    // broad filesystem access so skills (browser-harness, scripts, etc.) and
    // orchestration helpers (delegate.sh, team-status.sh) can reach beyond
    // the agent's own workspace dir. Per-user isolation still holds — the
    // user's gateway runs under <userHome>/, so "broad" is bounded to that.
    ...(fsWorkspaceOnly === false || adlcRole || isMaster ? { tools: { fs: { workspaceOnly: false } } } : {}),
  };

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  // Backfill heartbeat config for all existing agents that don't have it.
  // OpenClaw's heartbeat-runner only enables heartbeat for agents with explicit
  // `heartbeat` config once ANY agent has it — so all agents need the field.
  // Use the same budget-friendly defaults as new agents (see agentEntry above).
  for (const existing of config.agents.list) {
    if (!existing.heartbeat) {
      existing.heartbeat = {
        isolatedSession: true,
        lightContext: true,
        suppressToolErrorWarnings: true,
        model: 'lmstudio/qwen/qwen3.6-35b-a3b',
      };
    }
  }

  config.agents.list.push(agentEntry);

  // 3b. Add channel accounts + bindings
  const addedBindings = [];
  let whatsappPairingRequired = false;

  if (!config.bindings) config.bindings = [];
  if (!config.channels) config.channels = {};

  for (const ch of channels) {
    if (ch.type === 'telegram') {
      // Add telegram account
      if (!config.channels.telegram) config.channels.telegram = { enabled: true, accounts: {} };
      if (!config.channels.telegram.accounts) config.channels.telegram.accounts = {};
      config.channels.telegram.accounts[id] = {
        botToken: ch.botToken.trim(),
        dmPolicy: ch.dmPolicy || 'pairing',
        ...(ch.streaming ? { streaming: ch.streaming } : { streaming: 'partial' }),
        ...(ch.allowFrom && ch.allowFrom.length > 0 ? { allowFrom: ch.allowFrom } : {}),
      };

      // Add binding
      config.bindings.push({
        type: 'route',
        agentId: id,
        match: { channel: 'telegram', accountId: id },
      });
      addedBindings.push({ channel: 'telegram', accountId: id });
    }

    if (ch.type === 'whatsapp') {
      // Add whatsapp account (no token — QR pairing required separately)
      if (!config.channels.whatsapp) config.channels.whatsapp = { accounts: {} };
      if (!config.channels.whatsapp.accounts) config.channels.whatsapp.accounts = {};
      config.channels.whatsapp.accounts[id] = {
        dmPolicy: ch.dmPolicy || 'pairing',
        ...(ch.allowFrom && ch.allowFrom.length > 0 ? { allowFrom: ch.allowFrom } : {}),
      };

      // Add binding
      config.bindings.push({
        type: 'route',
        agentId: id,
        match: { channel: 'whatsapp', accountId: id },
      });
      addedBindings.push({ channel: 'whatsapp', accountId: id });
      whatsappPairingRequired = true;
    }

    if (ch.type === 'discord') {
      if (!ch.botToken || !String(ch.botToken).trim()) {
        throw new Error('Discord botToken is required');
      }
      if (!config.channels.discord) config.channels.discord = {};
      if (!config.channels.discord.accounts) config.channels.discord.accounts = {};
      config.channels.discord.enabled = true;
      config.channels.discord.accounts[id] = {
        token: String(ch.botToken).trim(),
        dmPolicy: ch.dmPolicy || 'pairing',
        groupPolicy: ch.groupPolicy || 'open',
      };

      // Add binding
      config.bindings.push({
        type: 'route',
        agentId: id,
        match: { channel: 'discord', accountId: id },
      });
      addedBindings.push({ channel: 'discord', accountId: id });
    }
  }

  // Write openclaw.json
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // 4. Scaffold workspace directory ─────────────────────────────────────────

  ensureDir(workspacePath);
  ensureDir(path.join(workspacePath, 'memory'));

  // Seed auth-profiles.json — agents need provider API keys to call LLMs.
  // Copy from admin's main agent (the canonical source) so every newly
  // provisioned agent (admin's or non-admin's) inherits the platform's
  // shared LLM credentials. Done idempotently.
  try {
    const srcAuth = path.join(AGENTS_DIR, 'main', 'agent', 'auth-profiles.json');
    const dstAuth = path.join(agentStatePath, 'auth-profiles.json');
    if (fs.existsSync(srcAuth) && !fs.existsSync(dstAuth)) {
      ensureDir(agentStatePath);
      fs.copyFileSync(srcAuth, dstAuth);
      try { fs.chmodSync(dstAuth, 0o600); } catch (_) {}
    }
  } catch (e) {
    console.warn(`[provision] auth-profiles seed failed: ${e.message}`);
  }

  // IDENTITY.md
  writeFile(
    path.join(workspacePath, 'IDENTITY.md'),
    generateIdentityMd({ name, emoji, theme, description })
  );

  // SOUL.md
  writeFile(
    path.join(workspacePath, 'SOUL.md'),
    generateSoulMd({ name, theme, soulContent })
  );

  if (isMaster) {
    const masterAddendum = [
      '',
      '---',
      '',
      '## Master Agent',
      '',
      'You are the **Master Agent** for this workspace. Your role is to orchestrate sub-agents,',
      'route user intent to the right specialist, and keep the team aligned. When a request',
      'arrives, you decide whether to handle it yourself or delegate to a sub-agent.',
      '',
    ].join('\n');
    fs.appendFileSync(path.join(workspacePath, 'SOUL.md'), masterAddendum);
  }

  // AGENTS.md
  writeFile(
    path.join(workspacePath, 'AGENTS.md'),
    generateAgentsMd({ name, isMaster })
  );

  // TOOLS.md
  writeFile(
    path.join(workspacePath, 'TOOLS.md'),
    generateToolsMd({ name, isMaster })
  );

  // MEMORY.md — long-term memory file (always scaffold, empty initially)
  writeFile(
    path.join(workspacePath, 'MEMORY.md'),
    `# MEMORY.md — ${name}'s Long-Term Memory\n\n_Nothing here yet. ${name} will fill this in over time._\n`
  );

  // USER.md — copy from this user's main workspace if available
  const mainUserMd = readFileSafe(path.join(_workspaceFor(userId), 'USER.md'));
  if (mainUserMd) {
    writeFile(path.join(workspacePath, 'USER.md'), mainUserMd);
  }

  // ── Block 1: Override agent files from template ──────────────────────────
  if (templateFiles) {
    if (templateFiles.identity) {
      writeFile(path.join(workspacePath, 'IDENTITY.md'), templateFiles.identity);
    }
    if (templateFiles.soul) {
      writeFile(path.join(workspacePath, 'SOUL.md'), templateFiles.soul);
      // Re-inject research standard block if not already present
      try {
        const soulPath = path.join(workspacePath, 'SOUL.md');
        const soulContent = fs.readFileSync(soulPath, 'utf-8');
        if (!soulContent.includes('<!-- aoc:research-standard:start -->')) {
          fs.writeFileSync(soulPath, soulContent.trimEnd() + RESEARCH_STANDARD_BLOCK + '\n', 'utf-8');
        }
      } catch (e) {
        console.warn('[provision] soul standard inject failed:', e.message);
      }
    }
    if (templateFiles.tools) {
      writeFile(path.join(workspacePath, 'TOOLS.md'), templateFiles.tools);
    }
    if (templateFiles.agents) {
      writeFile(path.join(workspacePath, 'AGENTS.md'), templateFiles.agents);
    }
  }

  // Create outputs/ directory for ADLC agents (markdown-first output convention)
  if (adlcRole) {
    ensureDir(path.join(workspacePath, 'outputs'));
  }

  // ── Block 2: Install skills to global dir (idempotent) ─────────────────
  if (skillSlugs.length > 0) {
    const globalSkillsDir = path.join(OPENCLAW_HOME, 'skills');
    ensureDir(globalSkillsDir);

    for (const slug of skillSlugs) {
      const skillDir = path.join(globalSkillsDir, slug);
      // Only write SKILL.md if dir doesn't exist AND we have content for this slug
      if (!fs.existsSync(skillDir) && skillContents[slug]) {
        ensureDir(skillDir);
        writeFile(path.join(skillDir, 'SKILL.md'), skillContents[slug]);
        console.log(`[provision] Installed global skill: ${slug}`);
      }
      // Add slug to agent's skills[] (if not already present)
      if (!agentEntry.skills.includes(slug)) {
        agentEntry.skills.push(slug);
      }
    }
  }

  // ── Block 3: Write script templates to agent workspace ──────────────────
  if (scriptTemplates.length > 0) {
    const agentScriptsDir = path.join(workspacePath, 'scripts');
    ensureDir(agentScriptsDir);

    const metaPath = path.join(agentScriptsDir, '.tools.json');
    const meta = readJsonSafe(metaPath) || {};

    for (const { filename, content } of scriptTemplates) {
      const scriptPath = path.join(agentScriptsDir, filename);
      writeFile(scriptPath, content);

      // chmod +x for shell scripts
      const ext = path.extname(filename).toLowerCase();
      if (['.sh', '.bash', '.zsh', '.fish'].includes(ext)) {
        try { fs.chmodSync(scriptPath, 0o755); } catch {}
      }

      // Upsert metadata entry
      const baseName = path.basename(filename, ext);
      if (!meta[filename]) {
        meta[filename] = { name: baseName, description: '' };
      }
    }

    writeFile(metaPath, JSON.stringify(meta, null, 2));
    console.log(`[provision] Wrote ${scriptTemplates.length} script template(s)`);
  }

  // 5. Create agent state directory
  ensureDir(agentStatePath);

  // Pre-link shared QMD model cache so first qmd query won't re-download GGUFs
  // for this agent. agentStatePath is `<agentsDir>/<id>/agent`; the qmd home
  // lives at `<agentsDir>/<id>/qmd/`, so we pass the parent.
  try {
    const { linkSharedQmdModelsForAgent } = require('../gateway-orchestrator.cjs');
    linkSharedQmdModelsForAgent(path.dirname(agentStatePath));
  } catch (e) {
    console.warn(`[provision] linkSharedQmdModels failed: ${e.message}`);
  }

  console.log(`[provision] Agent "${id}" ("${name}") provisioned successfully`);
  console.log(`[provision]   Workspace: ${workspacePath}`);
  console.log(`[provision]   Bindings: ${addedBindings.map(b => `${b.channel}/${b.accountId}`).join(', ')}`);

  // Auto-install update_task.sh and inject HEARTBEAT task check for the new agent
  try {
    ensureUpdateTaskScript();
    ensureCheckTasksScript();
    ensureCheckConnectionsScript();
    ensureGwsCallScript();
    ensureAocConnectScript();
    ensureMcpCallScript();
    ensureFetchAttachmentScript();
    ensureSaveOutputScript();
    ensurePostCommentScript();
    stampBuiltinSharedMeta();
    const getFileFn  = (_id, filename) => ({ content: fs.readFileSync(path.join(workspacePath, filename), 'utf-8') });
    const saveFileFn = (_id, filename, content) => fs.writeFileSync(path.join(workspacePath, filename), content, 'utf-8');
    // Auto-inject built-in scripts based on agent state (no connections / no skills yet at provision time
    // means only 'always' triggers fire — task scripts + aoc-connect + check_connections).
    syncAgentBuiltins(id, { connections: [], skills: [] }, getFileFn, saveFileFn);
    injectHeartbeatTaskCheck(id, workspacePath);
    // Write per-agent identity env file. Includes a service token scoped to
    // (agentId, ownerId) so this agent can hit AOC APIs as itself only —
    // bocor token = bocor *that* agent's scope, not the whole cluster.
    //
    // We export the per-agent JWT as BOTH `AOC_AGENT_TOKEN` (new, explicit
    // name) AND `AOC_TOKEN` (overrides the cluster-wide DASHBOARD_TOKEN that
    // ~/.openclaw/.aoc_env sets). The shell loads .aoc_agent_env after the
    // global env file, so existing skill scripts that use `$AOC_TOKEN`
    // pick up the scoped token automatically — zero script changes.
    let agentEnvContent = `# AOC agent identity — auto-generated\nexport AOC_AGENT_ID="${id}"\n`;
    try {
      const dbMod = require('../db.cjs');
      const tok = dbMod.generateAgentServiceToken
        ? dbMod.generateAgentServiceToken({ agentId: id, ownerId: userId ?? 1 })
        : null;
      if (tok) {
        agentEnvContent += `export AOC_AGENT_TOKEN="${tok}"\n`;
        agentEnvContent += `export AOC_TOKEN="${tok}"\n`;
      }
    } catch (e) {
      console.warn(`[provision] could not mint agent service token: ${e.message}`);
    }
    fs.writeFileSync(path.join(workspacePath, '.aoc_agent_env'), agentEnvContent, { mode: 0o600, encoding: 'utf-8' });
    console.log(`[provision] Created .aoc_agent_env for agent: ${id}`);
  } catch (e) {
    console.warn('[provision] agent setup failed:', e.message);
  }

  // Install shared ADLC scripts to ~/.openclaw/scripts/ if this is an ADLC agent
  if (adlcRole && scriptTemplates.length > 0) {
    try {
      ensureSharedAdlcScripts(scriptTemplates);
    } catch (e) {
      console.warn('[provision] shared ADLC scripts install failed:', e.message);
    }
  }

  return {
    ok: true,
    agentId: id,
    agentName: name,
    workspacePath,
    agentStatePath,
    bindings: addedBindings,
    whatsappPairingRequired,
    filesCreated: ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md', ...(mainUserMd ? ['USER.md'] : [])],
    profileSaved: false, // Will be updated by caller after SQLite save
    ...(isMaster ? { isMaster: true } : {}),
  };
}

module.exports = { provisionAgent, slugify, validateProvision };
