---
name: uiux-odoo-generator
description: Design and scaffold Odoo 17/18 web backend screens — form views (header statusbar, tabs, chatter), tree/list views (filters, totals), kanban boards (stages, cards, progress bars), and modal wizards. Operates in THREE modes — (A) Customize existing view from a user-provided screenshot, (B) Design a new module from a natural-language brief, or (C) Direct spec from a structured object. Use whenever the user asks to mock up, design, prototype, customize, or scaffold an Odoo screen, view, module, or UI — including phrases like "bikin form Odoo", "desain kanban pipeline", "scaffold view Odoo", "register payment wizard", "customize this view", "tambah field di form ini", "bikin modul baru". Outputs a pixel-faithful HTML mockup that matches the Odoo 17 Enterprise design system AND a ready-to-install XML scaffold (ir.ui.view records + __manifest__.py).
---

# uiux-odoo-generator

A specialized companion to `uiux-generator`, focused entirely on Odoo 17/18 web backend UI. It produces two synchronized artifacts from a single spec:

1. **HTML mockup** (`mockups.html`) — a pixel-faithful Odoo Enterprise screen (burgundy primary, teal optional accent, warm cream body, chevron statusbar, tab-style chatter, kanban columns…). Renders in any browser, zero dependencies, no Odoo server needed. Use for stakeholder review, PRDs, Figma handoff, user interviews.
2. **XML scaffold** (`views/<module>_views.xml`, `__manifest__.py`, per-screen files) — `<record model="ir.ui.view">` entries for `form`, `tree`, `kanban`, and wizard views. Drop-in starting point for the actual Odoo module.

Both outputs come from the same canvas spec — change a field once, both regenerate.

## Three operating modes — **PICK THE RIGHT ONE FIRST**

The mode is determined by what the user gives you, not by a flag. Read the input before doing anything.

### Mode A — Customize Existing View (screenshot-driven) 🖼️

**Trigger**: user attaches/pastes a screenshot of an Odoo view AND asks to change/extend it. Example user messages:
- "tambah field NIK di form customer ini"
- "hide tab Accounting di form sale order"
- "add tombol Approve di statusbar"
- "customize view ini biar ada kolom region"
- any message with an image + Odoo context

**MANDATORY 4-step protocol**:

1. **Read the screenshot with vision.** Identify what you see. Follow `references/odoo-screenshot-reading.md` — it has the full checklist (breadcrumb → model inference, statusbar states, field inventory, tab inventory, chatter presence).

2. **Summarize back to the user in 3–5 lines.** Example:
   > Saya lihat form view `sale.order` di S00042, statusbar Draft → Sent → Sale (current: **Sale**), 4 field kiri (Customer, Invoice Address, Delivery Address, Quotation Template), 4 field kanan (Expiration, Quotation Date, Pricelist, Payment Terms), tab aktif: **Order Lines** dengan 3 baris produk, chatter aktif.

3. **Ask 3–5 clarifying questions** before touching any code. Use `AskUserQuestion` if available. Typical questions:
   - Field apa yang mau ditambah/ubah? (name, type, required?, default?)
   - Di kolom kiri, kanan, atau tab mana?
   - Ada kondisi visibility (invisible/readonly berdasarkan state)?
   - Tombol baru di header/statusbar? action type apa?
   - Perlu rename label field existing?

4. **Only after user confirms**, generate:
   - HTML mockup of the customized AFTER view (reuse all visible fields from the screenshot, add/modify per the request)
   - XML `ir.ui.view` record for the full customized view

Do NOT output xpath inherit snippets unless the user explicitly asks.

### Mode B — Design New Module (brief-driven) 🧱

**Trigger**: user describes a new feature/module from scratch in natural language. Example user messages:
- "bikin modul untuk approval permintaan cuti karyawan"
- "design sistem tracking kunjungan sales ke customer"
- "create a module for warehouse transfer approval"
- "butuh form baru untuk permintaan pembelian aset"

**MANDATORY 3-step protocol**:

1. **Clarify using the 8-item checklist** in `references/odoo-module-design-brief.md`. Ask the user in sections (model + fields first, then workflow, then views). Do NOT ask all 8 at once — progressively drill down. Use `AskUserQuestion` when the answer is a clear pick-one.

2. **Confirm the full design back in bullet form** before generating anything:
   > **Module**: `dke_leave` — Permintaan Cuti Karyawan
   > **Model**: `dke.leave.request`
   > **Fields**: `employee_id` (m2o hr.employee, required), `date_from` (Date), `date_to` (Date), `leave_type` (Selection: annual/sick/personal), `reason` (Text), `state` (Selection)
   > **Workflow**: draft → submitted → approved / refused
   > **Views**: List (employee, dates, type, state w/ decoration), Form (statusbar + 2-col + chatter), Kanban (by state), Wizard (Approve Multiple)
   > **Menu**: HR › Leaves › Leave Requests
   >
   > Ok to generate?

3. **Only after user says "ok proceed"**, generate the full 4-view set + XML scaffold + menu hint.

### Mode C — Direct spec (advanced) 🛠️

**Trigger**: the caller (another agent, or a power user) hands you a structured spec object directly. No clarify needed.

```bash
cd scripts
node example.js           # renders the bundled lead-to-cash workflow
```

Or write a custom spec file mirroring `scripts/example.js` and run it.

## Spec shape — at a glance

