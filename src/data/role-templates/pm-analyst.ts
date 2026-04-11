import type { AgentRoleTemplate } from '@/types'

export const PM_ANALYST_TEMPLATE: AgentRoleTemplate = {
  id: 'pm-analyst',
  adlcAgentNumber: 1,
  role: 'PM & Product Analyst',
  emoji: '📊',
  color: '#8b5cf6',
  description: 'Mengelola lifecycle produk dari discovery hingga launch. Riset pasar, PRD generator, hypothesis validation, dan product analytics.',
  modelRecommendation: 'claude-opus-4-6',
  tags: ['pm', 'analyst', 'prd', 'research', 'adlc'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** PM & Product Analyst
- **Emoji:** 📊
- **Role:** ADLC Agent 1 — PM & Product Analyst
- **Vibe:** Analytical, data-driven, rigorous product thinker

## My Mission

Saya adalah PM Agent dalam pipeline ADLC. Tugas utama saya:
1. **Discovery** — Riset pasar, kompetitor, dan user sentiment
2. **Hypothesis Generation** — Formulasi hypothesis yang testable
3. **PRD Generation** — Buat Product Requirements Document yang comprehensive
4. **Value Scoring** — Evaluasi ROI dan prioritas fitur
5. **Product Analytics** — Monitor metrics dan adaptive loop

## My Position in ADLC Pipeline

- **Input dari:** Business Analyst (Agent 7) atau langsung dari stakeholder
- **Output ke:** UX Designer (Agent 2) dan EM/Architect (Agent 3)
- **Quality Gate:** PRD harus di-approve CPO sebelum dilanjutkan
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

### PM-Specific Scripts
- datadog-query.py — Query Datadog metrics
- mixpanel-report.py — Pull Mixpanel analytics reports
- pii-scanner.py — Scan documents for PII before sharing
- gdocs-export.sh — Export markdown to Google Docs (optional, requires gws CLI)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)

### Output Convention
All documents written to: \`outputs/YYYY-MM-DD-{slug}.md\`
`,
  },

  skillSlugs: [
    'market-research',
    'prd-generator',
    'pa-metrics-report',
    'pa-adaptive-loop',
    'hypothesis-generator',
    'value-score-calculator',
  ],

  skillContents: {
    'hypothesis-generator': `---
name: hypothesis-generator
description: "WAJIB DIGUNAKAN: Ketika diminta membuat hypothesis baru, validasi ide, atau memulai product discovery."
---

# Hypothesis Generator

Skill untuk memformulasi product hypothesis yang testable, measurable, dan time-bound sebelum riset atau PRD dimulai.

<HARD-GATE>
Jangan pernah mulai riset tanpa hypothesis yang terformulasi.
Jangan accept hypothesis tanpa metric yang jelas.
Setiap hypothesis HARUS punya falsification criteria.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Problem Framing** — Identifikasi abstract problem dari input stakeholder/BA
2. **Hypothesis Formulation** — Tulis hypothesis dalam format: "Kami percaya [X] akan [Y] karena [Z]"
3. **Metric Definition** — Tentukan success metric (MUST be quantifiable)
4. **Falsification Criteria** — Tentukan kapan hypothesis dianggap gagal
5. **[HUMAN GATE — CPO]** — Kirim hypothesis summary via notify.sh, tunggu approval
6. **Output Document** — Tulis ke outputs/YYYY-MM-DD-hypothesis-{topic}.md

## Process Flow

\`\`\`dot
digraph hypothesis_generator {
  rankdir=TB
  node [shape=box, style=rounded]

  input [label="Stakeholder Input"]
  frame [label="Problem Framing"]
  formulate [label="Hypothesis Formulation"]
  metrics [label="Metric Definition"]
  falsify [label="Falsification Criteria"]
  gate [label="HUMAN GATE\\nCPO Approval", shape=diamond, style="filled", fillcolor="#f59e0b"]
  approved [label="Approved\\nProceed to Research"]
  rejected [label="Rejected\\nRevise Hypothesis"]
  output [label="Write Output Doc"]

  input -> frame -> formulate -> metrics -> falsify -> gate
  gate -> approved [label="Yes"]
  gate -> rejected [label="No"]
  rejected -> frame
  approved -> output
}
\`\`\`

## Instruksi Detail

### Step 1 — Problem Framing
Baca input dari stakeholder atau Business Analyst. Identifikasi:
- Siapa yang mengalami masalah?
- Apa masalahnya secara spesifik?
- Seberapa besar dampaknya (revenue, users, retention)?

### Step 2 — Hypothesis Formulation
Format WAJIB:
> "Kami percaya bahwa [aksi/fitur] akan menghasilkan [outcome terukur] untuk [target user]. Kami akan tahu ini berhasil ketika [metric] mencapai [threshold] dalam [timeframe]."

### [HUMAN GATE] — CPO
- Kirim summary hypothesis via: \`./scripts/notify.sh "Hypothesis baru: [judul] - butuh approval"\` (auto-detects agent's channel: WhatsApp/Telegram/Discord)
- Tunggu response "approved" atau "revise: [feedback]"
- Jika tidak ada response dalam 24 jam, kirim reminder

## Inter-Agent Handoff

**Input dari:** Business Analyst (Agent 7) — viability report, market data
**Output ke:** Market Research skill (self) — validated hypothesis untuk riset

## Anti-Pattern

- Jangan buat hypothesis yang tidak bisa dibuktikan salah (unfalsifiable)
- Jangan skip metric definition — "meningkatkan UX" bukan metric
- Jangan langsung mulai riset tanpa hypothesis tervalidasi
`,

    'value-score-calculator': `---
name: value-score-calculator
description: "WAJIB DIGUNAKAN: Ketika diminta menghitung Value Score, prioritasi fitur, atau evaluasi ROI sebuah initiative."
---

# Value Score Calculator

Menghitung Value Score composite untuk setiap fitur/initiative berdasarkan framework RICE yang di-enhance dengan ADLC-specific factors.

<HARD-GATE>
Jangan lock PRD tanpa Value Score eksplisit.
Value Score < 40 = REJECT, jangan proceed ke UX.
Semua komponen score harus ada justifikasi data — bukan gut feeling.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Gather Data** — Kumpulkan data reach, impact, confidence, effort dari riset
2. **Calculate RICE** — Hitung base RICE score
3. **Apply ADLC Multipliers** — Strategic alignment, technical debt reduction, user sentiment
4. **Compute Final Score** — Weighted composite score (0-100)
5. **Generate Recommendation** — PROCEED / DEFER / REJECT
6. **[HUMAN GATE — CPO]** — Kirim Value Score report via notify.sh
7. **Output Document** — Tulis ke outputs/YYYY-MM-DD-value-score-{feature}.md

## Process Flow

\`\`\`dot
digraph value_score {
  rankdir=TB
  node [shape=box, style=rounded]

  data [label="Gather Data"]
  rice [label="Calculate RICE"]
  multipliers [label="ADLC Multipliers"]
  score [label="Compute Final Score"]
  branch [shape=diamond, label="Score >= 40?"]
  proceed [label="PROCEED\\nForward to UX"]
  reject [label="REJECT\\nArchive"]
  gate [label="HUMAN GATE\\nCPO Review", shape=diamond, style="filled", fillcolor="#f59e0b"]

  data -> rice -> multipliers -> score -> branch
  branch -> gate [label="Yes"]
  branch -> reject [label="No"]
  gate -> proceed [label="Approved"]
  gate -> reject [label="Rejected"]
}
\`\`\`

## Instruksi Detail

### RICE Calculation
- **Reach:** Berapa user yang terdampak per quarter?
- **Impact:** Skala 1-5 (1=minimal, 5=massive)
- **Confidence:** Persentase confidence level (data vs asumsi)
- **Effort:** Person-weeks estimasi

Formula: \`RICE = (Reach * Impact * Confidence) / Effort\`

### ADLC Multipliers
- **Strategic Alignment** (0.8-1.2): Seberapa align dengan company OKR?
- **Tech Debt Reduction** (0.9-1.1): Apakah ini mengurangi tech debt?
- **User Sentiment** (0.8-1.2): Berdasar NPS/CSAT feedback

Formula: \`Final = RICE * Strategic * TechDebt * Sentiment\` (normalized to 0-100)

## Inter-Agent Handoff

**Input dari:** Market Research skill, hypothesis-generator
**Output ke:** UX Designer (Agent 2) — feature spec dengan Value Score

## Anti-Pattern

- Jangan override score threshold tanpa CPO approval
- Jangan pakai "high confidence" tanpa data backing
- Jangan skip ADLC multipliers — raw RICE alone tidak cukup
`,
  },

  scriptTemplates: [
    {
      filename: 'datadog-query.py',
      content: `#!/usr/bin/env python3
"""Query Datadog metrics for product analytics.

Usage: python3 datadog-query.py <metric_name> [--period 7d]

Requires: DD_API_KEY and DD_APP_KEY environment variables.
"""
import os
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

DD_API_KEY = os.environ.get('DD_API_KEY', '')
DD_APP_KEY = os.environ.get('DD_APP_KEY', '')

if not DD_API_KEY or not DD_APP_KEY:
    print("ERROR: DD_API_KEY and DD_APP_KEY environment variables required.")
    print("Setup: export DD_API_KEY=your_api_key DD_APP_KEY=your_app_key")
    sys.exit(1)

metric = sys.argv[1] if len(sys.argv) > 1 else 'system.cpu.user'
period = sys.argv[2] if len(sys.argv) > 2 else '7d'

days = int(period.replace('d', '')) if period.endswith('d') else 7
end = int(datetime.now().timestamp())
start = int((datetime.now() - timedelta(days=days)).timestamp())

url = f"https://api.datadoghq.com/api/v1/query?from={start}&to={end}&query={urllib.parse.quote(metric)}"
req = urllib.request.Request(url, headers={
    'DD-API-KEY': DD_API_KEY,
    'DD-APPLICATION-KEY': DD_APP_KEY,
})

try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
        series = data.get('series', [])
        if series:
            points = series[0].get('pointlist', [])
            print(f"Metric: {metric}")
            print(f"Period: last {days} days")
            print(f"Points: {len(points)}")
            if points:
                values = [p[1] for p in points if p[1] is not None]
                print(f"Avg: {sum(values)/len(values):.2f}")
                print(f"Min: {min(values):.2f}")
                print(f"Max: {max(values):.2f}")
        else:
            print(f"No data found for metric: {metric}")
except Exception as e:
    print(f"Error querying Datadog: {e}")
    sys.exit(1)
`,
    },
    {
      filename: 'mixpanel-report.py',
      content: `#!/usr/bin/env python3
"""Pull Mixpanel analytics reports.

Usage: python3 mixpanel-report.py <event_name> [--days 30]

Requires: MIXPANEL_TOKEN environment variable.
"""
import os
import sys
from datetime import datetime, timedelta

TOKEN = os.environ.get('MIXPANEL_TOKEN', '')

if not TOKEN:
    print("ERROR: MIXPANEL_TOKEN environment variable required.")
    print("Setup: export MIXPANEL_TOKEN=your_project_token")
    sys.exit(1)

event = sys.argv[1] if len(sys.argv) > 1 else ''
days = 30
for i, arg in enumerate(sys.argv):
    if arg == '--days' and i + 1 < len(sys.argv):
        days = int(sys.argv[i + 1])

if not event:
    print("Usage: python3 mixpanel-report.py <event_name> [--days 30]")
    sys.exit(1)

from_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
to_date = datetime.now().strftime('%Y-%m-%d')

print(f"Mixpanel Report: {event}")
print(f"Period: {from_date} to {to_date}")
print(f"Token: {TOKEN[:8]}...")
print()
print("NOTE: Full Mixpanel API integration requires project-specific setup.")
print("Configure your Mixpanel project settings and API credentials.")
`,
    },
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
