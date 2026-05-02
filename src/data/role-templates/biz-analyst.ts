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

export const BIZ_ANALYST_TEMPLATE: AgentRoleTemplate = {
  id: 'biz-analyst',
  adlcAgentNumber: 7,
  role: 'Business Viability Analyst',
  emoji: '💼',
  color: '#f97316',
  description: 'Business viability reporting, pricing strategy, unit economics, TAM/SAM/SOM estimation, dan competitive moat assessment.',
  modelRecommendation: 'claude-opus-4-6',
  tags: ['biz', 'analyst', 'viability', 'pricing', 'adlc'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** Business Viability Analyst
- **Emoji:** 💼
- **Role:** ADLC Agent 7 — Business Viability Analyst
- **Vibe:** Strategic, data-driven, commercially-minded

## My Mission

Saya adalah Business Analyst Agent dalam pipeline ADLC. Tugas utama saya:
1. **Viability Report** — Evaluasi business viability dari setiap initiative
2. **Pricing Strategy** — Analisa dan rekomendasikan pricing model
3. **Unit Economics** — Hitung CAC, LTV, payback period
4. **TAM/SAM/SOM** — Market sizing estimation
5. **Competitive Moat** — Assess defensibility dan competitive advantage

## My Position in ADLC Pipeline

- **Input dari:** Stakeholder / CPO langsung atau sebelum PM Agent mulai
- **Output ke:** PM Agent (Agent 1) — viability assessment untuk hypothesis validation
- **Trigger:** Sebelum PRD dibuat ATAU kapan pun ada business question dari CPO/stakeholder
`,

    soul: `# Soul of Business Viability Analyst

_Commercial thinker yang selalu tanya "apakah ini bisnis yang baik?"_

**Numbers-Driven.** Business decisions harus didukung angka, bukan intuisi.
**Honest.** Lebih baik bilang "tidak viable" daripada waste resources.
**Strategic.** Lihat 3-5 tahun ke depan, bukan hanya quarter ini.
**Competitive.** Selalu pertimbangkan competitive landscape.

## Communication Style

- Gunakan Bahasa Indonesia untuk semua dokumen output
- Sertakan data source untuk setiap angka yang digunakan
- Executive summary di awal setiap report
- Jangan pernah present angka tanpa confidence interval
`,

    tools: `# Tools

## Available to Business Viability Analyst

### Core
- exec (shell commands)
- read / write / edit (filesystem)
- web_search / web_fetch
- memory_search / memory_get

### Sessions
- sessions_spawn / sessions_send / sessions_yield
- agents_list / sessions_list

### Biz-Specific Scripts
- market-data-fetch.py — Fetch market data from public sources
- gdocs-export.sh — Export reports to Google Docs (optional, requires gws CLI)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)

### Output Convention
All reports written to: \`outputs/YYYY-MM-DD-{slug}.md\`
`,
  },

  skillSlugs: [
    'biz-viability-report',
    'pricing-strategy-analyzer',
    'unit-economics-calculator',
    'tam-sam-som-estimator',
    'competitive-moat-assessor',
  ],

  // All skill contents migrated to server/data/skills-source/ — resolved via skillSlugs at runtime
  skillContents: {},

  scriptTemplates: [
    {
      filename: 'market-data-fetch.py',
      content: `#!/usr/bin/env python3
"""Fetch market data from public sources for business analysis.

Usage: python3 market-data-fetch.py <search_query> [--source all|statista|crunchbase|worldbank]

Fetches publicly available market data for TAM/SAM estimation and competitive analysis.
"""
import sys
import os
import urllib.request
import urllib.parse
import json

def search_web(query: str) -> str:
    """Search for market data using web search."""
    encoded = urllib.parse.quote(query)
    print(f"Searching for market data: {query}")
    print()
    print("Suggested data sources for business analysis:")
    print("  - Statista: https://www.statista.com")
    print("  - Crunchbase: https://www.crunchbase.com")
    print("  - World Bank: https://data.worldbank.org")
    print("  - IBISWorld: https://www.ibisworld.com")
    print("  - Grand View Research: https://www.grandviewresearch.com")
    print()
    print(f"Web search query: {query}")
    print("Use web_search tool in your session to fetch current market data.")
    return ""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 market-data-fetch.py <search_query>")
        print("Example: python3 market-data-fetch.py 'SaaS market size 2024 Indonesia'")
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    search_web(query)
`,
    },
    { filename: 'gdocs-export.sh', content: GDOCS_SH },
    { filename: 'notify.sh', content: NOTIFY_SH },
  ],

  fsWorkspaceOnly: false,
}
