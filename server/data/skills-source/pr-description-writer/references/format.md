# Output Format — PR Description

## Required sections (in order)

1. **Summary** — 1-2 sentences plain language
2. **Motivation** — why + linked FSD/PRD/issue
3. **Scope** — Added / Modified / Removed sub-sections
4. **Out of scope** — deferred items (or "none")
5. **Implementation notes** — technical approach + key decisions
6. **Database / Schema changes** — checkbox + migration paths if any
7. **Breaking changes** — None or detailed list
8. **Test plan** — Automated + Manual sub-sections, all checkboxes
9. **Screenshots / Screencast** — REQUIRED for UI changes
10. **Deployment notes** — feature flag + sequence + rollback + monitoring
11. **Reviewer checklist** — code/test/security/a11y/perf

Plus appended diagnostics:
- Commits list
- Diff stat

## PR Title Format

```
{type}: {description} (FSD: YYYY-MM-DD)
```

Types: `feat | fix | refactor | test | chore | docs | style | perf | ci`

## Issue keywords

- `Closes #N` — auto-closes issue on merge
- `Fixes #N` — same
- `Refs #N` — references without auto-close

## Anti-pattern

- ❌ "See code" / "self-explanatory"
- ❌ Test plan empty
- ❌ Breaking change in body, no dedicated section
- ❌ UI change tanpa screenshot
- ❌ Migration tanpa reversibility flag
- ❌ Big PR (>500 LoC) tanpa "Why so big?" justification
- ❌ Generic title
- ❌ Missing FSD/PRD/issue link
- ❌ `_[fill]_` placeholders left in submitted PR
