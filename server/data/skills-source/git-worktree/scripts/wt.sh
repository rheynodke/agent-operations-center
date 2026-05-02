#!/bin/bash
# Git Worktree Manager — create / list / switch / remove / prune worktrees.
#
# Usage:
#   ./wt.sh create  --branch BRANCH [--base BASE]
#   ./wt.sh list
#   ./wt.sh switch  --branch BRANCH
#   ./wt.sh remove  --branch BRANCH [--delete-branch] [--force]
#   ./wt.sh prune
#
# Convention: worktrees co-located at <repo-root>/.worktrees/{branch-slug}

set -euo pipefail

CMD="${1:-}"
[ -z "$CMD" ] && { grep '^#' "$0" | sed 's/^# \?//'; exit 1; }
shift || true

BRANCH=""
BASE="main"
DELETE_BRANCH=false
FORCE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --branch)        BRANCH="$2"; shift 2;;
    --base)          BASE="$2"; shift 2;;
    --delete-branch) DELETE_BRANCH=true; shift;;
    --force)         FORCE=true; shift;;
    -h|--help)       grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "ERROR: not in a git repo"; exit 1; }

# Branch → slug (drop "feature/" prefix; replace "/" with "-")
slug_from_branch() {
  echo "$1" | sed 's|^feature/||' | sed 's|/|-|g'
}

ensure_gitignore() {
  if ! grep -qE '^\.worktrees/?$' "$REPO_ROOT/.gitignore" 2>/dev/null; then
    [ -f "$REPO_ROOT/.gitignore" ] || touch "$REPO_ROOT/.gitignore"
    {
      echo ""
      echo "# Local git worktrees (managed by git-worktree skill)"
      echo ".worktrees/"
    } >> "$REPO_ROOT/.gitignore"
    echo "✓ Added .worktrees/ to .gitignore (commit this change separately)"
  fi
}

log_entry() {
  mkdir -p "$REPO_ROOT/outputs/worktrees" 2>/dev/null || mkdir -p "outputs/worktrees"
  local logfile="$REPO_ROOT/outputs/worktrees/log.jsonl"
  [ -d "$REPO_ROOT/outputs/worktrees" ] || logfile="outputs/worktrees/log.jsonl"
  echo "{\"action\":\"$1\",\"branch\":\"$2\",\"base\":\"${3:-}\",\"path\":\"${4:-}\",\"at\":\"$(date -Iseconds)\"}" >> "$logfile"
}

case "$CMD" in
  create)
    [ -z "$BRANCH" ] && { echo "ERROR: --branch required"; exit 1; }

    # Validate base
    git rev-parse --verify "$BASE" >/dev/null 2>&1 || {
      echo "ERROR: base branch not found: $BASE"; exit 1;
    }

    # Check existing worktree for this branch
    EXISTING=$(git -C "$REPO_ROOT" worktree list --porcelain | awk -v b="$BRANCH" '
      /^worktree / {wt=$2}
      /^branch refs\/heads\// {
        sub("refs/heads/", "", $2)
        if ($2==b) print wt
      }
    ')
    if [ -n "$EXISTING" ]; then
      echo "Branch '$BRANCH' already has a worktree at: $EXISTING" >&2
      echo "$EXISTING"
      exit 0
    fi

    ensure_gitignore

    SLUG=$(slug_from_branch "$BRANCH")
    WT_PATH="$REPO_ROOT/.worktrees/$SLUG"
    mkdir -p "$REPO_ROOT/.worktrees"

    # Decide -b (new branch) vs reuse existing branch
    if git -C "$REPO_ROOT" rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
      git -C "$REPO_ROOT" worktree add "$WT_PATH" "$BRANCH" >/dev/null
    else
      git -C "$REPO_ROOT" worktree add "$WT_PATH" -b "$BRANCH" "$BASE" >/dev/null
    fi

    log_entry "create" "$BRANCH" "$BASE" "$WT_PATH"
    echo "$WT_PATH"
    ;;

  list)
    git -C "$REPO_ROOT" worktree list --porcelain | awk '
      /^worktree / {wt=$2}
      /^HEAD / {head=substr($2,1,7)}
      /^branch refs\/heads\// {
        sub("refs/heads/", "", $2); branch=$2
        printf "  %-40s  %-50s  (HEAD: %s)\n", branch, wt, head
      }
      /^bare/ { branch="(bare)"; printf "  %-40s  %s\n", branch, wt }
      /^detached/ { branch="(detached)"; printf "  %-40s  %s  (HEAD: %s)\n", branch, wt, head }
    '
    ;;

  switch)
    [ -z "$BRANCH" ] && { echo "ERROR: --branch required"; exit 1; }
    SLUG=$(slug_from_branch "$BRANCH")
    WT_PATH="$REPO_ROOT/.worktrees/$SLUG"
    if [ ! -d "$WT_PATH" ]; then
      # Try via git worktree list (in case path differs)
      WT_PATH=$(git -C "$REPO_ROOT" worktree list --porcelain | awk -v b="$BRANCH" '
        /^worktree / {wt=$2}
        /^branch refs\/heads\// {
          sub("refs/heads/", "", $2)
          if ($2==b) print wt
        }
      ')
    fi
    [ -z "$WT_PATH" ] && { echo "ERROR: no worktree for branch $BRANCH"; exit 1; }
    echo "$WT_PATH"
    ;;

  remove)
    [ -z "$BRANCH" ] && { echo "ERROR: --branch required"; exit 1; }
    SLUG=$(slug_from_branch "$BRANCH")
    WT_PATH="$REPO_ROOT/.worktrees/$SLUG"

    # Locate via git worktree list if convention path missing
    if [ ! -d "$WT_PATH" ]; then
      WT_PATH=$(git -C "$REPO_ROOT" worktree list --porcelain | awk -v b="$BRANCH" '
        /^worktree / {wt=$2}
        /^branch refs\/heads\// {
          sub("refs/heads/", "", $2)
          if ($2==b) print wt
        }
      ')
    fi
    [ -z "$WT_PATH" ] && { echo "ERROR: no worktree for branch $BRANCH"; exit 1; }

    # Check clean state
    if [ -d "$WT_PATH" ] && [ "$FORCE" = false ]; then
      DIRTY=$( cd "$WT_PATH" && git status --porcelain | head -1 )
      if [ -n "$DIRTY" ]; then
        echo "ERROR: worktree has uncommitted changes: $WT_PATH"
        echo "Use --force to remove anyway, or commit/stash first."
        exit 1
      fi
    fi

    git -C "$REPO_ROOT" worktree remove "$WT_PATH" $([ "$FORCE" = true ] && echo "--force" || echo "")
    log_entry "remove" "$BRANCH" "" "$WT_PATH"

    if [ "$DELETE_BRANCH" = true ]; then
      if git -C "$REPO_ROOT" branch -d "$BRANCH" 2>/dev/null; then
        echo "✓ Branch $BRANCH deleted (was merged)"
      elif [ "$FORCE" = true ]; then
        git -C "$REPO_ROOT" branch -D "$BRANCH"
        echo "⚠️  Branch $BRANCH force-deleted (was unmerged)"
      else
        echo "Branch $BRANCH not deleted (unmerged); use --force to force-delete"
      fi
    fi

    echo "✓ Worktree removed: $WT_PATH"
    ;;

  prune)
    git -C "$REPO_ROOT" worktree prune -v
    echo "✓ Pruned orphan worktree refs"
    ;;

  *)
    echo "Unknown command: $CMD"
    grep '^#' "$0" | sed 's/^# \?//'
    exit 1
    ;;
esac
