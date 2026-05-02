# Odoo Component Schema — Spec Reference

The canvas spec is a plain JS object. Every screen has `kind`, `id`, and optional `name` + `purpose`. The remaining keys depend on `kind`.

## Canvas envelope

```js
{
  title:    'Sales + CRM',          // human-readable
  slug:     'sales_crm_demo',       // used for output folder + module id
  module:   'sales_crm_demo',       // XML module technical name (defaults to slug)
  theme:    'odoo-17',              // 'odoo-17' | 'odoo-18' | 'odoo-16' | 'odoo-community'
  viewport: 'desktop',              // from mockup-builder — usually 'desktop'
  cols:     4,                      // how many screens per row on the canvas
  screens:  [ ... ],
}
```

## Shared screen keys (all kinds)

| Key          | Purpose |
|--------------|---------|
| `id`         | Stable identifier (used for screen XML filename) |
| `kind`       | `'form' \| 'tree' \| 'kanban' \| 'wizard'` |
| `name`       | Canvas label (what appears in the pink corner tag) |
| `purpose`    | One-liner shown in the canvas metadata |
| `model`      | Odoo technical model name (`sale.order`, `crm.lead`) |
| `slug`       | Used to derive `view_<slug>_<kind>` id in XML |
| `app`        | Topnav app label (`Sales`, `CRM`, `Inventory`) |
| `menu`       | Array of `{ label, active }` for the topnav menu strip |
| `user`       | Bottom-right user label (`My Company (San Francisco)`) |
| `crumbs`     | Breadcrumb array (`['Orders','Orders','S00042']`) |
| `pager`      | Pager text (`'1 / 12'`) |
| `showNew`    | Hide the "New" button if false |
| `showGear`   | Hide the gear icon if false |
| `x`, `y`     | Column/row position on the canvas |
| `connectsTo` | Array of screen ids — renders arrows between screens |

## kind: 'form'

```js
{
  kind: 'form',
  recordLabel: 'Sales Order',        // small grey line above the title
  title: 'S00042',                   // big record identifier
  titleField: 'name',                // (XML) field name for the H1
  subtitle: '…',                     // optional muted line under title
  status: {                           // renders <header><field … widget="statusbar"/>
    states: ['Draft','Sent','Sale','Done'],
    current: 'Sale',
  },
  statusField: 'state',               // (XML) defaults to 'state'
  headerBtns: [                       // renders <header><button …/>
    { label: 'Confirm',       variant: 'primary', name: 'action_confirm' },
    { label: 'Send by Email', name: 'action_quotation_send' },
    { label: 'Cancel',        variant: 'ghost',   name: 'action_cancel'  },
  ],
  fieldsLeft:  [ Field, ... ],        // left column inside <group>
  fieldsRight: [ Field, ... ],
  fields:      [ Field, ... ],        // single-column form instead of two
  leftTitle:  'Customer',             // optional group string attribute
  rightTitle: 'Payment',
  tabs: [ Tab, ... ],                 // renders <notebook>
  chatter: {                          // renders <div class="oe_chatter">
    followers: 2,
    date: '04/18/2026 14:32:10',
    entries: [ { who, when, body } ],
  },
  ribbon: 'Paid',                     // optional corner ribbon
}
```

### Field

```js
{
  label:       'Customer',         // human label (left side of the row)
  value:       'Deco Addict',      // what to show in the mockup (HTML preview only)
  name:        'partner_id',       // Odoo technical name (XML). Falls back to slug(label).
  required:    true,
  readonly:    false,
  invisible:   false,
  help:        'Pick the billing partner',
  placeholder: 'Type to search…',
  kind:        'm2oCombo',         // drives both preview + widget hint
  widget:      'monetary',         // XML widget override — trumps `kind`
  tagged:      false,              // HTML: render value as pill tags
  options:     { no_create: true },
  string:      'Bill to',          // override XML string attribute
}
```

Recognised `kind` values → XML widget:

| `kind`        | HTML preview     | XML widget                |
|---------------|------------------|---------------------------|
| `'m2oCombo'`  | autocomplete row | *(default many2one)*     |
| `'m2mTags'`   | coloured tags    | `many2many_tags`          |
| `'monetary'`  | `Rp 1.200.000`   | `monetary`                |
| `'binary'`    | 📎 link          | `binary`                  |
| `'status'`    | coloured pill    | *(plain)*                 |
| `'star'`      | ★ toggle         | `priority`                |
| `'checkbox'`  | checkbox row     | *(boolean)*               |
| `'radio'`     | radio row        | *(selection)*             |

