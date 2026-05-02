# Design Handoff — packaging for engineering

This playbook covers the last mile: what to include in a bundle so engineering can ship what you designed, not a lossy interpretation of it.

## What a complete handoff folder looks like

```
uiux-output/
└─ <feature-slug>/
   ├─ README.md                  ← the 5-line "start here"
   ├─ mockups.html               ← the interactive canvas
   ├─ screens.json               ← spec source (so specs can be diffed)
   ├─ style-guide.html           ← tokens + component gallery
   ├─ design-tokens.json         ← DTCG-format tokens (machine-readable)
   ├─ component-inventory.md     ← usage ranking (from audit)
   ├─ inspiration/               ← (optional) research bundles
   │  ├─ linear-app/
   │  └─ stripe-com/
   └─ notes.md                   ← decisions + open questions
```

Folder, not loose files. One `slug` per feature.

## The 5-line README

Engineering won't read a 2-page intro. Give them this:

```md
# <Feature name> — UI

- **Canvas**: open `mockups.html` in any browser.
- **Style guide**: `style-guide.html` shows the tokens + components this draws from.
- **Tokens**: `design-tokens.json` (DTCG) — copy into your token pipeline.
- **Decisions + open questions**: `notes.md`.
- **Source**: `screens.json` — edit + re-render via `uiux-generator`.
```

That's it. Save the context for `notes.md`.

## What goes in `notes.md`

Four short sections, each answering a specific question an engineer will ask the next morning.

### 1. What's locked vs. what's tentative

Be explicit. Engineers will otherwise ship the whole thing pixel-perfect — including the parts you hadn't finished thinking about.

```md
## Locked
- Palette (primary, accent, text, surface — see design-tokens.json)
- Navigation structure (top nav, 4 sections)
- Empty state copy and CTA

## Tentative — need review
- Card hover interaction
- Mobile breakpoint (only desktop mocks exist)
- Error state — may split into "offline" vs. "server error"
```

### 2. Key decisions with rationale

Not every choice, just the contentious ones.

```md
- **Side nav over top nav** — the feature has 6+ sections, top nav would wrap on 1280px screens.
- **Teal accent over blue** — teal tested better in the 5-user informal round, and differentiates from <competitor>.
- **Inline validation, not submit-button validation** — reduces retry cycles, matches existing form in Settings.
```

### 3. What's not in the mockup (and why)

```md
- **Loading skeletons** — defer to engineering defaults. If unclear, match the Dashboard skeleton pattern.
- **Permissions / role gating** — TBD with backend.
- **Internationalization** — all copy is en-US. Indonesian version is a follow-up.
```

### 4. Open questions for the review

Each question should have a named owner or at least a role:

```md
- **@eng-lead** — is `--radius-lg: 12px` compatible with the existing button radius (10px)? Should we round up?
- **@pm** — does the empty state CTA "Customize preferences" need analytics?
- **@content** — "Connection lost — reconnecting in 5s…" feels too technical. Better phrasing?
```

Don't end a handoff without open questions. If there are none, either the design was trivial or you missed something.

## Token handoff

`design-tokens.json` uses the **Design Tokens Community Group (DTCG)** schema:

```json
{
  "color": {
    "primary": { "$value": "#2563eb", "$type": "color" },
    "accent":  { "$value": "#14b8a6", "$type": "color" }
  },
  "spacing": {
    "xs": { "$value": "4px",  "$type": "dimension" },
    "sm": { "$value": "8px",  "$type": "dimension" }
  }
}
```

This feeds most token pipelines (Style Dictionary, Tokens Studio for Figma, Amazon's theo). If your team uses a different format, convert at the boundary — don't invent a custom schema.

Tailwind teams: the audit's Tailwind tokens are namespaced under `color/tailwind`, `spacing/tailwind`, etc., so they don't collide with the core palette. Use these to extend, not replace, the shared tokens.

## Engineering review invitation

Send the folder as a link, not as PDFs. Ask them for a 30-minute walkthrough at the canvas, not an async review.

Template message:

```
Hey — first pass at the <feature> UI. Canvas is at <link>.

Key decisions + open questions in notes.md. Most critical:
  - <open question 1>
  - <open question 2>

Got 30 min this week to walk through it? Happy to iterate before we commit to tokens.
```

Short, specific, invites dialogue. Don't attach the whole design rationale — that's what `notes.md` is for.

## Versioning

If the feature iterates, keep old snapshots:

```
uiux-output/
└─ <slug>/
   ├─ v1/
   ├─ v2/
   └─ current/         ← symlink or copy of the latest
```

Canvases are small (< 100 KB each). Keeping five versions costs nothing and saves the "what did we show last week?" argument.

## What *not* to include

- **Figma links** — handoff folders should be self-contained and openable offline.
- **Long prose about inspiration** — the research brief lives in its own `design-research/` folder.
- **Screenshots of the mockup** — the mockup *is* viewable. Screenshots go stale the moment you edit.
- **Engineering implementation notes** — that's their artefact, not yours. Stick to the design deliverable.
