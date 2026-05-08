---
name: aoc-odoo
description: "Built-in AOC skill — full odoocli operator toolkit for any Odoo instance assigned as a connection. Covers auth, model discovery, CRUD, business methods, debugging, view inspection. PRE-FLIGHT EVERY SESSION before any Odoo call: (1) run odoo-list.sh and MATCH each connection's `description`/`name` to the user's intent — for timesheet/task/project queries pick a connection whose name or description mentions task/timesheet/project (e.g. 'My Tasks and Timesheet'); if NO assigned connection matches, STOP and ask user to assign one (do not brute-force). (2) run odoo-whoami.sh <conn> to resolve current user (uid, tz, employee_id) — NEVER guess login from chat username. (3) For module intents (timesheet, task, project, sales, HR, accounting, manufacture, inventory), READ playbooks/<module>.md FIRST — it has copy-paste commands and curated pitfalls. The only helper scripts that exist are odoo-list.sh, odoo.sh, odoo-whoami.sh — do not invent others. Use whenever the user asks about Odoo data."
type: built-in
---

# aoc-odoo — OdooCLI via AOC connections

`odoocli` is a generic CLI for any Odoo model (built-in or custom) via XML-RPC. JSON output by default. **In AOC you do NOT call `odoocli` directly** — call it through `odoo.sh`, which fetches credentials from the assigned connection at run time.

## How it works in AOC

You are assigned **odoocli-typed connections** by the user. Credentials never live on disk in your home — `odoo.sh` fetches them from the AOC backend per-invocation, writes a temporary `--config` file (mode 0600) under `$TMPDIR`, runs `odoocli`, then deletes the temp file on exit. The connection's display name (e.g. `dke-prod`) is the **profile name** you pass to `odoocli`.

### Preflight — ALWAYS check assignment first

Before any `odoo.sh` call, run:

```bash
odoo-list.sh
```

Output is a JSON array on stdout: `[{"name": "dke-prod", "type": "odoocli", "hint": "..."}, ...]`. The `name` column is what you pass to `odoo.sh`.

**If `odoo-list.sh` prints `[]`, STOP.** The agent has no odoocli connection assigned. Do **not** keep retrying — every `odoo.sh` call will fail with `CONNECTION_NOT_ASSIGNED`. Instead, reply to the user with something like:

> "Saya belum punya koneksi Odoo yang di-assign ke saya. Tolong assign sebuah koneksi bertipe `odoocli` lewat dashboard AOC → Agents → [agent ini] → Connections tab, lalu sampaikan kembali tugasnya."

Only proceed once `odoo-list.sh` returns at least one entry. Even if a user *talks* about an Odoo instance the wider AOC has access to, you can only operate on connections explicitly assigned to *this* agent.

### Calling odoocli

```bash
odoo.sh <connection-name-or-id> <odoocli-subcommand> [args...]
```

Examples:

```bash
odoo.sh dke-prod auth test
odoo.sh dke-prod record search sale.order --domain "[('state','=','draft')]" --fields name,partner_id,amount_total
odoo.sh dke-prod model fields sale.order --required
odoo.sh dke-prod method call sale.order action_confirm --ids 42
```

Everything after `<connection-name-or-id>` is forwarded verbatim to `odoocli`. **Do not pass `--profile` or `--config`** — `odoo.sh` injects both for you.

### Multi-connection comparison

If you have two odoocli connections assigned (e.g. `prod` and `staging`), call `odoo.sh prod ...` then `odoo.sh staging ...` — each call is independent.

### Rules

1. **`odoo-list.sh` first, every session.** If it returns `[]`, STOP — do not call `odoo.sh`. Ask the user to assign an odoocli connection. Repeated retries are a wasted loop.
2. **Always discover before operating** — never assume field names or model structure
3. **Always verify after writing** — read back after create/write/method call
4. **Delete requires `--confirm`** — always ask user first
5. **Destructive methods (cancel/delete/remove) require `--confirm`** — always ask user first
6. **Bulk operations (>5 records)** — confirm with user first
7. **Private methods (starting with `_`)** — automatically rejected by odoocli
8. **Never echo credentials** — the wrapper handles auth; you never see passwords / api keys
9. **`CONNECTION_NOT_ASSIGNED` error** = the connection name exists in AOC but isn't bound to *this* agent. Same response: stop, tell the user, ask them to assign it.

