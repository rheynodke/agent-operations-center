---
name: uiux-generator
description: UI Designer toolkit for agents tasked with prototyping, auditing, and documenting user interfaces. Use when the user (or another agent) asks to design a UI, build a prototype, audit an existing app's design system, extract design tokens, survey competitor interfaces, create a style guide, review UI consistency, or open a live canvas to iterate on mockups. Triggers on phrases such as prototype this UI, bikin mockup, buat UI design, audit design tokens, scan design system, analyze competitor UI, fetch inspiration, style guide, style-guide.html, live canvas, UI designer mode, role ui designer, atau permintaan perancangan antarmuka lain. Supports three modes: research (fetch + analyze external sites), audit (scan current repo), and prototype (render a multi-screen HTML canvas served by a local live-reload web server on port 4455).
license: MIT
---

# uiux-generator

A standalone skill for agents operating in the **UI Designer** role. It covers the full loop a designer runs when joining a new product: *look outward* (research), *look inward* (audit what's already there), and *ship forward* (prototype the next screen). Everything is rendered as inline HTML / JSON — no external services, no heavy frameworks, zero npm dependencies for the core flow.

## When to use

Invoke this skill whenever the user or orchestrating agent assigns UI-design work. Typical triggers:

- "Audit the design system of this codebase."
- "Fetch inspiration from Linear and Stripe, then draft 3 dashboard variants."
- "Prototype a screen for the new onboarding flow and serve it on a live canvas."
- "Generate a style guide for the frontend team."
- "Scan our repo for design tokens and tell me where the drift is."
- "Bikin prototype UI-nya, launch serve-nya juga ya."

If a PRD has already been authored by `prd-generator` or `dke-prd`, this skill is the next step: it turns the PRD's Solution Overview into interactive mockups.

## Three modes

### 1. Research mode — external inspiration

**Goal**: understand how other products solve a similar problem before drawing a single box.

**Tooling**: `scripts/inspire.js` (wraps `lib/fetch-inspiration.js`).

```bash
node scripts/inspire.js --urls https://linear.app,https://stripe.com --out ./out
```

Output per URL (folder named after the hostname):
- `inspiration.json` — raw tokens (colors, fonts, font sizes, spacings, radii, shadows) + inferred palette.
- `inspiration.md` — human-readable summary with the headline palette and top-referenced values.
- `screenshot.png` — optional; only if Playwright is installed locally.

The HTML+CSS path is **zero-dep**. The screenshot path is best-effort — if Playwright isn't installed, it logs a hint and skips. Never block on it.

See `references/design-research.md` for the playbook on how to weave 3–5 inspiration fetches into a structured competitive brief.

### 2. Audit mode — what the repo already has

**Goal**: document the existing design system so new work stays consistent.

**Tooling**: `scripts/audit.js` (wraps `lib/repo-ui-scan.js` + `lib/style-guide-html.js`).

```bash
node scripts/audit.js --repo . --out ./ui-audit
```

Output:
- `design-tokens.json` — DTCG-format token tree (color / typography / spacing / radius / shadow, frequency-ranked).
- `component-inventory.md` — every React/Vue/Svelte component, ranked by how often it's used across the codebase.
- `ui-scan-summary.json` — raw findings (UI libraries, Tailwind config shape, palette inference).
- `style-guide.html` — a polished, browser-openable document. This is the artefact the designer hands to engineering.

The scanner understands: Tailwind configs, CSS custom properties (`--primary: …`), SCSS/LESS variables, theme JS/TS files, and dependency manifests (MUI, Chakra, Radix, shadcn, Mantine, styled-components, emotion, stitches).

See `references/repo-ui-audit.md` for the playbook on interpreting the audit and writing the recommendations section.

### 3. Prototype mode — live canvas

**Goal**: put ideas on a canvas the team can walk through in a meeting, and iterate in real time.

**Tooling**:
- `lib/mockup-builder.js` — renders an infinite pan/zoom canvas of screens.
- `scripts/example.js` — full multi-screen template to copy + edit.
- `lib/canvas-server.js` + `scripts/serve.js` — zero-dep HTTP + WebSocket live-reload server.
- `lib/preview-agent.js` + `scripts/preview.js` — **detached** daemon wrapper + Cloudflare Quick Tunnel integration.

Typical flow:

```bash
# 1. Copy scripts/example.js → scripts/generate_<slug>_canvas.js, edit SPEC.
node scripts/generate_<slug>_canvas.js

# 2. Launch a detached preview (survives across agent tool calls).
node scripts/preview.js start --spec scripts/generate_<slug>_canvas.js --slug <slug>

# 3. (Optional) Expose a public URL via Cloudflare Quick Tunnel.
node scripts/preview.js tunnel --slug <slug> --auto-install

# 4. When done:
node scripts/preview.js stop --slug <slug>
```

The server:
- Implements a raw WebSocket handshake in pure Node (`crypto` + RFC 6455 framing) — no `ws` package.
- Watches the spec file's directory via `fs.watch` and re-runs the spec on every change.
- Injects a tiny `/ws` live-reload snippet into every HTML response.
- Reconnects automatically if the server restarts.

See `references/prototype-canvas.md` for the layout catalogue, component schema, and conventions for multi-screen flows.

## Live preview workflow — **DO THIS AUTOMATICALLY after generating a prototype**

As soon as you finish rendering a canvas in prototype mode, auto-start the detached preview. Do not wait for permission — this is part of the deliverable.

```bash
node scripts/preview.js start --spec /absolute/path/to/<slug>_canvas.js --slug <slug>
```

Then tell the user:
- the local URL (e.g. `http://127.0.0.1:4455/`)
- how to get a public URL: `node scripts/preview.js tunnel --slug <slug> --auto-install`
- how to stop: `node scripts/preview.js stop --slug <slug>`

**On revision prompts** ("ubah warna primary", "tambah screen Settings", "rapihin spacing hero"), edit the spec file in place. The watcher re-runs the renderer automatically and pushes a WebSocket reload to any open tab — no server restart needed.

**Public URL (Cloudflare)** is **on-demand only**. Start a tunnel only when the user says "share", "public URL", "biar bisa dibuka stakeholder", etc. `--auto-install` handles cloudflared install via brew / apt / dnf / winget / curl binary — ask for consent before a sudo install step on Linux.

**Session resume**: at the start of any new session, run `node scripts/preview.js list` to detect previews still running from the previous session.

## Operating guidance

### When the user picks this skill with a vague brief

Always clarify before drawing:
1. **Which mode** — research, audit, or prototype? (If more than one, confirm the order.)
2. **The target** — which URLs, which repo, which PRD bundle?
3. **Output location** — let `UIUX_OUTPUT_DIR` or Cowork's `/mnt/outputs/uiux-output/<slug>/` resolve automatically unless the user specifies.

### Portability across agents

This skill runs in any environment with Node ≥ 16:

| Environment | Default output dir |
|---|---|
| Cowork | `/sessions/<id>/mnt/outputs/uiux-output/<slug>/` (auto-detected) |
| Claude Code / OpenCode / Openclaw | `process.cwd() + /uiux-output/<slug>/` |
| Raw Node CLI | same as above, or override with `UIUX_OUTPUT_DIR` |

No absolute paths are hard-coded into the libraries; every I/O helper computes its base directory at runtime.

### Complement to `prd-to-mockup`

This skill reuses the exact same `mockup-builder.js` core (same component schema, same themes, same canvas). If a `prd-output/<slug>/mockups.html` already exists from `prd-to-mockup`, `serve.js --root <that-dir>` opens the live canvas straight away — no re-render needed.

Where `prd-to-mockup` stops at the mockup, **uiux-generator adds the research + audit layers** and the live server. Use them together:

```
prd-generator   → PRD bundle
prd-to-mockup   → mockups.html
uiux-generator  → research / audit / live canvas
```

## Pre-delivery checklist

Before handing off any output:

- [ ] All generated files land under a single `<slug>/` folder — never loose in outputs root.
- [ ] For **research** deliverables, at least 2 URLs were analyzed and the inferred palettes are listed side-by-side.
- [ ] For **audit** deliverables, `style-guide.html` renders without errors when opened locally.
- [ ] For **prototype** deliverables, the canvas has ≥ 3 screens including at least one empty state and one error state (reviewers always forget these).
- [ ] A short `README.md` at the bundle root points the user to the main artefact.
- [ ] `connectsTo` arrows are used only for non-linear flows; linear ones rely on screen numbering.

## Reference playbooks

| File | Purpose |
|---|---|
| `references/design-research.md` | How to structure an inspiration pass (what to compare, what to ignore). |
| `references/repo-ui-audit.md` | How to interpret the token scan and write recommendations. |
| `references/prototype-canvas.md` | Screen templates, component schema, flow conventions. |
| `references/design-handoff.md` | What to include when handing mockups off to engineering. |

## Directory layout

```
uiux-generator/
├─ SKILL.md
├─ references/
│  ├─ design-research.md
│  ├─ repo-ui-audit.md
│  ├─ prototype-canvas.md
│  └─ design-handoff.md
└─ scripts/
   ├─ inspire.js            # CLI — research mode
   ├─ audit.js              # CLI — audit mode
   ├─ serve.js              # CLI — foreground live canvas server
   ├─ preview.js            # CLI — detached preview daemon + tunnel
   ├─ example.js            # Full multi-screen template
   └─ lib/
      ├─ fetch-inspiration.js
      ├─ repo-ui-scan.js
      ├─ style-guide-html.js
      ├─ canvas-server.js
      ├─ preview-agent.js   # Detached process + state + cloudflared
      └─ mockup-builder.js  # Shared with prd-to-mockup
```

Keep edits surgical — each file has one job.
