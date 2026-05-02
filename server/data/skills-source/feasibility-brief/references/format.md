# Output Format — Feasibility Brief

## Filename

`outputs/YYYY-MM-DD-feasibility-{feature-slug}.md`

## Required sections (in order)

1. **H1** — `# Feasibility Brief: {Feature}`
2. **Header** — Date, PRD link, Status (`draft|approved|rejected`)
3. **Decision** (top) — GO | GO-conditional | SPIKE-FIRST | NO-GO + 1-line rationale
4. **Context** — 2-3 sentences
5. **Technical Approach** — 1 paragraph
6. **Constraints** — 4-row table (infra/team/timeline/dependency) with severity + source per row
7. **Complexity Assessment** — per-component table (max 6 rows)
8. **Unknown Risks** — table + spike proposals
9. **Conditions** — only if Decision = GO-conditional, numbered list
10. **Sign-off** — CTO checkbox
11. **Next Step** — checklist routing

## Decision values (strict)

Decision MUST be one of:
- `GO` — proceed to FSD without conditions
- `GO-conditional` — proceed but conditions list must be met (1-3 explicit items)
- `SPIKE-FIRST` — too many unknowns; do exploratory work, re-run brief
- `NO-GO` — hard blocker; archive with reason

Variants like "Go (with caveats)", "Probably yes", "TBD" are NOT acceptable.

## Severity values (strict)

- `high` — blocks GO outright atau forces conditional clause
- `medium` — affects effort estimate ±50%
- `low` — note only, manageable

## Complexity values (strict)

- `low` — existing pattern, copy/extend
- `medium` — known tech but new combination
- `high` — new tech, new pattern, or known-hard

## Page constraint

Brief should fit in 1-2 pages. Kalau lebih panjang, alasan biasanya scope terlalu besar — split menjadi multiple briefs atau langsung FSD.

## Anti-pattern

- ❌ Decision = "Maybe" or "Looks feasible" — strict 4 values only
- ❌ Constraint row tanpa Source — gak verifiable
- ❌ Complexity "medium" tanpa rationale
- ❌ Status `approved` tanpa CTO checkbox checked
- ❌ Brief > 3 pages — too detailed, escalate to FSD
