#!/bin/bash
# BigQuery Usage — scaffold a BQ analysis report + execute queries via aoc-connect.sh.
#
# Usage:
#  ./query.sh --connection "<name>" --query "<SQL>" [--output outputs/PATH.csv]
#  ./query.sh --connection "<name>" --schema "<dataset>"
#  ./query.sh --connection "<name>" --report --feature "<slug>" [--window "30d"]
#
# Modes:
#  --query   Execute a single query, save result as CSV
#  --schema  Explore dataset schema (tables, columns, partitions)
#  --report  Scaffold a full BQ analysis report skeleton

set -euo pipefail

CONNECTION=""
QUERY=""
SCHEMA=""
REPORT=""
FEATURE=""
WINDOW="30d"
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --connection) CONNECTION="$2"; shift 2;;
 --query) QUERY="$2"; shift 2;;
 --schema) SCHEMA="$2"; shift 2;;
 --report) REPORT="true"; shift 1;;
 --feature) FEATURE="$2"; shift 2;;
 --window) WINDOW="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$CONNECTION" ] && { echo "ERROR: --connection required (registered BQ connection name)"; exit 1; }

DATE=$(date +%Y-%m-%d)

# Mode: schema exploration
if [ -n "$SCHEMA" ]; then
 echo "=== Schema Exploration: ${SCHEMA} ==="
 echo ""
 echo "Tables:"
 aoc-connect.sh "$CONNECTION" query "SELECT table_name, row_count, size_bytes FROM \`${SCHEMA}.INFORMATION_SCHEMA.TABLE_STORAGE\` ORDER BY row_count DESC LIMIT 50" 2>/dev/null || echo "WARNING: Schema query failed — check connection"
 exit 0
fi

# Mode: single query
if [ -n "$QUERY" ]; then
 [ -z "$OUTPUT" ] && OUTPUT="outputs/data/${DATE}-bq-result.csv"
 mkdir -p "$(dirname "$OUTPUT")"
 echo "Executing BQ query via: $CONNECTION"
 echo "Query: $QUERY"
 echo "Output: $OUTPUT"
 aoc-connect.sh "$CONNECTION" query "$QUERY" > "$OUTPUT" 2>/dev/null || { echo "ERROR: Query failed"; exit 1; }
 ROWS=$(wc -l < "$OUTPUT" | tr -d ' ')
 echo "Result: $((ROWS - 1)) rows (excl header) saved to $OUTPUT"
 exit 0
fi

# Mode: report scaffold
if [ "$REPORT" = "true" ]; then
 [ -z "$FEATURE" ] && { echo "ERROR: --feature required for report mode"; exit 1; }
 SLUG=$(echo "$FEATURE" | tr ' /' '--' | tr '[:upper:]' '[:lower:]')
 [ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-bq-analysis-${SLUG}.md"
 mkdir -p "$(dirname "$OUTPUT")"
 mkdir -p "outputs/data"

 cat > "$OUTPUT" <<EOF
# BigQuery Analysis: ${FEATURE}

**Date:** ${DATE}
**Connection:** ${CONNECTION}
**Window:** ${WINDOW}
**Author:** Data Analyst (#8)
**Status:** draft — fill metric values

## Data Source

- **Connection:** \`${CONNECTION}\` (via aoc-connect.sh)
- **Dataset:** _[fill dataset name]_
- **Key Tables:** _[fill table list]_

## Schema Notes

_[fill: relevant tables, partitioning, key columns]_

## Queries Executed

### Query 1: _[description]_

\`\`\`sql
-- [fill: paste actual query here]
\`\`\`

**Result:** _[N]_ rows → \`outputs/data/${DATE}-bq-${SLUG}-q1.csv\`

### Query 2: _[description]_

\`\`\`sql
-- [fill]
\`\`\`

## Analysis

_[fill: findings, trends, anomalies]_

## Data Quality

| Check | Result |
|---|---|
| Row count | _[N]_ |
| NULL ratio (key cols) | _[%]_ |
| Date range | _[from — to]_ |
| Duplicates | _[N]_ |

## Insights & Recommendations

1. **Insight:** _[observation]_ → **Action:** _[recommendation]_
2. **Insight:** _[observation]_ → **Action:** _[recommendation]_

## Limitations

- _[data gap or assumption]_

## Raw Data Files

- \`outputs/data/${DATE}-bq-${SLUG}-q1.csv\`
EOF

 echo "Wrote report skeleton: $OUTPUT"
 echo "Next: run queries via --query mode, fill placeholders."
 exit 0
fi

echo "ERROR: specify --query, --schema, or --report mode"
echo "Run with --help for usage."
exit 1
