# Odoo Screenshot Reading — Mode A Protocol

You are reading a screenshot of an existing Odoo web backend view. Your job is to extract **enough structure** to (1) summarize what the user sees, and (2) re-create the view faithfully in HTML mockup + XML scaffold form, with the user's requested customizations applied.

Do NOT skip the clarify step. Users give vague requests ("tambah field NIK") and the right placement depends on context that's only answerable by asking.

---

## 1. Extraction checklist — run through ALL items

For every Odoo screenshot, extract these in order. If an item isn't visible, record `null`.

### 1.1 Top navbar / breadcrumb
- **App name** (far left after the apps-grid icon) — e.g. `Sales`, `CRM`, `Inventory`, `Accounting`.
- **Breadcrumb trail** — e.g. `Quotations / S00042` or `Customers / Azure Interior`.
- **Record title** (last crumb if it's a specific record) — e.g. `S00042`, `Azure Interior`.
- **Pager** (top right) — e.g. `3 / 128`.
- **Action buttons top-right** — e.g. `Send by Email`, `Confirm`, `Print`, `Cancel` + cogwheel ⚙ menu.

### 1.2 Model inference
Use the breadcrumb to infer the model. Reference the table in §3.

### 1.3 View kind
One of:
- **form** — single-record, statusbar top, grid of fields, tabs (notebook) at bottom, chatter.
- **tree/list** — tabular rows.
- **kanban** — column layout with draggable cards.
- **wizard** — modal dialog (smaller, centered, with Cancel/Confirm footer).
- **search** — rare as a standalone; usually part of list/kanban.

### 1.4 Statusbar (form views only)
- **All stages/states** from left to right — e.g. `Draft → Sent → Sale → Done`.
- **Current stage** — which chip is highlighted (bold or colored background).
- **Special indicator** — invoiced flag, locked/unlocked icon, kanban-state dot.

### 1.5 Field layout (form views)
- Note the **2-column grid** (standard Odoo) vs. single-column vs. full-width.
- For each visible field: **label**, **widget** (text input, date picker, m2o dropdown, m2m tags, selection dropdown, boolean toggle, monetary with currency suffix, etc.), **value shown**.
- **Group headers** (if any — sometimes fields are grouped under a subtitle like "Shipping").

### 1.6 Notebook (tabs)
- Tab titles in order — e.g. `Order Lines | Other Info | Notes | Customer Signature`.
- **Active tab** — usually underlined burgundy.
- If active tab shows a **list inside it** (o2m), capture columns + number of rows.

### 1.7 Chatter (bottom)
Is the chatter present? What sub-tabs are visible?
- `Send message` / `Log note` toggle
- Button row: `Send message`, `Log note`, `Activities`, `Follow`
- Follower count (e.g. `2 followers`)
- Message thread with dates

### 1.8 Sidebar / right panel
Some views have a right-side panel — smart buttons row at top (e.g. `Invoices`, `Deliveries`, `Related SO`). Capture each button + its count.

### 1.9 List / tree specifics
- **Column headers** in order.
- **Row count** visible vs. total (e.g. 10 of 47).
- **Decorations** — red text for overdue, green for paid, bold for unread.
- **Row actions** at right (trash icon, archive, export).
- **Filters / groupby** active (shown as chips above the list).
- **Totals row** at bottom (sum of monetary columns).

### 1.10 Kanban specifics
- **Column titles** (= group-by values, usually stages or states).
- **Card counts** per column.
- **Progress bars** under each column title (segmented red/amber/green).
- **Card content** — typical structure: title (bold), subtitle (secondary text), avatar circle top-right, tags bottom-left, priority stars.

### 1.11 Wizard specifics
- **Wizard title** (dialog header).
- **Body fields** (same extraction as form fields).
- **Footer buttons** — left-aligned in Odoo 17 (e.g. `Create Payment` primary, `Cancel` secondary).

---

## 2. Summary format — paste this back to the user in 3–5 lines

> Saya lihat **{view_kind}** view untuk model `{model}` di record `{record_id}`.
> **Statusbar**: {stages_joined_by_arrow} — current **{current_stage}**.
> **Field layout**: {n_left} field di kiri ({names}), {n_right} field di kanan ({names}).
> **Tabs**: {tab_titles} — aktif: **{active_tab}** ({n_rows} baris).
> **Chatter**: {aktif|tidak}.

For list:
> Saya lihat **list view** model `{model}`. Kolom: {col_names}. {n_rows} baris terlihat. Filter aktif: {chips}. Decoration: {summarize}.

For kanban:
> Saya lihat **kanban view** model `{model}` di-group by `{stage_field}`. Kolom: {col_titles} dengan jumlah {counts}. Card menampilkan {card_fields}.

Keep it compact and accurate. If you're uncertain about a field name, mark with `(?)` and ask.

---

## 3. Breadcrumb → model inference table

Use this lookup to guess the technical model from what you see in the breadcrumb. When uncertain, ask.

| Breadcrumb contains           | Likely model                 | Common view hints                           |
| ----------------------------- | ---------------------------- | ------------------------------------------- |
| Sales › Quotations / Orders   | `sale.order`                 | Statusbar Draft→Sent→Sale→Done; tab Order Lines |
| Sales › Customers             | `res.partner`                | No statusbar; tabs Contacts&Addresses, Sales&Purchase, Accounting |
| CRM › Pipeline                | `crm.lead`                   | Kanban by stage; Won/Lost chips            |
| CRM › Leads                   | `crm.lead` (type=lead)       | List + kanban; stage_id grouping            |
| Inventory › Transfers         | `stock.picking`              | Statusbar Draft→Waiting→Ready→Done; tab Operations |
| Inventory › Products          | `product.template`           | Tabs General Info, Sales, Purchase, Inventory |
| Inventory › Inventory Adjust. | `stock.quant`                | List of stock levels per product/location   |
| Purchase › Requests for Quot. | `purchase.order`             | Statusbar Draft→RFQ Sent→PO→Done            |
| Purchase › Vendors            | `res.partner` (supplier)     | Same as Contacts, supplier_rank > 0         |
| Accounting › Customers        | `res.partner` (customer)     | customer_rank > 0                           |
| Accounting › Invoices         | `account.move` (out_invoice) | Statusbar Draft→Posted→Paid                 |
| Accounting › Bills            | `account.move` (in_invoice)  | Same model, different type                  |
| Accounting › Journal Entries  | `account.move`               | Generic accounting move                     |
| Accounting › Bank             | `account.bank.statement`     | Statement reconcile widget                  |
| Contacts                      | `res.partner`                | No statusbar                                |
| HR › Employees                | `hr.employee`                | Tabs Work Info, Private Info, HR Settings   |
| HR › Departments              | `hr.department`              | Simple hierarchy                            |
| HR › Time Off                 | `hr.leave` (request) or `hr.leave.allocation` | Statusbar Draft→To Approve→Approved |
| HR › Recruitment              | `hr.applicant`               | Kanban by stage                             |
| Project › Projects            | `project.project`            | Kanban + list                               |
| Project › Tasks               | `project.task`               | Kanban by stage; assignees avatar           |
| Helpdesk › Tickets            | `helpdesk.ticket`            | Kanban by stage                             |
| Website › Products            | `product.template`           | Same as Inventory Products                  |
| Website › Pages               | `website.page`               | Rare to customize via form                  |
| Manufacturing › MO / Orders   | `mrp.production`             | Statusbar Draft→Confirmed→In Progress→Done  |
| Manufacturing › BOMs          | `mrp.bom`                    | Tab Components, Operations                  |
| Payroll › Payslips            | `hr.payslip`                 | Statusbar Draft→Waiting→Done                |
| Fleet › Vehicles              | `fleet.vehicle`              | Kanban by state                             |
| Maintenance › Requests        | `maintenance.request`        | Kanban by stage                             |

For DKE-internal modules (HGIS, PLM, WUGWUN, Bindcang, DKE Easy Connected, DKE Life), ask the user which custom model — these don't follow standard Odoo apps.

---

## 4. Clarifying questions — ask 3–5 before generating

Use `AskUserQuestion` if available. Tailor to what the user asked.

### If user wants to ADD a field
1. **Field name + label?** — e.g. `nik` / "NIK (KTP)"
2. **Field type?** — Char, Integer, Float, Date, Datetime, Selection, Many2one (to which model?), One2many, Many2many, Boolean, Binary.
3. **Required / readonly / invisible?** Under what condition (e.g. `state != 'draft'`)?
4. **Where to place?** Left column, right column, inside a specific tab, new tab, or new group?
5. **Default value?** Any compute or onchange?

### If user wants to ADD a button (statusbar or header)
1. **Button label + where?** Statusbar-left (before states), statusbar-right (after states), header-button group.
2. **Action type?** Python method (name it), open wizard (which), change state, call server action.
3. **Visibility condition?** e.g. only when `state == 'draft'`.
4. **Class / emphasis?** primary (`btn-primary`), secondary, link, danger.

### If user wants to HIDE / REMOVE
1. **Confirm exactly which field / tab / button** — read back the label.
2. **Hide permanently or conditionally?** If conditional, what condition.
3. **Affect all users or only some groups?**

### If user wants to ADD a new tab
1. **Tab title?**
2. **Content type** — a form-field group, an O2M list (to which model?), a computed HTML widget.
3. **Visibility condition?**
4. **Position** — after which existing tab.

### If user wants to CHANGE list columns
1. **Which columns to add / remove / reorder?**
2. **Decorations** — bold/red/green on what condition?
3. **Totals on any column?**
4. **Default sort order?**

---

## 5. Generation step — what to produce after user confirms

Output **two artifacts** in a single canvas spec:

1. **HTML mockup** of the customized AFTER view — reuse all visible fields + add/modify per user request. The BEFORE version is the screenshot itself; no need to re-render it.
2. **XML `ir.ui.view` record** — a complete view definition (not an xpath inherit patch, unless user explicitly asks). Include:
   - `<record id="..." model="ir.ui.view">`
   - `<field name="name">{model}.{view_type}</field>`
   - `<field name="model">{model}</field>`
   - `<field name="arch" type="xml"> ... </field>`
   - Inside arch: full `<form>` / `<tree>` / `<kanban>` / `<form>` (for wizard) with all fields + customizations.

Add a comment block at the top of the XML noting which screenshot this was derived from and which customization was applied, e.g.:

```xml
<!-- Derived from screenshot: Sales › Quotations › S00042 (form view)
     Customization: added field `nik` (Char, required when state='sale')
                    in the right column after payment_term_id
-->
```

---

## 6. Common pitfalls — avoid these

- **Don't guess the model from the record ID alone** (e.g. `S00042` could be a quote or a sale order depending on stage). Use breadcrumb + app name.
- **Don't invent fields that aren't in the screenshot.** If you need a field for the XML to be valid (like `state`), add it but mark with a comment.
- **Don't reorder existing fields** unless the user asks — the mockup must match the screenshot layout, plus only the requested change.
- **Don't drop the chatter** if the screenshot shows it, and vice versa.
- **Be careful with translated labels.** If the screenshot is in Indonesian (`Pelanggan` not `Customer`), that's a language setting, not a different field. Keep the XML `string="Customer"` in English by default, add `string="Pelanggan"` only if the user wants the label locked to Indonesian.
- **Odoo 17 vs 18** — visually nearly identical for most views. If unsure, default to Odoo 17 Enterprise styling in the mockup.
