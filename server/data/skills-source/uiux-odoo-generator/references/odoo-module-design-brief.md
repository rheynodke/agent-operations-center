# Odoo Module Design Brief — Mode B Protocol

The user wants a **new Odoo module** designed from a natural-language brief. Your job: progressively clarify, then confirm the design in bullet form, then generate mockup + XML scaffold — only after explicit "ok proceed".

**Do not ask all 8 questions at once.** Ask in sections, in order. Each section's answers inform the next section's questions.

---

## Section 1 — Model & fields (ASK FIRST)

Ask **two questions** in a single turn (or use `AskUserQuestion`):

1. **Main model** — what is the real-world thing being tracked? Propose a technical name.
   - Brief: "tracking kunjungan sales" → `dke.sales.visit`
   - Brief: "approval cuti karyawan" → `dke.leave.request`
   - Brief: "permintaan pembelian aset" → `dke.asset.request`
   - Naming rule: lowercase, dot-separated, start with org prefix (`dke.`, `hgis.`, `plm.` etc. for DKE modules) or a domain noun.

2. **Primary fields** — list 4–8 fields the record must carry. For each: name, type, required?
   - Prompt the user to describe in plain words ("siapa karyawan, kapan mulai, kapan selesai, alasan") and translate to technical fields yourself.

