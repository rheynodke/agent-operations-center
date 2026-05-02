# Output Format — Data Analysis Report

Strict format yang harus diikuti `report.sh` output.

## Filename

`outputs/YYYY-MM-DD-report-{slug}.md`

## Required sections (in order)

1. **H1 title** — `# Data Analysis Report: {Topic}`
2. **Summary block** — Date, Analyst, Requested by, Period, Status
3. **Executive Summary** — 3-5 bullet key findings (each with number)
4. **Methodology** — data sources, processing steps, query references
5. **Data Overview** — table: total records, date range, unique entities, data quality
6. **Analysis** — subsections per dimension with tables + narrative
7. **Insights & Recommendations** — table: insight, evidence, action, owner
8. **Limitations & Caveats** — data gaps, assumptions, confidence levels
9. **Appendix** — full queries, raw data file locations
10. **Sign-off** — stakeholder review checkbox

## Quality Rules

- Every insight MUST have a supporting data point
- Every query MUST be documented in appendix
- Methodology MUST be reproducible
- Limitations MUST be explicit (not hidden)
- Executive summary MUST be actionable (not "needs investigation")

## Anti-pattern

- ❌ Insight without supporting number
- ❌ Missing methodology — non-reproducible
- ❌ No limitations section — overconfident
- ❌ Correlation presented as causation
- ❌ Recommendation = "investigate further" — be specific
- ❌ Raw data not saved — non-verifiable
