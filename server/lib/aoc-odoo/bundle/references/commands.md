# OdooCLI Command Reference

Complete reference for all `odoocli` commands, options, and arguments.

## Global Options

```
odoocli [--profile NAME] [--config PATH] [--table] [--version] COMMAND
```

| Option | Env var | Description |
|--------|---------|-------------|
| `--profile NAME` | `ODOOCLI_PROFILE` | Connection profile (default: "default") |
| `--config PATH` | `ODOOCLI_CONFIG` | Override config file path |
| `--table` | `ODOOCLI_TABLE=1` | ASCII table output instead of JSON |
| `--version` | — | Show version and exit |

---

## auth — Authentication & Profile Management

### auth login

Create or update a connection profile. Tests authentication before saving.

```
odoocli auth login [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--url TEXT` | Odoo instance URL (prompted if omitted) |
| `--db TEXT` | Database name (prompted if omitted) |
| `--username TEXT` | Login username/email (prompted if omitted) |
| `--password TEXT` | Password (prompted with hidden input if omitted) |
| `--api-key TEXT` | API key (takes priority over password) |
| `--profile TEXT` | Profile name to save as (default: "default") |

```bash
odoocli auth login --profile admin
odoocli auth login --profile admin --url https://odoo.example.com --db mydb --username admin@example.com --password secret
odoocli auth login --profile api_user --api-key your-api-key-here
```

### auth profiles

List all saved profiles with connection details.

```
odoocli auth profiles
```

### auth test

Test connection and authentication for a profile.

```
odoocli [--profile NAME] auth test
```

### auth whoami

Show current authenticated user info from Odoo.

```
odoocli [--profile NAME] auth whoami
```

### auth remove

Remove a saved profile from the config file.

```
odoocli auth remove PROFILE_NAME --confirm
```

| Argument | Description |
|----------|-------------|
| `PROFILE_NAME` | Profile to remove |
| `--confirm` | Required flag to confirm removal |

---

## model — Model Discovery & Introspection

### model list

List available Odoo models on the instance.

```
odoocli model list [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--module TEXT` | Filter by module name |
| `--search TEXT` | Search by model name or label |
| `--transient` | Only show transient models (wizards) |

```bash
odoocli model list
odoocli model list --search invoice
odoocli model list --module sale
odoocli model list --transient
```

### model fields

List fields for an Odoo model with metadata.

```
odoocli model fields MODEL_NAME [OPTIONS]
```

| Argument | Description |
|----------|-------------|
| `MODEL_NAME` | Technical model name (e.g. `sale.order`) |

| Option | Description |
|--------|-------------|
| `--type TEXT` | Filter by field type (comma-separated: `many2one,char`) |
| `--search TEXT` | Filter fields by name substring |
| `--required` | Show only required fields |
| `--stored` | Show only stored fields (exclude computed) |

```bash
odoocli model fields sale.order
odoocli model fields sale.order --required
odoocli model fields sale.order --type many2one,one2many,many2many
odoocli model fields sale.order --stored
odoocli model fields sale.order --search partner
```

Output per field: `name`, `label`, `type`, `required`, `readonly`, `stored`, `relation`, `help`, `selection`.

### model methods

List discoverable public methods for a model.

```
odoocli model methods MODEL_NAME [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--search TEXT` | Filter methods by name substring |

```bash
odoocli model methods sale.order
odoocli model methods sale.order --search confirm
```

Note: list may be incomplete. `method call` can execute any public method by name.

---

## module — Module Metadata

### module list

List Odoo modules.

```
odoocli module list [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--state CHOICE` | Filter: installed, uninstalled, to upgrade, to install, to remove |
| `--search TEXT` | Search by module name or description |
| `--limit INTEGER` | Limit results (0 = all) |

```bash
odoocli module list --state installed
odoocli module list --search sale
odoocli module list --state installed --limit 20
```

### module info

Show detailed info and dependencies for a specific module.

```
odoocli module info MODULE_NAME
```

```bash
odoocli module info sale_management
odoocli module info account
```

---

## record — Generic CRUD

### record search

Search records with domain filter, field selection, pagination.

```
odoocli record search MODEL [OPTIONS]
```

| Argument | Description |
|----------|-------------|
| `MODEL` | Technical model name |

| Option | Default | Description |
|--------|---------|-------------|
| `--domain TEXT` | `[]` | Odoo domain filter string |
| `--fields TEXT` | all | Comma-separated field names |
| `--limit INTEGER` | 80 | Max records (0 = all) |
| `--offset INTEGER` | 0 | Pagination offset |
| `--order TEXT` | — | Sort: `"create_date desc"` |
| `--count` | — | Return count only, no data |

```bash
odoocli record search sale.order
odoocli record search sale.order --domain "[('state','=','draft')]"
odoocli record search sale.order --fields name,partner_id,amount_total,state
odoocli record search sale.order --limit 20 --offset 40
odoocli record search sale.order --order "create_date desc"
odoocli record search sale.order --domain "[('state','=','sale')]" --count
```

### record read

Read specific records by ID.

```
odoocli record read MODEL IDS [OPTIONS]
```

