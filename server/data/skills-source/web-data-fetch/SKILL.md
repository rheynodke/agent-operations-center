---
name: web-data-fetch
description: "WAJIB DIGUNAKAN: Setiap kali Data Analyst agent perlu mengambil data dari web API, scraping halaman web, atau fetch data dari external service. Trigger juga untuk frasa 'ambil data dari web', 'API call', 'fetch data', 'scraping', 'web API', 'external data'. Untuk website dengan auth di AOC, SELALU gunakan aoc-connect.sh. Output: web-data-{topic}.md + raw data."
---

# Web Data Fetch

Extract data dari web APIs, public datasets, dan web pages. Untuk website terdaftar di AOC, SELALU gunakan `aoc-connect.sh`.

<HARD-GATE>
Untuk website terdaftar di AOC, SELALU gunakan aoc-connect.sh — JANGAN hardcode API keys.
Respect robots.txt dan rate limiting.
SELALU cache/save fetched data locally — jangan fetch ulang-ulang.
Catat semua source URLs di report.
Validate API response structure setiap kali.
Large datasets WAJIB paginated.
</HARD-GATE>

## When to use

- Fetch data dari public APIs (World Bank, BPS, exchange rates)
- Fetch data dari registered website connections via AOC
- Scrape public web pages for market data
- Download public datasets (CSV, JSON)

## When NOT to use

- BigQuery — gunakan `bigquery-usage`
- PostgreSQL — gunakan `postgresql-query`
- Google Sheets — gunakan `google-sheets-analysis`
- Datadog/Mixpanel monitoring — gunakan `pa-metrics-report`

## Script Helper

Multi-mode web fetch helper:

```bash
# Fetch from public URL
./scripts/fetch.sh --url "https://api.worldbank.org/v2/country/IDN?format=json" \
  --output outputs/data/worldbank.json

# Fetch from AOC registered connection
./scripts/fetch.sh --connection "Service Name" --endpoint "/api/v1/data"

# Scaffold analysis report
./scripts/fetch.sh --report --feature "market-data"
```

The script auto-detects JSON responses and reports record count.

See `references/format.md` for the strict output format specification.

## Workflow

### Step 1 — Check Registered Connections

```bash
check_connections.sh website
```

### Step 2 — Fetch Data

**Registered connections:**
```bash
aoc-connect.sh "Service Name" api "/api/v1/data?limit=100"
aoc-connect.sh "Service Name" browse "/dashboard"
```

**Public APIs:**
```bash
curl -sf "https://api.worldbank.org/v2/country/IDN/indicator/NY.GDP.MKTP.CD?format=json&per_page=20" > outputs/data/worldbank-gdp.json
curl -sf "https://api.exchangerate-api.com/v4/latest/IDR" > outputs/data/exchange-rates.json
```

### Step 3 — Parse & Validate

```python
import json
with open('outputs/data/response.json') as f:
    data = json.load(f)
assert isinstance(data, (list, dict)), "Unexpected format"
```

### Step 4 — Transform & Save

```bash
python3 csv-to-json.py outputs/data/response.json --to csv --output outputs/data/normalized.csv
```

## Common Data Sources

| Source | Type | URL Pattern |
|---|---|---|
| World Bank | REST API | `api.worldbank.org/v2/...` |
| BPS Indonesia | Web | `bps.go.id` |
| Exchange Rate API | REST | `api.exchangerate-api.com/...` |
| GitHub API | REST | `api.github.com/...` |

## Checklist

1. **Check Connections** — `check_connections.sh website`
2. **Identify Sources** — registered vs public
3. **Fetch Data** — aoc-connect.sh or curl
4. **Parse & Validate** — check response structure
5. **Transform** — normalize to CSV/JSON
6. **Save Output** — `outputs/data/{date}-web-{slug}.json`
7. **Output Report** — `outputs/{date}-web-data-{slug}.md`

## Anti-Pattern

- ❌ Hardcode API keys — use aoc-connect.sh
- ❌ Scrape without checking robots.txt
- ❌ Fetch repeatedly — cache locally
- ❌ Assume API format stable — validate each time
- ❌ Single large request — paginate

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Data** ← **PM/Biz** | External data needs | fetch + transform |
| **Data** → `data-report-generator` | External data ready | feed into report |
| **Data** → `etl-pipeline` | Multi-source join | feed web extract |
