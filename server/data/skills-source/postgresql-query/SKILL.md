---
name: postgresql-query
description: "WAJIB DIGUNAKAN: Setiap kali Data Analyst agent perlu query PostgreSQL, analisa database relasional, atau extract data dari Postgres. Trigger juga untuk frasa 'query postgres', 'PostgreSQL', 'psql', 'database query', 'SQL analysis', 'query tabel'. Skill ini structured workflow: discover connections → explore schema → sample data → analysis → validate → output. Semua query via aoc-connect.sh — JANGAN hardcode credentials. Output: pg-analysis-{topic}.md + raw data CSV."
---

# PostgreSQL Query

Query dan analisa data dari PostgreSQL via `aoc-connect.sh` (credentials otomatis dari AOC). Structured workflow dari schema discovery sampai validated analysis.

<HARD-GATE>
SELALU gunakan aoc-connect.sh untuk query — JANGAN hardcode credentials, connection strings, atau password.
JANGAN jalankan UPDATE/DELETE tanpa WHERE clause — read-only by default.
SELALU gunakan LIMIT pada exploratory query.
Credentials JANGAN PERNAH muncul di output, report, atau log.
WAJIB check_connections.sh dulu — pastikan koneksi PG tersedia.
Large table WAJIB preview dulu dengan LIMIT 10 sebelum full query.
Write operations (INSERT/UPDATE/DELETE) WAJIB explicit permission dari user.
</HARD-GATE>

## When to use

- Data extraction dari PostgreSQL database
- Operational database analysis (Odoo, app DB, etc.)
- Schema exploration dan data profiling
- Ad-hoc SQL analysis requests

## When NOT to use

- BigQuery warehouse queries — gunakan `bigquery-usage`
- Real-time monitoring — gunakan `pa-metrics-report`
- Google Sheets data — gunakan `google-sheets-analysis`

## Required Inputs

- **Connection name** — registered PostgreSQL connection di AOC
- **Database/schema/table** — target tables
- **Analysis question** — apa yang ingin diketahui dari data

## Script Helper

Multi-mode PG helper:

```bash
# Explore schema (all tables)
./scripts/query.sh --connection "DKE PostgreSQL" --schema

# Explore specific table columns
./scripts/query.sh --connection "DKE PostgreSQL" --schema --table "orders"

# Execute single query → CSV
./scripts/query.sh --connection "DKE PostgreSQL" \
  --query "SELECT * FROM orders LIMIT 100" \
  --output outputs/data/result.csv

# Scaffold full analysis report
./scripts/query.sh --connection "DKE PostgreSQL" --report --feature "order-analysis"
```

See `references/format.md` for the strict output format specification.

## Workflow

### Step 1 — Discover Connections

```bash
check_connections.sh postgres
```

### Step 2 — Explore Schema

```bash
# List all tables with row counts
aoc-connect.sh "Connection Name" query "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC"

# Table sizes
aoc-connect.sh "Connection Name" query "SELECT tablename, pg_size_pretty(pg_total_relation_size(tablename::regclass)) FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(tablename::regclass) DESC"

# Describe columns
aoc-connect.sh "Connection Name" query "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'table_name' ORDER BY ordinal_position"

# Check indexes
aoc-connect.sh "Connection Name" query "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'table_name'"
```

### Step 3 — Sample Data (LIMIT!)

```bash
# Always preview first
aoc-connect.sh "Connection Name" query "SELECT * FROM orders LIMIT 10"

# Quick stats
aoc-connect.sh "Connection Name" query "SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as unique_users, MIN(created_at) as earliest, MAX(created_at) as latest FROM orders"
```

### Step 4 — Full Analysis Query

```bash
# Analysis with save
aoc-connect.sh "Connection Name" query "SELECT status, COUNT(*) as cnt, AVG(total_amount) as avg_amount FROM orders WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY status ORDER BY cnt DESC" > outputs/data/$(date +%Y-%m-%d)-pg-result.csv
```

### Step 5 — Validate Results

- Row count matches expectations
- NULL ratio check on critical columns
- Date range covers intended window
- Aggregate totals sanity check

## Common Query Patterns

### Aggregate statistics

```sql
SELECT
  COUNT(*) as total,
  COUNT(DISTINCT user_id) as unique_users,
  MIN(created_at) as earliest,
  MAX(created_at) as latest,
  AVG(amount) as avg_amount,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) as median_amount
FROM orders
WHERE created_at >= NOW() - INTERVAL '30 days'
```

### Time series

```sql
SELECT
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) AS orders,
  SUM(total_amount) AS revenue,
  COUNT(DISTINCT user_id) AS unique_buyers
FROM orders
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1
```

### Distribution analysis

```sql
SELECT
  CASE
    WHEN amount < 100 THEN '0-99'
    WHEN amount < 500 THEN '100-499'
    WHEN amount < 1000 THEN '500-999'
    ELSE '1000+'
  END AS bucket,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
FROM orders
GROUP BY 1
ORDER BY MIN(amount)
```

### NULL profiling

```sql
SELECT
  'column_a' AS col, COUNT(*) FILTER (WHERE column_a IS NULL) AS nulls, COUNT(*) AS total
FROM table_name
UNION ALL
SELECT
  'column_b', COUNT(*) FILTER (WHERE column_b IS NULL), COUNT(*)
FROM table_name
```

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Discover Connections** — `check_connections.sh postgres`
2. **Explore Schema** — tables, columns, row counts, indexes
3. **Sample Data** — preview with LIMIT 10
4. **Execute Analysis** — full query, save to CSV
5. **Validate Results** — row count, nulls, date range, sanity
6. **Save Raw Output** — `outputs/data/{date}-pg-{slug}.csv`
7. **Output Report** — `outputs/{date}-pg-analysis-{slug}.md`

## Anti-Pattern

- ❌ Hardcode credentials or connection strings
- ❌ UPDATE/DELETE tanpa WHERE clause — destructive!
- ❌ SELECT * tanpa LIMIT pada unknown table
- ❌ Skip check_connections.sh — connection might not exist
- ❌ Expose password/credentials in output or report
- ❌ Query tanpa index awareness — slow queries on production DB

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Data** ← **PM/Biz** | Operational data question | extract + analyze |
| **Data** → `data-report-generator` | Raw data ready | feed into report |
| **Data** → `etl-pipeline` | Multi-source join needed | feed PG extract |
| **Data** → **Biz** | Revenue/user data | feed into biz analysis |
