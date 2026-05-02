# Output Format — BigQuery Analysis Report

Strict format yang harus diikuti `query.sh --report` output.

## Filename

`outputs/YYYY-MM-DD-bq-analysis-{slug}.md`

Raw data: `outputs/data/YYYY-MM-DD-bq-{slug}-q{N}.csv`

## Required sections (in order)

1. **H1 title** — `# BigQuery Analysis: {Topic}`
2. **Summary block** — Date, Connection, Window, Author, Status
3. **Data Source** — connection name, dataset, key tables
4. **Schema Notes** — relevant tables, partitioning, key columns
5. **Queries Executed** — each query with SQL block + result summary + output file
6. **Analysis** — findings, trends, anomalies
7. **Data Quality** — row count, NULL ratio, date range, duplicates
8. **Insights & Recommendations** — insight → action pairs
9. **Limitations** — data gaps, assumptions
10. **Raw Data Files** — links to CSV outputs

## Query Documentation Rules

- Every query MUST be included verbatim in the report
- Each query has: description, SQL code block, row count, output filename
- Queries are numbered sequentially (q1, q2, ...)

## Anti-pattern

- ❌ Query not in report — non-reproducible
- ❌ SELECT * without LIMIT
- ❌ No data quality checks
- ❌ Hardcoded credentials in SQL
- ❌ Missing date range in analysis
