---
name: bigquery-usage
description: "WAJIB DIGUNAKAN: Setiap kali Data Analyst agent perlu query BigQuery, analisa data warehouse, atau extract data dari Google BigQuery. Trigger juga untuk frasa 'query BQ', 'BigQuery', 'data warehouse', 'BQ analysis', 'GCP dataset', 'warehouse query', 'bigquery table'. Skill ini structured workflow: discover connections → explore schema → exploratory query → full analysis → validate → output. Semua query via aoc-connect.sh — JANGAN hardcode credentials. Output: bq-analysis-{topic}.md + raw data CSV."
---

# BigQuery Usage

Query dan analisa data dari Google BigQuery via `aoc-connect.sh` (credentials otomatis dari AOC). Structured workflow dari schema discovery sampai validated analysis.

<HARD-GATE>
SELALU gunakan aoc-connect.sh untuk query — JANGAN hardcode credentials, service account JSON, atau API key.
SELALU gunakan LIMIT pada exploratory query — BigQuery charges by bytes scanned.
JANGAN SELECT * pada tabel besar — pilih kolom spesifik yang dibutuhkan.
Simpan setiap query yang dijalankan di report untuk reproducibility.
WAJIB check_connections.sh dulu — pastikan koneksi BQ tersedia sebelum query.
Setiap query WAJIB estimated scan size awareness — flag kalau >1GB scan.
Partitioned tables WAJIB pakai WHERE clause pada partition column.
Raw output WAJIB saved ke outputs/data/ sebagai CSV untuk traceability.
</HARD-GATE>

## When to use

- Data extraction dari BigQuery warehouse
- Cohort analysis (retention, revenue, engagement)
- Cross-table joins yang butuh warehouse compute
- Historical trend analysis (long time windows)
- Schema exploration untuk unfamiliar datasets

## When NOT to use

- Real-time monitoring — gunakan `pa-metrics-report` (PA Monitor scope)
- One-off PostgreSQL query — gunakan `postgresql-query`
- Google Sheets data — gunakan `google-sheets-analysis`

## Required Inputs

- **Connection name** — registered BigQuery connection di AOC
- **Dataset/table** — target dataset dan table names
- **Analysis question** — what do you want to learn from the data

## Script Helper

Multi-mode BQ helper:

```bash
# Explore dataset schema
./scripts/query.sh --connection "DKE BigQuery" --schema "my_dataset"

# Execute single query → CSV
./scripts/query.sh --connection "DKE BigQuery" \
  --query "SELECT * FROM \`dataset.table\` LIMIT 100" \
  --output outputs/data/result.csv

# Scaffold full analysis report
./scripts/query.sh --connection "DKE BigQuery" --report --feature "user-retention" --window "30d"
```

See `references/format.md` for the strict output format specification.

## Workflow

### Step 1 — Discover Connections

```bash
check_connections.sh bigquery
```

### Step 2 — Explore Schema

```bash
# List tables in a dataset
aoc-connect.sh "Connection Name" query "SELECT table_name, row_count FROM \`dataset.INFORMATION_SCHEMA.TABLE_STORAGE\` ORDER BY row_count DESC"

# Describe table columns
aoc-connect.sh "Connection Name" query "SELECT column_name, data_type, is_nullable FROM \`dataset.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'table_name'"

# Check partition info
aoc-connect.sh "Connection Name" query "SELECT * FROM \`dataset.INFORMATION_SCHEMA.TABLE_OPTIONS\` WHERE table_name = 'table_name' AND option_name = 'partition_expiration_days'"
```

### Step 3 — Exploratory Query (LIMIT!)

```bash
# Always preview first — small scan
aoc-connect.sh "Connection Name" query "SELECT * FROM \`dataset.table\` LIMIT 10"

# Check cardinality
aoc-connect.sh "Connection Name" query "SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as unique_users, MIN(created_at) as earliest, MAX(created_at) as latest FROM \`dataset.table\`"
```

### Step 4 — Full Analysis Query

```bash
# Analysis query with save
aoc-connect.sh "Connection Name" query "SELECT col1, col2, COUNT(*) as cnt FROM \`dataset.table\` WHERE _PARTITIONDATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) GROUP BY 1,2 ORDER BY cnt DESC LIMIT 1000" > outputs/data/$(date +%Y-%m-%d)-bq-result.csv
```

### Step 5 — Validate Results

- Check row count matches expectations
- Check for NULL values in critical columns
- Verify date range covers intended window
- Cross-check totals against known benchmarks

### Step 6 — Output

```bash
# Save analysis report
# outputs/YYYY-MM-DD-bq-analysis-{topic}.md
```

## Common Query Patterns

### Cohort retention

```sql
SELECT
  DATE_TRUNC(first_seen, WEEK) AS cohort_week,
  DATE_DIFF(activity_date, first_seen, WEEK) AS week_n,
  COUNT(DISTINCT user_id) AS users
FROM `dataset.user_activity`
GROUP BY 1, 2
ORDER BY 1, 2
```

### Funnel analysis

```sql
SELECT
  step,
  COUNT(DISTINCT session_id) AS sessions,
  ROUND(COUNT(DISTINCT session_id) * 100.0 /
    FIRST_VALUE(COUNT(DISTINCT session_id)) OVER (ORDER BY step_order), 1) AS pct
FROM `dataset.funnel_events`
WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY step, step_order
ORDER BY step_order
```

### Time series aggregation

```sql
SELECT
  DATE_TRUNC(created_at, DAY) AS day,
  COUNT(*) AS events,
  COUNT(DISTINCT user_id) AS unique_users,
  AVG(duration_ms) AS avg_duration
FROM `dataset.events`
WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY 1
ORDER BY 1
```

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Discover Connections** — `check_connections.sh bigquery`
2. **Explore Schema** — tables, columns, partitions, row counts
3. **Preview Data** — exploratory query with LIMIT
4. **Execute Analysis** — full query, save output to CSV
5. **Validate Results** — row count, nulls, date range, sanity check
6. **Save Raw Output** — `outputs/data/{date}-bq-{slug}.csv`
7. **Output Report** — `outputs/{date}-bq-analysis-{slug}.md`

## Anti-Pattern

- ❌ Hardcode credentials or service account JSON
- ❌ SELECT * on large tables — pick specific columns
- ❌ Query without WHERE on partitioned tables — full scan = expensive
- ❌ Skip check_connections.sh — connection might not exist
- ❌ Single query without validation — always check results
- ❌ Forget to save query in report — non-reproducible

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Data** ← **PM/Biz** | Data question | extract + analyze |
| **Data** → `data-report-generator` | Raw data ready | feed into report |
| **Data** → `etl-pipeline` | Multi-source join needed | feed BQ extract |
| **Data** → **PA Monitor** | Metric data for monitoring | feed baseline data |
