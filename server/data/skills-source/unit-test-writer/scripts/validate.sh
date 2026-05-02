#!/bin/bash
# Unit Test Writer (Validation-First) — scan + validate + report.
#
# Usage:
#   ./validate.sh --target PATH [--worktree PATH] [--threshold 80]
#
# This script ONLY validates and reports gaps. Actual test writing dispatched
# via claude-code-orchestrator separately.

set -euo pipefail

TARGET=""
WORKTREE=""
THRESHOLD=80

while [ $# -gt 0 ]; do
  case "$1" in
    --target)    TARGET="$2"; shift 2;;
    --worktree)  WORKTREE="$2"; shift 2;;
    --threshold) THRESHOLD="$2"; shift 2;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$TARGET" ] && { echo "ERROR: --target required"; exit 1; }
[ ! -f "$TARGET" ] && { echo "ERROR: target not found: $TARGET"; exit 1; }

if [ -z "$WORKTREE" ]; then
  WORKTREE=$(git rev-parse --show-toplevel 2>/dev/null) || WORKTREE=$(pwd)
fi

# Detect stack
STACK=""
CHECK_DIR=$(dirname "$TARGET")
while [ "$CHECK_DIR" != "/" ] && [ "$CHECK_DIR" != "." ]; do
  if [ -f "$CHECK_DIR/__manifest__.py" ]; then STACK="odoo"; break; fi
  if [ -f "$CHECK_DIR/package.json" ]; then
    if grep -q '"react"' "$CHECK_DIR/package.json"; then STACK="react"; break; fi
    if grep -q '"vue"' "$CHECK_DIR/package.json"; then STACK="vue"; break; fi
    if grep -q '"express"' "$CHECK_DIR/package.json"; then STACK="express"; break; fi
  fi
  if [ -f "$CHECK_DIR/pyproject.toml" ] && grep -q "fastapi" "$CHECK_DIR/pyproject.toml"; then STACK="fastapi"; break; fi
  CHECK_DIR=$(dirname "$CHECK_DIR")
done

[ -z "$STACK" ] && {
  case "$TARGET" in
    *.py)  STACK="python";;
    *.tsx) STACK="react";;
    *.vue) STACK="vue";;
    *.ts)  STACK="typescript";;
    *)     STACK="unknown";;
  esac
}

DATE=$(date +%Y-%m-%d)
FEATURE_SLUG=$(basename "$TARGET" | sed 's/\.[^.]*$//')
LOG_DIR="outputs/codework/${DATE}-${FEATURE_SLUG}/test-validation"
mkdir -p "$LOG_DIR"

echo "─────────────────────────────────────────────"
echo "Unit Test Writer — validation"
echo "─────────────────────────────────────────────"
echo "Target:    $TARGET"
echo "Worktree:  $WORKTREE"
echo "Stack:     $STACK"
echo "Threshold: ${THRESHOLD}%"
echo "Log dir:   $LOG_DIR"
echo "─────────────────────────────────────────────"

# Phase 1: Parse public surface
echo ""
echo "→ Phase 1: Parsing public surface..."

case "$STACK" in
  odoo|fastapi|python)
    PUBLIC_FNS=$(grep -E '^(    )?def [a-z][a-z_]*\(' "$TARGET" 2>/dev/null \
      | sed -E 's/[ \t]*def ([a-z_]+).*/\1/' \
      | head -50 || echo "")
    ;;
  react|vue|express|typescript)
    PUBLIC_FNS=$(grep -E '^export (function|const|class|default function) ' "$TARGET" 2>/dev/null \
      | sed -E 's/^export (function|const|class|default function) ([A-Za-z_][A-Za-z0-9_]*).*/\2/' \
      | head -50 || echo "")
    ;;
  *)
    PUBLIC_FNS=""
    ;;
esac

PUBLIC_COUNT=$(echo "$PUBLIC_FNS" | grep -c . || echo 0)
echo "  Public functions found: $PUBLIC_COUNT"
echo "$PUBLIC_FNS" > "$LOG_DIR/public-surface.txt"

