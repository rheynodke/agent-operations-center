#!/bin/bash
# Google Sheets Analysis — export sheet to CSV and scaffold analysis report.
#
# Usage:
#  ./export.sh --spreadsheet "<ID>" --gid "<GID>" [--output outputs/data/export.csv]
#  ./export.sh --spreadsheet "<ID>" --sheet "<name>" [--output outputs/data/export.csv]
#  ./export.sh --report --feature "<slug>" --spreadsheet "<ID>"
#
# Modes:
#  (default)  Export sheet to CSV
#  --report   Scaffold analysis report skeleton

set -euo pipefail

SPREADSHEET=""
GID="0"
SHEET=""
REPORT=""
FEATURE=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --spreadsheet) SPREADSHEET="$2"; shift 2;;
 --gid) GID="$2"; shift 2;;
 --sheet) SHEET="$2"; shift 2;;
 --report) REPORT="true"; shift 1;;
 --feature) FEATURE="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$SPREADSHEET" ] && { echo "ERROR: --spreadsheet required (ID from URL)"; exit 1; }

DATE=$(date +%Y-%m-%d)

# Mode: report scaffold
if [ "$REPORT" = "true" ]; then
 [ -z "$FEATURE" ] && { echo "ERROR: --feature required for report mode"; exit 1; }
 SLUG=$(echo "$FEATURE" | tr ' /' '--' | tr '[:upper:]' '[:lower:]')
 [ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-sheets-analysis-${SLUG}.md"
 mkdir -p "$(dirname "$OUTPUT")" "outputs/data"

 cat > "$OUTPUT" <<EOF
# Google Sheets Analysis: ${FEATURE}

**Date:** ${DATE}
**Author:** Data Analyst (#8)
**Spreadsheet ID:** \`${SPREADSHEET}\`
**Sheet/Tab:** ${SHEET:-_[fill tab name]_}

## Data Source

- **URL:** https://docs.google.com/spreadsheets/d/${SPREADSHEET}
- **GID:** ${GID}
- **Access:** _[public / shared / authenticated]_
- **Export file:** \`outputs/data/${DATE}-sheets-${SLUG}-raw.csv\`

## Data Quality Assessment

| Check | Result |
|---|---|
| Total rows | _[N]_ |
| Columns | _[list]_ |
| Header row | _[row 1 / other]_ |
| Missing values | _[% per column]_ |
| Mixed types | _[columns with mixed string/number]_ |
| Duplicates | _[N]_ |

## Cleaning Applied

- _[fill: what was cleaned — missing values, date format, dedup, etc.]_
- Cleaned file: \`outputs/data/${DATE}-sheets-${SLUG}-cleaned.csv\`

## Analysis

_[fill: findings, trends, patterns]_

## Insights & Recommendations

1. **Insight:** _[observation]_ → **Action:** _[recommendation]_

## Raw Data Files

- Raw: \`outputs/data/${DATE}-sheets-${SLUG}-raw.csv\`
- Cleaned: \`outputs/data/${DATE}-sheets-${SLUG}-cleaned.csv\`
EOF

 echo "Wrote: $OUTPUT"
 exit 0
fi

# Mode: export to CSV
[ -z "$OUTPUT" ] && OUTPUT="outputs/data/${DATE}-sheets-export.csv"
mkdir -p "$(dirname "$OUTPUT")"

EXPORT_URL=""
if [ -n "$SHEET" ]; then
 ENCODED_SHEET=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$SHEET'))" 2>/dev/null || echo "$SHEET")
 EXPORT_URL="https://docs.google.com/spreadsheets/d/${SPREADSHEET}/gviz/tq?tqx=out:csv&sheet=${ENCODED_SHEET}"
else
 EXPORT_URL="https://docs.google.com/spreadsheets/d/${SPREADSHEET}/export?format=csv&gid=${GID}"
fi

echo "Exporting Google Sheets to CSV..."
echo "URL: $EXPORT_URL"
echo "Output: $OUTPUT"

curl -sL "$EXPORT_URL" -o "$OUTPUT" 2>/dev/null || { echo "ERROR: Export failed — check spreadsheet access"; exit 1; }

ROWS=$(wc -l < "$OUTPUT" | tr -d ' ')
if [ "$ROWS" -le 1 ]; then
 echo "WARNING: Export returned $ROWS rows — check if spreadsheet is accessible"
else
 echo "Exported: $((ROWS - 1)) data rows (+ header) to $OUTPUT"

 # Quick data quality check
 python3 -c "
import csv, sys
with open('$OUTPUT') as f:
    reader = csv.DictReader(f)
    rows = list(reader)
if not rows:
    print('WARNING: No data rows')
    sys.exit(0)
cols = list(rows[0].keys())
print(f'Columns ({len(cols)}): {cols}')
total = len(rows)
for col in cols:
    non_empty = sum(1 for r in rows if r[col] and r[col].strip())
    fill = non_empty / total * 100
    if fill < 80:
        print(f'  ⚠️  {col}: {fill:.0f}% filled ({total - non_empty} missing)')
" 2>/dev/null || true
fi
