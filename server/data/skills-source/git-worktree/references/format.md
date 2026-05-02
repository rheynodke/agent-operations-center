# Output Format — Git Worktree

## Worktree path convention

`<repo-root>/.worktrees/{slug}`

Slug derivation:
- `feature/discount-line` → `discount-line` (drop `feature/` prefix)
- `hotfix/payment-422` → `hotfix-payment-422` (keep prefix as part of slug)
- `release/2026-04` → `release-2026-04`
- Sub-paths: `feature/sub/X` → `sub-X` (replace `/` with `-`)

## Log file

`outputs/worktrees/log.jsonl` — one event per line.

```json
{"action":"create","branch":"feature/discount-line","base":"main","path":"/path/to/repo/.worktrees/discount-line","at":"2026-05-02T10:30:00+07:00"}
{"action":"remove","branch":"feature/discount-line","base":"","path":"/path/to/repo/.worktrees/discount-line","at":"2026-05-15T14:22:00+07:00"}
```

Action values: `create | remove | prune`.

## .gitignore additions (auto)

```
# Local git worktrees (managed by git-worktree skill)
.worktrees/
```

## Edge cases

### Repo without `.gitignore`

Skill creates one. Agent should commit the new file separately (small, atomic, clear message).

### Branch already has worktree

`create` returns the existing path (idempotent), exits 0. No error. Agent inspects path and proceeds.

### Branch not in remote, exists locally

`create` reuses local branch (no `-b` flag). Worktree checked out at current HEAD of that branch.

### Worktree dir manually deleted with `rm -rf`

`git worktree list` shows ghost entry. Agent should run `./wt.sh prune` to cleanup refs.

### Worktree dir on different filesystem

Allowed but slower. Hardlinks not used cross-filesystem.

## Anti-pattern

- ❌ Worktree di location random (`/tmp/`, `~/`)
- ❌ `.worktrees/` not gitignored
- ❌ Manual `rm -rf .worktrees/X` (use `wt.sh remove`)
- ❌ Skip log entry — auditing broken
- ❌ Branch in multiple worktrees (git refuses anyway)
- ❌ Force-delete unmerged branch tanpa user confirm
- ❌ Forget cleanup after merge (worktree dir membengkak)
