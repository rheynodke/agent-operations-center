# Output Format — Google Sheets Analysis Report

Strict format yang harus diikuti `export.sh --report` output.

## Filename

`outputs/YYYY-MM-DD-sheets-analysis-{slug}.md`

Raw data: `outputs/data/YYYY-MM-DD-sheets-{slug}-raw.csv`
Cleaned: `outputs/data/YYYY-MM-DD-sheets-{slug}-cleaned.csv`

## Required sections

1. **H1 title** — `# Google Sheets Analysis: {Topic}`
2. **Summary block** — Date, Author, Spreadsheet ID, Sheet/Tab
3. **Data Source** — URL, GID, access type, export file path
4. **Data Quality Assessment** — table: rows, columns, header, missing, mixed types, dupes
5. **Cleaning Applied** — list of transforms done + cleaned file path
6. **Analysis** — findings, trends, patterns
7. **Insights & Recommendations** — insight → action pairs
8. **Raw Data Files** — raw + cleaned CSV paths

## Data Quality Checks (mandatory)

- Row count
- Column list with types
- Header row position (not always row 1)
- Missing value % per column
- Mixed type columns (string vs number)
- Duplicate row count

## Anti-pattern

- ❌ Analyze directly in Sheets — download first
- ❌ Modify source spreadsheet without permission
- ❌ Skip header verification
- ❌ Forget spreadsheet ID in report
