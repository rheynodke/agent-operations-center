---
name: prd-to-mockup
description: Turn a PRD (or any feature spec) into an interactive HTML mockup canvas — pan + zoom, multiple screens, themed frames, inspired by Figma / Google Stitch / Obra Superpower UI generator. Use whenever a user asks to create UI mockups, wireframes, screen flows, a clickable prototype from a PRD, a visual storyboard, an HTML canvas for designs, or any variant like "buatkan mockup dari PRD", "bikin wireframe HTML", "generate UI canvas", "visualize the flow", "render screens dari spec", "mockup.html dari bundle PRD". Also trigger when the user has just generated a PRD with the prd-generator skill and wants a quick visual companion. Output is a single self-contained .html file — no build step, no server — that opens in any browser and ships next to the PRD .docx in the same prd-output/<slug>/ folder. Theme-aware (matches PRD theme), viewport-configurable (desktop / tablet / mobile), works in any agent that reads the Skill format.
---

# PRD → Mockup Canvas

Standalone skill that turns a feature spec (most commonly the `prd-output/<slug>/` bundle from the `prd-generator` skill) into an **interactive HTML canvas** with multiple themed screens laid out on a pannable, zoomable board — think Figma / Google Stitch / Obra Superpower UI generator, but as a single portable file.

Output is one HTML file. It opens in any browser offline. No build step, no npm install needed at view time, nothing to host.

## When to use

Trigger on requests like:

- "Generate mockup / wireframe / UI canvas from this PRD"
- "Bikin screen flow dari bundle PRD", "buatkan mockup HTML dari spec ini"
- "Visualize the user journey for [feature]"
- "Kasih saya render cepat dari Section 6 dalam bentuk visual"
- "Prototype HTML dari fitur [X]" — agent then clarifies fidelity
- Right after `prd-generator` finishes → "want me to also generate a mockup canvas?"

**Do NOT use for**: production-ready UI code, responsive layouts for shipping, anything requiring a build system. This is a **visual companion** to a PRD — enough fidelity to discuss with stakeholders, not enough to ship.

## Relationship to prd-generator

This skill is **standalone** but designed to plug in next to `prd-generator`:

- Default output: `prd-output/<slug>/mockups.html` — sits next to the `.docx` in the same bundle folder.
- Screens can be **inferred from the PRD** (Section 6 Solution Overview + Section 7 Functional Requirements) or specified explicitly.
- Theme defaults to matching the PRD's theme.
- A sidecar `screens.json` captures the input spec for regeneration.

You can also use it completely without a PRD — just hand it a screens array.

## Operating modes

| Mode | When | What the agent does |
|---|---|---|
| `from-bundle` (**default when a PRD exists**) | User points at or just generated a `prd-output/<slug>/` bundle | Read `inputs.json` + the PRD's Section 6 & 7 → infer 3–7 screens → render canvas → save mockups.html into the bundle |
| `from-spec` | User writes or pastes a screens spec | Render directly. |
| `interactive` | User has a feature idea but no PRD and no spec | Ask 2–3 `AskUserQuestion` batches: what screens, what user persona, what fidelity → render. |

Announce the mode before rendering.

## Workflow

### Phase 0 — Pre-flight

1. Read `references/screen-patterns.md` and `references/canvas-layout.md`.
2. Identify inputs:
   - Is there a `prd-output/<slug>/` bundle path?
   - Is there an uploaded spec JSON?
   - Otherwise: start `interactive` mode.

### Phase 1 — Extract or elicit screens

**From a PRD bundle (recommended)**:

1. Read `prd-output/<slug>/inputs.json` for title, theme, locale.
2. Read the `.docx` or any associated markdown to find Section 6 (Solution Overview) and Section 7 (Functional Requirements).
3. Extract user-journey steps. Each step or primary interaction ≈ 1 screen. Typical PRD yields 3–7 screens.
4. For each screen, figure out: `name`, `purpose`, best-fit `layout` template (form / list / detail / dashboard / empty / error), and the key `components` (buttons, fields, lists, cards, KPIs, etc.).

**Interactive**:

1. Ask the user the feature + persona + fidelity.
2. Suggest a screen list (3–5) based on common patterns in `references/screen-patterns.md`.
3. Confirm before rendering.

### Phase 2 — Build the spec

The spec passed to `mockup-builder.renderCanvas()` looks like:

```js
{
  title: 'PRD: Real-time Notifications',
  slug:  'realtime-notifications',
  theme: 'modern-teal',   // preset or custom object
  viewport: 'desktop',    // 'desktop' | 'tablet' | 'mobile' | 'responsive'
  cols: 3,                // optional — columns on the canvas grid
  screens: [
    {
      id: '01-empty',
      name: '1. Empty inbox',
      purpose: 'User sees no active notifications yet.',
      layout: 'empty',
      components: [
        { type: 'topbar', brand: 'ACME', actions: ['Profile'] },
        { type: 'empty', title: 'All caught up', body: 'No notifications right now.' },
      ],
      connectsTo: ['02-live'],
    },
    ...
  ],
}
```

