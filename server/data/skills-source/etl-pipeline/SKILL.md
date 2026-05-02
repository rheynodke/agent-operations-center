---
name: etl-pipeline
description: "WAJIB DIGUNAKAN: Setiap kali Data Analyst agent perlu membuat data pipeline, transform data antar format, atau menggabungkan data dari multiple sources. Trigger juga untuk frasa 'ETL', 'data pipeline', 'join data', 'merge data', 'transform data', 'combine sources', 'data integration'. Skill ini structured workflow: define pipeline → extract from multiple sources → validate → transform → validate → load → log. Output: etl-{pipeline-name}.md + processed data."
---

# ETL Pipeline

Extract, Transform, Load data dari multiple sources ke format siap analisa. Structured multi-step pipeline dengan validation di setiap stage.

<HARD-GATE>
JANGAN overwrite source data — selalu buat copy/output baru.
Log setiap transformation step untuk audit trail.
Validate data di SETIAP stage (extract, transform, load) — row counts WAJIB match.
Handle errors gracefully — partial failures JANGAN crash seluruh pipeline.
Setiap source extraction via aoc-connect.sh (credentials otomatis).
Join operations WAJIB log: left count, right count, joined count, dropped count.
Type coercion WAJIB explicit — jangan silent type conversion.
</HARD-GATE>

## When to use

- Combine data from multiple sources (BQ + PG + Sheets + Web)
- Transform data format (CSV ↔ JSON ↔ TSV)
- Data cleaning pipeline (dedup, normalize, enrich)
- Prepare dataset for analysis or reporting

## When NOT to use

- Single-source query — use specific data skill directly
- Monitoring pipeline — use `pa-metrics-report`
- One-off format conversion — use csv-to-json.py script directly

## Script Helper

Multi-mode ETL helper:

```bash
# Run extract from multiple sources
./scripts/pipeline.sh --name "user-revenue-join" \
  --sources "BQ:DKE BigQuery:SELECT id,revenue FROM sales|PG:DKE PostgreSQL:SELECT id,name FROM users" \
  --join-key "id"

# Scaffold pipeline documentation
./scripts/pipeline.sh --report --name "user-revenue-join"
```

The script:
- Extracts from BQ, PG, Sheets, and URL sources automatically
- Saves each source extract as separate CSV
- Reports row counts per source
- Generates pipeline documentation with validation tables

See `references/format.md` for the strict output format specification.

## Workflow

### Step 1 — Define Pipeline

| Field | Value |
|---|---|
| Pipeline name | {descriptive name} |
| Sources | BQ: dataset.table, PG: schema.table, Sheets: ID |
| Transform | join on user_id, normalize dates, dedup |
| Output | outputs/data/{date}-{slug}-joined.csv |

### Step 2 — Extract from Multiple Sources

```bash
# Step 1: Extract from each source
aoc-connect.sh "DKE BigQuery" query "SELECT id, revenue FROM \`dataset.sales\`" > outputs/data/bq-export.csv
aoc-connect.sh "DKE PostgreSQL" query "SELECT id, name, region FROM customers" > outputs/data/pg-export.csv
curl -sL "https://docs.google.com/spreadsheets/d/ID/export?format=csv" > outputs/data/sheets-export.csv
```

### Step 3 — Validate Extract

```python
import csv

for filename in ['bq-export.csv', 'pg-export.csv', 'sheets-export.csv']:
    with open(f'outputs/data/{filename}') as f:
        rows = list(csv.DictReader(f))
    print(f"{filename}: {len(rows)} rows, columns: {list(rows[0].keys()) if rows else 'empty'}")
```

### Step 4 — Transform (join, clean, normalize)

```python
import csv, json

# Load sources
with open('outputs/data/bq-export.csv') as f:
    bq_data = {row['id']: row for row in csv.DictReader(f)}

with open('outputs/data/pg-export.csv') as f:
    pg_data = {row['id']: row for row in csv.DictReader(f)}

# Join on ID
joined = []
for id, bq_row in bq_data.items():
    pg_row = pg_data.get(id, {})
    joined.append({**bq_row, **pg_row})

# Log join stats
print(f"BQ: {len(bq_data)}, PG: {len(pg_data)}, Joined: {len(joined)}")
print(f"Unmatched BQ: {len(bq_data) - len(joined)}")

# Normalize dates
from datetime import datetime
for row in joined:
    if row.get('date'):
        try:
            row['date'] = datetime.strptime(row['date'], '%d/%m/%Y').strftime('%Y-%m-%d')
        except ValueError:
            pass  # already ISO format

# Dedup
seen = set()
unique = []
for row in joined:
    key = row['id']
    if key not in seen:
        seen.add(key)
        unique.append(row)
print(f"After dedup: {len(unique)} (removed {len(joined) - len(unique)})")

# Handle missing values
for row in unique:
    for k, v in row.items():
        if v in ('', 'NULL', 'null', None, 'N/A'):
            row[k] = None
```

### Step 5 — Validate Transform

```python
# Check: no data loss
assert len(unique) > 0, "Transform produced empty result"
assert len(unique) <= len(bq_data), "Transform produced more rows than source — duplicates?"

# Check: required columns present
required = ['id', 'name', 'revenue']
for col in required:
    assert col in unique[0], f"Missing required column: {col}"
```

### Step 6 — Load (save output)

```python
with open('outputs/data/joined-result.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=unique[0].keys())
    writer.writeheader()
    writer.writerows(unique)
print(f"Saved {len(unique)} rows to outputs/data/joined-result.csv")
```

### Step 7 — Pipeline Log

Document: sources, row counts per stage, transforms applied, validation results.

## Checklist

1. **Define Pipeline** — sources, transforms, destination
2. **Discover Sources** — `check_connections.sh`
3. **Extract** — aoc-connect.sh, curl, gws
4. **Validate Extract** — row counts, null checks
5. **Transform** — clean, normalize, join, aggregate
6. **Validate Transform** — schema match, no data loss
7. **Load** — save to destination format
8. **Pipeline Log** — document all steps and metrics
9. **Output Document** — `outputs/{date}-etl-{slug}.md`

## Anti-Pattern

- ❌ Transform in-place — create new output
- ❌ Skip row count validation between stages
- ❌ Silent-drop rows that fail transform — log them
- ❌ Assume data types consistent across sources
- ❌ No pipeline log — non-auditable
- ❌ Single monolithic script — break into stages

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Data** ← multiple sources | Multi-source analysis needed | orchestrate pipeline |
| **Data** → `data-report-generator` | Joined dataset ready | compile report |
| **Data** → **PM/Biz** | Enriched data available | feed analysis |
