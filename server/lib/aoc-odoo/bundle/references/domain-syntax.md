# Odoo Domain Syntax Reference

Odoo domains are used to filter records in `odoocli record search --domain "..."`.

## Basic syntax

A domain is a list of `(field, operator, value)` tuples:

```bash
odoocli record search sale.order --domain "[('state','=','draft')]"
```

Multiple conditions are AND by default:

```bash
# state = 'draft' AND partner_id is not empty
odoocli record search sale.order --domain "[('state','=','draft'),('partner_id','!=',False)]"
```

## Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Equals | `('state','=','draft')` |
| `!=` | Not equals | `('state','!=','cancel')` |
| `>` | Greater than | `('amount_total','>',1000)` |
| `<` | Less than | `('amount_total','<',500)` |
| `>=` | Greater or equal | `('date_order','>=','2026-01-01')` |
| `<=` | Less or equal | `('date_order','<=','2026-12-31')` |
| `ilike` | Case-insensitive contains | `('name','ilike','test')` |
| `like` | Case-sensitive contains | `('name','like','Test')` |
| `not ilike` | Not contains (case-insensitive) | `('name','not ilike','test')` |
| `=like` | Pattern match (`%` wildcard) | `('name','=like','SO%')` |
| `=ilike` | Pattern match (case-insensitive) | `('name','=ilike','so%')` |
| `in` | Value in list | `('state','in',['draft','sent'])` |
| `not in` | Value not in list | `('state','not in',['cancel','done'])` |
| `child_of` | Is child of (hierarchy) | `('partner_id','child_of',1)` |
| `parent_of` | Is parent of (hierarchy) | `('partner_id','parent_of',5)` |

## Logic operators

Odoo uses **prefix (Polish) notation** for OR and AND:

| Operator | Meaning | Default |
|----------|---------|---------|
| `&` | AND | Yes (implicit between conditions) |
| `\|` | OR | Must be explicit |
| `!` | NOT | Negates next condition |

### AND (default, implicit)

```bash
# Both conditions must be true (no & needed)
"[('state','=','draft'),('partner_id','!=',False)]"

# Explicit AND (same result)
"['&',('state','=','draft'),('partner_id','!=',False)]"
```

### OR

```bash
# state = 'draft' OR state = 'sent'
"['|',('state','=','draft'),('state','=','sent')]"

# Simpler with 'in' operator:
"[('state','in',['draft','sent'])]"
```

### Complex combinations

```bash
# (state = 'draft' OR state = 'sent') AND partner_id > 10
"['|',('state','=','draft'),('state','=','sent'),('partner_id','>',10)]"

# A OR B OR C (chain | operators)
"['|',('state','=','draft'),'|',('state','=','sent'),('state','=','sale')]"

# NOT: state != 'cancel' (same as !=)
"['!',('state','=','cancel')]"
```

### How prefix notation works

`|` and `&` consume the **next two** conditions:

```
['|', A, B]           → A OR B
['|', A, '|', B, C]   → A OR (B OR C) = A OR B OR C
['&', '|', A, B, C]   → (A OR B) AND C
['|', '&', A, B, C]   → (A AND B) OR C
```

## Value types

| Python type | Usage | Example |
|------------|-------|---------|
| `str` | Text fields, dates | `('name','=','SO001')` |
| `int` | IDs, numbers | `('partner_id','=',42)` |
| `float` | Monetary, decimal | `('amount_total','>',1000.50)` |
| `bool` | Boolean fields | `('active','=',True)` |
| `False` | Check empty/null | `('partner_id','!=',False)` |
| `list` | Used with `in`/`not in` | `('state','in',['draft','sent'])` |

## Date and datetime

Dates as strings in `YYYY-MM-DD` format, datetimes as `YYYY-MM-DD HH:MM:SS`:

```bash
# Orders from this year
"[('date_order','>=','2026-01-01'),('date_order','<=','2026-12-31')]"

# Created today
"[('create_date','>=','2026-04-14 00:00:00'),('create_date','<=','2026-04-14 23:59:59')]"
```

## Many2one fields

Filter by ID or use dot notation for related fields:

```bash
# Partner by ID
"[('partner_id','=',42)]"

# Partner by name (dot notation)
"[('partner_id.name','ilike','Acme')]"

# Partner by country
"[('partner_id.country_id.code','=','ID')]"
```

## One2many / Many2many fields

These are searched by checking if any related record matches:

```bash
# Orders that have at least one line with product_id = 5
"[('order_line.product_id','=',5)]"

# Tasks with specific tag
"[('tag_ids.name','ilike','urgent')]"
```

## Common patterns

```bash
# Active records only
"[('active','=',True)]"

# Records created by current user (use uid from auth whoami)
"[('create_uid','=',<uid>)]"

# Non-archived partners with email
"[('active','=',True),('email','!=',False)]"

# Draft invoices over 1M
"[('state','=','draft'),('amount_total','>',1000000),('move_type','=','out_invoice')]"

# Overdue invoices
"[('state','=','posted'),('payment_state','!=','paid'),('invoice_date_due','<','2026-04-14')]"

# Products in specific category
"[('categ_id.name','=','Consumable')]"

# Employees in specific department
"[('department_id.name','=','Engineering')]"

# Records modified in last 7 days
"[('write_date','>=','2026-04-07')]"
```
