# Prototype Canvas — screen templates & conventions

This playbook is for **prototype mode**: authoring a multi-screen canvas that the team can walk through in a meeting. The rendering engine is shared with `prd-to-mockup` (`lib/mockup-builder.js`), so everything below applies to both skills.

## The SPEC object

Every canvas starts from one JS object:

```js
const SPEC = {
  title: 'Feature name — UI Prototype',
  slug: 'feature-slug',
  theme: 'modern-teal',         // or 'dke-blue' | 'corporate-neutral' | 'minimal-black' | {...custom}
  viewport: 'desktop',           // 'desktop' | 'tablet' | 'mobile' | 'responsive'
  cols: 3,                       // grid columns for auto-layout
  screens: [ ... ],
};
```

Keep `slug` short and hyphenated — it becomes the folder name.

## Layout templates (pick one per screen)

| Layout | Best for | Must include |
|---|---|---|
| `form` | Single-purpose input screen | topbar, heading, 2–5 fields, 1 primary button |
| `list` | Feed / inbox / search results | topbar, nav, heading, 3–6 cards or one `list` |
| `detail` | One-record view | topbar with Back, level-1 heading, action row, 2–3 cards |
| `dashboard` | Overviews / admin home | topbar, heading level 2, row of 3–4 KPIs, 1–2 cards |
| `empty` | First-run / zero-results | minimal topbar, `empty` component with title + body + CTA |
| `error` | Connection lost / 404 / 500 | topbar, `alert` of `kind:'danger'`, retry button |

The builder auto-fills missing structure per layout. You don't need to declare every chrome element — start with the minimum and iterate.

## Component catalogue (cheat sheet)

```js
// Text
{ type: 'heading', level: 1|2|3, text: '...' }
{ type: 'text',    text: '...' }
{ type: 'muted',   text: '...' }

// Form
{ type: 'input',    label, inputType: 'text'|'email'|'password'|'number'|'date', placeholder, value }
{ type: 'select',   label, options: ['A', 'B'] }
{ type: 'checkbox', label, checked: true|false }
{ type: 'button',   label, variant: 'primary'|'ghost'|'danger' }

// Layout
{ type: 'row',    children: [ ... ] }
{ type: 'stack',  children: [ ... ] }
{ type: 'spacer', size: 16 }

// Chrome
{ type: 'topbar', brand: 'App', actions: ['Search','Profile'] }
{ type: 'nav',    items: [{ label: 'Home', active: true }] }

// Content
{ type: 'card',   title, body, meta }
{ type: 'list',   items: ['a','b','c'] }
{ type: 'table',  headers: [...], rows: [[...]] }
{ type: 'kpi',    label, value, delta: '+5%', deltaKind: 'up'|'down' }
{ type: 'alert',  kind: 'info'|'danger'|'success', text }
{ type: 'empty',  title, body, cta }
{ type: 'avatar', name: 'Dian Pratama' }

// Escape hatch
{ type: 'html',   html: '<div>custom</div>' }
```

Unknown `type` values render as a `[unknown-type]` placeholder — they never crash. Fine during iteration.

## Canvas arrangement

Screens lay out on an infinite 2D board:

- **Default grid**: `cols × rows`. If you don't specify `cols`, the builder picks `min(3, ceil(sqrt(n)))`.
- **Custom positions**: give a screen explicit `x` and `y` to override the grid.
- **Spacing**: viewport width + 140px gutter horizontally, viewport height + 140px vertically.

### When to use a custom arrangement

- **Phases** — cluster onboarding top-left, daily use center, admin bottom-right.
- **Alt flows** — place the alt below the happy path so `connectsTo` arrows read top-to-bottom.
- **Before/After** — today state on the left, future state on the right, same vertical axis.

Default grid is fine for most flows. Reach for custom layouts only when the flow has structure worth showing.

## Connections (`connectsTo`)

Each screen may list `connectsTo: ['<target-id>', ...]`. The builder renders a bezier arrow behind the screens (SVG z-index below).

Best practices:

- Use arrows **only for non-linear flows**. A linear 1→2→3 flow communicates through numbered labels — arrows would be noise.
- **Don't** let more than 3 arrows converge on a single screen. Split into two bundles.
- Arrows are 50% opacity; dense flows still read because screens dominate.

## Pan / zoom / navigation

Every rendered canvas ships with:

| Input | Action |
|---|---|
| Drag on canvas | Pan |
| Mouse wheel / pinch | Zoom toward cursor |
| Click sidebar item | Jump to screen at 80% zoom |
| Click minimap screen | Same jump |
| `F` | Fit-all |
| `0` | Reset to 100% top-left |
| Toolbar 25 / 50 / 100 | Set zoom directly |

Initial load auto-fits all screens after ~50ms. Zoom clamps to `0.1` – `2.5`.

## Screen counts by feature size

| Feature scope | Screen count | Always include |
|---|---|---|
| Small (< 2 user stories) | 3 screens | Entry + main + detail |
| Medium (2–5 stories) | 5–6 screens | + empty state + error state |
| Large (> 5 stories) | Split into multiple bundles | One bundle per persona or flow |

Reviewers always forget empty and error states. Adding them elevates the mockup from "pretty picture" to "actually considered the product".

## Copywriting for mockups

Write plausible copy, not lorem-ipsum. Reviewers trust mockups more when the copy feels like what the product would actually say.

Guidelines:
- Concrete names (Dian, Surabaya-02) instead of placeholders.
- Specific numbers (12,480 SKUs) instead of "Some value".
- Error messages that say *what happened* + *what the system is doing* + *what the user can do*.
- Empty states that unambiguously answer "what do I do next?".

Bad: "No items". Good: "No low-stock items 🎉 — every SKU is above its reorder point."

## Serving with live reload

```bash
# Option A — watch an existing output directory
node scripts/serve.js --root ./uiux-output/<slug>

# Option B — watch the spec file (rebuilds on save)
node scripts/serve.js --spec scripts/generate_<slug>_canvas.js
```

The server runs on `127.0.0.1:4455` by default. Change with `--port`. The live-reload snippet is injected into every HTML response — no manual refresh.

## Performance

Typical file sizes (all inline, no external requests):

- 3-screen mockup: ~25 KB
- 7-screen mockup: ~45 KB
- 15-screen mockup: ~90 KB

Zero runtime dependencies means no compatibility issues across browsers, agents, or offline sessions.