# Phase 2: Run coverage (best-effort — agent may need to run manually if env not available)
echo ""
echo "→ Phase 2: Run coverage (per stack)..."

COVERAGE_PCT="unknown"
case "$STACK" in
  odoo)
    echo "  (Odoo coverage requires test DB — agent should run manually)"
    echo "  Suggested: coverage run --source=<module> odoo-bin --test-tags=/<module> -d test_db --stop-after-init"
    ;;
  react|vue|express)
    if [ -f "$WORKTREE/package.json" ] && command -v npx &>/dev/null; then
      ( cd "$WORKTREE" && npx vitest run --coverage --coverage.reporter=text 2>&1 || true ) \
        > "$LOG_DIR/coverage-before.txt"
      COVERAGE_PCT=$(grep -oE '[0-9.]+%' "$LOG_DIR/coverage-before.txt" | head -1 || echo "unknown")
    fi
    ;;
  fastapi|python)
    if command -v pytest &>/dev/null; then
      ( cd "$WORKTREE" && pytest --cov --cov-report=term --cov-report=term-missing 2>&1 || true ) \
        > "$LOG_DIR/coverage-before.txt"
      COVERAGE_PCT=$(grep -oE '[0-9]+%' "$LOG_DIR/coverage-before.txt" | tail -1 || echo "unknown")
    fi
    ;;
esac

echo "  Coverage: $COVERAGE_PCT"

# Phase 3: Compile gaps report
echo ""
echo "→ Phase 3: Compile gaps report..."

cat > "$LOG_DIR/summary.md" <<EOF
# Test Validation Summary

**Target:** \`${TARGET}\`
**Worktree:** \`${WORKTREE}\`
**Stack:** ${STACK}
**Coverage:** ${COVERAGE_PCT} (threshold: ${THRESHOLD}%)
**Date:** ${DATE}

## Public Surface

${PUBLIC_COUNT} public function/method:

\`\`\`
${PUBLIC_FNS}
\`\`\`

## Coverage Status

> _[Agent: inspect coverage-before.txt; identify per-function and per-branch gaps]_

\`\`\`
$([ -f "$LOG_DIR/coverage-before.txt" ] && tail -30 "$LOG_DIR/coverage-before.txt" || echo "(coverage report not generated — agent must run manually)")
\`\`\`

## Identified Gaps

> _[Agent: fill below based on coverage report]_

| Function | Gap | Suggested test cases |
|---|---|---|
| _[function name]_ | not covered | happy + edge + error |
| _[function name]_ | partial (else branch line N) | edge case for else |

## Recommendation

- [ ] If gaps exist → dispatch \`claude-code-orchestrator\` mode=write-tests
- [ ] If coverage ≥ ${THRESHOLD}% → hand off to \`commit-strategy\`
- [ ] If 3+ iterations failed → escalate to EM (untestable code → refactor)

## Dispatch Prompt Template

\`\`\`
Target file: ${TARGET}
Stack: ${STACK}
Existing tests: <agent fills test file path>

Untested public functions:
- _[fill from public surface]_

For each, write:
1. Happy path (valid input, expected output)
2. Edge case (boundary value, empty, null)
3. Error path (invalid input, expected exception)

Stack convention:
- ${STACK}: see references/format.md for naming + structure

Run after writing:
- ${STACK} test command + coverage command

Report functions covered post-test.
\`\`\`

## Sign-off

- [ ] SWE Self-Review — _Name, Date_
- [ ] Coverage threshold met
- [ ] All public functions tested
- [ ] No \`xit\`/\`skip\` tests
EOF

echo "Wrote: $LOG_DIR/summary.md"
echo ""
echo "Next:"
echo "  1. Inspect $LOG_DIR/summary.md"
echo "  2. Fill gaps section based on coverage report"
echo "  3. If gaps exist, dispatch:"
echo "     ./skills/claude-code-orchestrator/scripts/dispatch.sh \\"
echo "       --worktree $WORKTREE \\"
echo "       --feature ${FEATURE_SLUG}-tests \\"
echo "       --mode write-tests \\"
echo "       --targets <test file path>"