```js
{
  title: 'Odoo 17 — Lead-to-Cash',
  slug: 'odoo_17_lead_to_cash',
  module: 'odoo_17_lead_to_cash',       // XML module technical name
  theme: 'odoo-17',                     // or 'odoo-18', 'odoo-16', 'odoo-community'
  cols: 2,                              // grid layout (2×2 for 4 screens)
  screens: [
    { id: 'kanban-crm',    kind: 'kanban', /* stages + cards */,  connectsTo: ['form-so'] },
    { id: 'form-so',       kind: 'form',   /* statusbar + tabs + chatter */, connectsTo: ['tree-orders'] },
    { id: 'tree-orders',   kind: 'tree',   /* columns + rows */,   connectsTo: ['wizard-pay'] },
    { id: 'wizard-pay',    kind: 'wizard', /* fields + footer */                               },
  ],
}
```

See `references/odoo-component-schema.md` for the full field list per screen kind.

## Output locations

Respects, in order:
1. `opts.outputDir` — caller override
2. `opts.baseDir` + `spec.slug`
3. `UIUX_ODOO_OUTPUT_DIR` env var
4. Cowork fallback: `<session>/mnt/outputs/uiux-odoo-output/<slug>/`
5. CWD fallback: `./uiux-odoo-output/<slug>/`

HTML bundle lives at `<dir>/mockups.html`; XML scaffold at `<dir>/xml/views/…`.

## Live preview workflow — **DO THIS AUTOMATICALLY after every generation**

This skill ships a detached preview daemon (`scripts/preview.js`) that hosts the rendered mockup and live-reloads the user's browser on every regeneration. Treat it as part of the generation step, not as an optional extra.

### 1. After the FIRST generation for a session — auto-start preview

Right after you write the spec and render `mockups.html`, run:

```bash
node scripts/preview.js start --spec /absolute/path/to/<canvas>.js --slug <spec.slug>
```

Tell the user the local URL and give them the two follow-up commands ("public URL" and "stop"). Do not wait for permission to start — this is in-scope for the generation.

Behavior:
- The process is **detached** (survives across tool calls).
- Port auto-picks starting from 4455.
- State is tracked at `~/.uiux-preview/<slug>.json`.
- If a preview with the same slug is already running, it is **reused** (no double-spawn).

### 2. On REVISION prompts — edit the spec, don't restart

When the user says "ubah warna tombol jadi teal", "tambah field Discount", "hide tab Customer Signature", etc. — **edit the existing spec file in place**. The watcher picks up the change, re-runs the renderer, and pushes a WebSocket reload to any open browser tab. Confirm the change in one line ("✔ Discount field added — browser will refresh").

Only restart the preview (stop + start) if the slug itself changed (different module/feature) or the user explicitly asks.

### 3. Public URL via Cloudflare — ON-DEMAND ONLY

Start a public tunnel only when the user says "share", "public URL", "biar bisa diakses stakeholder", or similar. Run:

```bash
node scripts/preview.js tunnel --slug <spec.slug> --auto-install
```

- Uses Cloudflare Quick Tunnels (`https://xxxxx.trycloudflare.com`) — no Cloudflare account needed.
- `--auto-install` will install `cloudflared` via brew / apt / dnf / winget / GitHub binary depending on the OS. **Ask the user for consent before running a sudo install step** on Linux.
- Tunnel process is detached; its PID is stored in the same state file.

### 4. Stopping

When the user says "stop preview", "matikan server", or is clearly done:

```bash
node scripts/preview.js stop --slug <spec.slug>
```

This kills both the serve daemon and the tunnel.

### 5. Status / listing

```bash
node scripts/preview.js list               # all running previews
node scripts/preview.js status --slug <x>  # full state JSON for one slug
```

Use `list` at the start of a session to detect previews already running from a previous run (e.g. after a session restart).

## Ancillary tools

```bash
node scripts/generate-xml.js --spec path/to/screens.json --module my_module
node scripts/generate-xml.js --example
node scripts/serve.js --spec ./my-canvas.js        # foreground serve (use preview.js for background)
node scripts/serve.js --root /path/to/output
node scripts/spec-template.js --kind customize > stub.js    # emits a commented spec stub
node scripts/spec-template.js --kind new-module > stub.js
node scripts/preview.js install-cloudflared --dry-run       # show install plan for your OS
```

## Reference playbooks (read when deeper context is needed)

- `references/odoo-screenshot-reading.md` — **Mode A protocol.** What to extract from a screenshot (breadcrumb → model, statusbar, field layout, tab inventory) and a breadcrumb-to-model inference table.
- `references/odoo-module-design-brief.md` — **Mode B protocol.** 8-item clarify checklist (model, fields, workflow, tree, kanban, search, menu, extras) + confirmation format.
- `references/odoo-view-types.md` — when to pick form vs tree vs kanban vs wizard, and how each maps to user tasks.
- `references/odoo-component-schema.md` — exhaustive spec keys per kind, every widget/flag accepted.
- `references/odoo-xml-conventions.md` — naming rules for view ids, model names, security files, manifest entries.
- `references/odoo-design-patterns.md` — the Odoo 17 Enterprise look: warm cream body, burgundy primary, teal optional, chevron statusbar, tab-style chatter, kanban progress bars.

## Relation to sibling skills

- **uiux-generator** — generic UI design system scaffolder (any web app). Reuse its `mockup-builder` + `canvas-server`; this skill is layered on top.
- **dke-prd** — if the user wants an Odoo feature documented as a PT DKE PRD, invoke `dke-prd` first and feed the PRD sections into this skill for the mockup.
