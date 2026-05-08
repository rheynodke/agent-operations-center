# <Module Name> Playbook

> Replace `<Module Name>` and fill all sections below. Do not delete section
> headings — the agent expects the 8-section structure.

## 1. Scope
- Models: `<list of Odoo models covered>`.
- Modules: `<Odoo module names that must be installed>`.
- Tested for Odoo `<versions>`. Version-specific differences are flagged in §6.

## 2. Trigger Phrases
- ID: "<phrase 1>", "<phrase 2>", ...
- EN: "<phrase 1>", "<phrase 2>", ...

## 3. Pre-flight
After the standard pre-flight (`odoo-list.sh` → `odoo-whoami.sh`), capture
module-specific values from the whoami output. Example:
- `UID=<uid>`
- `TZ=<tz>`
- `EMP_ID=<employee_id>` (may be null)

State any module-specific warnings (e.g., warn if HR not installed).

## 4. Default Scoping Rule
State the default filter (e.g., `user_id = $UID`) and exact override phrases
that broaden it. Cover edge cases: partner_id, company_id, etc.

## 5. Common Queries (copy-paste)

Each entry follows this format:

### Intent: "<user phrase>"
Brief description.

```bash
odoo.sh <conn> record search <model> --domain "[...]" --fields ...
```
**Output shape:** `<JSON shape>`
**Aggregation (if any):** `<how to summarize>`

## 6. Common Pitfalls (curated, append-only)

Each entry follows this format:

### Pitfall: <short title>
**Gejala:** <what's seen>
**Root cause:** <why>
**Cara hindari:** <explicit rule>
**Reference:** <session id, date, or upstream link — optional>

## 7. Override Patterns

| User says | Modification |
|---|---|
| "<phrase>" | <what to change in queries> |

## 8. Advanced / Custom (escape hatch)

Discovery starter for intents outside §5:

```bash
odoo.sh <conn> model list --search <keyword>
odoo.sh <conn> model fields <model> --required
odoo.sh <conn> model fields <model> --type many2one
```

Key models / fields used in this module:
- `<model 1>` — important fields: <list>
- `<model 2>` — important fields: <list>
