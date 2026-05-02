# Canvas Layout & Component Schema

This reference documents the rendered HTML canvas: how screens are arranged, how pan/zoom works, and the full schema for every component `type` the builder accepts.

## Canvas arrangement

Screens lay out on an infinite 2D board:

- **Default grid**: `cols × rows`. The builder picks `cols = min(3, ceil(sqrt(n)))` when not specified, so 3 screens → 3×1, 7 screens → 3×3 (with 2 empty cells).
- **Spacing**: viewport width + 140px gutter horizontally; viewport height + 140px vertically.
- **Custom positions**: any screen with an explicit `x` and `y` overrides the grid. Useful for story-driven flows (e.g. all login screens top-left, all admin screens bottom-right).

### When to use a custom arrangement

- You have clear **phases** (onboarding, daily use, admin) and want to separate clusters spatially.
- You have **alt flows** diverging from a main flow — place the alt below the happy path so `connectsTo` arrows read top-to-bottom.
- You're building a **before/after** story — put the "today" state on the left, "future" state on the right, same vertical axis.

Default grid is fine for most PRDs. Reach for custom layouts only when the flow has structure worth showing.

## Pan & zoom behavior

Behavior built into every rendered canvas:

| Input | Action |
|---|---|
| Click + drag on canvas | Pan. |
| Mouse wheel / pinch | Zoom toward the cursor. |
| Click a screen name in the sidebar | Jump to that screen at 80% zoom. |
| Click a minimap screen | Same jump. |
| `F` key | Fit-all. |
| `0` key | Reset to 100% at top-left. |
| Toolbar 25% / 50% / 100% | Set zoom directly. |

Initial state: the page auto-fits all screens on load (~50ms delay). This avoids the "where am I?" confusion on first open.

Zoom range is clamped to `0.1` – `2.5` to prevent runaway zoom loops from trackpad gestures.

## Connection arrows

Specifying `connectsTo: ['<screen-id>', ...]` on a screen draws a bezier arrow from its right edge to the left edge of each target. Arrows render **behind** the screens (SVG z-index below the frames).

Best practices:

- Use for **non-linear** flows only — if the flow is a straight line, the numbered screen labels already communicate order.
- Avoid arrow spaghetti: > 3 arrows converging on one screen becomes unreadable. Split into two bundles.
- Arrows are 50% opacity by default, so a dense flow still reads (screens dominate; arrows are decoration).

## Component schema reference

Every object in a screen's `components` array has a `type`. Unknown types render as `[unknown-type]` placeholders — they never crash.

### Text components

```js
{ type: 'heading', level: 1 | 2 | 3, text: '...' }
{ type: 'text',    text: '...' }   // aka 'p'
{ type: 'muted',   text: '...' }   // secondary / caption
```

### Form components

```js
{ type: 'input',    label: '...', inputType: 'text' | 'email' | 'password' | 'number' | 'date', placeholder: '...', value: '...' }
{ type: 'select',   label: '...', options: ['Option A', 'Option B', ...] }
{ type: 'checkbox', label: '...', checked: true | false }
{ type: 'button',   label: '...', variant: 'primary' | 'ghost' | 'danger' }
```

### Layout components

```js
{ type: 'row',   children: [...]  }  // horizontal flex, wrap
{ type: 'stack', children: [...]  }  // vertical flex
{ type: 'spacer', size: 16 }         // pixels
```

### Chrome

```js
{ type: 'topbar', brand: 'App Name', actions: ['Profile', 'Logout'] }
{ type: 'nav',    items: [{ label: 'Home', active: true }, { label: 'Settings' }] }
```

### Content blocks

```js
{ type: 'card', title: '...', body: '...', meta: '...' }
{ type: 'list', items: ['a', 'b', 'c'] }
{ type: 'table', headers: ['Col 1', 'Col 2'], rows: [['r1c1', 'r1c2'], ...] }
{ type: 'kpi', label: '...', value: '...', delta: '+5%', deltaKind: 'up' | 'down' }
{ type: 'alert', kind: 'info' | 'danger' | 'success', text: '...' }
{ type: 'empty', title: '...', body: '...', cta: '...' }
{ type: 'avatar', name: 'Dian Pratama' }       // renders initials
```

### Escape hatches

```js
{ type: 'html', html: '<div>custom markup</div>' }
```

Use for anything the schema doesn't cover. Keep it simple — this is a mockup, not a live component library.

## Theme integration

Every CSS rule uses CSS custom properties (`--primary`, `--surface`, etc.) populated from the theme. Changing the theme re-skins every component automatically.

The grid background (dotted) uses `--border` at low opacity so it stays subtle against any palette.

## File size & performance

Typical output sizes:

- 3-screen mockup: ~25 KB HTML
- 7-screen mockup: ~45 KB HTML
- 15-screen mockup: ~90 KB HTML

All inline — no external requests when opened. Zero runtime deps means no compatibility issues across browsers, agents, or offline sessions.
