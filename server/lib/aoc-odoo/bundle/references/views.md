# OdooCLI — View Reference

Quick reference for XML/QWeb views, actions, reports, and menus in Odoo.

## View Types (`ir.ui.view`)

| Type | Used for |
|------|----------|
| `form` | Single record editing/display |
| `tree` / `list` | Multi-record list |
| `kanban` | Card-based board view |
| `search` | Search panel (filters, group by, favorites) |
| `qweb` | QWeb template (reports, emails, web pages) |
| `graph` | Charts (bar, pie, line) |
| `pivot` | Pivot/crosstab analysis |
| `calendar` | Date-based calendar view |
| `activity` | Activity/task timeline |
| `map` | Geographic map view |

## View Modes (`mode` field)

| Mode | Meaning |
|------|---------|
| `primary` | Standalone view (the "base" definition) |
| `extension` | Inherits and extends another view (`inherit_id` is set) |

## Action Types

| Type flag | Model | What it does |
|-----------|-------|-------------|
| `window` | `ir.actions.act_window` | Opens a list/form/kanban/graph/etc. view |
| `server` | `ir.actions.server` | Runs Python code, sends email, or calls method |
| `report` | `ir.actions.report` | Generates a PDF, HTML, or Excel report |
| `client` | `ir.actions.client` | Runs a JavaScript client action in browser |
| `url` | `ir.actions.act_url` | Redirects to an external URL |

## Report Types (`report_type` field)

| Value | Format |
|-------|--------|
| `qweb-pdf` | PDF via QWeb + wkhtmltopdf |
| `qweb-html` | HTML via QWeb |
| `xlsx` | Excel (requires `report_xlsx` module) |
| `py3o` | LibreOffice/ODT (requires `py3o` module) |

---

## Quick Command Patterns

### Find all views for a model

```bash
odoocli view list --model sale.order
odoocli view list --model sale.order --type form
odoocli view list --model account.move --type tree
```

### Read XML architecture of a view

```bash
# Get ID from view list first
odoocli view list --model sale.order --type form
# Then show arch
odoocli view show 150 --arch
```

### Search for a field/widget inside any view

```bash
odoocli view search-arch "partner_id"
odoocli view search-arch 'widget="statusbar"' --model sale.order
odoocli view search-arch "x_custom_field"          # find uses of custom fields
odoocli view search-arch 'groups="base.group_'     # find group-restricted elements
```

### Find views from a specific module

```bash
odoocli view list --module sale_management
odoocli view list --module tgi_plm_integration
```

### Find custom/studio-modified views

```bash
odoocli view list --custom
```

### Find all reports for a model

```bash
odoocli view reports --model sale.order
odoocli view reports --model account.move
odoocli view reports --type qweb-pdf
```

### Get QWeb template for a report

```bash
# 1. Get report_name
odoocli view reports --model sale.order
# e.g. report_name = "sale.report_saleorder"

# 2. Find QWeb template view
odoocli view list --search "report_saleorder" --type qweb

# 3. Get template XML
odoocli view show <id> --arch
```

### Find all actions for a model

```bash
odoocli view actions --model sale.order
odoocli view actions --model sale.order --type window   # list/form openers
odoocli view actions --model sale.order --type server   # Action menu items
odoocli view actions --model sale.order --type report   # Print buttons
```

### Find a menu and its linked action

```bash
odoocli view menus --search "Sales Orders" --action
# Output includes: action = "ir.actions.act_window,200"

# Follow the action
odoocli record read ir.actions.act_window 200 \
  --fields name,res_model,view_mode,view_id,domain
```

---

## Common IR Models (Technical)

| Model | What it stores |
|-------|---------------|
| `ir.ui.view` | All XML/QWeb view definitions |
| `ir.ui.menu` | Application menu structure |
| `ir.actions.act_window` | Window actions (list/form openers) |
| `ir.actions.server` | Server actions (Python, email, method calls) |
| `ir.actions.report` | Report actions (PDF/HTML/XLSX) |
| `ir.actions.client` | Client-side JavaScript actions |
| `ir.actions.act_url` | URL redirect actions |
| `ir.model` | Model registry |
| `ir.model.fields` | Field definitions |
| `ir.model.access` | CRUD access rules (ACL) |
| `ir.rule` | Record rules (domain-based restrictions) |
| `ir.config_parameter` | System parameters |
| `ir.cron` | Scheduled actions |
| `ir.logging` | Server logs |

---

## Debug: Why a Button is Missing from Form

```bash
# 1. Find form view
odoocli view list --model sale.order --type form

# 2. Read arch and look at button conditions
odoocli view show <id> --arch

# Key attributes to check:
# invisible="state != 'draft'"          → button hidden when state not draft
# groups="sale.group_sale_manager"      → button hidden for non-managers
# column_invisible="..."                → list column visibility
```

## Debug: Find All Inherit Views for a Model

```bash
# All extension views (customize/inherit) for a model
odoocli view list --model sale.order
# Look for mode = "extension"

# Show what the inherit view changes
odoocli view show <extension_view_id> --arch
```

## Debug: Report Not Printing / Wrong Template

```bash
# 1. Find report action
odoocli view reports --model sale.order --search "Quotation"

# 2. Check report_name (template key)
# e.g. "sale.report_saleorder"

# 3. Find QWeb template
odoocli view list --search "report_saleorder" --type qweb

# 4. Read template XML
odoocli view show <id> --arch

# 5. Find if there's an inherit/override
odoocli view search-arch 'inherit_id' --search "report_saleorder"
```
