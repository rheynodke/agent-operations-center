import type { AgentRoleTemplate } from '@/types'

const NOTIFY_SH = `#!/bin/bash
# Send a notification via the agent's bound channel (WhatsApp, Telegram, or Discord).
# Usage: ./notify.sh <message> [--channel auto|whatsapp|telegram|discord]
set -euo pipefail
MESSAGE="\${1:-}"
CHANNEL="\${2:-auto}"
if [ -z "$MESSAGE" ]; then echo "Usage: ./notify.sh <message> [--channel auto|whatsapp|telegram|discord]"; exit 1; fi
AOC_URL="\${AOC_URL:-http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:-}"
AOC_AGENT_ID="\${AOC_AGENT_ID:-}"
if [ -z "$AOC_TOKEN" ]; then
  echo "WARNING: AOC_TOKEN not set. Message: $MESSAGE"
  mkdir -p "\${HOME}/.openclaw/logs"
  echo "$(date -Iseconds) [no-token] $MESSAGE" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true
  exit 0
fi
if [ "$CHANNEL" = "auto" ] && [ -n "$AOC_AGENT_ID" ]; then
  CHANNELS_JSON=$(curl -sf -H "Authorization: Bearer $AOC_TOKEN" "$AOC_URL/api/agents/$AOC_AGENT_ID/channels" 2>/dev/null || echo "{}")
  if echo "$CHANNELS_JSON" | grep -q '"telegram"'; then CHANNEL="telegram"
  elif echo "$CHANNELS_JSON" | grep -q '"whatsapp"'; then CHANNEL="whatsapp"
  elif echo "$CHANNELS_JSON" | grep -q '"discord"'; then CHANNEL="discord"
  else CHANNEL="log-only"; fi
fi
mkdir -p "\${HOME}/.openclaw/logs"
echo "$(date -Iseconds) [$CHANNEL] $MESSAGE" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true
echo "Notification via $CHANNEL: $MESSAGE"
case "$CHANNEL" in
  telegram|whatsapp|discord)
    curl -sf -X POST -H "Authorization: Bearer $AOC_TOKEN" -H "Content-Type: application/json" \
      -d "{\\"message\\": \\"$MESSAGE\\", \\"channel\\": \\"$CHANNEL\\"}" \
      "$AOC_URL/api/agents/$AOC_AGENT_ID/notify" 2>/dev/null || echo "WARNING: Gateway delivery failed."
    ;;
esac
echo "Done."
`

const GDOCS_SH = `#!/bin/bash
# Export a Markdown file to Google Docs via gws CLI (optional).
# Usage: ./gdocs-export.sh <markdown_file> [doc_title]
set -euo pipefail
MD_FILE="\${1:-}"
DOC_TITLE="\${2:-}"
if [ -z "$MD_FILE" ]; then echo "Usage: ./gdocs-export.sh <markdown_file> [doc_title]"; exit 1; fi
if [ ! -f "$MD_FILE" ]; then echo "ERROR: File not found: $MD_FILE"; exit 1; fi
if ! command -v gws &> /dev/null; then
  echo "INFO: gws CLI not found. Skipping Google Docs export."
  echo "Output saved locally: $MD_FILE"
  exit 0
fi
if [ -z "$DOC_TITLE" ]; then DOC_TITLE=$(basename "$MD_FILE" .md | sed 's/-/ /g'); fi
echo "Exporting to Google Docs: $DOC_TITLE"
gws docs create --title "$DOC_TITLE" --content-file "$MD_FILE" --format markdown
echo "Done."
`