### Tab

```js
{
  label:  'Order Lines',
  active: true,                // only one tab should be active
  body:   '<raw html>',        // HTML preview body
  o2m: {                       // XML one2many hint
    field:    'order_line',
    editable: 'bottom',
    columns: [
      { label: 'Product',  name: 'product_id' },
      { label: 'Qty',      name: 'product_uom_qty' },
      { label: 'Unit Price', name: 'price_unit', widget: 'monetary' },
      { label: 'Subtotal',   name: 'price_subtotal', widget: 'monetary', sum: 'Total' },
    ],
  },
  fields: [ Field, ... ],      // alternative: plain group of fields in the tab
  xml:    '<raw xml>',         // escape hatch for bespoke pages
}
```

## kind: 'tree'

```js
{
  kind: 'tree',
  searchChips:        [ { label: 'Status: Sales Order' } ],
  searchPlaceholder:  'Search…',
  pagerText:          '1-6 / 6',
  checkboxCol:        true,         // left-most checkbox column
  editable:           'bottom',     // (XML) inline editing position
  multiEdit:          true,         // (XML) multi_edit="1"
  decoration:         { danger: 'state == "cancel"', warning: 'date_deadline < context_today' },
  columns: [
    { label: 'Number',       name: 'name' },
    { label: 'Customer',     name: 'partner_id' },
    { label: 'Total',        name: 'amount_total', widget: 'monetary', align: 'right', sum: 'Total' },
    { label: 'Status',       name: 'state', optional: 'show' },
  ],
  rows: [
    ['S00042','04/15/2026','Deco Addict','Mitchell Admin',
      { value: '$ 1,842.40', align: 'right', primary: true },
      { html: '<span class="odoo-status green">Sale</span>' } ],
    ...
  ],
  footer: [                          // row-shape footer, or a plain string for a single totals cell
    null, null, null, null, { value: '$ 10,465.05', align: 'right' }, null,
  ],
}
```

Row cell forms:
- String — plain text
- `{ value, align, primary }` — styled plain text
- `{ html, align }` — raw HTML (pills, links, tags)
- `null` — empty cell

## kind: 'kanban'

```js
{
  kind: 'kanban',
  groupBy: 'stage_id',               // (XML) default_group_by
  filterChips: [ { label: 'My Pipeline' } ],
  searchPlaceholder: 'Search…',
  columns: [
    {
      title: 'New',
      count: 4,                      // badge next to title
      progress: [                    // array of segments or a single 0..100 number
        { pct: 60, color: '#017e84' },
        { pct: 20, color: '#f0ad4e' },
        { pct: 20, color: '#d04437' },
      ],
      cards: [
        {
          title:     'Office Design Project',
          subtitle:  'Deco Addict',
          tags:      [ { label: 'Office', color: 'blue' }, 'Product' ],
          priority:  true,              // ★ if truthy
          isDone:    false,             // ✓ if truthy
          hasAttendees: false,
          hasNote:      false,
          hasFile:      false,
          deadline:  '04/20/2026',
          assignee:  'Mitchell Admin', // initials avatar
          status:    'green',          // green | amber | red | none
        },
      ],
    },
  ],
  // XML technical field overrides (only needed if your model differs):
  subtitleField: 'partner_id',
  priorityField: 'priority',
  tagsField:     'tag_ids',
  assigneeField: 'user_id',
  deadlineField: 'date_deadline',
}
```

## kind: 'wizard'

```js
{
  kind: 'wizard',
  model:          'account.payment.register',
  title:          'Register Payment',
  backgroundKind: 'tree',            // 'form' | 'tree' | 'kanban' | 'blank'
  backgroundSpec: treeScreen,        // reuse another screen as the blurred background
  fields: [ Field, ... ],            // single-column group, usually 4–8 fields
  footerBtns: [
    { label: 'Create Payment', variant: 'primary', name: 'action_create_payments' },
    { label: 'Discard' },             // cancel/discard → special="cancel" in XML
  ],
}
```

## Tips

- **Keep technical names consistent** — `partner_id`, `user_id`, `amount_total`, `date_order`, `state`. The XML generator uses them verbatim.
- **Provide `model`** on every screen if you want valid XML — it becomes `<field name="model">sale.order</field>`.
- **Don't overload a form** — if a tab crosses ~12 fields, split into a sub-tab or a separate view.
- **Kanban progress bars** are fed by ratios, not counts — 100 always means "full bar".
