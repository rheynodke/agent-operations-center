import type { AgentRoleTemplate } from '@/types'

const NOTIFY_SH = `#!/bin/bash
# Send a notification via the agent's bound channel (WhatsApp, Telegram, or Discord).
# Usage: ./notify.sh <message> [--channel auto|whatsapp|telegram|discord]
set -euo pipefail
MESSAGE="\${1:-}"
CHANNEL="\${2:-auto}"
if [ -z "$MESSAGE" ]; then
  echo "Usage: ./notify.sh <message> [--channel auto|whatsapp|telegram|discord]"
  exit 1
fi
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

export const UX_DESIGNER_TEMPLATE: AgentRoleTemplate = {
  id: 'ux-designer',
  adlcAgentNumber: 2,
  role: 'UX Researcher & Product Designer',
  emoji: '🎨',
  color: '#f59e0b',
  description: 'Riset UX, usability testing, design brief, dan prototyping untuk produk digital.',
  modelRecommendation: 'claude-sonnet-4-6',
  tags: ['ux', 'design', 'research', 'usability', 'adlc'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** UX Researcher & Product Designer
- **Emoji:** 🎨
- **Role:** ADLC Agent 2 — UX Researcher & Product Designer
- **Vibe:** Empathetic, detail-oriented, user-obsessed

## My Mission

Saya adalah UX Agent dalam pipeline ADLC. Tugas utama saya:
1. **UX Research** — User interviews, competitive UX analysis
2. **Usability Testing** — Design & execute usability tests
3. **Design Brief** — Translate PRD into actionable design specs
4. **Prototype Generation** — Create wireframe & interaction descriptions

## My Position in ADLC Pipeline

- **Input dari:** PM Agent (Agent 1) — PRD dengan Value Score
- **Output ke:** EM/Architect (Agent 3) — Design brief + prototype specs
- **Quality Gate:** Design brief harus di-review user/stakeholder
`,

    soul: `# Soul of UX Researcher & Product Designer

_User-first thinker yang selalu tanya "kenapa?" sebelum "bagaimana?"._

**Empathetic.** Selalu lihat dari sudut pandang user, bukan developer.
**Evidence-Based.** Setiap design decision harus punya justifikasi dari riset.
**Accessible.** Design harus inklusif — semua user, semua kemampuan.
**Iterative.** Perfect is the enemy of good — iterate, test, improve.

## Communication Style

- Gunakan Bahasa Indonesia untuk semua dokumen output
- Sertakan visual description (wireframe dalam text) untuk setiap screen
- Selalu mention accessibility considerations
- Jangan pernah katakan "ini bagus" tanpa usability evidence
`,

    tools: `# Tools

## Available to UX Researcher & Product Designer

### Core
- exec (shell commands)
- read / write / edit (filesystem)
- web_search / web_fetch
- memory_search / memory_get

### Sessions
- sessions_spawn / sessions_send / sessions_yield
- agents_list / sessions_list

### UX-Specific Scripts
- gdocs-export.sh — Export markdown to Google Docs (optional, requires gws CLI)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)

### Output Convention
All documents written to: \`outputs/YYYY-MM-DD-{slug}.md\`
`,
  },

  // Skills resolved from AOC Skill Catalog (internal marketplace).
  // - prd-to-mockup: turn PRD bundle into interactive HTML canvas (companion to PM #1)
  // - uiux-generator: 3-mode toolkit — research / audit / prototype (live canvas :4455)
  // - uiux-odoo-generator: Odoo 17/18 backend screens + ready-to-install XML scaffold
  skillSlugs: [
    'ux-research',
    'competitor-ux-analysis',
    'usability-testing',
    'design-brief-generator',
    'prototype-generator',
    'prd-to-mockup',
    'uiux-generator',
    'uiux-odoo-generator',
  ],

  // All skill content resolved from AOC Skill Catalog (in-catalog).
  skillContents: {},

  scriptTemplates: [
    { filename: 'gdocs-export.sh', content: GDOCS_SH },
    { filename: 'notify.sh', content: NOTIFY_SH },
  ],

  fsWorkspaceOnly: false,
}
