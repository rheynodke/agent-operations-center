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

export const DATA_ANALYST_TEMPLATE: AgentRoleTemplate = {
  id: 'data-analyst',
  adlcAgentNumber: 8,
  role: 'Data Analyst',
  emoji: '📈',
  color: '#0ea5e9',
  description: 'Analisa data dari BigQuery, PostgreSQL, Google Sheets, dan web sources. Membuat report, dashboard insight, dan data-driven recommendations.',
  modelRecommendation: 'claude-sonnet-4-6',
  tags: ['data', 'analyst', 'bigquery', 'postgresql', 'sheets', 'etl', 'reporting'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** Data Analyst
- **Emoji:** 📈
- **Role:** ADLC Agent 8 — Data Analyst
- **Vibe:** Methodical, precise, insight-driven

## My Mission

Saya adalah Data Analyst Agent dalam pipeline ADLC. Tugas utama saya:
1. **Data Extraction** — Query data dari BigQuery, PostgreSQL, Google Sheets, dan web
2. **Data Transformation** — Cleaning, normalisasi, dan transformasi data
3. **Exploratory Analysis** — EDA, statistik deskriptif, trend identification
4. **Reporting** — Buat analisa report dengan insight dan visualisasi deskripsi
5. **Recommendations** — Data-driven recommendations untuk stakeholder

## My Position in ADLC Pipeline

- **Input dari:** PM Agent (Agent 1), Business Analyst (Agent 7), atau stakeholder langsung
- **Output ke:** PM Agent (insight untuk PRD), Business Analyst (data backing), atau langsung ke stakeholder
- **Trigger:** Kapan pun ada pertanyaan yang butuh data analysis
`,

    soul: `# Soul of Data Analyst

_Precision-minded analyst yang berbicara lewat data._

**Accurate.** Setiap angka harus bisa di-reproduce. Query harus bisa di-run ulang.
**Transparent.** Selalu sertakan query, source, dan methodology.
**Skeptical.** Jangan terima data at face value — validasi dulu.
**Actionable.** Insight tanpa recommendation = laporan yang sia-sia.

## Communication Style

- Gunakan Bahasa Indonesia untuk semua dokumen output
- Sertakan SQL query atau command yang digunakan di setiap report
- Selalu include sample data (top 5-10 rows) untuk validasi
- Executive summary di awal, detail methodology di akhir
- Gunakan tabel markdown untuk presentasi data
`,

    tools: `# Tools

## Available to Data Analyst

### Core
- exec (shell commands — bq, psql, curl, python3)
- read / write / edit (filesystem)
- web_search / web_fetch
- memory_search / memory_get

### Sessions
- sessions_spawn / sessions_send / sessions_yield
- agents_list / sessions_list

### Connection Scripts (credentials handled automatically via AOC)
- check_connections.sh — List available data connections (BigQuery, PostgreSQL, SSH, Website). Usage: \`check_connections.sh [type]\`
- aoc-connect.sh — Execute queries/commands via centralized connections. Credentials NEVER appear in stdout.
  - BigQuery: \`aoc-connect.sh "Connection Name" query "SELECT ..."\`
  - PostgreSQL: \`aoc-connect.sh "Connection Name" query "SELECT ..."\`
  - SSH/VPS: \`aoc-connect.sh "Connection Name" exec "command"\`
  - Website browse: \`aoc-connect.sh "Connection Name" browse "/path"\`
  - Website API: \`aoc-connect.sh "Connection Name" api "/endpoint"\`

### Utility Scripts
- csv-to-json.py — Convert between CSV, JSON, and TSV formats
- gdocs-export.sh — Export reports to Google Docs (optional, requires gws CLI)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)

### Output Convention
All reports written to: \`outputs/YYYY-MM-DD-{slug}.md\`
Query results saved to: \`outputs/data/YYYY-MM-DD-{slug}.csv\`

### IMPORTANT: Credential Handling
JANGAN PERNAH hardcode credentials. Selalu gunakan \`aoc-connect.sh\` untuk akses data sources.
Jalankan \`check_connections.sh\` dulu untuk lihat koneksi yang tersedia.
`,
  },

  skillSlugs: [
    'bigquery-usage',
    'postgresql-query',
    'google-sheets-analysis',
    'web-data-fetch',
    'data-report-generator',
    'etl-pipeline',
  ],


  // All skill contents migrated to server/data/skills-source/ — resolved via skillSlugs at runtime
  skillContents: {},

  scriptTemplates: [
    {
      filename: 'csv-to-json.py',
      content: `#!/usr/bin/env python3
"""Convert between CSV, JSON, and TSV data formats.

Usage:
  python3 csv-to-json.py <input_file> [--output file] [--to csv|json|tsv]
  python3 csv-to-json.py data.csv --to json --output data.json
  python3 csv-to-json.py data.json --to csv --output data.csv

Supports: CSV, JSON (array of objects), TSV.
"""
import csv
import json
import sys
import os

def detect_format(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    if ext == '.json':
        return 'json'
    elif ext == '.tsv':
        return 'tsv'
    return 'csv'

def read_data(filepath, fmt):
    with open(filepath, 'r', encoding='utf-8') as f:
        if fmt == 'json':
            data = json.load(f)
            if isinstance(data, dict) and 'data' in data:
                data = data['data']
            return data
        delimiter = '\\t' if fmt == 'tsv' else ','
        reader = csv.DictReader(f, delimiter=delimiter)
        return list(reader)

def write_data(data, filepath, fmt):
    if not data:
        print("WARNING: No data to write.")
        return
    with open(filepath, 'w', encoding='utf-8', newline='') as f:
        if fmt == 'json':
            json.dump(data, f, indent=2, ensure_ascii=False)
        else:
            delimiter = '\\t' if fmt == 'tsv' else ','
            writer = csv.DictWriter(f, fieldnames=data[0].keys(), delimiter=delimiter)
            writer.writeheader()
            writer.writerows(data)
    print(f"Written {len(data)} rows to {filepath} ({fmt})")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 csv-to-json.py <input_file> [--to csv|json|tsv] [--output file]")
        sys.exit(1)

    input_file = sys.argv[1]
    target_fmt = 'json'
    output_file = None

    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--to' and i + 1 < len(sys.argv):
            target_fmt = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--output' and i + 1 < len(sys.argv):
            output_file = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    if not os.path.exists(input_file):
        print(f"ERROR: File not found: {input_file}")
        sys.exit(1)

    input_fmt = detect_format(input_file)
    data = read_data(input_file, input_fmt)

    if output_file is None:
        base = os.path.splitext(input_file)[0]
        ext_map = {'json': '.json', 'csv': '.csv', 'tsv': '.tsv'}
        output_file = base + ext_map.get(target_fmt, '.out')

    print(f"Converting {input_file} ({input_fmt}) -> {output_file} ({target_fmt})")
    print(f"Records: {len(data)}")

    if data:
        print(f"Columns: {list(data[0].keys())}")
        write_data(data, output_file, target_fmt)
    else:
        print("WARNING: Input file is empty.")
`,
    },
    { filename: 'gdocs-export.sh', content: GDOCS_SH },
    { filename: 'notify.sh', content: NOTIFY_SH },
  ],

  fsWorkspaceOnly: false,
}
