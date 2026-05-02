---
name: data-report-generator
description: "WAJIB DIGUNAKAN: Setiap kali Data Analyst agent perlu membuat laporan analisa data, summary report, atau presentasi insight dari data yang sudah dikumpulkan. Trigger juga untuk frasa 'buat report', 'analisa report', 'summary data', 'insight report', 'present findings'. Skill ini produce comprehensive report dari data yang sudah di-extract/transform. Output: report-{topic}.md."
---

# Data Report Generator

Generate comprehensive data analysis report dari data yang sudah di-extract dan di-transform oleh skill lain (BQ, PG, Sheets, Web).

<HARD-GATE>
JANGAN buat report tanpa raw data yang bisa di-verify.
Setiap insight HARUS didukung angka spesifik dari data.
Include methodology section — bagaimana data diambil dan diolah.
Sertakan limitations dan caveats di setiap report.
Setiap recommendation HARUS actionable — bukan "perlu diinvestigasi lebih lanjut".
Executive summary di awal — max 5 bullets.
Queries/commands WAJIB included di appendix untuk reproducibility.
</HARD-GATE>

## When to use

- After data extraction from any source — compile into structured report
- Ad-hoc analysis request from stakeholder
- Periodic reporting (weekly/monthly)
- Data-backed decision support

## When NOT to use

- Raw data extraction only — use specific data skills
- Monitoring/observability — use `pa-metrics-report`
- Business viability assessment — use `biz-viability-report`

## Script Helper

Scaffold a comprehensive report:

```bash
./scripts/report.sh --topic "Monthly Revenue Analysis" \
  --requestor "Finance Team" \
  --sources "BQ|PG|Sheets" \
  --period "last 30 days"
```

The script:
- Pre-fills methodology, data overview, and insights sections
- Creates executive summary framework (3-5 bullets)
- Includes appendix for full queries
- Generates sign-off checklist

See `references/format.md` for the strict output format specification.

## Report Template

```markdown
# Data Analysis Report: {Topic}

**Date:** YYYY-MM-DD
**Analyst:** Data Analyst Agent (#8)
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

[Tables, comparisons, trends — each backed by specific numbers]

## Insights & Recommendations

1. **Insight:** [observation] → **Action:** [recommendation]
2. **Insight:** [observation] → **Action:** [recommendation]

## Limitations & Caveats

- [data gap or assumption]

## Appendix

- Full queries used
- Raw data file locations
```

## Checklist

1. **Gather Data** — collect from skills (BQ, PG, Sheets, Web)
2. **Executive Summary** — 3-5 bullet key findings
3. **Methodology** — data sources, query, processing steps
4. **Descriptive Stats** — row count, date range, distributions
5. **Analysis** — trend, comparisons, anomaly detection
6. **Insights & Recommendations** — actionable items
7. **Limitations** — data gaps, assumptions, confidence
8. **[HUMAN GATE]** — send summary via notify.sh
9. **Output Document** — `outputs/{date}-report-{slug}.md`
10. **Export** — optional: gdocs-export.sh

## Anti-Pattern

- ❌ Insight tanpa angka pendukung
- ❌ Skip methodology — non-reproducible
- ❌ Hide limitations — be transparent
- ❌ Mix correlation dengan causation
- ❌ Recommendation "investigate more" — be specific
- ❌ No executive summary — reader lost

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Data** ← `bigquery-usage` | BQ data ready | compile report |
| **Data** ← `postgresql-query` | PG data ready | compile report |
| **Data** ← `google-sheets-analysis` | Sheets data ready | compile report |
| **Data** ← `web-data-fetch` | Web data ready | compile report |
| **Data** → **PM** | Insight for PRD | feed discovery |
| **Data** → **Biz** | Data backing | feed analysis |
| **Data** → stakeholder | Report delivered | decision support |
