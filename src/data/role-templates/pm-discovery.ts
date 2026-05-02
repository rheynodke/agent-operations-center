import type { AgentRoleTemplate } from '@/types'

export const PM_DISCOVERY_TEMPLATE: AgentRoleTemplate = {
  id: 'pm-discovery',
  adlcAgentNumber: 1,
  role: 'PM Discovery',
  emoji: '📊',
  color: '#8b5cf6',
  description: 'Riset fitur BARU — 6-step discovery dari abstract problem hingga PRD ber-Value Score yang mitigasi 4 product risks.',
  modelRecommendation: 'claude-opus-4-6',
  tags: ['pm', 'discovery', 'prd', 'research', 'adlc', '4-risks'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** PM Discovery
- **Emoji:** 📊
- **Role:** ADLC Agent #1 — PM Discovery (NEW feature research)
- **Vibe:** Analytical, data-driven, rigorous product thinker
- **Sub-role partner:** PA Monitor (#1B) — owns existing-feature observability

## My Mission — 6-step Discovery

Saya adalah PM Discovery Agent. Lingkup saya **fitur BARU** — bukan monitoring fitur existing (itu PA Monitor #1B).

Workflow 6-step:
1. **Abstract Problem** → frame problem dari raw stakeholder request
2. **Validated Hypothesis** → testable hypothesis dengan falsification criteria
3. **Real Problem Identification** → validate via user interview/data
4. **Multi-Solution Ideation** → generate ≥3 solusi dengan business model fit
5. **Stakeholder Validation** → track approval per stakeholder
6. **PRD Output** → wajib include Value Score + 4-risk mitigation

## 4 Product Risks Lens (wajib di setiap discovery)

| Risk | Saya tangani | Hand-off ke |
|---|---|---|
| **Value** | market-research, hypothesis, value-score | — |
| **Usability** | criteria definer | UX Designer (#2) |
| **Feasibility** | tech-constraint pre-collect | EM Architect (#3) |
| **Business Viability** | model fit checker | Biz Analyst (#7) |

## ADLC Pipeline Position

- **Input:** Biz Analyst (#7), stakeholder, atau re-discovery trigger dari PA Monitor (#1B)
- **Output:** UX (#2), EM (#3), QA (#5), Doc (#6) via task board handoff
- **Hard Gate:** PRD wajib lewat CPO approval + Value Score eksplisit
`,

    soul: `# Soul of PM & Product Analyst

_Rigorous product thinker yang tidak pernah skip data._

**Data-First.** Setiap keputusan produk harus didukung data — bukan asumsi.
**Hypothesis-Driven.** Formulasi hypothesis yang jelas sebelum riset.
**User-Centric.** Selalu kembali ke user problem, bukan solusi.
**Quality over Speed.** PRD yang buruk lebih mahal dari PRD yang lambat.

## Communication Style

- Gunakan Bahasa Indonesia untuk semua dokumen output
- Sertakan data kuantitatif di setiap rekomendasi
- Jangan pernah bilang "mungkin" tanpa supporting evidence
- Setiap PRD harus punya Value Score eksplisit
`,

    tools: `# Tools

## Available to PM & Product Analyst

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
- aoc-connect.sh — Query services via centralized connections (credentials never in stdout)
  - Website API: \`aoc-connect.sh "Datadog" api "/api/v1/query?..."\`
  - Website API: \`aoc-connect.sh "Mixpanel" api "/api/2.0/events?..."\`

### PM-Specific Scripts
- pii-scanner.py — Scan documents for PII before sharing
- gdocs-export.sh — Export markdown to Google Docs (optional, requires gws CLI)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)

### Output Convention
All documents written to: \`outputs/YYYY-MM-DD-{slug}.md\`
`,
  },

  // Skills resolved from AOC Skill Catalog (internal marketplace).
  // PA-side skills (pa-metrics-report, pa-adaptive-loop) live on the
  // PA Monitor #1B template — handoff via aoc-tasks `re-discovery` tag.
  // prd-to-mockup is paired with prd-generator: PRD .docx + companion HTML canvas.
  skillSlugs: [
    'market-research',
    'prd-generator',
    'prd-to-mockup',
    'hypothesis-generator',
    'value-score-calculator',
  ],

  // All skill content resolved from AOC Skill Catalog (in-catalog).
  skillContents: {},

  scriptTemplates: [
    {
      filename: 'pii-scanner.py',
      content: `#!/usr/bin/env python3
"""Scan documents for PII (Personally Identifiable Information) before sharing.

Usage: python3 pii-scanner.py <file_path>

Checks for: email addresses, phone numbers, NIK, credit card numbers, IP addresses.
"""
import re
import sys
import os

if len(sys.argv) < 2:
    print("Usage: python3 pii-scanner.py <file_path>")
    sys.exit(1)

filepath = sys.argv[1]
if not os.path.exists(filepath):
    print(f"ERROR: File not found: {filepath}")
    sys.exit(1)

with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

PII_PATTERNS = {
    'Email': r'[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
    'Phone (ID)': r'(?:\\+62|62|0)\\d{8,12}',
    'NIK': r'\\b\\d{16}\\b',
    'Credit Card': r'\\b(?:\\d{4}[\\s\\-]?){3}\\d{4}\\b',
    'IP Address': r'\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b',
    'NPWP': r'\\b\\d{2}\\.\\d{3}\\.\\d{3}\\.\\d{1}\\-\\d{3}\\.\\d{3}\\b',
}

found_any = False
for pii_type, pattern in PII_PATTERNS.items():
    matches = re.findall(pattern, content)
    if matches:
        found_any = True
        print(f"WARNING: {pii_type} found ({len(matches)} instance(s)):")
        for m in matches[:5]:
            print(f"  - {m}")
        if len(matches) > 5:
            print(f"  ... and {len(matches) - 5} more")

if found_any:
    print()
    print("ACTION REQUIRED: Remove or redact PII before sharing this document.")
    sys.exit(1)
else:
    print("PASS: No PII detected.")
    sys.exit(0)
`,
    },
    {
      filename: 'gdocs-export.sh',
      content: `#!/bin/bash
# Export a Markdown file to Google Docs via gws CLI.
# Usage: ./gdocs-export.sh <markdown_file> [doc_title]
#
# This is an OPTIONAL enhancement. The primary output is always the .md file.
# If gws CLI is not installed, the script gracefully exits with success.

set -euo pipefail

MD_FILE="\${1:-}"
DOC_TITLE="\${2:-}"

if [ -z "$MD_FILE" ]; then
  echo "Usage: ./gdocs-export.sh <markdown_file> [doc_title]"
  exit 1
fi

if [ ! -f "$MD_FILE" ]; then
  echo "ERROR: File not found: $MD_FILE"
  exit 1
fi

if ! command -v gws &> /dev/null; then
  echo "INFO: gws CLI not found. Skipping Google Docs export."
  echo "Output saved locally: $MD_FILE"
  echo "Install gws for Google Docs export: https://github.com/nicholasgasior/gws"
  exit 0
fi

if [ -z "$DOC_TITLE" ]; then
  DOC_TITLE=$(basename "$MD_FILE" .md | sed 's/-/ /g')
fi

echo "Exporting to Google Docs: $DOC_TITLE"
gws docs create --title "$DOC_TITLE" --content-file "$MD_FILE" --format markdown

echo "Done. Document created in Google Drive."
`,
    },
    {
      filename: 'notify.sh',
      content: `#!/bin/bash
# Send a notification via the agent's bound channel (WhatsApp, Telegram, or Discord).
# Usage: ./notify.sh <message> [--channel auto|whatsapp|telegram|discord]
#
# By default, auto-detects the agent's primary channel from AOC API.
# Requires OpenClaw gateway to be running.

set -euo pipefail

MESSAGE="\${1:-}"
CHANNEL="\${2:-auto}"

if [ -z "$MESSAGE" ]; then
  echo "Usage: ./notify.sh <message> [--channel auto|whatsapp|telegram|discord]"
  echo ""
  echo "Channels: auto (detect from agent binding), whatsapp, telegram, discord"
  exit 1
fi

AOC_URL="\${AOC_URL:-http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:-}"
AOC_AGENT_ID="\${AOC_AGENT_ID:-}"

if [ -z "$AOC_TOKEN" ]; then
  echo "WARNING: AOC_TOKEN not set. Cannot send notification."
  echo "Message: $MESSAGE"
  mkdir -p "\${HOME}/.openclaw/logs"
  echo "$(date -Iseconds) [no-token] $MESSAGE" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true
  exit 0
fi

# Auto-detect channel from agent's channel bindings
if [ "$CHANNEL" = "auto" ] && [ -n "$AOC_AGENT_ID" ]; then
  CHANNELS_JSON=$(curl -sf -H "Authorization: Bearer $AOC_TOKEN" \
    "$AOC_URL/api/agents/$AOC_AGENT_ID/channels" 2>/dev/null || echo "{}")

  # Priority: telegram > whatsapp > discord
  if echo "$CHANNELS_JSON" | grep -q '"telegram"'; then
    CHANNEL="telegram"
  elif echo "$CHANNELS_JSON" | grep -q '"whatsapp"'; then
    CHANNEL="whatsapp"
  elif echo "$CHANNELS_JSON" | grep -q '"discord"'; then
    CHANNEL="discord"
  else
    CHANNEL="log-only"
  fi
fi

echo "Sending notification via: $CHANNEL"
echo "Message: $MESSAGE"

# Log all notifications
mkdir -p "\${HOME}/.openclaw/logs"
echo "$(date -Iseconds) [$CHANNEL] $MESSAGE" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true

# Channel-specific delivery via gateway
case "$CHANNEL" in
  telegram|whatsapp|discord)
    curl -sf -X POST \
      -H "Authorization: Bearer $AOC_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"message\": \"$MESSAGE\", \"channel\": \"$CHANNEL\"}" \
      "$AOC_URL/api/agents/$AOC_AGENT_ID/notify" 2>/dev/null || \
      echo "WARNING: Gateway delivery failed. Message logged locally."
    ;;
  *)
    echo "No channel binding found. Notification logged locally only."
    ;;
esac

echo "Done."
`,
    },
  ],

  fsWorkspaceOnly: false,
}
