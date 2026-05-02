#!/bin/bash
# Web Data Fetch — fetch data from APIs and scaffold analysis report.
#
# Usage:
#  ./fetch.sh --url "<URL>" [--output outputs/data/result.json]
#  ./fetch.sh --connection "<name>" --endpoint "<path>" [--output outputs/data/result.json]
#  ./fetch.sh --report --feature "<slug>"
#
# Modes:
#  --url         Fetch from public URL via curl
#  --connection  Fetch via aoc-connect.sh (registered connection)
#  --report      Scaffold a web-data analysis report skeleton

set -euo pipefail

URL=""
CONNECTION=""
ENDPOINT=""
REPORT=""
FEATURE=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --url) URL="$2"; shift 2;;
 --connection) CONNECTION="$2"; shift 2;;
 --endpoint) ENDPOINT="$2"; shift 2;;
 --report) REPORT="true"; shift 1;;
 --feature) FEATURE="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

DATE=$(date +%Y-%m-%d)

# Mode: report scaffold
if [ "$REPORT" = "true" ]; then
 [ -z "$FEATURE" ] && { echo "ERROR: --feature required for report mode"; exit 1; }
 SLUG=$(echo "$FEATURE" | tr ' /' '--' | tr '[:upper:]' '[:lower:]')
 [ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-web-data-${SLUG}.md"
 mkdir -p "$(dirname "$OUTPUT")" "outputs/data"

 cat > "$OUTPUT" <<EOF
# Web Data Fetch: ${FEATURE}

**Date:** ${DATE}
**Author:** Data Analyst (#8)
**Status:** draft

## Sources

| # | Source | Type | URL/Connection | Auth |
|---|---|---|---|---|
| 1 | _[name]_ | _[REST API / web page]_ | _[URL]_ | _[public / AOC registered]_ |
| 2 | _[name]_ | _[type]_ | _[URL]_ | _[auth]_ |

## Fetched Data

### Source 1: _[name]_

**Command:**
\`\`\`bash
# [fill: curl or aoc-connect.sh command]
\`\`\`

**Result:** _[N]_ records → \`outputs/data/${DATE}-web-${SLUG}-s1.json\`

**Validation:**
- Response format: _[JSON array / object / CSV]_
- Record count: _[N]_
- Key fields: _[list]_

## Transformed Data

- Normalized file: \`outputs/data/${DATE}-web-${SLUG}-normalized.csv\`

## Analysis

_[fill: findings from fetched data]_

## Insights & Recommendations

1. **Insight:** _[observation]_ → **Action:** _[recommendation]_

## Source URLs

1. _[full URL with access date]_
EOF

 echo "Wrote: $OUTPUT"
 exit 0
fi

# Mode: fetch from registered connection
if [ -n "$CONNECTION" ]; then
 [ -z "$ENDPOINT" ] && { echo "ERROR: --endpoint required with --connection"; exit 1; }
 [ -z "$OUTPUT" ] && OUTPUT="outputs/data/${DATE}-web-result.json"
 mkdir -p "$(dirname "$OUTPUT")"
 echo "Fetching via AOC connection: $CONNECTION"
 echo "Endpoint: $ENDPOINT"
 aoc-connect.sh "$CONNECTION" api "$ENDPOINT" > "$OUTPUT" 2>/dev/null || { echo "ERROR: Fetch failed"; exit 1; }
 SIZE=$(wc -c < "$OUTPUT" | tr -d ' ')
 echo "Saved: $OUTPUT (${SIZE} bytes)"
 exit 0
fi

# Mode: fetch from public URL
if [ -n "$URL" ]; then
 [ -z "$OUTPUT" ] && OUTPUT="outputs/data/${DATE}-web-result.json"
 mkdir -p "$(dirname "$OUTPUT")"
 echo "Fetching: $URL"
 curl -sf "$URL" -o "$OUTPUT" 2>/dev/null || { echo "ERROR: Fetch failed"; exit 1; }
 SIZE=$(wc -c < "$OUTPUT" | tr -d ' ')
 echo "Saved: $OUTPUT (${SIZE} bytes)"
 # Auto-detect format
 if head -c 1 "$OUTPUT" | grep -q '[{\[]'; then
   RECORDS=$(python3 -c "
import json
with open('$OUTPUT') as f:
    d = json.load(f)
if isinstance(d, list): print(len(d))
elif isinstance(d, dict) and 'data' in d: print(len(d['data']))
else: print('1 object')
" 2>/dev/null || echo "unknown")
   echo "Format: JSON, Records: $RECORDS"
 fi
 exit 0
fi

echo "ERROR: specify --url, --connection, or --report"
exit 1