| Argument | Description |
|----------|-------------|
| `MODEL` | Technical model name |
| `IDS` | Comma-separated record IDs (e.g. `42` or `42,43,44`) |

| Option | Description |
|--------|-------------|
| `--fields TEXT` | Comma-separated field names |

```bash
odoocli record read sale.order 42
odoocli record read sale.order 42 --fields name,partner_id,state
odoocli record read sale.order 42,43,44
```

### record create

Create a new record.

```
odoocli record create MODEL [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--values TEXT` | JSON object of field values |
| `--file PATH` | Path to JSON file with values |

One of `--values` or `--file` is required.

```bash
odoocli record create sale.order --values '{"partner_id": 1, "date_order": "2026-04-14"}'
odoocli record create sale.order --file order_data.json
```

Output: `{"id": 123, "model": "sale.order"}`

### record write

Update existing records.

```
odoocli record write MODEL IDS [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--values TEXT` | JSON object of fields to update |
| `--file PATH` | Path to JSON file with values |

```bash
odoocli record write sale.order 42 --values '{"note": "Updated by agent"}'
odoocli record write sale.order 42,43 --values '{"tag_ids": [[4, 5]]}'
```

Output: `{"success": true, "model": "sale.order", "ids": [42]}`

### record delete

Delete records. Requires `--confirm`.

```
odoocli record delete MODEL IDS --confirm
```

```bash
odoocli record delete sale.order 42 --confirm
```

Without `--confirm`: returns error `CONFIRM_REQUIRED`.

---

## method — Business Method Execution

### method list

List discoverable public methods for a model.

```
odoocli method list MODEL [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--search TEXT` | Filter by name substring |

```bash
odoocli method list sale.order
odoocli method list sale.order --search confirm
```

### method call

Call a business method on Odoo records.

```
odoocli method call MODEL METHOD_NAME [OPTIONS]
```

| Option | Required | Description |
|--------|----------|-------------|
| `--ids TEXT` | yes | Comma-separated record IDs |
| `--kwargs TEXT` | no | Extra keyword arguments as JSON object |
| `--confirm` | conditional | Required for destructive methods |

**Rules:**
- Methods starting with `_` → rejected (private)
- Methods matching `unlink`, `*cancel*`, `*delete*`, `*remove*` → require `--confirm`
- All other public methods → execute directly

```bash
odoocli method call sale.order action_confirm --ids 42
odoocli method call sale.order action_confirm --ids 42,43,44
odoocli method call sale.order message_post --ids 42 --kwargs '{"body": "Hello"}'
odoocli method call sale.order action_cancel --ids 42 --confirm
```

---

## debug — Inspection & Debugging

### debug inspect

Deep inspection of a single record — all field values merged with field metadata.

```
odoocli debug inspect MODEL RECORD_ID [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--non-empty` | Exclude empty/False/null fields |
| `--resolve` | Resolve many2one names, show one2many/many2many counts and previews |

```bash
odoocli debug inspect sale.order 42
odoocli debug inspect sale.order 42 --non-empty
odoocli debug inspect sale.order 42 --resolve
odoocli debug inspect sale.order 42 --resolve --non-empty
```

Output includes per field: `value`, `type`, `required`, `readonly`, `relation`, `count`, `preview`.

### debug trace

Trace relational record chains from a starting record.

```
odoocli debug trace MODEL RECORD_ID [OPTIONS]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--depth INTEGER` | 1 | Max relation depth to follow |
| `--path TEXT` | auto | Explicit field path (comma-separated) |

Without `--path`: auto-follows all one2many and many2many fields up to depth.
With `--path`: follows only the specified field chain.

```bash
odoocli debug trace sale.order 42
odoocli debug trace sale.order 42 --depth 2
odoocli debug trace sale.order 42 --path order_line,picking_ids,invoice_ids
```

### debug log

Read chatter messages and system logs for a record.

```
odoocli debug log MODEL RECORD_ID [OPTIONS]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--limit INTEGER` | 50 | Max log entries |
| `--system` | — | System logs only (ir.logging) |
| `--all` | — | Both chatter + system logs |

Default: chatter messages only (mail.message).

```bash
odoocli debug log sale.order 42
odoocli debug log sale.order 42 --system
odoocli debug log sale.order 42 --all
odoocli debug log sale.order 42 --limit 20
```

### debug access

Check current user's CRUD access rights on a model, optionally with record-level rules.

```
odoocli debug access MODEL [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--id INTEGER` | Also check record-level rules for this specific record |

```bash
odoocli debug access sale.order
odoocli debug access sale.order --id 42
```

Output: `{"model": "...", "user": "...", "rights": {"read": true, "write": true, "create": true, "unlink": false}}`
With `--id`: adds `"record_rules": {"read": true, "write": false, "unlink": false}`.

---

## view — XML/QWeb Views, Actions, Reports & Menus

### view list

List XML/QWeb view definitions from `ir.ui.view`.

