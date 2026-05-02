# Repo UI Audit — interpreting the scan

This playbook is for **audit mode**: reading what `scripts/audit.js` produces and turning it into a short document the engineering lead will actually read.

## What the audit captures

`lib/repo-ui-scan.js` walks the repo (ignoring `node_modules`, `.git`, build outputs) and extracts:

- **Tailwind config** — colors, fontFamily, spacing, borderRadius, boxShadow.
- **CSS custom properties** — every `--token: value;` declaration.
- **SCSS/LESS variables** — `$name` and `@name` declarations.
- **Theme files** — `theme.{ts,js,json}`, `tokens.*`, `colors.*`, `design-tokens.*`.
- **Component inventory** — React (`.jsx`/`.tsx`), Vue (`.vue`), Svelte (`.svelte`) components with usage counts.
- **UI libraries from `package.json`** — MUI, Chakra, Antd, Radix, shadcn, Mantine, styled-components, Emotion, Stitches, Tailwind.

It does **not** run the app, touch the DB, or evaluate JS. It's regex + file walking. Fast, portable, but deliberately shallow.

## Reading `ui-scan-summary.json`

Top-level keys worth inspecting:

- `totalFiles` — how many files were actually scanned (after `--max-files` cap). If this is < 100 on a real app, bump `--max-files` or check ignored dirs.
- `buckets` — token counts per category. This is your drift indicator (see below).
- `rawColorCount` — every distinct color literal found in any source. Big gap between `rawColorCount` and `buckets.color` means a lot of hard-coded colors that aren't tokenized.
- `uiLibs` — what's imported. Cross-check: is one of these dead-code you can drop?
- `palette` — the 4-role inference. Always sanity-check against the actual running product.
- `components` — keys are component names, values include `usage` counts.

## Drift signals

The four patterns worth flagging:

### Palette sprawl
`rawColorCount > 40` + `buckets.color < 20` means colors are hard-coded inline or in styled components. Ask: *"Can we extract a canonical scale and reference it?"*

### Near-duplicate colors
Colors like `#0079fc` and `#007aff` suggest drift from a shared source. List the duplicates in the brief with their counts.

### Missing scales
`!buckets.radius` / `!buckets.shadow` means corners and elevation are improvised per-component. Even a 3-rung scale (sm/md/lg) is better than none.

### Multiple UI libraries
More than 2 UI libraries in `package.json` almost always means an incomplete migration. Flag it prominently — the consistency win from consolidating is usually larger than a full redesign.

## Reading `component-inventory.md`

Components are ranked by usage. The top of the list is your **de-facto design system** — whatever is used 50+ times is effectively canonical, even if it was never officially blessed.

Two things to look for:

1. **"Base" components that should exist but don't** — e.g. `Button` used 120 times, `ButtonGhost` used 80 times, `ButtonDestructive` used 30 times. That's a `Button variant="..."` waiting to happen.

2. **Low-usage components that look like duplicates** — e.g. `Card`, `CardV2`, `CardNew`. These are the refactor targets.

Don't waste time on one-off page components. Focus on anything with 20+ references.

## Writing recommendations

The audit's `style-guide.html` auto-generates a Recommendations section from heuristics. It's a starting point, not the final word. For the written handoff, rewrite as:

```
## Recommendations

1. **Consolidate button variants** — `Button`, `ButtonGhost`, `ButtonDestructive` total 230 usages across 84 files.
   Collapse into a single `Button` with a `variant` prop. (Effort: 1 sprint.)

2. **Tokenize the blue palette** — 14 distinct blues in use, 3 within 2% of each other.
   Extract into `--color-blue-{50..900}` and migrate high-usage files first. (Effort: 2 sprints, touches ~60 files.)

3. **Define elevation scale** — no shadow tokens today. Propose sm/md/lg matching existing patterns. (Effort: 1 day to document + 1 sprint to adopt.)
```

Three recommendations is usually enough. More dilutes the message. Each one needs:
- A concrete data point from the audit (usage count, duplicate count).
- A named action (consolidate / tokenize / define).
- A rough effort estimate.

## What the audit misses

Be explicit about the limits so the team doesn't treat it as gospel:

- **Runtime-computed styles** — tokens generated from JS at runtime (e.g. `styled-components` tagged templates with variables) won't be picked up.
- **Non-code assets** — SVGs, PNG mockups, Figma files.
- **Accessibility** — the audit is purely style-focused. A11y audit is a separate pass.
- **Behavior** — animations, focus management, keyboard flows. Style tokens don't capture any of that.

Call these out at the bottom of the written handoff in one paragraph. Sets expectations, earns trust.

## When to re-run

The audit is a **snapshot**. Re-run it:

- Before every major design-system decision (to anchor the discussion in data).
- After consolidation PRs land (to measure the change).
- Quarterly, as a health check.

Don't wire it into CI — it's not a test, it's a mirror. Teams that run it too often stop reading it.
