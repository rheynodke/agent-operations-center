# Output Format — Web Data Fetch Report

Strict format yang harus diikuti `fetch.sh --report` output.

## Filename

`outputs/YYYY-MM-DD-web-data-{slug}.md`

Raw data: `outputs/data/YYYY-MM-DD-web-{slug}-s{N}.json`

## Required sections

1. **H1 title** — `# Web Data Fetch: {Topic}`
2. **Summary block** — Date, Author, Status
3. **Sources** — table: name, type, URL, auth type
4. **Fetched Data** — per source: command, result, validation
5. **Transformed Data** — normalized file path
6. **Analysis** — findings from fetched data
7. **Insights & Recommendations** — insight → action pairs
8. **Source URLs** — full URLs with access date

## Safety Rules

- Public APIs: respect robots.txt and rate limits
- Registered connections: always via aoc-connect.sh
- Cache locally — don't re-fetch repeatedly
- Never expose API keys in output

## Anti-pattern

- ❌ Hardcode API keys
- ❌ Fetch without caching
- ❌ Missing source URL in report
- ❌ Assume response format stable
