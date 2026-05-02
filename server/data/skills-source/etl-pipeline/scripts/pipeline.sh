#!/bin/bash
# ETL Pipeline — orchestrate multi-source extract, transform, load.
#
# Usage:
#  ./pipeline.sh --name "<pipeline-name>" \
#    --sources "BQ:connection:query|PG:connection:query|SHEETS:id:gid|URL:url" \
#    [--join-key "<column>"] \
#    [--output outputs/data/joined.csv]
#  ./pipeline.sh --report --name "<pipeline-name>"
#
# Modes:
#  (default)  Run extract from sources + validate
#  --report   Scaffold a pipeline log/report skeleton

set -euo pipefail

NAME=""
SOURCES=""
JOIN_KEY=""
REPORT=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --name) NAME="$2"; shift 2;;
 --sources) SOURCES="$2"; shift 2;;
 --join-key) JOIN_KEY="$2"; shift 2;;
 --report) REPORT="true"; shift 1;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$NAME" ] && { echo "ERROR: --name required"; exit 1; }

DATE=$(date +%Y-%m-%d)
SLUG=$(echo "$NAME" | tr ' /' '--' | tr '[:upper:]' '[:lower:]')

# Mode: report scaffold
if [ "$REPORT" = "true" ]; then
 [ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-etl-${SLUG}.md"
 mkdir -p "$(dirname "$OUTPUT")" "outputs/data"

 cat > "$OUTPUT" <<EOF
# ETL Pipeline: ${NAME}

**Date:** ${DATE}
**Author:** Data Analyst (#8)
**Status:** draft

## Pipeline Definition

| Field | Value |
|---|---|
| Pipeline name | ${NAME} |
| Sources | _[fill: list all sources]_ |
| Join key | ${JOIN_KEY:-_[fill or N/A]_} |
| Output | \`outputs/data/${DATE}-etl-${SLUG}-joined.csv\` |

## Stage 1: Extract

| # | Source | Type | Connection | Query/URL | Status |
|---|---|---|---|---|---|
| 1 | _[name]_ | _[BQ/PG/Sheets/Web]_ | _[connection]_ | _[query or URL]_ | ⏳ |
| 2 | _[name]_ | _[type]_ | _[connection]_ | _[query]_ | ⏳ |

### Extract Validation

| Source | Expected Rows | Actual Rows | Columns | Status |
|---|---|---|---|---|
| _[source 1]_ | _[est]_ | _[actual]_ | _[N]_ | _[✅/❌]_ |
| _[source 2]_ | _[est]_ | _[actual]_ | _[N]_ | _[✅/❌]_ |

## Stage 2: Transform

### Cleaning Steps

- [ ] Handle missing values — strategy: _[drop/fill/flag]_
- [ ] Normalize date formats — target: ISO 8601
- [ ] Remove duplicates — key: _[column(s)]_
- [ ] Type coercion — _[explicit conversions]_

### Join Operations

| Left | Right | Key | Left Rows | Right Rows | Joined | Dropped |
|---|---|---|---|---|---|---|
| _[src 1]_ | _[src 2]_ | \`${JOIN_KEY:-id}\` | _[N]_ | _[N]_ | _[N]_ | _[N]_ |

### Transform Validation

| Check | Expected | Actual | Status |
|---|---|---|---|
| Row count post-join | _[N]_ | _[N]_ | _[✅/❌]_ |
| Required columns present | _[list]_ | _[confirmed?]_ | _[✅/❌]_ |
| No data loss | _[assertion]_ | _[result]_ | _[✅/❌]_ |

## Stage 3: Load

- Output file: \`outputs/data/${DATE}-etl-${SLUG}-joined.csv\`
- Final row count: _[N]_
- File size: _[KB]_

## Pipeline Log

| Timestamp | Stage | Action | Result |
|---|---|---|---|
| _[HH:MM]_ | Extract | _[source 1 query]_ | _[N rows]_ |
| _[HH:MM]_ | Extract | _[source 2 query]_ | _[N rows]_ |
| _[HH:MM]_ | Transform | _[join on key]_ | _[N joined]_ |
| _[HH:MM]_ | Transform | _[dedup]_ | _[N removed]_ |
| _[HH:MM]_ | Load | _[save output]_ | _[N final rows]_ |

## Error Log

_[fill: any errors encountered during pipeline, or "none"]_

## Output Files

- Extract: \`outputs/data/${DATE}-etl-${SLUG}-src{N}.csv\`
- Transformed: \`outputs/data/${DATE}-etl-${SLUG}-joined.csv\`
- Pipeline log: this document
EOF

 echo "Wrote: $OUTPUT"
 echo "Next: execute each extract stage, fill validation tables, run transforms."
 exit 0
fi

# Mode: extract run
[ -z "$SOURCES" ] && { echo "ERROR: --sources required for extract mode"; exit 1; }

mkdir -p "outputs/data"

echo "=== ETL Pipeline: ${NAME} ==="
echo "Date: $DATE"
echo ""

# Parse sources and extract
IFS='|' read -ra SRC_ARR <<< "$SOURCES"
i=1
for src in "${SRC_ARR[@]}"; do
 IFS=':' read -ra PARTS <<< "$src"
 TYPE="${PARTS[0]}"
 CONN="${PARTS[1]:-}"
 DETAIL="${PARTS[2]:-}"
 OUTFILE="outputs/data/${DATE}-etl-${SLUG}-src${i}.csv"

 echo "--- Source ${i}: ${TYPE} ---"

 case "$TYPE" in
  BQ|bigquery)
   echo "Extracting from BigQuery: $CONN"
   aoc-connect.sh "$CONN" query "$DETAIL" > "$OUTFILE" 2>/dev/null || echo "ERROR: BQ extract failed"
   ;;
  PG|postgres)
   echo "Extracting from PostgreSQL: $CONN"
   aoc-connect.sh "$CONN" query "$DETAIL" > "$OUTFILE" 2>/dev/null || echo "ERROR: PG extract failed"
   ;;
  SHEETS|sheets)
   echo "Extracting from Google Sheets: $CONN (GID: $DETAIL)"
   curl -sL "https://docs.google.com/spreadsheets/d/${CONN}/export?format=csv&gid=${DETAIL}" > "$OUTFILE" 2>/dev/null || echo "ERROR: Sheets export failed"
   ;;
  URL|url)
   echo "Fetching from URL: $CONN"
   curl -sf "$CONN" > "$OUTFILE" 2>/dev/null || echo "ERROR: URL fetch failed"
   ;;
  *)
   echo "Unknown source type: $TYPE (expected BQ|PG|SHEETS|URL)"
   ;;
 esac

 if [ -f "$OUTFILE" ]; then
  ROWS=$(wc -l < "$OUTFILE" | tr -d ' ')
  echo "Saved: $OUTFILE ($((ROWS - 1)) data rows)"
 fi
 echo ""
 i=$((i+1))
done

echo "=== Extract complete. Run --report to scaffold pipeline documentation. ==="