Always include these by convention (don't ask, just add):
- `name` (Char, display name — e.g. auto-generated sequence or a title)
- `company_id` (Many2one `res.company`, default current)
- `user_id` (Many2one `res.users`, default current — creator)
- `active` (Boolean, default True — for archive)

---

## Section 2 — Workflow / state machine

Ask **one question**:

3. **Workflow** — does this record have states/stages? If yes, list them and the transitions.
   - Common patterns:
     - **Simple approval**: draft → submitted → approved / refused
     - **Lifecycle**: draft → in progress → done / cancelled
     - **Sales-like**: draft → quotation → confirmed → done
     - **No states**: free-form record (e.g. a contact, a product)
   - Also ask: **who can trigger each transition?** (creator, manager, group-based)

If states are used, add the `state` Selection field automatically. Stages displayed as statusbar chips in the form view.

---

## Section 3 — Views (ASK AFTER sections 1 & 2 ANSWERED)

Ask **three questions** in one turn (or use `AskUserQuestion` sequentially):

4. **Tree / list columns** — for the default list view, which 4–6 columns matter most? Default sort?
   - Typical: name, key dates, main M2O, state with decoration, monetary total.

5. **Kanban grouping** — do we want a kanban board? If yes, group-by what?
   - Most common: group by `state` (if workflow exists) or by `stage_id` (if a separate `project.task`-style stage model).
   - Card content: usually name + 2–3 fields + maybe a progress bar or date.

6. **Search filters** — what are the top 3 filters users will click?
   - Typical: "My records" (`user_id = uid`), "This month", state-based (e.g. "To Approve", "Done"), grouped-by (by user, by state, by department).

---

## Section 4 — Navigation & extras (ASK LAST)

Ask **two questions** in one turn:

7. **Menu structure** — where does it live?
   - New top-level app? ("DKE HR" → new app icon)
   - Under an existing app? ("HR › Leaves › Cuti Khusus")
   - Also ask: does this module introduce a new app (with a menu icon) or just a sub-menu?

8. **Optional extras** — any of these?
   - **Wizard?** e.g. "Approve Multiple" mass-action, "Reject with Reason" popup.
   - **Smart buttons** on a related record? (e.g. a button on `hr.employee` counting leave requests.)
   - **Automated activities / scheduled tasks?** (e.g. auto-remind after 3 days of no approval.)
   - **Mail / chatter?** (almost always yes — include `mail.thread` and `mail.activity.mixin`.)
   - **Sequence** for auto `name`? (e.g. `REQ/2026/0001`.)
   - **Security groups?** Creator, Manager, Admin.

---

## Confirmation format — paste this back BEFORE generating

After all 8 answers, summarize in this exact structure and ask "Ok to generate?":

```
Module: `dke_leave` — Permintaan Cuti Karyawan
Model: `dke.leave.request` (inherits mail.thread, mail.activity.mixin)

Fields:
  - name (Char, auto-sequence REQ/YYYY/NNNN)
  - employee_id (Many2one hr.employee, required)
  - date_from (Date, required)
  - date_to (Date, required)
  - days (Float, computed)
  - leave_type (Selection: annual, sick, personal, unpaid)
  - reason (Text)
  - state (Selection: draft, submitted, approved, refused; default draft)
  - manager_id (Many2one res.users — approver)
  - company_id, user_id, active (conventions)

Workflow:
  draft → submitted (employee action: "Submit")
  submitted → approved (manager action: "Approve")
  submitted → refused (manager action: "Refuse" + reason)

Views:
  Form: statusbar (draft→submitted→approved/refused),
        2-col layout — left: employee/type/dates, right: manager/days/state,
        tab "Reason" (text area), chatter enabled
  Tree: name, employee, date_from, date_to, leave_type, state (decoration-success on approved, decoration-danger on refused)
  Kanban: group by state, card shows employee avatar + name + date range + days
  Search: "My Requests" (user_id=uid), "To Approve" (state=submitted + manager_id=uid),
          "This Year" (date_from in current year); Group By: State, Employee, Manager

Menu:
  HR › Leaves › Leave Requests  (under existing HR app)

Extras:
  - Wizard: "Approve Multiple" (mass-action on submitted records)
  - Smart button on hr.employee: "X Leave Requests" → list filtered by employee
  - Automated activity: 3-day reminder to manager if state stuck in submitted
  - Security: group Leave User (own records), group Leave Manager (team records),
              group Leave Admin (all)

Ok to generate?
```

Wait for user confirmation ("ok", "yes", "proceed", "lanjut") before generating ANY artifact.

---

## Generation step — what to produce after user says "ok"

Produce a single canvas spec that renders:

1. **HTML mockup** with 4 screens in a 2×2 grid:
   - Kanban view (grouped by state)
   - Form view (with statusbar, 2-col, tab, chatter)
   - Tree view (with decorations + totals if monetary)
   - Wizard (if applicable; otherwise a 4th "empty state" or search view)

2. **XML scaffold** in `xml/` with:
   - `__manifest__.py` (name, version, depends=['base', 'mail', 'hr'], data=[security, views, menu])
   - `security/ir.model.access.csv` — rows for each security group
   - `views/<model>_views.xml` — form + tree + kanban + search records
   - `views/<model>_menu.xml` — action + menuitem
   - `wizards/<wizard>_views.xml` — if applicable
   - `data/sequence.xml` — if using `ir.sequence` for name

Use the naming conventions in `references/odoo-xml-conventions.md`.

---

## Anti-patterns — don't do these

- **Don't generate before confirm.** Even if the brief is very detailed, echo back the bullet summary and wait.
- **Don't ask all 8 at once.** Overwhelming. Section by section.
- **Don't invent business logic** the user didn't mention. If user said "tracking kunjungan", don't add an "escalation after 72h" rule unprompted — ask.
- **Don't over-normalize.** If the user wants 3 fields that could be a separate model, keep them flat in the parent model unless user says "bisa multiple".
- **Don't default to English field labels** if the user is clearly writing in Indonesian. Mirror the user's language in `string=` labels. Technical field names stay English (`employee_id` not `karyawan_id`).
- **Don't skip the chatter** on transactional models (requests, orders, tickets). Almost always needed.
- **Don't forget security.** Every new model needs at least one access rule in `ir.model.access.csv`, otherwise the module won't install.

---

## Quick-start templates

For common briefs, you can propose these as starting points (but still ask to confirm):

### Approval request pattern
Model: `{prefix}.{thing}.request`, fields: `name, requester_id, date_request, details (Text), state (draft/submitted/approved/refused), manager_id, approved_date`. Workflow: draft→submitted→approved/refused. Views: form (statusbar + 2-col), tree (w/ state decoration), kanban (by state), wizard (mass approve).

### Simple tracker pattern (no workflow)
Model: `{prefix}.{thing}`, fields: `name, date, responsible_id, notes (Text), active`. No states. Views: list (sort by date desc), kanban (by responsible), form (single-col, chatter).

### Lifecycle / stage pattern
Model: `{prefix}.{thing}`, fields: `name, stage_id (M2O to {prefix}.{thing}.stage), date_open, date_close, user_id, priority (Selection)`. Separate stage model like project.task. Views: kanban by stage (primary view), list, form w/ chatter.

### Master data pattern
Model: `{prefix}.{thing}`, fields: `name, code (Char unique), category_id (M2O), active, company_id, notes`. No workflow. Views: list + form only, no kanban typically.
