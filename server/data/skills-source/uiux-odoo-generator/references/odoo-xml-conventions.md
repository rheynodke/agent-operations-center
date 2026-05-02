# Odoo XML Conventions

The XML scaffold produced by this skill follows Odoo's OCA-style naming and structure so the output can drop into an addon with minimal cleanup. This document captures the rules the generator enforces, and the rules it can't enforce but you should still follow by hand.

## Module layout

```
<module_name>/
├── __init__.py
├── __manifest__.py
├── models/
│   └── __init__.py
│   └── <model_name>.py
├── security/
│   └── ir.model.access.csv
├── views/
│   └── <module_name>_views.xml       ← combined <odoo>/<data>
│   └── screens/
│       ├── form_sale_order.xml       ← one record per file (easier to diff)
│       ├── tree_sale_orders.xml
│       ├── kanban_crm.xml
│       └── wizard_register_payment.xml
└── data/
    └── ir_sequence.xml               ← sequences, mail templates, etc. (you add these)
```

The generator creates `__manifest__.py`, the combined `views/<module>_views.xml`, and the per-screen files. Models, Python actions, security, and demo data remain your responsibility.

## Record ids

| Pattern                              | Use for             |
|--------------------------------------|---------------------|
| `view_<slug>_form`                   | Form view           |
| `view_<slug>_tree`                   | Tree/list view      |
| `view_<slug>_kanban`                 | Kanban view         |
| `view_<slug>_wizard`                 | Transient wizard    |
| `action_<slug>_open`                 | `ir.actions.act_window` |
| `menu_<slug>`                        | `ir.ui.menu`        |

Keep `<slug>` snake_case and free of dots — the XML generator slugifies spec titles for you. If you override with `spec.viewId`, use the same convention.

## The `name` field

Odoo convention: `<model>.<view_kind>`. The generator emits this automatically:
- `sale.order.form`
- `sale.order.tree`
- `crm.lead.kanban`
- `account.payment.register.wizard.form`

Override only if the model name clashes (e.g. inheritance — then suffix with `.inherit.<module>`).

## The `model` field

This is the Odoo technical model name, e.g. `sale.order`, `res.partner`, `crm.lead`. Always dot-separated, lowercase, no underscores between words of a single concept. A few anchors worth knowing:

| Domain       | Common models                         |
|--------------|----------------------------------------|
| Sales        | `sale.order`, `sale.order.line`        |
| Purchase     | `purchase.order`, `purchase.order.line`|
| Inventory    | `stock.picking`, `stock.move`, `stock.quant` |
| Accounting   | `account.move`, `account.move.line`, `account.payment` |
| CRM          | `crm.lead`, `crm.stage`                |
| HR           | `hr.employee`, `hr.leave`, `hr.attendance` |
| Project      | `project.project`, `project.task`      |
| Partner      | `res.partner`                          |
| User         | `res.users`                            |

## Field attributes the generator emits

From the spec:

| Spec key        | XML attribute             |
|-----------------|---------------------------|
| `widget` / `kind` | `widget="…"`            |
| `required`      | `required="1"`            |
| `readonly`      | `readonly="1"`            |
| `invisible`     | `invisible="1"`           |
| `placeholder`   | `placeholder="…"`         |
| `options`       | `options="{…}"`           |
| `string`        | `string="…"`              |

Attributes the generator does NOT set — you'll need to add them manually when moving from mockup to production view:

- `domain="[('active','=',True)]"` — filter related records.
- `context="{'default_partner_id': partner_id}"` — default values when opening related records.
- `attrs="{'readonly': [('state','=','done')]}"` — dynamic visibility (Odoo 16-).
- In Odoo 17+, the `attrs`/`states` attributes are gone; use plain Python expressions: `readonly="state == 'done'"`, `invisible="not partner_id"`.

## Decoration & widgets in tree views

The renderer preview uses coloured pills; in XML you'll want:

```xml
<tree decoration-danger="state == 'cancel'"
      decoration-warning="date_deadline and date_deadline &lt; context_today"
      decoration-success="state == 'done'">
  <field name="name"/>
  <field name="amount_total" widget="monetary" sum="Total"/>
</tree>
```

Common widgets worth memorising:

| Widget                      | Use |
|-----------------------------|-----|
| `monetary`                  | Currency-aware numeric field |
| `many2many_tags`            | Coloured pills |
| `priority`                  | ★★★ priority toggle |
| `statusbar`                 | Selection field as pipeline steps |
| `many2one_avatar_user`      | Assignee avatar in kanban |
| `date` / `datetime`         | Formatted date pickers |
| `progressbar`               | 0–100 bar |
| `html`                      | Rich-text |
| `binary` / `image`          | File / image upload |
| `badge`                     | Compact status pill |

## Kanban card template

The generator produces a `kanban-box` template with the conventional Odoo 17 classes:

```xml
<div t-attf-class="oe_kanban_card oe_kanban_global_click">
  <div class="o_kanban_record_top">
    <strong class="o_kanban_record_title"><field name="name"/></strong>
    <field name="priority" widget="priority"/>
  </div>
  <div class="o_kanban_record_subtitle"><field name="partner_id"/></div>
  <field name="tag_ids" widget="many2many_tags"/>
  <div class="o_kanban_record_bottom">
    <div class="oe_kanban_bottom_left">
      <field name="date_deadline" widget="date"/>
    </div>
    <div class="oe_kanban_bottom_right">
      <field name="user_id" widget="many2one_avatar_user"/>
    </div>
  </div>
</div>
```

If your model uses different field names (e.g. `x_owner` instead of `user_id`), override them on the spec:

```js
{
  kind: 'kanban',
  assigneeField: 'x_owner',
  priorityField: 'x_priority',
  tagsField:     'x_tags',
}
```

## Wizard conventions

- Model always inherits from `models.TransientModel`, never `models.Model`.
- Record id: `view_<slug>_wizard` (no `form` suffix — it's implied).
- Footer must have at least one button with `special="cancel"` for the modal to dismiss properly. The generator adds this automatically when a button's label contains "cancel" or "discard".
- The action that opens the wizard should use `target="new"` so Odoo renders it in a dialog:

```xml
<record id="action_register_payment" model="ir.actions.act_window">
  <field name="name">Register Payment</field>
  <field name="res_model">account.payment.register</field>
  <field name="view_mode">form</field>
  <field name="target">new</field>
</record>
```

## Manifest

The generator's `__manifest__.py` is a starting point. Things you'll commonly add:

- `'depends': ['base', 'mail', 'sale_management', 'account']` — depend on the modules whose models you inherit/extend.
- `'assets': {'web.assets_backend': ['module/static/src/**/*']}` — frontend JS/CSS.
- `'demo': ['demo/demo_data.xml']` — sample records loaded with `-i module --demo=all`.

## Pre-commit checks before installing

- `xmllint --noout views/*.xml` — validate XML syntax.
- `python -c "import ast; ast.parse(open('__manifest__.py').read())"` — manifest is valid Python.
- Run the module in a throw-away DB: `odoo-bin -d tmp -i your_module --stop-after-init --log-level=error`.
