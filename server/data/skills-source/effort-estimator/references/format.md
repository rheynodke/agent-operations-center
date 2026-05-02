# Output Format — Effort Estimate

## Filename

`outputs/YYYY-MM-DD-effort-{feature-slug}.md`

## Required sections (in order)

1. **H1** — `# Effort Estimate: {Feature}`
2. **Header** — Date, Status, FSD link, Team capacity formula
3. **Component Breakdown** — table with Best / Likely / Worst / PERT / Rationale per component
4. **Non-coding Buffer** — show buffer addition (default 30%)
5. **Calendar Timeline** — convert person-weeks → calendar weeks
6. **External Dependencies** — separate table (NOT in person-time)
7. **Risk Notes** — bullet list of estimate-blowing risks
8. **Confidence** — High / Medium / Low checkbox
9. **Sign-off** — EM + PM
10. **Next Step** — checklist

## PERT formula (mandatory)

`PERT = (best + 4 × likely + worst) / 6`

Per component AND total. Always between best and worst.

## P75 commitment (recommended)

```
std_dev = (worst - best) / 6
P75 = mean + 0.674 × std_dev
```

Commit this number to stakeholder, NOT mean or best case.

## Velocity formula

```
team_capacity (person-weeks/calendar-week) = N_swe × focus_factor
```

Default focus_factor:
- 0.5 — interrupt-heavy team
- 0.6 — typical (default)
- 0.7 — focused team, minimal interrupts

## Buffer rule

Default 30% non-coding tax on coding estimates. Adjust:
- 20% — solo SWE on familiar codebase
- 30% — typical (default)
- 40-50% — new team / cross-team coordination

## Confidence flag

Mandatory:
- **High** — FSD complete, team familiar, historical anchor available
- **Medium** — FSD draft, some unknowns
- **Low** — Only PRD, scope soft, novel tech

Low confidence = flag in summary; consider spike before committing.

## Anti-pattern

- ❌ Single-number estimate — always 3-point + PERT
- ❌ Total tanpa per-component breakdown
- ❌ Skip buffer — code review/testing always under-estimated
- ❌ Velocity formula not declared
- ❌ Dependencies counted in person-time
- ❌ Estimate > 8 weeks single block — split jadi milestones
- ❌ Confidence Low tanpa flag in summary atau spike recommendation
