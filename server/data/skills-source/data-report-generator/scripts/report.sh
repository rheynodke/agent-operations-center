#!/bin/bash
# Data Report Generator — scaffold a comprehensive analysis report.
#
# Usage:
#  ./report.sh --topic "<topic>" --requestor "<stakeholder>" \
#    [--sources "BQ|PG|Sheets|Web"] [--period "last 30 days"] \
#    [--output outputs/PATH.md]
#
# Generates a structured report skeleton following the standard template.

set -euo pipefail

TOPIC=""
REQUESTOR=""
SOURCES=""
PERIOD=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --topic) TOPIC="$2"; shift 2;;
 --requestor) REQUESTOR="$2"; shift 2;;
 --sources) SOURCES="$2"; shift 2;;
 --period) PERIOD="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$TOPIC" ] && { echo "ERROR: --topic required"; exit 1; }
[ -z "$REQUESTOR" ] && REQUESTOR="_[fill requestor]_"
[ -z "$PERIOD" ] && PERIOD="_[fill period]_"

DATE=$(date +%Y-%m-%d)
SLUG=$(echo "$TOPIC" | tr ' /' '--' | tr '[:upper:]' '[:lower:]' | head -c 50)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-report-${SLUG}.md"
mkdir -p "$(dirname "$OUTPUT")"

# Parse sources
SOURCE_LIST=""
if [ -n "$SOURCES" ]; then
 IFS='|' read -ra SRC_ARR <<< "$SOURCES"
 for s in "${SRC_ARR[@]}"; do
  SOURCE_LIST="${SOURCE_LIST}- ${s}: _[connection name, query/export details]_
"
 done
else
 SOURCE_LIST="- _[fill: data source + connection details]_
"
fi

cat > "$OUTPUT" <<EOF
# Data Analysis Report: ${TOPIC}

**Date:** ${DATE}
**Analyst:** Data Analyst (#8)
**Requested by:** ${REQUESTOR}
**Period:** ${PERIOD}
**Status:** draft

## Executive Summary

> 1. _[key finding with number]_
> 2. _[key finding with number]_
> 3. _[key finding with number]_

## Methodology

**Data Sources:**
${SOURCE_LIST}

**Processing:**
- _[fill: how data was extracted, cleaned, transformed]_

**Queries/Commands:** see Appendix

## Data Overview

| Metric | Value |
|--------|-------|
| Total Records | _[N]_ |
| Date Range | _[from — to]_ |
| Unique Entities | _[N]_ |
| Data Quality | _[% complete]_ |

## Analysis

### _[Dimension 1]_

| _[metric]_ | _[value]_ | _[comparison]_ |
|---|---|---|
| _[fill]_ | _[fill]_ | _[fill]_ |

_[Fill: narrative interpretation]_

### _[Dimension 2]_

_[fill: tables, comparisons, trends]_

## Insights & Recommendations

| # | Insight | Evidence | Action | Owner |
|---|---|---|---|---|
| 1 | _[observation]_ | _[data point]_ | _[recommendation]_ | _[PM/EM/Biz]_ |
| 2 | _[observation]_ | _[data point]_ | _[recommendation]_ | _[owner]_ |
| 3 | _[observation]_ | _[data point]_ | _[recommendation]_ | _[owner]_ |

## Limitations & Caveats

- _[data gap, assumption, or caveat]_
- _[confidence level for key estimates]_

## Appendix

### Full Queries Used

\`\`\`sql
-- Query 1: [description]
-- [paste actual query]
\`\`\`

### Raw Data File Locations

- _[outputs/data/YYYY-MM-DD-*.csv]_

## Sign-off

- [ ] Stakeholder Review — _Name, Date_
EOF

echo "Wrote: $OUTPUT"
echo "Topic: $TOPIC"
echo "Requestor: $REQUESTOR"
echo ""
echo "Next: run data extraction queries, fill placeholders, export via gdocs-export.sh if needed."
