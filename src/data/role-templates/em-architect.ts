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

### EM-Specific Scripts
- gdocs-export.sh — Export markdown to Google Docs (optional, requires gws CLI)
- linear-task-create.sh — Create Linear issues for technical tasks
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

  skillContents: {
    'tech-stack-advisor': `---
name: tech-stack-advisor
description: "WAJIB DIGUNAKAN: Ketika diminta merekomendasikan tech stack, evaluate teknologi, atau membuat architecture decision record."
---

# Tech Stack Advisor

Evaluate dan rekomendasikan tech stack berdasarkan requirements, team expertise, dan long-term maintainability.

<HARD-GATE>
Jangan rekomendasikan teknologi yang tidak ada expertise di tim.
Setiap rekomendasi HARUS include trade-offs secara eksplisit.
ADR (Architecture Decision Record) WAJIB dibuat untuk setiap keputusan major.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Requirements Gathering** — Kumpulkan functional & non-functional requirements
2. **Team Expertise Assessment** — Identifikasi current team skillset
3. **Options Analysis** — Evaluate 2-3 tech stack options
4. **Trade-off Matrix** — Buat matrix: performance, cost, learning curve, ecosystem
5. **Risk Assessment** — Identifikasi risiko per option
6. **[HUMAN GATE — CTO]** — Kirim ADR draft via notify.sh, tunggu approval
7. **Final Recommendation** — Lock decision dengan justifikasi
8. **Output Document** — Write to outputs/YYYY-MM-DD-tech-stack-adr-{feature}.md

## Process Flow

\`\`\`dot
digraph tech_stack {
  rankdir=TB
  node [shape=box, style=rounded]
  reqs [label="Requirements\\nGathering"]
  team [label="Team Expertise\\nAssessment"]
  options [label="Options Analysis"]
  matrix [label="Trade-off Matrix"]
  risks [label="Risk Assessment"]
  gate [label="HUMAN GATE\\nCTO Approval", shape=diamond, style="filled", fillcolor="#f59e0b"]
  lock [label="Lock Decision"]
  output [label="Write ADR"]
  revise [label="Revise Options"]

  reqs -> team -> options -> matrix -> risks -> gate
  gate -> lock [label="Approved"]
  gate -> revise [label="Concerns"]
  revise -> options
  lock -> output
}
\`\`\`

## Inter-Agent Handoff

**Input dari:** PM Agent (Agent 1) — PRD technical requirements
**Output ke:** FSD Generator skill (self) — approved tech stack for FSD

## Anti-Pattern

- Jangan pilih teknologi karena "trending" tanpa evaluasi
- Jangan skip trade-off analysis — CTO akan tanya
- Jangan lock stack tanpa team buy-in
`,

    'effort-estimator': `---
name: effort-estimator
description: "WAJIB DIGUNAKAN: Ketika diminta estimasi effort, timeline, atau sprint planning untuk fitur baru."
---

# Effort Estimator

Buat effort estimation yang realistis berdasarkan FSD, team velocity, dan historical data.

<HARD-GATE>
Jangan berikan estimasi tanpa membaca FSD secara penuh.
Setiap estimasi HARUS include buffer 20% untuk unknowns.
Estimasi harus di-review oleh setidaknya satu senior engineer.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **FSD Review** — Baca FSD secara penuh, identifikasi semua task
2. **Task Breakdown** — Break down ke tasks < 2 hari per task
3. **Complexity Assessment** — Rate setiap task: S/M/L/XL (1/3/5/8 days)
4. **Dependencies Mapping** — Identifikasi dependencies antar tasks
5. **Buffer Calculation** — Tambah 20% buffer untuk unknowns + 10% untuk review
6. **Timeline Projection** — Hitung total dengan team velocity
7. **[HUMAN GATE — EM/CTO]** — Send estimate via notify.sh for sign-off
8. **Output Document** — Write to outputs/YYYY-MM-DD-effort-estimate-{feature}.md

## Process Flow

\`\`\`dot
digraph effort_estimator {
  rankdir=TB
  node [shape=box, style=rounded]
  fsd [label="Read FSD"]
  breakdown [label="Task Breakdown"]
  complexity [label="Complexity\\nAssessment"]
  deps [label="Dependencies\\nMapping"]
  buffer [label="Buffer\\nCalculation"]
  timeline [label="Timeline\\nProjection"]
  gate [label="HUMAN GATE\\nEM/CTO Sign-off", shape=diamond, style="filled", fillcolor="#f59e0b"]
  output [label="Write Output Doc"]
  revise [label="Revise Estimate"]

  fsd -> breakdown -> complexity -> deps -> buffer -> timeline -> gate
  gate -> output [label="Approved"]
  gate -> revise [label="Too Large/Small"]
  revise -> breakdown
}
\`\`\`

## Inter-Agent Handoff

**Input dari:** FSD Generator — completed FSD
**Output ke:** SWE (Agent 4) — effort estimate + task breakdown for sprint planning

## Anti-Pattern

- Jangan beri estimasi "optimistic" untuk mengakomodasi deadline — be honest
- Jangan skip dependencies mapping — ini sumber slip terbesar
- Jangan forget QA time dalam estimasi
`,
  },

  scriptTemplates: [
    { filename: 'gdocs-export.sh', content: GDOCS_SH },
    {
      filename: 'linear-task-create.sh',
      content: `#!/bin/bash
# Create a Linear issue from command line.
# Usage: ./linear-task-create.sh <title> <description> [team_key]
# Requires: LINEAR_API_KEY environment variable
set -euo pipefail
TITLE="\${1:-}"
DESC="\${2:-}"
TEAM="\${3:-ENG}"
if [ -z "$TITLE" ]; then
  echo "Usage: ./linear-task-create.sh <title> <description> [team_key]"
  exit 1
fi
LINEAR_API_KEY="\${LINEAR_API_KEY:-}"
if [ -z "$LINEAR_API_KEY" ]; then
  echo "ERROR: LINEAR_API_KEY not set."
  echo "Setup: export LINEAR_API_KEY=lin_api_..."
  exit 1
fi
echo "Creating Linear issue: $TITLE"
echo "Team: $TEAM"
echo "Description: $DESC"
# Query team ID
TEAM_QUERY='{"query":"query { teams { nodes { id key name } } }"}'
TEAMS=$(curl -sf -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d "$TEAM_QUERY" https://api.linear.app/graphql 2>/dev/null || echo "{}")
TEAM_ID=$(echo "$TEAMS" | grep -o '"id":"[^"]*","key":"'"$TEAM"'"' | grep -o '"id":"[^"]*"' | head -1 | tr -d '"id:' || echo "")
if [ -z "$TEAM_ID" ]; then
  echo "WARNING: Team '$TEAM' not found. Issue creation requires valid team."
  echo "Available teams: $(echo "$TEAMS" | grep -o '"key":"[^"]*"' | tr -d '"key:' | tr '\\n' ', ')"
  exit 1
fi
CREATE_QUERY="{\"query\":\"mutation { issueCreate(input: { teamId: \\\"$TEAM_ID\\\", title: \\\"$TITLE\\\", description: \\\"$DESC\\\" }) { success issue { id identifier url } } }\"}"
RESULT=$(curl -sf -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d "$CREATE_QUERY" https://api.linear.app/graphql 2>/dev/null || echo "{}")
echo "Result: $RESULT"
echo "Done."
`,
    },
    { filename: 'notify.sh', content: NOTIFY_SH },
  ],

  fsWorkspaceOnly: false,
}