---

## Command Overview

```
odoo.sh <connection-name> [--profile NAME] [--table] COMMAND SUBCOMMAND [OPTIONS] [ARGS]
```

| Command  | Subcommands                             | Purpose                               |
|----------|-----------------------------------------|---------------------------------------|
| auth     | login, test, whoami, profiles, remove   | Authentication & profile management   |
| model    | list, fields, methods                   | Model discovery & introspection       |
| module   | list, info                              | Module metadata & dependencies        |
| record   | search, read, create, write, delete     | Generic CRUD on any model             |
| method   | list, call                              | Business method discovery & execution |
| debug    | inspect, trace, log, access             | Record inspection & debugging         |
| view     | list, show, search-arch, actions, reports, menus | XML/QWeb views, actions, reports & menus |

For full command options, see [references/commands.md](references/commands.md).

> Note on `auth`: `auth login` / `auth profiles` / `auth remove` operate on the local `~/.odoocli.toml` and are **not useful inside AOC** — your profile is materialized fresh from the connection on every invocation. Use `auth test` and `auth whoami` to verify a connection works.

---

## Workflows

### Discover a model

```bash
odoo.sh <conn> model list --search <keyword>                              # find the model
odoo.sh <conn> model fields <model> --required                            # mandatory fields
odoo.sh <conn> model fields <model>                                       # all fields
odoo.sh <conn> model fields <model> --type many2one,one2many,many2many    # relationships
odoo.sh <conn> model methods <model>                                      # available actions
```

Don't know the model name? See [references/models.md](references/models.md).

### Search and read data

```bash
odoo.sh <conn> record search <model> --domain "[('state','=','draft')]" --fields name,state
odoo.sh <conn> record search <model> --count
odoo.sh <conn> record read <model> <id>
odoo.sh <conn> record read <model> <id> --fields name,state,partner_id
```

For domain syntax, see [references/domain-syntax.md](references/domain-syntax.md).

### Create a record

```bash
odoo.sh <conn> model fields <model> --required                            # 1. check required
odoo.sh <conn> record search <related> --domain "[('name','ilike','x')]" --fields name --limit 10  # 2. resolve m2o
odoo.sh <conn> record create <model> --values '{"field": "value"}'        # 3. create
odoo.sh <conn> record read <model> <new_id>                               # 4. verify
```

### Update a record

```bash
odoo.sh <conn> record read <model> <id> --fields field1,field2            # 1. current state
odoo.sh <conn> record write <model> <id> --values '{"field": "new"}'      # 2. update
odoo.sh <conn> record read <model> <id> --fields field1,field2            # 3. verify
```

### Execute a business action

```bash
odoo.sh <conn> record read <model> <id> --fields state                    # 1. check state
odoo.sh <conn> debug access <model> --id <id>                             # 2. check access
odoo.sh <conn> debug inspect <model> <id> --non-empty                     # 3. check readiness
odoo.sh <conn> method call <model> <method> --ids <id>                    # 4. execute
odoo.sh <conn> record read <model> <id> --fields state                    # 5. verify
odoo.sh <conn> debug log <model> <id> --limit 5                           # 6. check errors
```

For common methods, see [references/workflows.md](references/workflows.md).

### Debug a problem record

```bash
odoo.sh <conn> debug inspect <model> <id> --resolve --non-empty           # 1. current state
odoo.sh <conn> debug access <model> --id <id>                             # 2. permissions
odoo.sh <conn> debug log <model> <id> --all                               # 3. history
odoo.sh <conn> debug trace <model> <id>                                   # 4. related records
odoo.sh <conn> model methods <model> --search action                      # 5. transitions
```

After diagnosis: explain root cause → suggest fix → get user approval → execute → verify.

### Inspect XML/QWeb views and reports

```bash
odoo.sh <conn> view list --model <model>                              # all views for a model
odoo.sh <conn> view list --model <model> --type form                 # form views only
odoo.sh <conn> view show <view_id>                                   # full view with arch preview
odoo.sh <conn> view show <view_id> --arch                            # raw XML architecture
odoo.sh <conn> view search-arch "<pattern>"                          # find pattern in any view arch
odoo.sh <conn> view search-arch "<field>" --model <model>            # scoped to one model
odoo.sh <conn> view reports --model <model>                          # report templates
odoo.sh <conn> view actions --model <model>                          # window/server/report actions
odoo.sh <conn> view menus --search "<name>" --action                 # menu → action mapping
```

