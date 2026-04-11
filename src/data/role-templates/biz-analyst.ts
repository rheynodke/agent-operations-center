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

  skillContents: {
    'biz-viability-report': `---
name: biz-viability-report
description: "WAJIB DIGUNAKAN: Ketika diminta mengevaluasi business viability, membuat business case, atau menilai apakah sebuah initiative worth pursuing."
---

# Business Viability Report

Comprehensive business viability assessment untuk menentukan apakah sebuah initiative layak dibangun dari perspektif bisnis.

<HARD-GATE>
Jangan recommend "BUILD" tanpa positive unit economics.
Setiap angka harus punya source citation.
Report HARUS include sensitivity analysis untuk key assumptions.
Viability report WAJIB dikonfirmasi CPO/stakeholder sebelum PM membuat PRD.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Problem Definition** — Definisikan problem yang mau di-solve secara bisnis
2. **Market Sizing** — Lakukan TAM/SAM/SOM estimation
3. **Unit Economics** — Hitung CAC, LTV, payback period
4. **Competitive Analysis** — Map competitive landscape
5. **Revenue Model** — Identifikasi monetization strategy
6. **Risk Assessment** — Identifikasi key business risks
7. **Sensitivity Analysis** — Best case / base case / worst case
8. **[HUMAN GATE — CPO]** — Send report via notify.sh, tunggu approval
9. **Output Document** — Write to outputs/YYYY-MM-DD-biz-viability-{initiative}.md

## Process Flow

\`\`\`dot
digraph biz_viability {
  rankdir=TB
  node [shape=box, style=rounded]
  problem [label="Problem Definition"]
  market [label="Market Sizing"]
  economics [label="Unit Economics"]
  competitive [label="Competitive Analysis"]
  revenue [label="Revenue Model"]
  risks [label="Risk Assessment"]
  sensitivity [label="Sensitivity Analysis"]
  gate [label="HUMAN GATE\\nCPO Approval", shape=diamond, style="filled", fillcolor="#f59e0b"]
  approved [label="BUILD\\nForward to PM"]
  rejected [label="REJECT\\nArchive"]
  output [label="Write Output Report"]

  problem -> market -> economics -> competitive -> revenue -> risks -> sensitivity -> gate
  gate -> approved [label="Viable"]
  gate -> rejected [label="Not Viable"]
  approved -> output
}
\`\`\`

## Inter-Agent Handoff

**Input dari:** CPO/Stakeholder — business question atau initiative idea
**Output ke:** PM Agent (Agent 1) — viability assessment untuk hypothesis validation

## Anti-Pattern

- Jangan cherry-pick data yang mendukung conclusion
- Jangan skip sensitivity analysis — assumptions always have uncertainty
- Jangan present revenue projections tanpa churn/CAC considerations
`,

    'pricing-strategy-analyzer': `---
name: pricing-strategy-analyzer
description: "WAJIB DIGUNAKAN: Ketika diminta menganalisa pricing, membuat pricing model, atau evaluate pricing strategy untuk produk/fitur baru."
---

# Pricing Strategy Analyzer

Analisa dan rekomendasikan pricing model yang optimal berdasarkan competitive benchmarking dan value-based pricing.

<HARD-GATE>
Jangan recommend pricing tanpa competitive benchmark.
Pricing harus tested dengan value-based pricing methodology.
Setiap model harus include churn impact analysis.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Value Proposition Clarity** — Apa nilai yang di-deliver ke user?
2. **Competitive Benchmarking** — Berapa kompetitor charge? Model apa yang mereka pakai?
3. **Pricing Model Selection** — Freemium / Subscription / Usage-based / Per-seat?
4. **Price Point Analysis** — Anchoring, decoy pricing, tier structure
5. **Elasticity Estimation** — Berapa churn jika harga naik X%?
6. **Revenue Projection** — Proyeksi revenue per pricing model
7. **[HUMAN GATE — CPO/Finance]** — Review via notify.sh
8. **Output Document** — Write to outputs/YYYY-MM-DD-pricing-strategy-{product}.md

## Inter-Agent Handoff

**Input dari:** Biz Viability Report — market sizing, competitive analysis
**Output ke:** PM Agent (Agent 1) — pricing recommendation for PRD

## Anti-Pattern

- Jangan set pricing berdasarkan cost + margin saja — consider value
- Jangan ignore competitor pricing — market sets expectations
- Jangan pick tier count without user research
`,

    'unit-economics-calculator': `---
name: unit-economics-calculator
description: "WAJIB DIGUNAKAN: Ketika diminta menghitung unit economics, CAC/LTV ratio, payback period, atau evaluate profitability per customer."
---

# Unit Economics Calculator

Hitung dan analyze unit economics untuk memastikan business model fundamentally sound.

<HARD-GATE>
LTV/CAC ratio HARUS >= 3 untuk healthy business.
Payback period HARUS < 18 months untuk SaaS.
Jangan present projections tanpa churn assumptions.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **CAC Calculation** — Hitung Customer Acquisition Cost (all channels)
2. **ARPU/ARPA** — Average Revenue Per User/Account
3. **Churn Rate** — Monthly/Annual churn estimation
4. **LTV Calculation** — Lifetime Value = ARPU / Churn Rate
5. **LTV/CAC Ratio** — Must be >= 3
6. **Payback Period** — CAC / Monthly Gross Margin
7. **Margin Analysis** — Gross margin, contribution margin
8. **Output Document** — Write to outputs/YYYY-MM-DD-unit-economics-{product}.md

## Inter-Agent Handoff

**Input dari:** Pricing Strategy, market research data
**Output ke:** Biz Viability Report — unit economics component

## Anti-Pattern

- Jangan use "blended" CAC — break down by channel
- Jangan assume 0% churn
- Jangan confuse revenue with gross profit
`,

    'tam-sam-som-estimator': `---
name: tam-sam-som-estimator
description: "WAJIB DIGUNAKAN: Ketika diminta market sizing, mengestimasi TAM/SAM/SOM, atau membuat market opportunity assessment."
---

# TAM/SAM/SOM Estimator

Estimate Total Addressable Market, Serviceable Addressable Market, dan Serviceable Obtainable Market.

<HARD-GATE>
Gunakan top-down DAN bottom-up approach — cross-validate.
Setiap angka HARUS ada source (research report, public data, analogous company).
SOM HARUS realistis — jangan claim 30% market share di tahun 1.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Define Market** — Definisikan market secara jelas (geography, customer segment)
2. **Top-Down Estimation** — Start dari total industry, narrow down
3. **Bottom-Up Estimation** — Start dari addressable customers × ARPU
4. **Cross-Validation** — Reconcile top-down vs bottom-up
5. **Growth Rate** — Market CAGR estimation
6. **Output Document** — Write to outputs/YYYY-MM-DD-tam-sam-som-{market}.md

## Inter-Agent Handoff

**Input dari:** Market research, industry reports, analogous company data
**Output ke:** Biz Viability Report — market sizing component

## Anti-Pattern

- Jangan use only top-down — bottom-up grounding is critical
- Jangan confuse TAM dengan SOM — be realistic about penetration
- Jangan project without CAGR data
`,

    'competitive-moat-assessor': `---
name: competitive-moat-assessor
description: "WAJIB DIGUNAKAN: Ketika diminta assess competitive advantage, evaluate defensibility, atau analisa competitive moat sebuah produk."
---

# Competitive Moat Assessor

Assess defensibility dan sustainable competitive advantage dari produk/fitur yang dibangun.

<HARD-GATE>
Setiap moat claim HARUS punya evidence.
Jangan recommend BUILD untuk produk yang mudah di-clone tanpa differentiator.
Competitive moat assessment harus include "attack scenario" dari setiap major competitor.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Competitor Mapping** — Identify semua competitors (direct + indirect)
2. **Moat Types** — Evaluate: Network effects, Switching costs, Cost advantages, Intangibles
3. **Moat Strength Rating** — Rate setiap moat: Strong / Moderate / Weak / None
4. **Attack Scenarios** — "How would [top competitor] attack us?"
5. **Defensibility Score** — Composite score (0-10)
6. **Recommendations** — How to strengthen moat
7. **Output Document** — Write to outputs/YYYY-MM-DD-competitive-moat-{product}.md

## Inter-Agent Handoff

**Input dari:** Market research, competitive benchmarking
**Output ke:** Biz Viability Report — competitive moat section

## Anti-Pattern

- Jangan claim "first mover advantage" as a moat — it's not
- Jangan ignore indirect competitors
- Jangan rate moat strength without evidence
`,
  },

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
