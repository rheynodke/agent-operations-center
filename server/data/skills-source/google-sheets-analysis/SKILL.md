---
name: google-sheets-analysis
description: "WAJIB DIGUNAKAN: Setiap kali Data Analyst agent perlu membaca, menganalisa, atau memproses data dari Google Sheets. Trigger juga untuk frasa 'Google Sheets', 'spreadsheet', 'analisa sheet', 'data dari sheets', 'export spreadsheet', 'sheet ke CSV'. Skill ini structured workflow: identify source → export CSV → inspect → clean → analyze → output. JANGAN modifikasi source spreadsheet. Output: sheets-analysis-{topic}.md + cleaned data CSV."
---

# Google Sheets Analysis

Extract dan analisa data dari Google Sheets — download sebagai CSV, analisa lokal, output report. JANGAN modifikasi source spreadsheet tanpa explicit permission.

<HARD-GATE>
JANGAN modifikasi source spreadsheet tanpa explicit permission dari user.
SELALU download/export sebagai CSV untuk analisa lokal — jangan analisa langsung di Sheets.
Validasi header dan data types WAJIB sebelum analisa — Sheets sering mix string dan number.
Catat spreadsheet ID dan sheet name di report untuk traceability.
JANGAN assume header row ada di baris 1 — verifikasi dulu.
Cleaned data WAJIB saved ke outputs/data/ — raw + cleaned versions.
Missing values WAJIB handled explicit — document strategy (drop/fill/flag).
</HARD-GATE>

## When to use

- Analisa data dari Google Sheets (shared spreadsheets, manual data collection)
- Cross-reference Sheets data with database data
- Data quality audit pada manually-maintained spreadsheets
- Export + transform Sheets data untuk downstream analysis

## When NOT to use

- Large dataset in warehouse — gunakan `bigquery-usage`
- Database queries — gunakan `postgresql-query`
- Web API data — gunakan `web-data-fetch`

## Required Inputs

- **Spreadsheet ID** — from URL: `docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/...`
- **Sheet/tab name** — specific tab to analyze
- **Access level** — public, shared, or requires auth

## Script Helper

Multi-mode Sheets helper:

```bash
# Export sheet to CSV (by GID)
./scripts/export.sh --spreadsheet "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" --gid 0

# Export sheet to CSV (by name)
./scripts/export.sh --spreadsheet "SPREADSHEET_ID" --sheet "Sheet1" --output outputs/data/export.csv

# Scaffold full analysis report
./scripts/export.sh --report --feature "sales-data" --spreadsheet "SPREADSHEET_ID"
```

The export script automatically runs a data quality check (column types, fill rates, mixed types).

See `references/format.md` for the strict output format specification.

## Workflow

### Step 1 — Identify Source

Document the spreadsheet:
- Spreadsheet ID
- Sheet/tab name
- GID (tab identifier from URL)
- Access type (public vs authenticated)

### Step 2 — Export Data

```bash
# Public/shared sheets — CSV export URL
curl -L "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=SHEET_GID" \
  -o outputs/data/sheet-export.csv

# Specific sheet by name (URL encoded)
curl -L "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/gviz/tq?tqx=out:csv&sheet=Sheet1" \
  -o outputs/data/sheet-export.csv

# Via gws CLI (authenticated)
gws sheets read --spreadsheet-id SPREADSHEET_ID --range "Sheet1!A1:Z1000" --format csv > outputs/data/export.csv
```

### Step 3 — Inspect Structure

```python
import csv

with open('outputs/data/sheet-export.csv') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

print(f"Rows: {len(rows)}")
print(f"Columns: {list(rows[0].keys()) if rows else 'empty'}")

# Check for mixed types, empty rows, merged cells artifacts
for col in rows[0].keys():
    values = [r[col] for r in rows if r[col]]
    types = set()
    for v in values[:20]:
        try:
            float(v); types.add('numeric')
        except:
            types.add('text')
    if len(types) > 1:
        print(f"WARNING: Mixed types in '{col}': {types}")
```

### Step 4 — Clean Data

- Handle missing values (empty cells, "N/A", "#REF!")
- Normalize date formats
- Remove duplicate rows
- Fix merged-cell artifacts (blank rows that are actually sub-items)
- Convert numeric strings to proper numbers

### Step 5 — Analyze

- Aggregations, pivots, trend analysis per requirement
- Cross-reference with other data sources if needed

### Step 6 — Output

- Save cleaned data: `outputs/data/{date}-sheets-{slug}-cleaned.csv`
- Write report: `outputs/{date}-sheets-analysis-{slug}.md`

## Common Patterns

### Multi-tab export

```bash
# Export multiple tabs
for gid in 0 123456789 987654321; do
  curl -sL "https://docs.google.com/spreadsheets/d/$SPREADSHEET_ID/export?format=csv&gid=$gid" \
    -o "outputs/data/tab-$gid.csv"
done
```

### Data quality summary

```python
# Quick quality assessment
total_rows = len(rows)
for col in rows[0].keys():
    non_empty = sum(1 for r in rows if r[col].strip())
    fill_rate = non_empty / total_rows * 100
    print(f"{col}: {fill_rate:.0f}% filled ({total_rows - non_empty} missing)")
```

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Identify Source** — spreadsheet ID, sheet name, GID, access type
2. **Export Data** — download as CSV
3. **Inspect Structure** — headers, data types, row count, missing values
4. **Clean Data** — handle missing values, duplicates, formatting
5. **Analyze** — run analysis per requirement
6. **Save Cleaned Data** — `outputs/data/{date}-sheets-{slug}-cleaned.csv`
7. **Output Report** — `outputs/{date}-sheets-analysis-{slug}.md`

## Anti-Pattern

- ❌ Analisa langsung di Google Sheets — download dulu, analisa lokal
- ❌ Assume header row di baris 1 — verifikasi
- ❌ Skip data type validation — Sheets mixes string and number freely
- ❌ Modify source spreadsheet tanpa permission
- ❌ Forget to document spreadsheet ID — non-traceable
- ❌ Ignore merged cells artifacts — blank rows from merges

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Data** ← **PM/Biz/stakeholder** | Spreadsheet data question | export + analyze |
| **Data** → `data-report-generator` | Cleaned data ready | feed into report |
| **Data** → `etl-pipeline` | Multi-source join needed | feed Sheets extract |
