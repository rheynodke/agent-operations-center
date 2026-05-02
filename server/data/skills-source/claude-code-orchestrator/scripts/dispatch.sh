#!/bin/bash
# Claude Code Orchestrator — invoke claude CLI in worktree with structured task.
#
# Usage:
#   ./dispatch.sh --worktree PATH --fsd PATH --feature SLUG \
#                 --mode implement|refactor|fix|write-tests|update-docs \
#                 [--targets "path1,path2"] [--sections "§2,§4"] \
#                 [--max-iterations 3]

set -euo pipefail

WORKTREE=""
FSD=""
FEATURE=""
MODE="implement"
TARGETS=""
SECTIONS=""
MAX_ITER=3

while [ $# -gt 0 ]; do
  case "$1" in
    --worktree)        WORKTREE="$2"; shift 2;;
    --fsd)             FSD="$2"; shift 2;;
    --feature)         FEATURE="$2"; shift 2;;
    --mode)            MODE="$2"; shift 2;;
    --targets)         TARGETS="$2"; shift 2;;
    --sections)        SECTIONS="$2"; shift 2;;
    --max-iterations)  MAX_ITER="$2"; shift 2;;
    -h|--help)         grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$WORKTREE" ] && { echo "ERROR: --worktree required"; exit 1; }
[ -z "$FSD" ] && { echo "ERROR: --fsd required"; exit 1; }
[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }
[ ! -d "$WORKTREE" ] && { echo "ERROR: worktree not found: $WORKTREE"; exit 1; }
[ ! -f "$FSD" ] && { echo "ERROR: FSD not found: $FSD"; exit 1; }

CLAUDE_BIN="${CLAUDE_BIN:-/opt/homebrew/bin/claude}"
[ ! -x "$CLAUDE_BIN" ] && { echo "ERROR: claude CLI not found at $CLAUDE_BIN"; exit 1; }

DATE=$(date +%Y-%m-%d)
LOG_DIR="outputs/codework/${DATE}-${FEATURE}"
mkdir -p "$LOG_DIR"

echo "─────────────────────────────────────────────"
echo "Claude Code Orchestrator"
echo "─────────────────────────────────────────────"
echo "Feature:   $FEATURE"
echo "Worktree:  $WORKTREE"
echo "FSD:       $FSD"
echo "Mode:      $MODE"
echo "Sections:  ${SECTIONS:-all relevant}"
echo "Targets:   ${TARGETS:-(claude decides)}"
echo "Max iter:  $MAX_ITER"
echo "Log dir:   $LOG_DIR"
echo "Claude:    $CLAUDE_BIN"
echo "─────────────────────────────────────────────"

