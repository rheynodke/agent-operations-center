# aoc-odoo Functional Playbooks

Module-specific operational flows for Odoo via odoocli. Each playbook is the
**external memory** for one functional area — read it before running raw
odoocli commands for that area. Playbooks evolve: new pitfalls are appended
as they're discovered.

## Pre-flight standard

Run these THREE steps before any module operation, in this order:

1. `odoo-list.sh` — confirm a connection is assigned; capture `name`, `description`, `odooUrl`, `odooDb`, `odooUsername`.
2. `odoo-whoami.sh <conn>` — resolve current Odoo user. Capture `uid`, `tz`, `employee_id`.
3. Read the matching playbook in this directory — follow its scoping rule, queries, and pitfalls.

## Default scoping rule

When the user asks about "their" data implicitly (no possessive 1st-person, no
explicit subject, just "timesheet hari ini" / "task aktif" / "log jam"), the
default scope is **`user_id = current_uid`**.

Override only when the user explicitly says: "tim", "semua", "all", "everyone",
"user X", "siapa saja". When in doubt, ask once before broadening.

## Playbook structure (mandatory 8 sections)

Every playbook follows this skeleton — see `_template.md`:

1. **Scope** — models covered, modules, version notes
2. **Trigger Phrases** — Indonesian + English
3. **Pre-flight** — beyond the standard pre-flight above
4. **Default Scoping Rule** — module-specific scoping + override rules
5. **Common Queries (copy-paste)** — intent → ready-to-run command
6. **Common Pitfalls (curated, append-only)** — real failures + how to avoid
7. **Override Patterns** — broaden scope safely
8. **Advanced / Custom (escape hatch)** — discovery starter for out-of-scope intents

The 8 sections map directly to the questions the agent has during operation:
"what module? when does this apply? what to check first? default filter?
ready-made command? what mistakes to avoid? how to broaden? what if outside scope?"

## Module status

| Module | Playbook | Status |
|---|---|---|
| Project / Task / Timesheet | `project-task-timesheet.md` | Iteration 1 |
| Sales | — | Planned |
| Purchase | — | Planned |
| HR | — | Planned |
| Accounting | — | Planned |
| Manufacturing | — | Planned |
| Inventory | — | Planned |

## Adding a new playbook

1. Copy `_template.md` to `<module>.md`.
2. Fill all 8 sections.
3. Register here in the Module status table.
4. Register in `SKILL.md` "Available playbooks" table with trigger phrases.
5. Commit.
