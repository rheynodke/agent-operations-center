'use strict';
/**
 * aoc-self — built-in skill that lets an agent author its own personal
 * skills (scope='agent'), enable/disable them in its own allowlist, and
 * inspect what it has authored.
 *
 * Skills created via this bundle live at <workspace>/.agents/skills/<slug>/
 * — outside any global / shared dir, so they are scoped only to this agent.
 * The orchestrator's `buildSkillsPathPrefix` walks per-agent workspaces, so
 * scripts under <workspace>/.agents/skills/<slug>/scripts/ are auto-resolved
 * on PATH after the next gateway restart.
 *
 * Auto-installed at startup. Auto-enabled in admin's defaults + every per-
 * user openclaw.json, mirroring aoc-schedules.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');

const SKILL_SLUG = 'aoc-self';
const BUNDLE_VERSION = '1.2.0'; // 1.2.0: add /remember command + agent-memory-append.sh; resolve MEMORY.md guidance conflict

const ENV_PRELUDE = `\\
source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env"
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env"
`;

const SKILL_MD = `---
name: aoc-self
description: Built-in AOC skill — author your own personal skills (scope='agent'), AND persist single-line rules/facts to your own MEMORY.md so you never have to be re-taught the same thing twice. Skills bottle multi-step workflows. /remember persists individual rules.
type: built-in
layer: 1
---

# aoc-self — Author your own skills AND persist rules

You can:
1. **Write personal skills** that only YOU can see and run (multi-step workflows).
2. **Persist single rules / facts to MEMORY.md** via the \`/remember\` command — so the next session you start, you already know what the user told you.

## When to use which

| User says... | Right tool | Why |
|--------------|-----------|-----|
| "Kalau aku bilang X, selalu lakukan Y" / "Inget ini ya" / "Jangan lagi begitu" | **\`/remember\` → MEMORY.md** | Single durable rule, no shell command. |
| "Bottle this workflow as a command" / "Ini chain curl panjang, simpan dong" | **agent-skill-create.sh** | Multi-step shell, needs PATH integration. |
| "Catat ini ke memory" / "Save to memory" / "Note this for next time" | **\`/remember\`** | Default — append to MEMORY.md. |

**Never claim "saved to memory" without actually executing one of these tools in the same turn. That is a hard rule — see SOUL.md self-correction protocol.**

## Setup — once per shell session

\`\`\`bash
export PATH="$HOME/.openclaw/skills/aoc-self/scripts:$PATH"
\`\`\`

## How personal skills are stored

Created at \`<your-workspace>/.agents/skills/<slug>/\`. Layout:

\`\`\`
.agents/skills/<slug>/
├── SKILL.md           # frontmatter + when-to-use guidance
└── scripts/
    └── <slug>.sh      # the actual command (added separately)
\`\`\`

The orchestrator scans this dir at gateway boot and prepends scripts/ to PATH —
so after \`agent-skill-create.sh\` + \`agent-skill-add-script.sh\` + a gateway
restart, you can call your script by bare name.

## Creating a personal skill

Step 1 — scaffold the skill folder + SKILL.md + enable it in your allowlist:

\`\`\`bash
agent-skill-create.sh inventory-monday-export "Export Odoo stock changes from last week to a Google Sheet"
\`\`\`

This writes a SKILL.md with the description you provided and registers the slug
in your \`agents.list[<id>].skills\` allowlist. The skill is now visible to you
in future sessions.

Step 2 — add the actual executable script:

\`\`\`bash
agent-skill-add-script.sh inventory-monday-export inventory-export.sh "$(cat <<'SH'
#!/usr/bin/env bash
set -euo pipefail
START=\$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d '7 days ago' +%Y-%m-%d)
odoo.sh dke-prod record search stock.move --domain "[('date','>=','\$START')]" --fields product_id,quantity,date \\
  | gws-call.sh google_sheets append-rows --sheet-id ABC123 --range Sheet1!A1
SH
)"
\`\`\`

The script is mode 0755 automatically. After **gateway restart** the bare name
\`inventory-export.sh\` resolves on PATH.

## Listing your skills

\`\`\`bash
agent-skill-list.sh           # all your personal skills
\`\`\`

## Removing a skill

\`\`\`bash
agent-skill-remove.sh inventory-monday-export --yes
\`\`\`

Disables the slug in your allowlist and deletes the folder.

## Sharp edges (always tell the user)

1. **Gateway restart required** for newly-added script to be PATH-resolvable
   (same caveat as cron jobs). Until restart, invoke with full path:
   \`bash .agents/skills/<slug>/scripts/<file>.sh\`.
2. **Personal scope only** — the skill is visible only to YOU. Other agents
   under the same user (and the master) cannot run your scripts. If you want a
   skill shared across the team, ask the user to install it as a user-level
   skill via the dashboard.
3. **No secrets in scripts** — scripts go through your gateway's exec sandbox
   like any other tool. Don't hard-code API keys; use \`aoc-connect.sh\` /
   connection-based credentials instead.
4. **Confirm with user before delete** — \`agent-skill-remove.sh\` requires
   \`--yes\`.

## Environment variables

- \`AOC_URL\` — dashboard URL (default http://localhost:18800)
- \`AOC_TOKEN\` — bearer (sourced from \`.aoc_agent_env\`)
- \`AOC_AGENT_ID\` — your agent id (the API uses this to scope writes)
`;

const AGENT_SKILL_CREATE_SH = `#!/usr/bin/env bash
# aoc-self / agent-skill-create.sh — scaffold a new agent-scoped skill + enable it.
# Usage: agent-skill-create.sh <slug> "<one-line description / when to use>"
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AOC_AGENT_ID="\${AOC_AGENT_ID:?AOC_AGENT_ID not set}"

SLUG="\${1:?Usage: agent-skill-create.sh <slug> \\"<description>\\"}"
DESC="\${2:-Personal skill}"

# slug sanity: letters, digits, hyphen, underscore, dot
case "\$SLUG" in *[!a-zA-Z0-9._-]* )
  echo "Error: slug must match [a-zA-Z0-9._-]+" >&2; exit 64 ;;
esac

# Build SKILL.md content with frontmatter
SKILL_CONTENT=\$(cat <<EOF
---
name: \$SLUG
description: \$DESC
type: agent-local
---

# \$SLUG

\$DESC

## Usage

Run \\\`\$SLUG.sh\\\` to invoke this skill.

## Notes

Created by \$AOC_AGENT_ID on \$(date -u +%Y-%m-%dT%H:%M:%SZ).
EOF
)

# Step 1: create the skill folder + SKILL.md (scope='agent' = <ws>/.agents/skills/<slug>/)
CREATE_RESP=\$(curl -sf -X POST \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "\$(jq -n --arg name "\$SLUG" --arg scope agent --arg content "\$SKILL_CONTENT" '{name: \$name, scope: \$scope, content: \$content}')" \\
  "\$AOC_URL/api/agents/\$AOC_AGENT_ID/skills" 2>&1) || {
  echo "[agent-skill-create] failed to create skill folder:" >&2
  echo "\$CREATE_RESP" >&2
  exit 1
}

# Step 2: enable in allowlist
TOGGLE_RESP=\$(curl -sf -X PATCH \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled": true}' \\
  "\$AOC_URL/api/agents/\$AOC_AGENT_ID/skills/\$SLUG/toggle" 2>&1) || {
  echo "[agent-skill-create] folder created but toggle failed:" >&2
  echo "\$TOGGLE_RESP" >&2
  exit 1
}

echo "\$CREATE_RESP" | jq '{slug: .slug, scope: .scope, path: .path}'
echo
echo "Skill scaffolded + enabled. Next steps:" >&2
echo "  1) Add a script:    agent-skill-add-script.sh \$SLUG <filename>.sh \\"<bash-body>\\"" >&2
echo "  2) Restart gateway so the new script resolves on PATH." >&2
`;

const AGENT_SKILL_ADD_SCRIPT_SH = `#!/usr/bin/env bash
# aoc-self / agent-skill-add-script.sh — add an executable script to your agent-scoped skill.
# Usage: agent-skill-add-script.sh <slug> <filename> <content>
#        agent-skill-add-script.sh <slug> <filename> -        # read content from stdin
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AOC_AGENT_ID="\${AOC_AGENT_ID:?AOC_AGENT_ID not set}"

SLUG="\${1:?Usage: agent-skill-add-script.sh <slug> <filename> <content|->}"
FILENAME="\${2:?Usage: agent-skill-add-script.sh <slug> <filename> <content|->}"
CONTENT_ARG="\${3:?Usage: agent-skill-add-script.sh <slug> <filename> <content|->}"

# filename sanity: no path traversal, ends with allowed ext
case "\$FILENAME" in
  */*|*..*) echo "Error: filename must not contain '/' or '..'" >&2; exit 64 ;;
