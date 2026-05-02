# Output Format — FSD

## Filename

`outputs/YYYY-MM-DD-fsd-{feature-slug}.md`

## Required header (YAML)

```yaml
mode: odoo | frontend
target-version: <e.g. odoo-17, react-18, vue-3>
ship-as: module | feature | page | component
```

Plus regular metadata: Date, Status, PRD link, Feasibility Brief link.

## Required sections (in order)

1. Header (YAML + metadata)
2. **§1 Architecture Overview** — narrative + dot diagram
3. **§2 Data Model** — Odoo models OR DB tables OR state shape
4. **§3 API Contracts** — `api-contract` skill output (embedded or linked)
5. **§4 Views / Components** — XML (Odoo) OR component tree (frontend)
6. **§5 Security & Permissions** — access CSV (Odoo) OR auth requirements (frontend)
7. **§6 Error Handling Matrix** — table
8. **§7 Observability Hooks** — table
9. **§8 Rollout Plan** — phases table with rollback condition per phase
10. **§9 Story → Implementation Mapping** — exhaustive table (every PRD story → FSD section)
11. **Sign-off** — peer review + PRD owner approval
12. **Next Step** — checklist routing to SWE/QA/Doc

## Status lifecycle

- `draft` — placeholders unfilled
- `peer-reviewed` — at least 1 EM/senior SWE marked approved
- `approved` — both peer review + PRD owner sign-off → ready for SWE

## Mode-specific reference

- ODOO mode: see `references/odoo-template.md` for full XML/CSV/Python field examples
- FRONTEND mode: see `references/frontend-template.md` for component tree + state shape patterns

## Anti-pattern

- ❌ Missing mode header — SWE bingung target stack
- ❌ Free-form prose untuk API contracts — use api-contract skill
- ❌ §9 mapping incomplete — pasti ada story yang lupa di-implement
- ❌ Rollout phase tanpa rollback condition
- ❌ Status `approved` tanpa kedua sign-off check
- ❌ FSD mengubah scope dari PRD — kalau ada perubahan, PRD harus di-update dulu