Common view discovery workflows:

```bash
# Find why a button is missing from form
odoo.sh <conn> view list --model sale.order --type form
odoo.sh <conn> view show <id> --arch | grep -A5 "button_name"

# Find which views reference a custom field
odoo.sh <conn> view search-arch "x_custom_field"

# Find QWeb template for a report
odoo.sh <conn> view reports --model sale.order
odoo.sh <conn> view list --search "report_saleorder" --type qweb
odoo.sh <conn> view show <template_id> --arch

# Trace: Menu → Action → View
odoo.sh <conn> view menus --search "Sales Orders" --action
odoo.sh <conn> record read ir.actions.act_window <action_id> --fields view_id,res_model,view_mode
odoo.sh <conn> view show <view_id>
```

### Multi-account comparison

```bash
odoo.sh prod    record search sale.order --domain "[('state','=','draft')]" --count
odoo.sh staging record search sale.order --domain "[('state','=','draft')]" --count
odoo.sh prod    debug access sale.order
odoo.sh staging debug access sale.order
```

---

## Functional Playbooks

For module-specific operational flows (timesheet, sales, HR, etc.), follow
the playbook in `playbooks/<file>.md` **before** running raw odoocli commands.
Playbooks define the standard scoping rule, copy-pasteable commands, and
known pitfalls for that module.

### Pre-flight (mandatory for ANY playbook)
1. `odoo-list.sh`            → confirm a connection is assigned + grab metadata
2. `odoo-whoami.sh <conn>`   → resolve current Odoo user (uid, tz, employee_id)
3. Read the matching playbook → follow its scoping rule + commands

### Available playbooks

| Module(s) | When to load (trigger phrases) | File |
|---|---|---|
| Project / Task / Timesheet | "timesheet", "jam kerja", "log time", "task ku/saya", "project ku/saya", "tugas saya", "my tasks", "my project", "logged hours" | `playbooks/project-task-timesheet.md` |

> If a request matches a trigger phrase, you **MUST** read the playbook
> first. Do not rely on memory — playbooks evolve with new pitfalls.

For modules without a playbook yet, fall back to `references/workflows.md`
and announce to the user: "Belum ada playbook khusus untuk modul ini —
saya pakai pola umum, silakan koreksi kalau ada flow standar."

See `playbooks/README.md` for the playbook structure and how to add new ones.

---

## Error Handling

Errors return JSON to stderr: `{"error": "message", "code": "CODE"}`

| Code | What to do |
|------|------------|
| `AUTH_FAILED` | Connection credentials are wrong on the dashboard side. Ask the user to fix the connection in AOC → Connections. |
| `CONNECTION_ERROR` | URL/network issue. Run `odoo.sh <conn> auth test` to confirm. |
| `NOT_FOUND` | Verify ID/name exists |
| `ACCESS_DENIED` | `odoo.sh <conn> debug access <model>` to check rights |
| `CONFIRM_REQUIRED` | Add `--confirm` flag |
| `INVALID_DOMAIN` | See [references/domain-syntax.md](references/domain-syntax.md) |
| `ODOO_ERROR` | Read error message, check field values |
| `VALIDATION_ERROR` | Fix input format |

If `odoo.sh` itself fails (not odoocli), you'll see a `[odoo.sh]` prefix:
- `connection 'X' not found or not accessible` → run `odoo-list.sh`
- `connection type is 'website', not 'odoocli'` → connection name typo or wrong type
- `odoocli binary not found` → set `AOC_ODOOCLI_BIN=/path/to/odoocli` or `pip install odoocli`

## References

- [references/commands.md](references/commands.md) — Full command reference with all options
- [references/models.md](references/models.md) — 80+ Odoo model name mappings
- [references/workflows.md](references/workflows.md) — Business workflow methods per model
- [references/domain-syntax.md](references/domain-syntax.md) — Domain filter syntax, operators, patterns
- [references/views.md](references/views.md) — XML/QWeb view types, action types, and view inspection patterns
