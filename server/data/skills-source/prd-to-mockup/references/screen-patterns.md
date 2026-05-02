# Screen Patterns — Layout Templates & Inference Rules

This reference helps the agent pick the right `layout` for each screen and know what components belong inside.

## Template catalog

### `form`

**Use for**: login, signup, settings, filters, any single-purpose input screen.

Expected components (in order):
- `topbar` with the product name and 1–2 secondary actions (Help, Cancel).
- `heading` level 2 stating the form's purpose.
- `muted` one-line subtitle / context.
- 2–5 `input` or `select` or `checkbox` fields — keep it above the fold.
- 1 primary `button` at the bottom.

Anti-patterns: more than 7 fields on one form (break into steps), missing CTA, no error/validation state suggested.

### `list`

**Use for**: inbox, feed, search results, index pages.

Expected:
- `topbar` with the count ("3 unread") and a secondary action (Filter / Sort).
- `nav` if the list sits inside broader navigation.
- `heading` with the list's name.
- `muted` "X items · updated Y ago".
- A handful of `card` components (3–6 is fine for a mockup) or one `list`.
- Optional `button` for "Mark all read" / "Load more".

Anti-patterns: showing 20 rows in a mockup — users can't scan them. Pick 3 representative items.

### `detail`

**Use for**: one-record views — notification detail, user profile, order, PR.

Expected:
- `topbar` with Back + actions (Edit, Share).
- `heading` level 1 (the record's title).
- `muted` metadata line (created / updated / owner).
- `row` of action `button`s (primary + 1–2 ghost).
- 2–3 `card`s for related data (Summary, Activity, Related items).

Anti-patterns: stuffing editable form fields into a detail page (split into `form`).

### `dashboard`

**Use for**: overviews, operational consoles, admin home.

Expected:
- `topbar`.
- `heading` level 2 ("Overview", not the company name).
- `row` of 3–4 `kpi` cards at the top — always.
- 1–2 `card`s below for deeper sections ("Recent activity", "Top flows").

Anti-patterns: more than 6 KPIs on one screen, dashboard without a single number (this is a `list` or `detail`).

### `empty`

**Use for**: first-run, post-clear, post-deletion, filter-returns-zero states.

Expected:
- `topbar` (minimal).
- One `empty` component with title + body + optional CTA.

Rule: the empty state's CTA should unambiguously answer "what do I do next?". If unclear, add a second CTA or a short explainer.

### `error`

**Use for**: network failure, permission denied, 404, 500.

Expected:
- `topbar`.
- `alert` of kind `danger` with the human-readable message.
- Optional `button` for retry.

Rule: never show a raw stack trace. State what happened + what the system is doing + what the user can do.

## Screen inference from a PRD

When extracting screens from a `prd-output/<slug>/` bundle:

1. **Read Section 6 (Solution Overview)** — look for bullet points describing user journey steps. Each distinct step is a candidate screen.
2. **Read Section 7 (Functional Requirements)** — each "user can X" statement maps to one or more screens.
3. **Deduplicate**: two steps that share UI (e.g. "create order" and "edit order") become one `form` screen.
4. **Add states**: for any primary flow, include at least one `empty` and one `error` screen — reviewers often forget these.

Rule of thumb screen counts:
- Small feature (< 2 user stories): 3 screens (entry + main + detail).
- Medium feature (2–5 stories): 5–6 screens (add empty + error).
- Large feature (> 5 stories): split into multiple mockup bundles by persona or flow.

## Component composition guidance

**Rows of buttons**: wrap multiple `button`s in a `row` so they sit side-by-side. Always primary first.

**KPI grid**: 3 or 4 KPIs per `row` reads cleanly at desktop widths; 2 per row on tablet.

**Mixing content + states**: if a screen could be empty *or* populated, render both as separate screens (e.g. `02-empty` and `02-live`) and `connectsTo` them. This makes the flow explicit.

**Avoid lorem-ipsum in body**: write plausible copy. Reviewers trust mockups more when the copy feels like something the product would actually say.

## When to extend beyond templates

If no template fits — e.g. a map view, a canvas editor, a video player — use `type: 'html'` components to drop in raw HTML:

```js
{ type: 'html', html: '<div style="height:360px;background:#eef;border-radius:8px;display:grid;place-items:center">Map placeholder</div>' }
```

Keep it to placeholders. This skill is for **discussing** UI, not **shipping** it.
