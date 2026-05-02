# Output Format — Rebase Strategy

## Bundle structure

```
outputs/rebase/{date}-{branch}/
├── plan.md              # pre + post rebase narrative
├── before.log           # git log --oneline before
├── after.log            # git log --oneline after
└── conflicts/           # if conflicts encountered, resolution notes
    └── {file-path}.notes
```

## plan.md required sections

1. Header: branch, base, mode (autosquash/manual), backup tag, commit counts
2. Before (current history) — `git log --oneline base..HEAD` block
3. Rescue command — `git reset --hard <backup-tag>`
4. Execution summary
5. After (rebased history) — `git log --oneline base..HEAD` block
6. Status: commits before/after, tests pass/skipped, backup tag
7. Next steps — force-push command if applicable

## Backup tag format

`backup/{YYYYMMDD-HHMMSS}-{branch-slug}`

Examples:
- `backup/20260502-103045-feature-discount-line`
- `backup/20260502-141200-hotfix-payment-422`

Tags persist until manually deleted (`git tag -d <tag>`). Recommend cleanup setelah merge confirmed.

## Conflict resolution notes

Per conflicted file, capture di `conflicts/{file-path-with-slashes-replaced}.notes`:

```markdown
# Conflict: models/discount_line.py

**Location:** rebase commit 7c2e9d4 (`[add][dke_discount] add discount_line model`)

## Conflict description

- Local (current branch): added `amount` computed field with @api.depends
- Remote (main, since branched): same field but as Stored field

## Resolution

Keep computed @api.depends version (matches FSD §2). Mark as `store=True` to preserve performance benefit from main.

## Verification

- [ ] No conflict markers remaining
- [ ] Lint pass (`pylint models/discount_line.py`)
- [ ] Test pass for this model

## Approved by

- Agent: 2026-05-02 10:32
```

## Force-push convention (strict)

| Command | When |
|---|---|
| `git push --force-with-lease` | ✅ Default — checks remote unchanged since fetch |
| `git push --force-with-lease=ref:expected-sha` | ✅ Stricter — explicit expected sha |
| `git push --force` | ❌ NEVER — silently overwrites teammates |
| `git push --force --no-verify` | ❌ NEVER |

## Anti-pattern

- ❌ Skip backup tag
- ❌ Rebase shared branch
- ❌ `--force` without `--with-lease`
- ❌ Skip post-rebase tests
- ❌ Auto-accept conflicts blind
- ❌ Drop unique commits without confirm
- ❌ Squash + drop simultaneous (un-reviewable)
- ❌ Long-running interactive rebase (>15 min) — split into smaller rebases
