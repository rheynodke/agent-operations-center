#!/bin/bash
# PostgreSQL Query — execute queries via aoc-connect.sh and scaffold reports.
#
# Usage:
#  ./query.sh --connection "<name>" --query "<SQL>" [--output outputs/PATH.csv]
#  ./query.sh --connection "<name>" --schema [--table "<name>"]
#  ./query.sh --connection "<name>" --report --feature "<slug>"
#
# Modes:
#  --query   Execute a single query, save result as CSV
#  --schema  Explore schema (tables, columns, indexes)
#  --report  Scaffold a full PG analysis report skeleton

set -euo pipefail

CONNECTION=""
QUERY=""
SCHEMA=""
TABLE=""
REPORT=""
FEATURE=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --connection) CONNECTION="$2"; shift 2;;
 --query) QUERY="$2"; shift 2;;
 --schema) SCHEMA="true"; shift 1;;
 --table) TABLE="$2"; shift 2;;
 --report) REPORT="true"; shift 1;;
 --feature) FEATURE="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$CONNECTION" ] && { echo "ERROR: --connection required"; exit 1; }

DATE=$(date +%Y-%m-%d)

# Mode: schema exploration
if [ "$SCHEMA" = "true" ]; then
 echo "=== Schema Exploration: ${CONNECTION} ==="
 if [ -n "$TABLE" ]; then
   echo "Columns for: $TABLE"
   aoc-connect.sh "$CONNECTION" query "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${TABLE}' ORDER BY ordinal_position" 2>/dev/null || echo "WARNING: Query failed"
 else
   echo "Tables with row counts:"
   aoc-connect.sh "$CONNECTION" query "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 50" 2>/dev/null || echo "WARNING: Query failed"
 fi
 exit 0
fi

# Mode: single query
if [ -n "$QUERY" ]; then
 [ -z "$OUTPUT" ] && OUTPUT="outputs/data/${DATE}-pg-result.csv"
 mkdir -p "$(dirname "$OUTPUT")"
 echo "Executing PG query via: $CONNECTION"
 aoc-connect.sh "$CONNECTION" query "$QUERY" > "$OUTPUT" 2>/dev/null || { echo "ERROR: Query failed"; exit 1; }
 ROWS=$(wc -l < "$OUTPUT" | tr -d ' ')
 echo "Result: $((ROWS - 1)) rows saved to $OUTPUT"
 exit 0
fi

# Mode: report scaffold
if [ "$REPORT" = "true" ]; then
 [ -z "$FEATURE" ] && { echo "ERROR: --feature required for report mode"; exit 1; }
 SLUG=$(echo "$FEATURE" | tr ' /' '--' | tr '[:upper:]' '[:lower:]')
 [ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-pg-analysis-${SLUG}.md"
 mkdir -p "$(dirname "$OUTPUT")" "outputs/data"

 cat > "$OUTPUT" <<EOF
# PostgreSQL Analysis: ${FEATURE}

**Date:** ${DATE}
**Connection:** ${CONNECTION}
**Author:** Data Analyst (#8)
**Status:** draft

## Data Source

- **Connection:** \`${CONNECTION}\` (via aoc-connect.sh)
- **Schema:** _[public / custom]_
- **Key Tables:** _[fill]_

## Queries Executed

### Query 1: _[description]_

\`\`\`sql
-- [fill]
\`\`\`

**Result:** _[N]_ rows → \`outputs/data/${DATE}-pg-${SLUG}-q1.csv\`

## Analysis

_[fill: findings]_

## Data Quality

| Check | Result |
|---|---|
| Row count | _[N]_ |
| NULL ratio | _[%]_ |
| Date range | _[from — to]_ |

## Insights & Recommendations

1. **Insight:** _[observation]_ → **Action:** _[recommendation]_

## Raw Data Files

- \`outputs/data/${DATE}-pg-${SLUG}-q1.csv\`
EOF

 echo "Wrote: $OUTPUT"
 exit 0
fi

echo "ERROR: specify --query, --schema, or --report"
exit 1
