#!/bin/bash
# Commit Strategy — generate atomic commit plan from worktree changes.
#
# Usage:
#   ./plan.sh --worktree PATH [--fsd PATH] [--issue N] [--output PATH]
#
# Detects mode (Odoo OCA vs Conventional) and produces commit plan.
# Plan is reviewed before execution; agent or SWE performs actual commits.

set -euo pipefail

WORKTREE=""
FSD=""
ISSUE=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --worktree) WORKTREE="$2"; shift 2;;
    --fsd)      FSD="$2"; shift 2;;
    --issue)    ISSUE="$2"; shift 2;;
    --output)   OUTPUT="$2"; shift 2;;
    -h|--help)  grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$WORKTREE" ] && WORKTREE=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "ERROR: --worktree required and not in a repo"; exit 1; }
[ ! -d "$WORKTREE" ] && { echo "ERROR: worktree not found: $WORKTREE"; exit 1; }

cd "$WORKTREE"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/commits/${DATE}-${BRANCH//\//-}/plan.md"
mkdir -p "$(dirname "$OUTPUT")"

# Detect mode
MODE="conventional"
if find . -name "__manifest__.py" -not -path "*/node_modules/*" -not -path "*/.worktrees/*" | head -1 | read; then
  MODE="odoo"
fi

# Inspect changes
CHANGED_FILES=$(git status --short | awk '{print $2}')
DIFF_STAT=$(git diff --stat HEAD 2>/dev/null || git diff --stat --cached 2>/dev/null || true)

# Detect modules (Odoo only)
MODULES_TOUCHED=""
if [ "$MODE" = "odoo" ]; then
  MODULES_TOUCHED=$(echo "$CHANGED_FILES" | sed -E 's|^addons/||;s|^modules/||' | awk -F/ '$1 != "" {print $1}' | sort -u | tr '\n' ',' | sed 's/,$//')
fi

# Build plan skeleton
cat > "$OUTPUT" <<EOF
# Commit Plan: ${BRANCH}

**Mode:** ${MODE} ${MODE:+(${MODE} format detected)}
**Worktree:** ${WORKTREE}
**Branch:** ${BRANCH}
**FSD:** ${FSD:-_[fill if applicable]_}
**Issue:** ${ISSUE:+#${ISSUE}}
**Modules touched:** ${MODULES_TOUCHED:-N/A}

## Diff stat

\`\`\`
${DIFF_STAT}
\`\`\`

## Changed files

\`\`\`
${CHANGED_FILES}
\`\`\`

EOF

# Mode-specific guidance + commit template
if [ "$MODE" = "odoo" ]; then
cat >> "$OUTPUT" <<'EOF'
## Commit format (Odoo OCA)

```
[<type>][<module1>,<module2>] <short subject ≤72 chars>

<body explaining why, FSD reference, issue link>

FSD: <path> §N
Closes #N (or Refs #N)
```

Type prefixes: `[add]` `[imp]` `[ref]` `[fix]`

## Suggested commit grouping

> Agent: review changed files, group by logical unit (typically per-module + per-FSD-section).
> Each group becomes one commit. Aim for 3-7 atomic commits typical, max ~10.

### Commit 1 (proposed)

**Subject:** `[<type>][<modules>] <subject>`

**Files:**
- _[fill]_

**Body:**
```
_[fill: why this change]_

FSD: _[path]_ §_[N]_
```

### Commit 2 (proposed)

**Subject:** `[<type>][<modules>] <subject>`

**Files:**
- _[fill]_

**Body:**
```
_[fill]_
```

### (... add more as needed ...)

EOF
else
cat >> "$OUTPUT" <<'EOF'
## Commit format (Conventional Commits)

```
<type>(<scope>): <short subject ≤72 chars>

<body explaining why, FSD reference, issue link>

FSD: <path> §N
Closes #N (or Refs #N)
```

Types: `feat | fix | refactor | test | chore | docs | style | perf | ci | build`

## Suggested commit grouping

### Commit 1 (proposed)

**Subject:** `<type>(<scope>): <subject>`

**Files:**
- _[fill]_

**Body:**
```
_[fill]_

FSD: _[path]_ §_[N]_
```

### (... add more as needed ...)

EOF
fi

cat >> "$OUTPUT" <<EOF
## Execution

After plan reviewed:

\`\`\`bash
cd ${WORKTREE}

# Commit 1
git add <files>
git commit -F - <<COMMITEOF
<subject>

<body>
COMMITEOF

# Commit 2
git add <files>
git commit -F - <<COMMITEOF
<subject>

<body>
COMMITEOF

# Verify
git log --oneline -n 5
\`\`\`

## Sign-off

- [ ] SWE Self-Review — _Name, Date_
- [ ] All commits authored, history matches plan

EOF

echo "Wrote: $OUTPUT"
echo ""
echo "Mode detected: $MODE"
[ "$MODE" = "odoo" ] && echo "Modules touched: $MODULES_TOUCHED"
echo ""
echo "Next: agent reviews + fills plan, then executes commits."