esac
case "\$FILENAME" in
  *.sh|*.py|*.js|*.ts|*.rb|*.bash|*.zsh|*.fish|*.lua) ;;
  *) echo "Error: filename must end in .sh / .py / .js / .ts / .rb / .bash / .zsh / .fish / .lua" >&2; exit 64 ;;
esac

if [ "\$CONTENT_ARG" = "-" ]; then
  CONTENT=\$(cat)
else
  CONTENT="\$CONTENT_ARG"
fi

curl -sf -X PUT \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "\$(jq -n --arg content "\$CONTENT" '{content: \$content}')" \\
  "\$AOC_URL/api/agents/\$AOC_AGENT_ID/skills/\$SLUG/scripts/\$FILENAME" | jq .

echo
echo "Script added. NOTE: gateway restart required before bare-name resolution works." >&2
`;

const AGENT_SKILL_LIST_SH = `#!/usr/bin/env bash
# aoc-self / agent-skill-list.sh — list YOUR personal (agent-scope) skills.
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AOC_AGENT_ID="\${AOC_AGENT_ID:?AOC_AGENT_ID not set}"

# /api/agents/:id/skills returns ALL skills (built-in, global, agent-local) so
# we filter to the ones with scope/source indicating they're agent-authored.
curl -sf -H "Authorization: Bearer \$AOC_TOKEN" "\$AOC_URL/api/agents/\$AOC_AGENT_ID/skills" \\
  | jq '[.skills[]? | select((.scope // "") == "agent" or (.source // "") == "agent" or (.path // "") | contains(".agents/skills"))
         | {slug: (.slug // .name), enabled, description, path}]'
`;

const AGENT_SKILL_REMOVE_SH = `#!/usr/bin/env bash
# aoc-self / agent-skill-remove.sh — disable + delete a personal skill.
# Usage: agent-skill-remove.sh <slug> [--yes]
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AOC_AGENT_ID="\${AOC_AGENT_ID:?AOC_AGENT_ID not set}"

SLUG="\${1:?Usage: agent-skill-remove.sh <slug> [--yes]}"
CONFIRM="\${2:-}"

if [ "\$CONFIRM" != "--yes" ]; then
  echo "Refusing to delete skill '\$SLUG' without --yes." >&2
  echo "Confirm with the user, then re-run with --yes." >&2
  exit 65
fi

# Disable first (best-effort).
curl -sf -X PATCH \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled": false}' \\
  "\$AOC_URL/api/agents/\$AOC_AGENT_ID/skills/\$SLUG/toggle" >/dev/null 2>&1 || true

# Delete the folder.
curl -sf -X DELETE \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  "\$AOC_URL/api/agents/\$AOC_AGENT_ID/skills/\$SLUG" | jq .
`;

const AGENT_MEMORY_APPEND_SH = `#!/usr/bin/env bash
# aoc-self / agent-memory-append.sh — append a single rule/fact to YOUR MEMORY.md.
# Usage: agent-memory-append.sh "<rule text>"
#        echo "<rule text>" | agent-memory-append.sh -
# The script GETs current MEMORY.md, appends the rule under a dated heading,
# then PUTs it back. Idempotent on exact duplicate lines (skips if already present).
set -euo pipefail
${ENV_PRELUDE}
AOC_URL="\${AOC_URL:=http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set}"
AOC_AGENT_ID="\${AOC_AGENT_ID:?AOC_AGENT_ID not set}"

RULE="\${1:?Usage: agent-memory-append.sh \\"<rule>\\" | -}"
if [ "\$RULE" = "-" ]; then RULE=\$(cat); fi
RULE=\$(printf '%s' "\$RULE" | sed 's/[[:space:]]*$//') # trim trailing whitespace
[ -n "\$RULE" ] || { echo "Refusing empty rule" >&2; exit 64; }

API="\$AOC_URL/api/agents/\$AOC_AGENT_ID/files/MEMORY.md"

CURRENT=\$(curl -sf -H "Authorization: Bearer \$AOC_TOKEN" "\$API" | jq -r '.content // ""')

# Idempotency: skip if exact rule line already in file
if printf '%s\\n' "\$CURRENT" | grep -Fxq "- \$RULE"; then
  echo "Rule already present in MEMORY.md (no change)." >&2
  exit 0
fi

TODAY=\$(date +%Y-%m-%d)
HEADING="## Auto-remembered (\$TODAY)"

# Append. If today's heading exists, slot under it; else add new heading section.
if printf '%s\\n' "\$CURRENT" | grep -Fxq "\$HEADING"; then
  NEW=\$(printf '%s\\n- %s\\n' "\$CURRENT" "\$RULE")
else
  SEP=""
  [ -n "\$CURRENT" ] && SEP=$'\\n\\n'
  NEW=\$(printf '%s%s%s\\n\\n- %s\\n' "\$CURRENT" "\$SEP" "\$HEADING" "\$RULE")
fi

curl -sf -X PUT \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "\$(jq -n --arg content "\$NEW" '{content: \$content}')" \\
  "\$API" >/dev/null

echo "Appended to MEMORY.md: \$RULE" >&2
`;

const COMMANDS_JSON = JSON.stringify([
  {
    name: 'remember',
    description: 'Persist a single rule / fact / preference to your MEMORY.md',
    argHint: '<rule text — one durable sentence the user wants you to know forever>',
    template:
`User memberi slash command /remember.

User input: {{args}}

LANGKAH WAJIB:
1. Bersihkan input: hilangkan "inget ya", "catat dong", dsb. Sisakan rule inti dalam 1 kalimat deklaratif.
2. Kalau input kosong atau ambigu, tanya 1 pertanyaan klarifikasi singkat lalu STOP.
3. Eksekusi: \`agent-memory-append.sh "<rule>"\` — JANGAN skip, JANGAN klaim sukses tanpa exit code 0.
4. Setelah script sukses, balas 1 baris: "✅ Tersimpan ke MEMORY.md: <rule>".
5. STOP. Jangan tawarkan tindakan lain.

LARANGAN KERAS:
- Jangan pernah merespons "sudah kucatat" tanpa benar-benar menjalankan agent-memory-append.sh di turn ini.
- Kalau script gagal (non-zero exit), laporkan error apa adanya — JANGAN palsu klaim sukses.`
  },
  {
    name: 'list-my-skills',
    description: 'Tampilkan daftar skill personal yang Anda buat sendiri',
    argHint: '',
    template:
`Anda menerima slash command /list-my-skills.

LANGKAH:
1. Jalankan \`agent-skill-list.sh\`.
2. Rangkum hasil ke bullet list singkat: \`• <slug>: <description> [enabled|disabled]\`.
3. Kalau kosong, beri 1 kalimat: "Belum ada skill personal — ketik /create-my-skill untuk membuat."
4. STOP. Jangan tawarkan tindakan lain.`
  },
  {
    name: 'create-my-skill',
    description: 'Buat skill personal baru untuk diri Anda sendiri',
    argHint: '<deskripsi: kapan skill ini dipakai + apa yang dikerjakan>',
    template:
`Anda menerima slash command /create-my-skill dari user.

User input: {{args}}

LANGKAH:
1. Parse narasi user untuk:
   - slug: nama pendek dengan format [a-z0-9-]+ (auto-generate dari deskripsi kalau user tidak menyebutkan eksplisit)
   - description: 1 kalimat kapan skill ini dipakai
   - body skript: command shell apa yang akan dieksekusi (tanya kalau tidak jelas)
2. Kalau body skript tidak jelas, ajukan 1 pertanyaan: "Apa exact command yang harus dijalankan?" lalu STOP.
3. Konfirmasi: "Akan buat skill '<slug>' yang menjalankan: <command>. OK?" tunggu jawaban.
4. Setelah user konfirmasi:
   a. \`agent-skill-create.sh <slug> "<description>"\`
   b. \`agent-skill-add-script.sh <slug> <slug>.sh "<body>"\`
5. Lapor: skill terbuat di .agents/skills/<slug>/, ingatkan **gateway restart** wajib supaya bare-name resolve di PATH.
6. STOP. Jangan menawarkan tugas lain.

Hanya gunakan tools: agent-skill-create.sh, agent-skill-add-script.sh.`
  },
  {
    name: 'remove-my-skill',
    description: 'Hapus skill personal Anda (selalu konfirmasi dulu)',
    argHint: '<slug>',
    template:
`Anda menerima slash command /remove-my-skill dari user.

User input: {{args}}

LANGKAH:
1. Parse slug dari input.
2. Tampilkan detail skill yang akan dihapus (jalankan \`agent-skill-list.sh\` dan ambil entry yang cocok).
3. Konfirmasi EKSPLISIT: "Hapus skill '<slug>'? (ya/tidak)" — STOP, tunggu jawaban.
4. Kalau user "ya": \`agent-skill-remove.sh <slug> --yes\`.
5. Kalau user "tidak": acknowledge, STOP.
6. Setelah delete sukses, lapor singkat. STOP.`
  }
], null, 2) + '\n';

