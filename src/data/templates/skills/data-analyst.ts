// ─── Data Analyst Skill Templates ───────────────────────────────────────────────

import type { SkillTemplate } from '../types'

export const DATA_ANALYST_TEMPLATES: SkillTemplate[] = [

  {
    id: 'bigquery-usage',
    name: 'BigQuery Usage',
    slug: 'bigquery-usage',
    description: 'Query dan analisa data dari Google BigQuery menggunakan bq CLI dengan cost estimation dan safety checks.',
    agent: 'Data Analyst',
    agentEmoji: '📈',
    category: 'Data Analyst',
    tags: ['data', 'bigquery', 'bq', 'sql', 'warehouse', 'gcp', 'analytics'],
    content: `---
name: bigquery-usage
description: "WAJIB DIGUNAKAN: Ketika diminta query BigQuery, analisa data warehouse, atau extract data dari Google BigQuery."
---

# BigQuery Usage

Skill untuk query dan analisa data dari Google BigQuery via \\\`aoc-connect.sh\\\` (credentials otomatis dari AOC).

<HARD-GATE>
SELALU gunakan aoc-connect.sh untuk query — JANGAN hardcode credentials.
Selalu gunakan LIMIT pada exploratory query.
Jangan SELECT * pada tabel besar — pilih kolom yang dibutuhkan saja.
Simpan setiap query yang dijalankan di report untuk reproducibility.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Discover Connections** — Jalankan \\\`check_connections.sh bigquery\\\` untuk list koneksi BQ
2. **Explore Schema** — Query INFORMATION_SCHEMA via aoc-connect.sh
3. **Exploratory Query** — Query dengan LIMIT kecil dulu untuk validasi
4. **Execute Full Query** — Jalankan full analysis query, save output
5. **Validate Results** — Cek row count, null values, dan data range
6. **Save Output** — Simpan raw result ke outputs/data/ dan summary ke report
7. **Output Document** — Write report ke outputs/YYYY-MM-DD-bq-analysis-{topic}.md

## Common Patterns

### Discover & query via aoc-connect.sh
\\\`\\\`\\\`bash
# List available BigQuery connections
check_connections.sh bigquery

# Query (credentials handled automatically)
aoc-connect.sh "Connection Name" query "SELECT COUNT(*) FROM \\\\\\\`dataset.table\\\\\\\`"

# Exploratory — always use LIMIT
aoc-connect.sh "Connection Name" query "SELECT * FROM \\\\\\\`dataset.table\\\\\\\` LIMIT 10"

# Save results
aoc-connect.sh "Connection Name" query "SELECT col1, col2 FROM \\\\\\\`dataset.table\\\\\\\` LIMIT 1000" > outputs/data/result.csv
\\\`\\\`\\\`

## Anti-Pattern

- Jangan SELECT * — selalu pilih kolom spesifik
- JANGAN hardcode credentials — gunakan aoc-connect.sh
- Jangan skip check_connections.sh — pastikan koneksi tersedia dulu
`,
  },

  {
    id: 'postgresql-query',
    name: 'PostgreSQL Query',
    slug: 'postgresql-query',
    description: 'Query dan analisa data dari PostgreSQL via psql CLI dengan safety checks untuk destructive operations.',
    agent: 'Data Analyst',
    agentEmoji: '📈',
    category: 'Data Analyst',
    tags: ['data', 'postgresql', 'psql', 'sql', 'database', 'analytics'],
    content: `---
name: postgresql-query
description: "WAJIB DIGUNAKAN: Ketika diminta query PostgreSQL, analisa database, atau extract data dari Postgres."
---

# PostgreSQL Query

Skill untuk query dan analisa data dari PostgreSQL via \\\`aoc-connect.sh\\\` (credentials otomatis dari AOC).

<HARD-GATE>
SELALU gunakan aoc-connect.sh untuk query — JANGAN hardcode credentials.
Jangan jalankan UPDATE/DELETE tanpa WHERE clause.
Selalu gunakan LIMIT pada exploratory query.
Credentials JANGAN PERNAH muncul di output atau report.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Discover Connections** — Jalankan \\\`check_connections.sh postgres\\\` untuk list koneksi PG
2. **Explore Schema** — List tables dan columns via aoc-connect.sh
3. **Sample Data** — Preview: query dengan LIMIT 10
4. **Execute Query** — Jalankan analysis query, save output
5. **Validate Results** — Cek row count, NULL ratio, dan anomali
6. **Save Output** — Simpan ke outputs/data/ sebagai CSV
7. **Output Document** — Write report ke outputs/YYYY-MM-DD-pg-analysis-{topic}.md

## Common Patterns

### Discover & query via aoc-connect.sh
\\\`\\\`\\\`bash
# List available PostgreSQL connections
check_connections.sh postgres

# Query (credentials handled automatically)
aoc-connect.sh "Connection Name" query "SELECT COUNT(*) FROM users"

# Exploratory
aoc-connect.sh "Connection Name" query "SELECT * FROM orders LIMIT 10"

# Schema exploration
aoc-connect.sh "Connection Name" query "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC"
\\\`\\\`\\\`

## Anti-Pattern

- JANGAN store password/credentials di output — gunakan aoc-connect.sh
- Jangan query tanpa LIMIT pada tabel yang belum diketahui ukurannya
- Jangan gunakan SELECT * untuk production queries
`,
  },

  {
    id: 'google-sheets-analysis',
    name: 'Google Sheets Analysis',
    slug: 'google-sheets-analysis',
    description: 'Extract dan analisa data dari Google Sheets via CSV export atau gws CLI.',
    agent: 'Data Analyst',
    agentEmoji: '📈',
    category: 'Data Analyst',
    tags: ['data', 'google-sheets', 'spreadsheet', 'csv', 'analytics'],
    content: `---
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
5. **Analyze** — Jalankan analisa sesuai permintaan
6. **Save Output** — Simpan cleaned data ke outputs/data/
7. **Output Document** — Write report ke outputs/YYYY-MM-DD-sheets-analysis-{topic}.md

## Common Patterns

### Export via URL (public/shared sheets)
\\\`\\\`\\\`bash
curl -L "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=SHEET_GID" \\\\
  -o outputs/data/sheet-export.csv
\\\`\\\`\\\`

### Export via gws CLI
\\\`\\\`\\\`bash
gws sheets read --spreadsheet-id SPREADSHEET_ID --range "Sheet1!A1:Z1000" --format csv > outputs/data/export.csv
\\\`\\\`\\\`

## Anti-Pattern

- Jangan analisa langsung di Google Sheets — download dulu, analisa lokal
- Jangan assume header row ada di baris 1 — verifikasi dulu
- Jangan skip data type validation
`,
  },

  {
    id: 'web-data-fetch',
    name: 'Web Data Fetch',
    slug: 'web-data-fetch',
    description: 'Extract data dari web APIs, public datasets, dan web pages untuk analisa.',
    agent: 'Data Analyst',
    agentEmoji: '📈',
    category: 'Data Analyst',
    tags: ['data', 'web', 'api', 'fetch', 'scraping', 'rest', 'analytics'],
    content: `---
name: web-data-fetch
description: "WAJIB DIGUNAKAN: Ketika diminta mengambil data dari web API, scraping halaman web, atau fetch data dari external service."
---

# Web Data Fetch

Skill untuk extract data dari web APIs, public datasets, dan web pages. Untuk website yang memerlukan auth, gunakan \\\`aoc-connect.sh\\\`.

<HARD-GATE>
Untuk website dengan auth yang terdaftar di AOC, SELALU gunakan aoc-connect.sh.
Respect robots.txt dan rate limiting.
Selalu cache/save fetched data locally — jangan fetch ulang-ulang.
Catat semua source URLs di report.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Check Registered Connections** — Jalankan \\\`check_connections.sh website\\\` untuk lihat website connections
2. **Identify Sources** — List semua URLs/APIs (registered + public)
3. **Fetch Data** — aoc-connect.sh untuk registered sites, curl/web_fetch untuk public
4. **Parse & Validate** — Parse JSON/HTML response, validasi structure
5. **Transform** — Normalize data ke format yang consistent (CSV/JSON)
6. **Save Output** — Simpan raw + processed data ke outputs/data/
7. **Output Document** — Write report ke outputs/YYYY-MM-DD-web-data-{topic}.md

## Common Patterns

### Registered website connections (credentials via AOC)
\\\`\\\`\\\`bash
check_connections.sh website
aoc-connect.sh "Service Name" api "/api/v1/data?limit=100"
aoc-connect.sh "Service Name" browse "/dashboard"
\\\`\\\`\\\`

### Public APIs (no auth)
\\\`\\\`\\\`bash
curl -sf "https://api.worldbank.org/v2/country/IDN/indicator/NY.GDP.MKTP.CD?format=json&per_page=20"
curl -sf "https://api.exchangerate-api.com/v4/latest/IDR"
\\\`\\\`\\\`

## Anti-Pattern

- Jangan hardcode API keys/credentials — gunakan aoc-connect.sh untuk registered sites
- Jangan scrape tanpa cek robots.txt
- Jangan fetch berulang kali — cache locally
`,
  },

  {
    id: 'data-report-generator',
    name: 'Data Report Generator',
    slug: 'data-report-generator',
    description: 'Generate comprehensive data analysis report dengan executive summary, methodology, dan actionable insights.',
    agent: 'Data Analyst',
    agentEmoji: '📈',
    category: 'Data Analyst',
    tags: ['data', 'report', 'analysis', 'insight', 'visualization', 'analytics'],
    content: `---
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

1. **Gather Data** — Kumpulkan semua data dari skills sebelumnya
2. **Executive Summary** — Tulis 3-5 bullet key findings
3. **Methodology** — Dokumentasikan data sources, query, dan processing steps
4. **Descriptive Stats** — Row count, date range, unique values, distributions
5. **Analysis** — Trend analysis, comparisons, anomaly detection
6. **Insights & Recommendations** — Actionable insights dari data
7. **Limitations** — Data gaps, assumptions, confidence levels
8. **[HUMAN GATE — Stakeholder]** — Kirim summary via notify.sh
9. **Output Document** — Write to outputs/YYYY-MM-DD-report-{topic}.md

## Report Template

\\\`\\\`\\\`markdown
# Data Analysis Report: {Topic}
**Date:** YYYY-MM-DD | **Analyst:** Data Analyst Agent | **Requested by:** {stakeholder}

## Executive Summary
- Key finding 1 (with number)
- Key finding 2 (with number)

## Methodology
- **Data Sources:** [list all sources]
- **Period:** [date range]

## Data Overview
| Metric | Value |
|--------|-------|
| Total Records | N |
| Date Range | X to Y |

## Analysis
[Tables, comparisons, trends]

## Insights & Recommendations
1. **Insight:** [observation] → **Action:** [recommendation]

## Limitations & Caveats
- [data gap or assumption]

## Appendix
- Full queries used
- Raw data file locations
\\\`\\\`\\\`

## Anti-Pattern

- Jangan buat insight tanpa angka pendukung
- Jangan skip methodology — report harus reproducible
- Jangan mix correlation dengan causation
`,
  },

  {
    id: 'etl-pipeline',
    name: 'ETL Pipeline',
    slug: 'etl-pipeline',
    description: 'Extract, Transform, Load data dari multiple sources ke format siap analisa.',
    agent: 'Data Analyst',
    agentEmoji: '📈',
    category: 'Data Analyst',
    tags: ['data', 'etl', 'pipeline', 'transform', 'join', 'merge', 'analytics'],
    content: `---
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
2. **Discover Sources** — Jalankan \\\`check_connections.sh\\\` untuk list semua koneksi
3. **Extract** — Ambil data via \\\`aoc-connect.sh\\\` (BQ, PG, Web) atau curl/gws (Sheets, public API)
4. **Validate Extract** — Cek completeness: row counts, null checks
4. **Transform** — Clean, normalize, join, aggregate sesuai requirement
5. **Validate Transform** — Cek output: schema match, no data loss
6. **Load** — Save ke destination format (CSV, JSON, atau target DB)
7. **Pipeline Log** — Dokumentasikan semua steps dan metrics
8. **Output Document** — Write to outputs/YYYY-MM-DD-etl-{pipeline-name}.md

## Common Patterns

### Multi-source join with Python
\\\`\\\`\\\`python
import csv, json

with open('outputs/data/bq-export.csv') as f:
    bq_data = {row['id']: row for row in csv.DictReader(f)}

with open('outputs/data/pg-export.csv') as f:
    pg_data = {row['id']: row for row in csv.DictReader(f)}

joined = []
for id, bq_row in bq_data.items():
    pg_row = pg_data.get(id, {})
    joined.append({**bq_row, **pg_row})

print(f"Joined: {len(joined)} rows")
\\\`\\\`\\\`

## Anti-Pattern

- Jangan transform in-place — selalu buat output baru
- Jangan skip row count validation antar stage
- Jangan silent-drop rows yang gagal transform
`,
  },

]