Rule of thumb: 3 is a minimum (entry → main → detail), 5–7 is ideal for most PRDs, > 10 gets overwhelming on one canvas.

### Phase 3 — Render & save

Use `scripts/example.js` as the template:

1. Copy `scripts/` into a work dir and `npm install` (no deps — zero-install actually works).
2. Duplicate `example.js` to `generate_<slug>_mockup.js`.
3. Fill `SPEC` with the screens.
4. Run `node generate_<slug>_mockup.js`.
5. Output: `prd-output/<slug>/mockups.html` + `prd-output/<slug>/screens.json`.

### Phase 4 — Deliver

Share the path. Tell the user:

- **Pan**: click + drag.
- **Zoom**: mouse wheel / pinch.
- **Jump to screen**: sidebar list.
- **F**: fit-all. **0**: reset to 100%.
- The bottom-right minimap mirrors the canvas.

## Output layout

The bundle lands in `prd-output/<slug>/` alongside the PRD:

```
prd-output/<slug>/
├── <Title>.docx        ← from prd-generator
├── summary.md          ← from prd-generator
├── mockups.html        ← THIS SKILL — single self-contained HTML canvas
├── screens.json        ← THIS SKILL — spec for regeneration
└── ...
```

Output directory auto-detection is identical to `prd-generator`:

1. `opts.outputDir` explicit override.
2. `PRD_OUTPUT_DIR` env var.
3. Cowork session → `/sessions/<id>/mnt/outputs/prd-output/<slug>/`.
4. Fallback → `<cwd>/prd-output/<slug>/`.

## Layout templates (screen skeletons)

When a screen has a `layout` but no explicit `components`, the builder auto-fills a sensible skeleton. Available templates:

| Template | Typical use |
|---|---|
| `form` | Login, signup, settings, filters |
| `list` | Inbox, feed, search results |
| `detail` | Record view, profile, order detail |
| `dashboard` | KPIs + recent activity |
| `empty` | First-run or post-clear states |
| `error` | Failure + retry |

Full reference: `references/screen-patterns.md`.

## Component types

The renderer accepts these `type` values in `components`:

`heading`, `text`, `muted`, `button`, `input`, `select`, `checkbox`, `list`, `card`, `kpi`, `row`, `stack`, `nav`, `topbar`, `table`, `alert`, `empty`, `avatar`, `spacer`, `html`.

Unknown types render as a muted placeholder (never error). See `references/canvas-layout.md` for full schema and examples.

## Theme

Same presets as `prd-generator`: `dke-blue`, `corporate-neutral`, `modern-teal`, `minimal-black`. Or pass a custom object:

```js
theme: { primary: '#0F766E', primaryLight: '#14B8A6', accent: '#14B8A6', bg: '#f0fdfa', surface: '#ffffff', text: '#134E4A', muted: '#64748b', border: '#CCFBF1', success: '#10B981', danger: '#EF4444' }
```

The default is `dke-blue` so mockups visually tie back to the default PRD theme.

## Portability

Works anywhere the Skill format is supported:

| Environment | Install | Run |
|---|---|---|
| **Cowork** | Upload `prd-to-mockup.skill`. | Invoke skill. Output in `/sessions/<id>/mnt/outputs/prd-output/<slug>/`. |
| **Claude Code** | `unzip prd-to-mockup.skill -d ~/.claude/skills/` | Invoke skill. Output in `<cwd>/prd-output/<slug>/`. |
| **OpenCode / Openclaw** | Drop `prd-to-mockup/` folder into the agent's skills directory. | Same. Override with `PRD_OUTPUT_DIR` env var. |
| **Raw Node ≥ 16** | Copy `scripts/` somewhere. **No npm install needed** — zero deps. | `require('./lib/mockup-builder').renderCanvas(spec)` |

Unlike `prd-generator`, this skill has **zero runtime dependencies** — `mockup-builder.js` uses only Node's built-in `fs` and `path`.

## Pre-delivery checklist

- [ ] Number of screens is between 3 and 10 (3 absolute min, 7 ideal).
- [ ] Each screen has a clear `name` and `purpose` (empty strings are a smell).
- [ ] `connectsTo` is set where the flow is non-obvious (first-time users rely on these arrows).
- [ ] Theme matches the PRD's theme (or explicitly overridden with reason).
- [ ] Viewport matches the product (desktop ops tool → `desktop`; consumer app → `mobile`).
- [ ] `mockups.html` opens in a fresh browser tab without console errors.
- [ ] `screens.json` is valid JSON and can regenerate the same canvas.
