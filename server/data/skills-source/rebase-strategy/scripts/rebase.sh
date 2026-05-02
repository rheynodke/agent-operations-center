#!/bin/bash
# Rebase Strategy — pre-flight + execute rebase with safety nets.
#
# Usage:
#   ./rebase.sh --mode autosquash|manual [--base origin/main] [--worktree PATH] [--skip-tests]

set -euo pipefail

MODE="autosquash"
BASE="origin/main"
WORKTREE=""
SKIP_TESTS=false

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)       MODE="$2"; shift 2;;
    --base)       BASE="$2"; shift 2;;
    --worktree)   WORKTREE="$2"; shift 2;;
    --skip-tests) SKIP_TESTS=true; shift;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if [ -z "$WORKTREE" ]; then
  WORKTREE=$(pwd)
fi
cd "$WORKTREE"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
DATE=$(date +%Y-%m-%d)
LOG_DIR="outputs/rebase/${DATE}-${BRANCH//\//-}"
mkdir -p "$LOG_DIR"

echo "─────────────────────────────────────────────"
echo "Rebase Strategy"
echo "─────────────────────────────────────────────"
echo "Worktree: $WORKTREE"
echo "Branch:   $BRANCH"
echo "Base:     $BASE"
echo "Mode:     $MODE"
echo "Log dir:  $LOG_DIR"
echo "─────────────────────────────────────────────"

# 1. Verify worktree clean
DIRTY=$(git status --porcelain | head -1)
if [ -n "$DIRTY" ]; then
  echo "ERROR: uncommitted changes; commit or stash first."
  git status --short
  exit 1
fi

# 2. Verify not protected branch
case "$BRANCH" in
  main|master|develop|release/*|hotfix/release-*)
    echo "ERROR: refuse to rebase protected branch: $BRANCH"
    exit 1
    ;;
esac

# 3. Fetch latest base
git fetch origin 2>/dev/null || true

# 4. Check if branch was pushed; if so, ensure no remote-only commits
LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
if [ -n "$REMOTE_HEAD" ] && [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  AHEAD_REMOTE=$(git rev-list --count "$LOCAL_HEAD".."$REMOTE_HEAD" 2>/dev/null || echo 0)
  if [ "$AHEAD_REMOTE" -gt 0 ]; then
    echo "⚠️  Remote has $AHEAD_REMOTE commits not in local. Pull/merge first to avoid losing them."
    exit 1
  fi
fi

# 5. Backup tag
TAG="backup/$(date +%Y%m%d-%H%M%S)-${BRANCH//\//-}"
git tag "$TAG"
echo "✓ Backup tag: $TAG"
echo "  Rescue: git reset --hard $TAG"

# 6. Capture before log
git log --oneline "${BASE}..HEAD" > "$LOG_DIR/before.log" || true
COMMIT_COUNT=$(wc -l < "$LOG_DIR/before.log" | tr -d ' ')
echo "✓ Before: $COMMIT_COUNT commits ahead of $BASE"
echo ""

# Plan document
cat > "$LOG_DIR/plan.md" <<EOF
# Rebase Plan: ${BRANCH}

**Date:** ${DATE}
**Worktree:** ${WORKTREE}
**Base:** ${BASE}
**Mode:** ${MODE}
**Backup tag:** ${TAG}
**Commits before:** ${COMMIT_COUNT}

## Before (current history)

\`\`\`
$(cat "$LOG_DIR/before.log")
\`\`\`

## Rescue command (if rebase goes wrong)

\`\`\`bash
git reset --hard ${TAG}
\`\`\`

## Post-rebase verification

- [ ] All expected commits preserved
- [ ] No orphan changes
- [ ] Tests pass
- [ ] Force-push (if previously pushed): \`git push --force-with-lease\`
EOF

echo "Plan: $LOG_DIR/plan.md"
echo ""

# 7. Execute rebase
case "$MODE" in
  autosquash)
    echo "→ Running: git rebase -i --autosquash $BASE"
    echo ""
    git rebase -i --autosquash "$BASE" || REBASE_FAIL=1
    ;;
  manual)
    echo "→ Running: git rebase -i $BASE"
    echo ""
    git rebase -i "$BASE" || REBASE_FAIL=1
    ;;
  *)
    echo "ERROR: unknown mode: $MODE"
    exit 1
    ;;
esac

# 8. Handle conflict (if any)
if [ -n "${REBASE_FAIL:-}" ]; then
  echo ""
  echo "⚠️  Rebase paused (likely conflict)."
  echo ""
  git status --short
  echo ""
  echo "To resolve:"
  echo "  1. Edit conflicted files, remove <<<<<<< / ======= / >>>>>>> markers"
  echo "  2. Verify: grep -rn '<<<<<<< \|>>>>>>> \|^=======' --include='*.py' --include='*.ts' --include='*.tsx' --include='*.vue' --include='*.xml'"
  echo "  3. Stage: git add <files>"
  echo "  4. Continue: git rebase --continue"
  echo ""
  echo "To abort:"
  echo "  git rebase --abort"
  echo "  (or rescue: git reset --hard $TAG)"
  echo ""
  echo "After resolving, re-run this script with --skip-tests to verify."
  exit 2
fi

# 9. Capture after log
git log --oneline "${BASE}..HEAD" > "$LOG_DIR/after.log"
NEW_COUNT=$(wc -l < "$LOG_DIR/after.log" | tr -d ' ')
echo ""
echo "✓ Rebase complete"
echo "  Commits before: $COMMIT_COUNT"
echo "  Commits after:  $NEW_COUNT"
echo ""

# 10. Tests
if [ "$SKIP_TESTS" = false ]; then
  echo "→ Running tests (auto-detect command)..."
  if [ -f "package.json" ] && grep -q "\"test\"" package.json; then
    npm test || { echo "⚠️  Tests failed post-rebase. Inspect or rescue: git reset --hard $TAG"; exit 3; }
  elif [ -f "pyproject.toml" ] && command -v pytest &>/dev/null; then
    pytest || { echo "⚠️  Tests failed post-rebase."; exit 3; }
  else
    echo "  (No test runner detected; agent must run tests manually)"
  fi
fi

# Update plan with after state
cat >> "$LOG_DIR/plan.md" <<EOF

## After (rebased history)

\`\`\`
$(cat "$LOG_DIR/after.log")
\`\`\`

## Status

- Commits: ${COMMIT_COUNT} → ${NEW_COUNT}
- Tests: $([ "$SKIP_TESTS" = true ] && echo "skipped" || echo "passed")
- Backup tag: ${TAG}

## Next

- [ ] Force-push (if previously pushed): \`git push --force-with-lease origin ${BRANCH}\`
- [ ] Create / update PR
EOF

echo "✓ Done. Plan: $LOG_DIR/plan.md"
echo ""
echo "Force-push (if needed):"
echo "  git push --force-with-lease origin $BRANCH"
