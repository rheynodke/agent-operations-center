# Odoo 17 / 18 Design Patterns

The visual language the generator mimics — what makes a screen feel like Odoo even at a glance.

## Palette

| Token       | Odoo 17     | Odoo 18     | Odoo 16       | Community     |
|-------------|-------------|-------------|---------------|---------------|
| Primary     | `#714b67`   | `#714b67`   | `#875a7b`     | `#5c8ba6`     |
| Accent      | `#017e84`   | `#3b6098`   | `#00a09d`     | `#7c7bad`     |
| Background  | `#f9f9f9`   | `#f9fafb`   | `#f0eeee`     | `#f5f5f5`     |
| Surface     | `#ffffff`   | `#ffffff`   | `#ffffff`     | `#ffffff`     |
| Text        | `#4c4c4c`   | `#1f2328`   | `#555555`     | `#454748`     |
| Muted text  | `#6c757d`   | `#606060`   | `#6c757d`     | `#8f8f8f`     |
| Success     | `#5cb85c`   | `#2fb344`   | `#28a745`     | `#5cb85c`     |
| Warning     | `#f0ad4e`   | `#f0a000`   | `#f0ad4e`     | `#f0ad4e`     |
| Danger      | `#d04437`   | `#e0344c`   | `#d9534f`     | `#d04437`     |

The burgundy `#714b67` is unmistakably Odoo — use it for the topnav, primary buttons, the current step of a statusbar, and breadcrumb highlights. Keep the teal `#017e84` for links and accents, not for primary CTAs.

## Topnav

- Always one horizontal bar at `height: 36px`.
- Left: app logo + app label (`Sales`, `CRM`). The logo is burgundy-filled, no gradient.
- Middle: app's top-level menus. Active item has a subtle underline, not a pill.
- Right: icon strip (phone, chat, bell) + user avatar initials in burgundy. A small red dot on the chat icon when there are unread messages.

## Breadcrumb + action bar

Directly under the topnav, height `36px`, divider at the bottom.

- Left: burgundy **New** button (filled) followed by `breadcrumb › current` crumbs. The gear icon (⚙) sits just after the current crumb for the "Actions" menu.
- Right: pager (`1 / 12`) with ‹ › ≡ buttons. The ≡ button toggles view mode.

## Statusbar

The statusbar sits just under the action bar, directly above the sheet. It's a horizontal strip of pills:

- Done states — soft grey pills with a tick or dash.
- Current state — burgundy background, white text, `font-weight: 600`.
- Future states — grey outline only.

Common grammars (memorise these):

- Sales Order: `Quotation → Quotation Sent → Sales Order → Locked`.
- Invoice: `Draft → Posted → Paid → Reconciled`.
- Task: `In Progress → Ready → Done → Cancelled`.
- Purchase Order: `RFQ → RFQ Sent → Purchase Order → Locked`.

Action buttons (Confirm, Send by Email, Cancel) live **to the right** of the statusbar on the same row, never below. Primary actions are burgundy-filled; secondary actions are burgundy-outlined; ghost actions are underline-only grey.

## Form sheet

The classic Odoo sheet:

- White surface, `box-shadow: 0 1px 2px rgba(0,0,0,0.05)`, `border-radius: 4px`, `max-width: 1200px`, centred on a pale `#f9f9f9` background.
- Padded 24px all sides.
- Record label — 11px muted — sits above the title.
- Title — 28px, bold, black.
- Two-column group starts ~16px under the title. Column widths 50/50. Labels left-aligned at ~32% of the column width, values fill the rest.

Field rows:

- Height ~28px, line-height 20px, no vertical borders.
- Required fields get a red asterisk after the label.
- Help fields get a tiny `?` circle that shows on hover.
- Read-only values render without a border and in slightly darker text.
- Monetary values are shown as `Rp 1.200.000` or `$ 832.00` — the currency code precedes the amount with a non-breaking space.

## Notebook tabs

- Always under the two-column group, never above.
- Tab strip height 36px. Tabs have no background — they're just text with an underline on active.
- Active tab: burgundy 2px underline + darker text.
- Pane content has 16px padding top.

## One2many inline tables

Inside a notebook pane or directly in the form:

- Header row has a grey `#f7f7f7` background and uppercase `font-size: 11px` labels.
- Rows alternate with subtle hover highlight; deleted rows render struck-through.
- The `+ Add a line` CTA is teal-coloured, underlined on hover.
- Summary row lives below the table, right-aligned, with bold totals.

## Chatter

Right-rail on wide viewports, full-width at the bottom on narrow. Always:

- Action row: **Send message** (primary), **Log note**, **WhatsApp** (in Odoo 17/18), **Activities**.
- Meta row: search icon, 📎 attachment count, 👤 follower count, **Follow** toggle.
- Divider showing the activity date.
- Timeline: each entry has avatar + who + when + body. OdooBot automatic entries are in a slightly greyer tone.

## Kanban board

- Columns have a 4px top bar in the stage's colour — split into progress segments if `progress` is an array.
- Column header: title + "+" + count badge on the right.
- Card: white surface, 8px radius, `box-shadow: 0 1px 2px rgba(0,0,0,0.1)`, 12px padding, 10px between cards.
- Card title 14px bold, subtitle 12px muted. Tags are inline pills with a soft pastel background.
- Footer row: priority star · done tick · attendees · notes · attachments · deadline · spacer · avatar · status dot.

## Wizards (modals)

- Backdrop: `rgba(0,0,0,0.5)`, full-viewport.
- Modal: white, 6px radius, 480–640px wide, max-height `90vh` with internal scroll.
- Head: 16px padding, title left, close × right.
- Body: single-column group, field rows as in the form.
- Foot: primary button left, ghost buttons right, or vice versa — Odoo flips based on destructive-vs-safe. Our generator puts primary left, discard right.

## Spacing & typography

- Base font: system UI (`-apple-system, 'Segoe UI', Roboto, …`).
- Sizes: `12px` base, `14px` inputs, `11px` muted meta, `28px` titles, `16px` section headings.
- Radii: `4px` buttons/inputs, `6px` modals/cards, `2px` tags.
- Shadows: single soft shadow on cards and the sheet — never stack multiple shadows.

## Accessibility notes

- Burgundy on white meets AA contrast for normal text (4.5:1). Avoid burgundy text on the pale `#f9f9f9` background — it dips below.
- Status pills need a text label in addition to colour — colour-blind users can't rely on the green/yellow/red alone.
- Every interactive element needs a focus ring. In Odoo, this is a 2px burgundy outline with a 1px white inset.

## Don'ts

- No gradients. Odoo is flat.
- No rounded-everything. The sheet, tables, and inputs are slightly rounded; avatars and tags are pill-shaped; buttons are `4px`.
- No drop shadows on text.
- No emojis as icons. Odoo uses FontAwesome glyphs or Bootstrap icons. (Our mockup uses Unicode symbols for speed — replace with FA when you move to real XML.)
- No blue links. Links are teal `#017e84`.
