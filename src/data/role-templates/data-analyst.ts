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

  skillContents: {
    'bigquery-usage': `---
name: bigquery-usage
description: "WAJIB DIGUNAKAN: Ketika diminta query BigQuery, analisa data warehouse, atau extract data dari Google BigQuery."
---

# BigQuery Usage

Skill untuk query dan analisa data dari Google BigQuery via \`aoc-connect.sh\` (credentials otomatis dari AOC).

<HARD-GATE>
SELALU gunakan aoc-connect.sh untuk query — JANGAN hardcode credentials.
Selalu gunakan LIMIT pada exploratory query.
Jangan SELECT * pada tabel besar — pilih kolom yang dibutuhkan saja.
Simpan setiap query yang dijalankan di report untuk reproducibility.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Discover Connections** — Jalankan \`check_connections.sh bigquery\` untuk list koneksi BQ yang tersedia
2. **Explore Schema** — Query INFORMATION_SCHEMA via aoc-connect.sh
3. **Exploratory Query** — Query dengan LIMIT kecil dulu untuk validasi
4. **Execute Full Query** — Jalankan full analysis query, save output
5. **Validate Results** — Cek row count, null values, dan data range
6. **Save Output** — Simpan raw result ke outputs/data/ dan summary ke report
7. **[HUMAN GATE — optional]** — Kirim summary via notify.sh jika diminta stakeholder
8. **Output Document** — Write report ke outputs/YYYY-MM-DD-bq-analysis-{topic}.md

## Common Patterns

### Discover available BigQuery connections
\`\`\`bash
check_connections.sh bigquery
\`\`\`

### Query via aoc-connect.sh (credentials handled automatically)
\`\`\`bash
# Simple query
aoc-connect.sh "Connection Name" query "SELECT COUNT(*) FROM \\\`dataset.table\\\`"

# Exploratory — always use LIMIT
aoc-connect.sh "Connection Name" query "SELECT * FROM \\\`dataset.table\\\` LIMIT 10"

# Analysis query with save
aoc-connect.sh "Connection Name" query "SELECT col1, col2, COUNT(*) as cnt FROM \\\`dataset.table\\\` GROUP BY 1,2 ORDER BY cnt DESC LIMIT 1000" > outputs/data/result.csv
\`\`\`

### Schema exploration
\`\`\`bash
# List tables in a dataset
aoc-connect.sh "Connection Name" query "SELECT table_name, row_count FROM \\\`dataset.INFORMATION_SCHEMA.TABLE_STORAGE\\\` ORDER BY row_count DESC"

# Describe table columns
aoc-connect.sh "Connection Name" query "SELECT column_name, data_type, is_nullable FROM \\\`dataset.INFORMATION_SCHEMA.COLUMNS\\\` WHERE table_name = 'table_name'"
\`\`\`

## Inter-Agent Handoff

**Input dari:** PM Agent, Business Analyst, atau stakeholder — data question
**Output ke:** Data Report Generator skill — raw data untuk reporting

## Anti-Pattern

- Jangan SELECT * — selalu pilih kolom spesifik
- JANGAN hardcode credentials atau service account JSON — gunakan aoc-connect.sh
- Jangan query tanpa WHERE clause pada partitioned tables
- Jangan skip check_connections.sh — pastikan koneksi tersedia dulu
`,

    'postgresql-query': `---
name: postgresql-query
description: "WAJIB DIGUNAKAN: Ketika diminta query PostgreSQL, analisa database, atau extract data dari Postgres."
---

# PostgreSQL Query

Skill untuk query dan analisa data dari PostgreSQL via \`aoc-connect.sh\` (credentials otomatis dari AOC).

<HARD-GATE>
SELALU gunakan aoc-connect.sh untuk query — JANGAN hardcode credentials.
Jangan jalankan UPDATE/DELETE tanpa WHERE clause.
Selalu gunakan LIMIT pada exploratory query.
Credentials JANGAN PERNAH muncul di output atau report.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Discover Connections** — Jalankan \`check_connections.sh postgres\` untuk list koneksi PG yang tersedia
2. **Explore Schema** — List tables dan columns via aoc-connect.sh
3. **Sample Data** — Preview: query dengan LIMIT 10
4. **Execute Query** — Jalankan analysis query, save output
5. **Validate Results** — Cek row count, NULL ratio, dan anomali
6. **Save Output** — Simpan ke outputs/data/ sebagai CSV
7. **Output Document** — Write report ke outputs/YYYY-MM-DD-pg-analysis-{topic}.md

## Common Patterns

### Discover available PostgreSQL connections
\`\`\`bash
check_connections.sh postgres
\`\`\`

### Query via aoc-connect.sh (credentials handled automatically)
\`\`\`bash
# Simple query
aoc-connect.sh "Connection Name" query "SELECT COUNT(*) FROM users"

# Exploratory — always use LIMIT
aoc-connect.sh "Connection Name" query "SELECT * FROM orders LIMIT 10"

# Analysis query with save
aoc-connect.sh "Connection Name" query "SELECT status, COUNT(*) FROM orders GROUP BY status" > outputs/data/result.csv
\`\`\`

### Schema exploration
\`\`\`bash
# List all tables with row counts
aoc-connect.sh "Connection Name" query "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC"

# Table sizes
aoc-connect.sh "Connection Name" query "SELECT tablename, pg_size_pretty(pg_total_relation_size(tablename::regclass)) FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(tablename::regclass) DESC"

# Describe columns
aoc-connect.sh "Connection Name" query "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'table_name'"
\`\`\`

### Aggregate & statistics
\`\`\`bash
aoc-connect.sh "Connection Name" query "SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as unique_users, MIN(created_at) as earliest, MAX(created_at) as latest FROM orders WHERE created_at >= NOW() - INTERVAL '30 days'"
\`\`\`

## Inter-Agent Handoff

**Input dari:** PM Agent, Business Analyst, atau stakeholder — data question
**Output ke:** Data Report Generator skill — raw data untuk reporting

## Anti-Pattern

- JANGAN store password/credentials di script atau output — gunakan aoc-connect.sh
- Jangan query tanpa LIMIT pada tabel yang belum diketahui ukurannya
- Jangan gunakan SELECT * untuk production queries
- Jangan skip check_connections.sh — pastikan koneksi tersedia dulu
`,

    'google-sheets-analysis': `---
name: google-sheets-analysis
description: "WAJIB DIGUNAKAN: Ketika diminta membaca, menganalisa, atau memproses data dari Google Sheets."
---

# Google Sheets Analysis

Skill untuk extract dan analisa data dari Google Sheets menggunakan API atau CSV export.

<HARD-GATE>
Jangan modifikasi source spreadsheet tanpa explicit permission.
Selalu download/export sebagai CSV untuk analisa lokal.
Validasi header dan data types sebelum analisa.
Catat spreadsheet ID dan sheet name di report untuk traceability.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Identify Source** — Catat spreadsheet ID dan sheet/tab name
2. **Export Data** — Download sebagai CSV via export URL atau gws CLI
3. **Inspect Structure** — Cek headers, data types, row count, missing values
4. **Clean Data** — Handle missing values, duplicates, formatting inconsistencies
5. **Analyze** — Jalankan analisa sesuai permintaan (aggregation, trend, comparison)
6. **Save Output** — Simpan cleaned data ke outputs/data/
7. **Output Document** — Write report ke outputs/YYYY-MM-DD-sheets-analysis-{topic}.md

## Common Patterns

### Export via URL (public/shared sheets)
\`\`\`bash
# CSV export URL pattern
curl -L "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=SHEET_GID" \\
  -o outputs/data/sheet-export.csv

# Specific sheet by name (URL encoded)
curl -L "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/gviz/tq?tqx=out:csv&sheet=Sheet1" \\
  -o outputs/data/sheet-export.csv
\`\`\`

### Export via gws CLI
\`\`\`bash
gws sheets read --spreadsheet-id SPREADSHEET_ID --range "Sheet1!A1:Z1000" --format csv > outputs/data/export.csv
\`\`\`

### Quick analysis with Python
\`\`\`python
import csv
with open('outputs/data/export.csv') as f:
    reader = csv.DictReader(f)
    rows = list(reader)
print(f"Rows: {len(rows)}, Columns: {list(rows[0].keys()) if rows else 'empty'}")
\`\`\`

## Inter-Agent Handoff

**Input dari:** PM Agent, Business Analyst, stakeholder — spreadsheet URL/ID
**Output ke:** Data Report Generator skill — cleaned data untuk reporting

## Anti-Pattern

- Jangan analisa langsung di Google Sheets — download dulu, analisa lokal
- Jangan assume header row ada di baris 1 — verifikasi dulu
- Jangan skip data type validation — Sheets sering mix string dan number
`,

    'web-data-fetch': `---
name: web-data-fetch
description: "WAJIB DIGUNAKAN: Ketika diminta mengambil data dari web API, scraping halaman web, atau fetch data dari external service."
---

# Web Data Fetch

Skill untuk extract data dari web APIs, public datasets, dan web pages. Untuk website yang memerlukan auth, gunakan \`aoc-connect.sh\`.

<HARD-GATE>
Untuk website dengan auth yang terdaftar di AOC, SELALU gunakan aoc-connect.sh.
Respect robots.txt dan rate limiting.
Selalu cache/save fetched data locally — jangan fetch ulang-ulang.
Catat semua source URLs di report.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Check Registered Connections** — Jalankan \`check_connections.sh website\` untuk lihat website connections yang sudah terdaftar
2. **Identify Sources** — List semua URLs/APIs yang akan di-fetch (registered + public)
3. **Fetch Data** — Gunakan aoc-connect.sh untuk registered sites, curl/web_fetch untuk public
4. **Parse & Validate** — Parse JSON/HTML response, validasi structure
5. **Transform** — Normalize data ke format yang consistent (CSV/JSON)
6. **Save Output** — Simpan raw + processed data ke outputs/data/
7. **Output Document** — Write report ke outputs/YYYY-MM-DD-web-data-{topic}.md

## Common Patterns

### Registered website connections (credentials handled via AOC)
\`\`\`bash
# Check available website connections
check_connections.sh website

# API call with automatic auth
aoc-connect.sh "Service Name" api "/api/v1/data?limit=100"

# Browse website (opens browser, credentials available for login)
aoc-connect.sh "Service Name" browse "/dashboard"
\`\`\`

### Public APIs (no auth needed)
\`\`\`bash
# World Bank API
curl -sf "https://api.worldbank.org/v2/country/IDN/indicator/NY.GDP.MKTP.CD?format=json&per_page=20"

# BPS (Badan Pusat Statistik) — Indonesian statistics
# Use web_search to find current API endpoints

# Exchange rates
curl -sf "https://api.exchangerate-api.com/v4/latest/IDR"
\`\`\`

### web_fetch / web_search tools
\`\`\`bash
# Use web_fetch for JavaScript-rendered pages
# Use web_search for discovering data sources
\`\`\`

## Inter-Agent Handoff

**Input dari:** PM Agent, Business Analyst — external data needs
**Output ke:** Data Report Generator skill — external data untuk enrichment

## Anti-Pattern

- Jangan hardcode API keys atau credentials — gunakan aoc-connect.sh untuk registered sites
- Jangan scrape tanpa cek robots.txt
- Jangan fetch berulang kali — cache locally
- Jangan assume API response format stable — validate setiap kali
`,

    'data-report-generator': `---
name: data-report-generator
description: "WAJIB DIGUNAKAN: Ketika diminta membuat laporan analisa data, summary report, atau presentasi insight dari data yang sudah dikumpulkan."
---

# Data Report Generator

Skill untuk menghasilkan comprehensive data analysis report dari data yang sudah di-extract dan di-transform.

<HARD-GATE>
Jangan buat report tanpa raw data yang bisa di-verify.
Setiap insight HARUS didukung angka spesifik dari data.
Include methodology section — bagaimana data diambil dan diolah.
Sertakan limitations dan caveats di setiap report.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Gather Data** — Kumpulkan semua data dari skills sebelumnya (BQ, PG, Sheets, Web)
2. **Executive Summary** — Tulis 3-5 bullet key findings
3. **Methodology** — Dokumentasikan data sources, query, dan processing steps
4. **Descriptive Stats** — Row count, date range, unique values, distributions
5. **Analysis** — Trend analysis, comparisons, anomaly detection
6. **Insights & Recommendations** — Actionable insights dari data
7. **Limitations** — Data gaps, assumptions, confidence levels
8. **[HUMAN GATE — Stakeholder]** — Kirim summary via notify.sh
9. **Output Document** — Write to outputs/YYYY-MM-DD-report-{topic}.md
10. **Export** — Optional: gdocs-export.sh untuk Google Docs

## Report Template

\`\`\`markdown
# Data Analysis Report: {Topic}
**Date:** YYYY-MM-DD
**Analyst:** Data Analyst Agent
**Requested by:** {stakeholder}

## Executive Summary
- Key finding 1 (with number)
- Key finding 2 (with number)
- Key finding 3 (with number)

## Methodology
- **Data Sources:** [list all sources with dates]
- **Period:** [date range analyzed]
- **Query/Process:** [brief description, full queries in appendix]

## Data Overview
| Metric | Value |
|--------|-------|
| Total Records | N |
| Date Range | X to Y |
| Unique Entities | N |

## Analysis
### [Section per analysis dimension]
[Tables, comparisons, trends]

## Insights & Recommendations
1. **Insight:** [observation] → **Action:** [recommendation]
2. **Insight:** [observation] → **Action:** [recommendation]

## Limitations & Caveats
- [data gap or assumption]

## Appendix
- Full queries used
- Raw data file locations
\`\`\`

## Inter-Agent Handoff

**Input dari:** BigQuery, PostgreSQL, Sheets, Web Fetch skills — processed data
**Output ke:** PM Agent (insight for PRD), Business Analyst (data backing), stakeholder (report)

## Anti-Pattern

- Jangan buat insight tanpa angka pendukung
- Jangan skip methodology — report harus reproducible
- Jangan hide limitations — be transparent tentang data gaps
- Jangan mix correlation dengan causation
`,

    'etl-pipeline': `---
name: etl-pipeline
description: "WAJIB DIGUNAKAN: Ketika diminta membuat data pipeline, transform data antar format, atau menggabungkan data dari multiple sources."
---

# ETL Pipeline

Skill untuk Extract, Transform, dan Load data dari multiple sources ke format yang siap analisa.

<HARD-GATE>
Jangan overwrite source data — selalu buat copy.
Log setiap transformation step untuk audit trail.
Validate data di setiap stage (extract, transform, load).
Handle errors gracefully — partial failures jangan crash seluruh pipeline.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Define Pipeline** — Source(s), transformations, destination format
2. **Discover Sources** — Jalankan \`check_connections.sh\` untuk list semua koneksi yang tersedia
3. **Extract** — Ambil data via \`aoc-connect.sh\` (BQ, PG, Web) atau curl/gws (Sheets, public API)
4. **Validate Extract** — Cek completeness: row counts, null checks
4. **Transform** — Clean, normalize, join, aggregate sesuai requirement
5. **Validate Transform** — Cek output: schema match, no data loss
6. **Load** — Save ke destination format (CSV, JSON, atau target DB)
7. **Pipeline Log** — Dokumentasikan semua steps dan metrics
8. **Output Document** — Write to outputs/YYYY-MM-DD-etl-{pipeline-name}.md

## Common Patterns

### Extract from multiple sources via aoc-connect.sh
\`\`\`bash
# Step 1: Extract from each source
aoc-connect.sh "DKE BigQuery" query "SELECT id, revenue FROM \\\`dataset.sales\\\`" > outputs/data/bq-export.csv
aoc-connect.sh "DKE PostgreSQL" query "SELECT id, name, region FROM customers" > outputs/data/pg-export.csv
\`\`\`

### Multi-source join with Python
\`\`\`python
import csv, json

# Load source A (CSV from BigQuery)
with open('outputs/data/bq-export.csv') as f:
    bq_data = {row['id']: row for row in csv.DictReader(f)}

# Load source B (CSV from PostgreSQL)
with open('outputs/data/pg-export.csv') as f:
    pg_data = {row['id']: row for row in csv.DictReader(f)}

# Join on ID
joined = []
for id, bq_row in bq_data.items():
    pg_row = pg_data.get(id, {})
    joined.append({**bq_row, **pg_row})

# Save result
with open('outputs/data/joined.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=joined[0].keys())
    writer.writeheader()
    writer.writerows(joined)

print(f"Joined: {len(joined)} rows (BQ: {len(bq_data)}, PG: {len(pg_data)})")
\`\`\`

### Data cleaning
\`\`\`python
# Remove duplicates
seen = set()
unique = []
for row in data:
    key = row['id']
    if key not in seen:
        seen.add(key)
        unique.append(row)

# Normalize dates
from datetime import datetime
for row in data:
    if row.get('date'):
        row['date'] = datetime.strptime(row['date'], '%d/%m/%Y').strftime('%Y-%m-%d')

# Handle missing values
for row in data:
    for k, v in row.items():
        if v in ('', 'NULL', 'null', None, 'N/A'):
            row[k] = None
\`\`\`

## Inter-Agent Handoff

**Input dari:** Multiple data sources via other skills
**Output ke:** Data Report Generator — cleaned, joined dataset siap analisa

## Anti-Pattern

- Jangan transform in-place — selalu buat output baru
- Jangan skip row count validation antar stage
- Jangan silent-drop rows yang gagal transform — log mereka
- Jangan assume data types consistent antar sources
`,
  },

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