```
odoocli view list [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--model TEXT` | Filter by target model (e.g. `sale.order`) |
| `--type TEXT` | Filter by view type: `form`, `tree`, `kanban`, `search`, `qweb`, `graph`, `pivot`, `calendar`, `activity` |
| `--module TEXT` | Filter by defining module (matches xml_id prefix) |
| `--search TEXT` | Search in view name or xml_id |
| `--custom` | Only show customized views (`customize_show=True`) |
| `--limit INTEGER` | Max results (default: 80) |

```bash
odoocli view list --model sale.order
odoocli view list --model sale.order --type form
odoocli view list --module tgi_plm_integration
odoocli view list --search "sale_order_form"
odoocli view list --custom
```

Output per view: `id`, `name`, `key` (xml_id), `type`, `model`, `mode`, `priority`, `active`.

View `mode` values:
- `primary` — standalone view
- `extension` — inherits/extends another view

### view show

Show full definition of one view, including XML architecture.

```
odoocli view show VIEW_ID [OPTIONS]
```

| Argument | Description |
|----------|-------------|
| `VIEW_ID` | Numeric ID of the `ir.ui.view` record |

| Option | Description |
|--------|-------------|
| `--arch` | Print raw XML architecture only (pipe-friendly) |

```bash
odoocli view show 150
odoocli view show 150 --arch
odoocli view show 150 --arch | xmllint --format -
odoocli view show 150 --arch > exported_form.xml
```

Default output: all fields + `arch_length` + `arch_preview` (first 500 chars).
With `--arch`: prints raw XML to stdout only.

### view search-arch

Search for a text pattern inside the XML architecture of all views. Uses `arch_db ilike` in the database — does not require loading all views into memory.

```
odoocli view search-arch PATTERN [OPTIONS]
```

| Argument | Description |
|----------|-------------|
| `PATTERN` | Substring to search for inside view XML |

| Option | Description |
|--------|-------------|
| `--model TEXT` | Limit search to views for a specific model |
| `--type TEXT` | Limit search to a specific view type |
| `--limit INTEGER` | Max results (default: 50) |

```bash
odoocli view search-arch "partner_id"
odoocli view search-arch 'widget="many2many_tags"'
odoocli view search-arch 't-name="sale.report_saleorder"'
odoocli view search-arch "x_custom_field" --model sale.order
odoocli view search-arch "button" --model sale.order --type form
odoocli view search-arch 't-call="web.external_layout"' --type qweb
```

Output: `{"pattern": "...", "count": N, "views": [...]}`.

### view actions

List Odoo actions across all action model types.

```
odoocli view actions [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--model TEXT` | Filter by target model (`res_model` for window/server, `model` for report) |
| `--type TEXT` | Action type: `window`, `server`, `report`, `client`, `url` |
| `--search TEXT` | Search by action name |
| `--module TEXT` | Filter by binding module |
| `--limit INTEGER` | Max results per type (default: 80) |

| Type | Odoo Model | Description |
|------|------------|-------------|
| `window` | `ir.actions.act_window` | Opens list/form views |
| `server` | `ir.actions.server` | Runs Python code / batch actions |
| `report` | `ir.actions.report` | Generates PDF/HTML reports |
| `client` | `ir.actions.client` | Runs JS client actions |
| `url` | `ir.actions.act_url` | Redirects to URL |

```bash
odoocli view actions --model sale.order
odoocli view actions --model sale.order --type window
odoocli view actions --model sale.order --type server
odoocli view actions --type report
odoocli view actions --search "Confirm"
```

### view reports

List report actions from `ir.actions.report`.

```
odoocli view reports [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--model TEXT` | Filter by target model |
| `--search TEXT` | Search by report name or template name |
| `--type TEXT` | Filter by type: `qweb-pdf`, `qweb-html`, `xlsx`, `py3o` |
| `--limit INTEGER` | Max results (default: 80) |

```bash
odoocli view reports --model sale.order
odoocli view reports --type qweb-pdf
odoocli view reports --type qweb-html
odoocli view reports --search "Invoice"
odoocli view reports --model account.move
```

Output per report: `id`, `name`, `model`, `report_name` (template key), `report_type`, `print_report_name`, `binding_model_id`.

To find the QWeb template for a report:
```bash
# Step 1: get report_name from view reports
odoocli view reports --model sale.order
# Step 2: find the qweb template view with that name
odoocli view list --search "<report_name>" --type qweb
# Step 3: show its XML
odoocli view show <template_id> --arch
```

### view menus

List menu items from `ir.ui.menu`.

```
odoocli view menus [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--search TEXT` | Search by menu name |
| `--parent INTEGER` | Filter by parent menu ID |
| `--action` | Include linked action reference |
| `--limit INTEGER` | Max results (default: 80) |

```bash
odoocli view menus --search "Sales"
odoocli view menus --search "Invoices" --action
odoocli view menus --parent 120
```

Output per menu: `id`, `name`, `complete_name` (full path), `parent_id`, `sequence`, `active`, `action` (when `--action`).

Menu → Action → View trace pattern:
```bash
odoocli view menus --search "Sales Orders" --action
# → action: "ir.actions.act_window,200"
odoocli record read ir.actions.act_window 200 --fields name,res_model,view_mode,view_id
odoocli view show <view_id>
```
