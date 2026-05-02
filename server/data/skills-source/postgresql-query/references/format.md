# Output Format — PostgreSQL Analysis Report

Strict format yang harus diikuti `query.sh --report` output.

## Filename

`outputs/YYYY-MM-DD-pg-analysis-{slug}.md`

Raw data: `outputs/data/YYYY-MM-DD-pg-{slug}-q{N}.csv`

## Required sections (in order)

1. **H1 title** — `# PostgreSQL Analysis: {Topic}`
2. **Summary block** — Date, Connection, Author, Status
3. **Data Source** — connection, schema, key tables
4. **Queries Executed** — SQL blocks with results
5. **Analysis** — findings, trends
6. **Data Quality** — row count, NULLs, date range
7. **Insights & Recommendations** — insight → action pairs
8. **Raw Data Files** — CSV output links

## Safety Rules

- Read-only by default — no UPDATE/DELETE without explicit permission
- All queries via aoc-connect.sh — no hardcoded credentials
- LIMIT on exploratory queries — no unbounded SELECTs
- Credentials NEVER in output or logs

## Anti-pattern

- ❌ UPDATE/DELETE without WHERE
- ❌ Credentials in report
- ❌ SELECT * without LIMIT
- ❌ Query not documented in report