# Build base prompt
build_prompt() {
  local run_num=$1
  local refinement_note=$2

  cat <<PROMPT
You are working in $WORKTREE. Your task: implement code per the spec below.

## Task
- Mode: $MODE
- Feature: $FEATURE
- FSD: $FSD
- FSD Section(s): ${SECTIONS:-all sections}
- Target files: ${TARGETS:-(decide based on FSD § file mapping)}

## Your responsibilities
1. Read the FSD at $FSD carefully — especially the YAML header and Story → Implementation Mapping table.
2. Implement only what's specified in the listed FSD sections.
3. Follow existing repo conventions — inspect 2-3 existing files for style before writing.
4. Each new file must have a header comment citing FSD §: e.g. \`# Implements FSD §2 (Data Model)\`
5. Run quality gates before declaring done:
   - Lint
   - Type check
   - Tests (run any existing tests; do not break them)
6. Do NOT commit. Leave changes in working tree for SWE review.

## On ambiguity
If the spec is unclear, STOP and write your question to:
\`$LOG_DIR/question-${run_num}.md\`
Do not guess business logic.

## Quality gates (you MUST run)
After writing files, run:
\`\`\`
# Auto-detect from project, e.g.:
# Odoo: pylint --rcfile=.pylintrc-odoo {module}/
# React: eslint . && tsc --noEmit
# FastAPI: ruff check . && mypy .
\`\`\`
Report results in your final summary.

${refinement_note}

Begin now.
PROMPT
}

# Refinement note from previous run (if any)
build_refinement() {
  local run_num=$1
  local prev_log="$LOG_DIR/run-$((run_num - 1)).log"
  if [ ! -f "$prev_log" ]; then
    echo ""
    return
  fi
  cat <<EOF

## Previous attempt failed quality gates
The following errors were captured in run-$((run_num - 1)):

\`\`\`
$(tail -50 "$prev_log")
\`\`\`

Address these specific failures. Do not introduce new files unless necessary; focus on fixing existing changes.
EOF
}

RUN=1
FINAL_STATUS="pending"

while [ "$RUN" -le "$MAX_ITER" ]; do
  echo ""
  echo "─── Run $RUN/$MAX_ITER ─────────────────────────"

  REFINEMENT=""
  [ "$RUN" -gt 1 ] && REFINEMENT="$(build_refinement "$RUN")"
  PROMPT=$(build_prompt "$RUN" "$REFINEMENT")

  echo "$PROMPT" > "$LOG_DIR/prompt-${RUN}.md"

  # Invoke claude (capture stdout + stderr to log)
  set +e
  echo "$PROMPT" | "$CLAUDE_BIN" --print --dangerously-skip-permissions \
    > "$LOG_DIR/run-${RUN}.log" 2>&1
  CLAUDE_EXIT=$?
  set -e

  echo "Claude exit: $CLAUDE_EXIT"

  # Check if claude wrote a question (couldn't proceed)
  if [ -f "$LOG_DIR/question-${RUN}.md" ]; then
    echo "⚠️  Claude wrote a question — escalation needed:"
    cat "$LOG_DIR/question-${RUN}.md"
    FINAL_STATUS="needs-clarification"
    break
  fi

  # Capture diff
  ( cd "$WORKTREE" && git status --short ) > "$LOG_DIR/changes-${RUN}.txt"
  ( cd "$WORKTREE" && git diff ) > "$LOG_DIR/diff-${RUN}.patch"

  # Quality gates would run here — placeholder for now
  # In real workflow: run lint, type check, tests; capture exit codes
  # For this MVP scaffold: agent must inspect log + diff + decide
  echo "  → log:    $LOG_DIR/run-${RUN}.log"
  echo "  → diff:   $LOG_DIR/diff-${RUN}.patch"
  echo "  → status: $LOG_DIR/changes-${RUN}.txt"
  echo ""
  echo "  Inspect logs + run quality gates manually, OR re-dispatch with refined prompt."
  echo "  This script provides the dispatch loop scaffold; gate validation happens in the orchestrator agent."

  # MVP: treat first successful claude exit as preliminary pass
  # Real flow: agent inspects, decides, may iterate
  if [ $CLAUDE_EXIT -eq 0 ]; then
    FINAL_STATUS="claude-completed"
    break
  fi

  RUN=$((RUN + 1))
done

if [ "$FINAL_STATUS" = "pending" ] && [ "$RUN" -gt "$MAX_ITER" ]; then
  FINAL_STATUS="iteration-exhausted"
fi

# Manifest
cat > "$LOG_DIR/manifest.json" <<EOF
{
  "feature": "$FEATURE",
  "fsd": "$FSD",
  "worktree": "$WORKTREE",
  "mode": "$MODE",
  "sections": "${SECTIONS:-(all)}",
  "targets": "${TARGETS:-(claude decided)}",
  "iterations": $RUN,
  "max_iterations": $MAX_ITER,
  "final_status": "$FINAL_STATUS",
  "ready_for_commit": $([ "$FINAL_STATUS" = "claude-completed" ] && echo "true" || echo "false"),
  "claude_bin": "$CLAUDE_BIN",
  "timestamp": "$(date -Iseconds)"
}
EOF

echo ""
echo "─────────────────────────────────────────────"
echo "Final status: $FINAL_STATUS"
echo "Manifest:     $LOG_DIR/manifest.json"
echo "─────────────────────────────────────────────"

case "$FINAL_STATUS" in
  claude-completed)
    echo "Next: agent runs quality gates → if pass, hand off to commit-strategy"
    ;;
  needs-clarification)
    echo "Next: escalate to EM with question file"
    ;;
  iteration-exhausted)
    echo "Next: escalate to EM (3x iteration failed — likely FSD spec gap)"
    ;;
esac
