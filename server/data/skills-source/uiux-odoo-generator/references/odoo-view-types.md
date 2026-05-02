# Odoo View Types — When to Pick What

Odoo's backend has four view primitives that cover 95% of what a user does in the ERP. Picking the right one is usually obvious, but the borderline cases matter — getting it wrong forces users into an unnatural workflow.

## Form view

Use when the user is focused on **one record at a time**. Everything the user needs to read, edit, or act on is on a single scrollable sheet.

Classic anchors:
- `<header>` with statusbar (`Draft → Sent → Sale → Done`) and action buttons (Confirm, Cancel, Send by Email).
- Title block — large record identifier and the primary one-liner (e.g. partner name, SO number).
- Two-column group — grouped fields on left (what the record is) and right (when/how much).
- `<notebook>` with tabs for related data — Order Lines, Other Info, Customer Signature, Attachments.
- Chatter pane — followers, messages, log notes, activities, attachments.

Use form for: invoices, sales orders, purchase orders, products, customers, employees, partners, projects, tasks, wizards where the user is committing to a single object.

Avoid form when: the user is comparing records (use tree), or dragging across status (use kanban).

## Tree / List view

Use when the user is **scanning, sorting, filtering, or bulk-acting** on many records. Column density over context density.

Anchors:
- Search bar at the top with default filters as chips (e.g. "Status: Sales Order", "Salesperson: Me"). Group-by and favourite searches collapse below.
- Columns sized by data type — dates narrow, amounts right-aligned, long text wider.
- Optional totals/footer row for monetary sums (`sum="Total"` in XML).
- Row click opens the matching form view; bulk actions surface via a dropdown once rows are selected.

Use tree for: order lists, invoice lists, stock picking lists, activity queues, audit trails, reports.

Tips:
- Keep the default columns under 8. Everything else goes behind the "optional" column picker.
- Right-align numeric columns, especially currency.
- Decorate rows for urgent states (`decoration-danger`, `decoration-warning`).

## Kanban view

Use when records move across **stages** the user manages by drag-and-drop, or when cards need a visual summary that's easier to scan than a table row.

Anchors:
- Column per stage with a count badge, a progress bar (done vs overdue), and a "+" to add a new record.
- Compact card with title, subtitle (related partner), coloured tags, priority star, deadline, assignee avatar, status dot.
- Top bar has a search + view switchers (list / kanban / calendar / pivot / gantt / map / activity).

Use kanban for: CRM pipelines, task boards, recruitment, manufacturing orders by status, production work-centres.

Avoid kanban when: the user needs to scan more than ~20 records per column — the eye gets lost.

## Wizard view (modal)

Use for **transient, multi-field actions** that don't live as a first-class record. They collect inputs, run a method, then disappear.

Anchors:
- Modal over a semi-transparent backdrop — the background view is still visible (so the user remembers what they were doing).
- Title bar with close X, body with a single-column group of fields, footer with primary + secondary buttons.
- No chatter, no notebook — a wizard is a form with a job, not a long-lived object.

Examples: "Register Payment", "Send by Email", "Cancel Invoice", "Create Stock Transfer", "Batch Validate", "Export…".

Tip: if the wizard starts growing notebook tabs or a chatter, it's not a wizard anymore — it wants to be a real record.

## Rule of thumb

| Task                                        | View   |
|---------------------------------------------|--------|
| Fill in / review one thing                  | form   |
| Find one among many / export / sort / group | tree   |
| Move something across stages                | kanban |
| Do a one-shot action                        | wizard |
| Compare numbers across axes (pivot/graph)   | *(out of scope for this skill — use Odoo's pivot/graph views in-app)* |