export const EM_ARCHITECT_TEMPLATE: AgentRoleTemplate = {
  id: 'em-architect',
  adlcAgentNumber: 3,
  role: 'EM & System Architect',
  emoji: '🏗️',
  color: '#0ea5e9',
  description: 'Technical feasibility assessment, FSD generation, API contract design, tech stack advisory, dan effort estimation.',
  modelRecommendation: 'claude-opus-4-6',
  tags: ['em', 'architect', 'fsd', 'api', 'adlc'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** EM & System Architect
- **Emoji:** 🏗️
- **Role:** ADLC Agent 3 — Engineering Manager & System Architect
- **Vibe:** Systems thinker, pragmatic, quality-focused

## My Mission

Saya adalah EM/Architect Agent dalam pipeline ADLC. Tugas utama saya:
1. **Feasibility Assessment** — Evaluasi technical feasibility dari PRD + Design Brief
2. **FSD Generation** — Buat Functional Specification Document yang detailed
3. **API Contract Design** — Define API contracts sebelum implementation
4. **Tech Stack Advisory** — Rekomendasikan tech stack yang tepat
5. **Effort Estimation** — Estimasi effort yang realistis

## My Position in ADLC Pipeline

- **Input dari:** PM Agent (Agent 1) + UX Agent (Agent 2) — PRD & Design Brief
- **Output ke:** SWE (Agent 4) — FSD + API contracts
- **Quality Gate:** FSD harus di-approve CTO sebelum development dimulai
`,

    soul: `# Soul of EM & System Architect

_Systems thinker yang selalu tanya "bagaimana ini bisa patah?" sebelum build._

**Pragmatic.** Pilih solusi yang tepat, bukan yang paling canggih.
**Rigorous.** FSD yang ambigu lebih berbahaya dari tidak ada FSD.
**Risk-Aware.** Selalu identifikasi risiko teknis sebelum commit ke timeline.
**Collaborative.** Architect bukan oracle — diskusikan dengan tim sebelum putuskan.

## Communication Style

- Gunakan Bahasa Indonesia untuk semua dokumen output
- Sertakan diagram/architecture decision untuk setiap proposal teknis
- Jangan pernah bilang "mudah" tanpa estimasi yang terverifikasi
- Setiap FSD harus punya risk register
`,

    tools: `# Tools

## Available to EM & System Architect

### Core
- exec (shell commands)
- read / write / edit (filesystem)
- web_search / web_fetch
- memory_search / memory_get

### Sessions
- sessions_spawn / sessions_send / sessions_yield
- agents_list / sessions_list

### Connection Scripts (credentials handled automatically via AOC)
- check_connections.sh — List available connections. Usage: \`check_connections.sh [type]\`
- aoc-connect.sh — Access services via centralized connections (credentials never in stdout)
  - Website API: \`aoc-connect.sh "Linear" api "/graphql"\` — Create/query Linear issues

### EM-Specific Scripts
- linear-task-create.sh — Create Linear issues via aoc-connect.sh
- gdocs-export.sh — Export markdown to Google Docs (optional, requires gws CLI)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)

### Output Convention
All documents written to: \`outputs/YYYY-MM-DD-{slug}.md\`
`,
  },

  skillSlugs: [
    'feasibility-brief',
    'fsd-generator',
    'api-contract',
    'tech-stack-advisor',
    'effort-estimator',
  ],

  // All skill content resolved from AOC Skill Catalog (in-catalog).
  skillContents: {},

  scriptTemplates: [
    { filename: 'gdocs-export.sh', content: GDOCS_SH },
    {
      filename: 'linear-task-create.sh',
      content: `#!/bin/bash
# Create a Linear issue via aoc-connect.sh (credentials handled centrally).
# Usage: ./linear-task-create.sh <title> <description> [team_key] [--connection "Linear"]
#
# Requires: Linear registered as a Website connection in AOC Dashboard.
# Register Linear as a Website connection in AOC Dashboard (type: api_key, URL: https://api.linear.app).
set -euo pipefail
TITLE="\${1:-}"
DESC="\${2:-}"
TEAM="\${3:-ENG}"
CONN_NAME="\${4:-Linear}"
if [ -z "$TITLE" ]; then
  echo "Usage: ./linear-task-create.sh <title> <description> [team_key] [--connection name]"
  exit 1
fi
echo "Creating Linear issue: $TITLE"
echo "Team: $TEAM"
# Try aoc-connect.sh first (centralized credentials)
TEAM_QUERY='{"query":"query { teams { nodes { id key name } } }"}'
if command -v aoc-connect.sh &>/dev/null || [ -f "\${OPENCLAW_HOME:-$HOME/.openclaw}/scripts/aoc-connect.sh" ]; then
  AOC_CONNECT="\${OPENCLAW_HOME:-$HOME/.openclaw}/scripts/aoc-connect.sh"
  TEAMS=$($AOC_CONNECT "$CONN_NAME" api "graphql" 2>/dev/null <<< "$TEAM_QUERY" || echo "")
  if [ -z "$TEAMS" ]; then
    echo "WARNING: aoc-connect.sh failed for '$CONN_NAME'. Check: check_connections.sh website"
    echo "Register Linear as a Website connection in AOC Dashboard (type: api_key, URL: https://api.linear.app)"
    exit 1
  fi
else
  echo "WARNING: aoc-connect.sh not found. Register Linear in AOC Dashboard Connections."
  echo "Run: check_connections.sh website"
  exit 1
fi
TEAM_ID=$(echo "$TEAMS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
teams = data.get('data',{}).get('teams',{}).get('nodes',[])
target = '$TEAM'
for t in teams:
    if t.get('key') == target:
        print(t['id'])
        sys.exit(0)
print('')
" 2>/dev/null || echo "")
if [ -z "$TEAM_ID" ]; then
  echo "WARNING: Team '$TEAM' not found."
  exit 1
fi
CREATE_QUERY="{\"query\":\"mutation { issueCreate(input: { teamId: \\\"$TEAM_ID\\\", title: \\\"$TITLE\\\", description: \\\"$DESC\\\" }) { success issue { id identifier url } } }\"}"
RESULT=$($AOC_CONNECT "$CONN_NAME" api "graphql" 2>/dev/null <<< "$CREATE_QUERY" || echo "{}")
echo "Result: $RESULT"
echo "Done."
`,
    },
    { filename: 'notify.sh', content: NOTIFY_SH },
  ],

  fsWorkspaceOnly: false,
}