const BUNDLE = {
  files: [
    { rel: 'SKILL.md', content: SKILL_MD, mode: 0o644 },
    { rel: 'commands.json', content: COMMANDS_JSON, mode: 0o644 },
    { rel: 'scripts/agent-skill-create.sh',     content: AGENT_SKILL_CREATE_SH,     mode: 0o755 },
    { rel: 'scripts/agent-skill-add-script.sh', content: AGENT_SKILL_ADD_SCRIPT_SH, mode: 0o755 },
    { rel: 'scripts/agent-skill-list.sh',       content: AGENT_SKILL_LIST_SH,       mode: 0o755 },
    { rel: 'scripts/agent-skill-remove.sh',     content: AGENT_SKILL_REMOVE_SH,     mode: 0o755 },
    { rel: 'scripts/agent-memory-append.sh',    content: AGENT_MEMORY_APPEND_SH,    mode: 0o755 },
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
    if (r.written > 0) console.log(`[aoc-self] installed ${r.written}/${r.total} files`);
    return r;
  } catch (err) {
    console.warn('[aoc-self] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// Patch admin + every per-user openclaw.json to enable aoc-self in allowlists.
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

  if (changed) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  return changed;
}

async function ensureSkillEnabledForAllAgents() {
  const { withFileLock } = require('../locks.cjs');
  const adminCfg = path.join(OPENCLAW_HOME, 'openclaw.json');

  let adminChanged = false;
  await withFileLock(adminCfg, async () => { adminChanged = patchConfig(adminCfg); });

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
        console.warn(`[aoc-self] patch user ${entry.name} failed: ${e.message}`);
      }
    }
  }

  if (adminChanged || patched.length > 0) {
    const parts = [];
    if (adminChanged) parts.push('admin');
    if (patched.length > 0) parts.push(`${patched.length} per-user [${patched.join(', ')}]`);
    console.log(`[aoc-self] enabled skill in openclaw.json for: ${parts.join(' + ')}`);
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
