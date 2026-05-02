#!/bin/bash
# PR Description Writer — generate review-ready PR body from branch state.
#
# Usage:
#   ./build-pr.sh --branch BRANCH [--base main] [--fsd PATH] [--prd PATH] [--output PATH]

set -euo pipefail

BRANCH=""
BASE="main"
FSD=""
PRD=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2;;
    --base)   BASE="$2"; shift 2;;
    --fsd)    FSD="$2"; shift 2;;
    --prd)    PRD="$2"; shift 2;;
    --output) OUTPUT="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$BRANCH" ] && BRANCH=$(git rev-parse --abbrev-ref HEAD)
DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-pr-${BRANCH//\//-}.md"
mkdir -p "$(dirname "$OUTPUT")"

# Capture branch state
COMMITS=$(git log "${BASE}..HEAD" --pretty=format:'- %h %s' 2>/dev/null | head -30 || echo "  - _[fill: commits list]_")
DIFFSTAT=$(git diff "${BASE}...HEAD" --stat 2>/dev/null | tail -1 || echo "  _[fill]_")
ADDED_FILES=$(git diff "${BASE}...HEAD" --name-only --diff-filter=A 2>/dev/null | head -20 | sed 's/^/  - /' || echo "")
MODIFIED_FILES=$(git diff "${BASE}...HEAD" --name-only --diff-filter=M 2>/dev/null | head -20 | sed 's/^/  - /' || echo "")
DELETED_FILES=$(git diff "${BASE}...HEAD" --name-only --diff-filter=D 2>/dev/null | head -20 | sed 's/^/  - /' || echo "")

# Detect migrations
MIGRATIONS=$(git diff "${BASE}...HEAD" --name-only 2>/dev/null | grep -E "(migrations|alembic|prisma/migrations)" | head -5 | sed 's/^/  - /' || echo "")
HAS_MIGRATION=""
[ -n "$MIGRATIONS" ] && HAS_MIGRATION="yes"

# Detect UI changes (rough heuristic)
UI_CHANGED=$(git diff "${BASE}...HEAD" --name-only 2>/dev/null | grep -E '\.(tsx|vue|xml)$' | wc -l | tr -d ' ' || echo 0)

cat > "$OUTPUT" <<EOF
## Summary

> _[fill: 1-2 sentences explaining what this PR does, plain language]_

## Motivation

> _[fill: why this change is needed]_

EOF

if [ -n "$FSD" ]; then echo "- FSD: \`${FSD}\`" >> "$OUTPUT"; fi
if [ -n "$PRD" ]; then echo "- PRD: \`${PRD}\`" >> "$OUTPUT"; fi
echo "- Issue: _[Closes #N or Refs #N]_" >> "$OUTPUT"

cat >> "$OUTPUT" <<EOF

## Scope

### Added
${ADDED_FILES:-  - _[none]_}

### Modified
${MODIFIED_FILES:-  - _[none]_}

### Removed
${DELETED_FILES:-  - _[none]_}

## Out of scope (deferred)

- _[fill: deferred items, atau "none"]_

## Implementation notes

> _[fill: technical approach, key decisions, alternatives considered briefly]_

## Database / Schema changes

EOF

if [ -n "$HAS_MIGRATION" ]; then
cat >> "$OUTPUT" <<EOF
- [x] Schema change — migrations:
${MIGRATIONS}
- [ ] Reversible: _[yes/no — verify down migration exists]_
- [ ] Data backfill required: _[yes/no]_
EOF
else
cat >> "$OUTPUT" <<EOF
- [x] No schema change
EOF
fi

cat >> "$OUTPUT" <<EOF

## Breaking changes

- [x] _[choose: None | Yes — describe]_
- _[if yes: API version bump, deprecation timeline, migration steps for consumers]_

## Test plan

### Automated
- [ ] Unit tests added/updated — coverage: _[X%]_
- [ ] Integration tests added/updated
- [ ] All tests pass locally
- [ ] CI green

### Manual
- [ ] Test on staging URL: _[link]_
- [ ] Tested on devices: _[list]_
- [ ] Manual smoke test of critical paths: _[list flows]_

## Screenshots / Screencast

EOF

if [ "$UI_CHANGED" -gt 0 ]; then
cat >> "$OUTPUT" <<'EOF'
> ⚠️ UI files changed — screenshots REQUIRED before merge.

| Before | After |
|---|---|
| _[paste before screenshot]_ | _[paste after screenshot]_ |

EOF
else
cat >> "$OUTPUT" <<'EOF'
- [x] No UI changes (skip screenshots)

EOF
fi

cat >> "$OUTPUT" <<EOF
## Deployment notes

- [ ] Behind feature flag: _[flag name]_ atau _[no flag — direct rollout]_
- [ ] Sequenced deploy: _[FE/BE/migration order if applicable]_
- [ ] Rollback procedure: _[how to revert]_
- [ ] Monitoring: _[which dashboard, which alerts to watch]_

## Reviewer checklist

- [ ] Code review (logic + style)
- [ ] Test coverage adequate (≥80% on new code)
- [ ] Security review (if auth/data sensitive)
- [ ] Accessibility check (if UI)
- [ ] Performance review (if hot path)

---

### Commits ($(echo "$COMMITS" | wc -l | tr -d ' ') total)

${COMMITS}

### Diff stat

${DIFFSTAT}
EOF

echo "Wrote: $OUTPUT"
echo ""
echo "Next:"
echo "  1. Fill placeholders (_[fill]_)"
[ "$UI_CHANGED" -gt 0 ] && echo "  2. Add screenshots (UI files changed: $UI_CHANGED)"
echo "  3. Validate: no _[fill]_ remaining, all sections complete"
echo "  4. Create PR: gh pr create --body-file $OUTPUT"
