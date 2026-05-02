---
name: prd-generator
description: Generate Product Requirements Documents (PRDs) as .docx files in a consistent professional format — configurable for any organization or system (SaaS, internal tools, AI/LLM, mobile, infra, integration). Use whenever a user asks to create a PRD, product spec, feature brief, requirement doc, tech spec, or feature document — including phrases like "buatkan PRD", "tolong draft spec fitur", "dokumen produk untuk", "write a PRD", "draft a spec", "requirement doc", "feature document", "perlu PRD untuk". Trigger even without the word PRD when the request is about feature documentation or requirements. Enforces a standard cover page (numbered NNN/PRD-{ORG}/MONTH-ROMAN/YEAR with Product Driver, Product Delivery, Stakeholder, Status), a 16-section skeleton, and balanced coverage of the 4 Risks of Product Management (Marty Cagan). Org code, language (Bahasa Indonesia / English), brand theme, and date locale are configurable per PRD.
---

# PRD Generator

A configurable PRD generator that produces Product Requirements Documents in a consistent, professional `.docx` format — cover page, 16-section structure, 4 Risks balanced analysis (Marty Cagan's framework). The skill so any organization can adopt it: set an `orgCode`, pick a language (`id` / `en`), optionally customize brand colors, and drive a full PRD from a single Node.js template.

This skill is the **right tool** when a PM, IT Lead, Tech Lead, or stakeholder needs feature documentation with executive-ready formatting and a standard structure. It is **not** the right tool for meeting notes, roadmaps without concrete specs, or small change notes that don't need stakeholder sign-off.

## When to use

Trigger this skill on requests like:

- "Create a PRD for feature X" / "Buatkan PRD untuk fitur X"
- "Draft a spec / brief / requirement doc for..."
- "Tolong susun spec / dokumen produk / feature document..."
- "Document the requirements for [system / integration / migration]"
- "Format my feature doc", "Apa nomor PRD berikutnya?", "Generate a `NNN/PRD-.../...` doc"
- Any request where the deliverable is a feature document targeting a system — cloud SaaS, internal ERP, mobile app, AI/LLM product, integration layer, infra migration, security initiative.

**Do NOT use for**: meeting summaries, status updates, roadmap-only docs, tiny change notes, blog posts, or pitches.

## Operating modes — pick one before doing anything else

This skill is **proactive**. It does not silently fill placeholders. It interviews the user, discovers context from available sources, and fills the PRD with real evidence. On every invocation, pick an operating mode and announce it to the user:

| Mode | When to pick | What the agent does |
|---|---|---|
| `discover` (**default**) | User has an existing codebase, docs, data tools, or other context | Scan repo + docs + connectors for context → interview user to fill gaps → draft with evidence-backed content |
| `interview` | Greenfield idea, no repo yet | Run the full interview playbook end-to-end → draft from answers alone |
| `synthesize` | User uploads raw research (interview transcripts, survey data, meeting notes) | Parse and cluster themes → slot findings into sections → interview only to fill remaining gaps |
| `template` | User explicitly wants a blank skeleton to edit manually | Skip interview and discovery → output the 16-section template with placeholders |

Ask which mode via `AskUserQuestion` if not obvious from the user's message. Default to `discover` when in doubt. Never skip straight to generation without either explicit `template` consent or a completed interview + discovery.

## Required inputs (gathered during interview, not asked up front)

These 8 fields land on the cover page. Gather them during Phase A of the interview (see `references/interview-playbook.md`) — don't dump them as a single wall of questions:

1. **Title** — e.g. "PRD: Real-time Notifications for SaaS Dashboard"
2. **Org code** — short uppercase slug (e.g. `DKE`, `ACME`, `TOKO`). Default `DKE`.
3. **PRD number** — `NNN/PRD-{ORG}/MONTH-ROMAN/YEAR`. If user doesn't know, recommend `(highest known + 1)` and flag as Open Question.
4. **Product Driver** — PM / IT Lead proposing.
5. **Product Delivery** — Engineer / Tech Lead executing.
6. **Stakeholder** — Sponsor / user representative.
7. **Status** — `Draft` | `Review` | `Approved` | `Abandoned`. Default `Draft`.
8. **Problem / opportunity statement** — whose problem, data, impact.

Optional (sensible defaults):

- **Language** — `id` (default) or `en`.
- **Theme** — `dke-blue` default, or any preset / custom object.
- **Date** — defaults to today in the chosen locale.

## Workflow — the proactive playbook

Follow these phases in order. Don't skip.

### Phase 0 — Pre-flight (before touching AskUserQuestion)

1. Read `references/format.md`, `references/prd-structure.md`, `references/four-risks-framework.md`, `references/writing-style.md`.
2. Read `references/interview-playbook.md` and `references/discovery-playbook.md`.
3. Scan the user's most recent messages for cues:
   - **Existing system mentioned?** → likely `discover` mode.
   - **Greenfield idea?** → likely `interview` mode.
   - **Uploaded docs present?** → likely `synthesize` mode.
   - **"Just give me the template"?** → `template` mode.
4. Announce the chosen mode in one sentence, e.g. "I'll run in **discover** mode: I'll scan your repo, then interview you to fill the gaps."

### Phase 1 — Discovery (for `discover` / `synthesize` modes)

Follow `references/discovery-playbook.md`. In short:

- **Repo detection**: if the user mentioned a repo path or an uploaded codebase exists, run `node scripts/discover.js --repo <path> --out context.json`. Read `context.json` to learn tech stack, existing features, and docs.
- **Doc ingestion**: read any uploaded files (PDFs, markdown, transcripts). Extract quotes that support Problem Statement and user needs.
- **Data sources**: check what MCP connectors are available (Slack, Asana/Jira, Analytics, SQL warehouse, Datadog). Offer to pull baseline metrics for the Problem Statement and Product Metrics sections. If no connectors, suggest the user install via `search_mcp_registry` / `suggest_connectors`.
- **Web lookups** (sparingly): for competitor context or industry benchmark data, use `WebSearch` / `WebFetch` when the user references a named product or a standard metric.
- **Don't block**: if any source is unavailable, proceed and log the gap in Open Questions.

### Phase 2 — Interview (batched via AskUserQuestion)

Follow `references/interview-playbook.md`. Ask in **4 phases**, never dumping all questions at once:

- **Batch A** (4 Qs max): Mode confirmation, Title, Org code, Product Driver/Delivery/Stakeholder, Language+Theme.
- **Batch B** (3-4 Qs): Problem evidence, primary persona, existing metrics baseline.
- **Batch C** (3-4 Qs): Top goals, non-goals, rollout preference, known constraints.
- **Batch D** (2-3 Qs, conditional): Domain add-ons (analytics / AI / mobile / infra / security), regulatory constraints, build-vs-buy.

Use answers from Phase 1 to pre-fill options in AskUserQuestion (e.g. if `context.json` shows Next.js + Postgres, the tech-stack option can be pre-filled).

### Phase 3 — 4 Risks challenge (mandatory)

After the interview, **actively challenge** the user on each of the 4 Risks. Don't just record; push back where the story is thin:

- **Value Risk** — "You said 68% of admins miss events. What's the source? Do we know the opt-out rate on the current email channel?"
- **Usability Risk** — "Browser push has ~15% opt-in rate on first-ask. How will your flow beat that?"
- **Feasibility Risk** — "At 50k concurrent websockets, have you load-tested Socket.io on your infra?"
- **Business Viability Risk** — "What's the per-user infra cost delta at GA scale?"

Ask the user to either provide evidence or accept the item as an Open Question with an owner and due date. Balance ~25% each in Section 11.

### Phase 4 — Draft & review

1. Copy the `scripts/` folder from this skill into a work directory (e.g. `/sessions/<session>/prd-work/` in Cowork, or `./prd-work/` in Claude Code / OpenCode / Openclaw).
2. Run `cd <work-dir> && npm install` to fetch dependencies.
3. Duplicate `scripts/example.js` to `generate_<slug>_prd.js`. Fill `INPUTS` + each section's content from the interview + discovery. Use real evidence; flag genuine unknowns in Section 12 (Open Questions).
4. Populate the `summary`, `openQuestions`, and (optional) `context` / `inputs` payloads that get passed to `saveBundle()` — these become real side files, not throwaways.
5. Before generating, show the user a **plaintext summary** of the key sections (Executive Summary, NSM + metrics, top risks) and ask for sign-off or edits.
6. Run `node generate_<slug>_prd.js`. Output is a **folder** (see "Output layout" below), not just a single file.
7. Validate: `python3 <path-to-docx-skill>/scripts/office/validate.py <bundle>/<title>.docx` (skip if the docx skill isn't installed; the library self-heals the fontTable ref already).

### Phase 5 — Deliver & iterate

1. Share the **bundle folder** — primary link goes to the `.docx`, but also mention the sidecars (`summary.md`, `open-questions.md`, `inputs.json`) so the reviewer can grep them.
2. Attach the auto-generated 5–8 line summary (NSM, top metrics, rollout phases, top risk per category).
3. List Open Questions with owner + due date (already mirrored in `open-questions.md`).
4. Offer to iterate on specific sections (e.g. "Want me to deepen Section 9 with sequence diagrams?" / "Should I pull Datadog metrics for the baseline?").

## Output layout — every PRD is a folder, not a file

The generator writes a **bundle** via `saveBundle()`. The default layout:

```
prd-output/<slug>/
├── <Title>.docx        ← the PRD itself
├── summary.md          ← 5-8 line exec summary (paste into Slack / email)
├── open-questions.md   ← unresolved items with owner + due date
├── context.json        ← optional: repo discovery output from scripts/discover.js
├── inputs.json         ← interview answers + metadata (enables regeneration)
└── README.md           ← folder index
```

Why a folder, not a single file:

- **Reviewers** get a ready-to-paste summary and a self-contained open-questions list without opening Word.
- **Auditability** — `context.json` captures what the repo looked like at drafting time; `inputs.json` captures the answers fed into the PRD.
- **Regeneration** — running the same `generate_<slug>_prd.js` with the saved `inputs.json` reproduces the PRD deterministically, which is critical when iterating on wording after review.

### Base directory — auto-detected per environment

`resolveOutputDir(slug)` picks a base in this order:

1. `baseDir` arg passed to `saveBundle()` (explicit override).
2. Env var `PRD_OUTPUT_DIR` (handy for Claude Code / OpenCode / CI).
3. Cowork session (`/sessions/<id>/mnt/outputs/`) if detected → writes to `<id>/mnt/outputs/prd-output/<slug>/`.
4. Fallback: `<cwd>/prd-output/<slug>/` — works in any CLI agent (Claude Code, OpenCode, Openclaw) or in raw `node` without special setup.

## Running in any agent (portability)

This skill is not Cowork-specific. It works in any agent that reads the Skill format:

| Environment | Install | Run |
|---|---|---|
| **Cowork** | The `.skill` archive is installed via the UI. | Skill auto-triggers on PRD requests. Output lands in `/sessions/<id>/mnt/outputs/prd-output/<slug>/`. |
| **Claude Code** (CLI) | `unzip prd-generator.skill -d ~/.claude/skills/` | Claude Code picks up the skill from `~/.claude/skills/prd-generator/`. Output defaults to `<cwd>/prd-output/<slug>/`. |
| **OpenCode / Openclaw** | Drop the unpacked `prd-generator/` folder into the agent's skills directory (check your agent's docs for the exact path). | Same. Override location with `PRD_OUTPUT_DIR=/my/path` or `INPUTS.baseDir`. |
| **Any Node ≥ 16** | Copy `scripts/` somewhere on disk, `npm install`. | Call the library directly: `const b = require('./lib/prd-builder'); await b.saveBundle({...})`. |

The .docx validator (`docx/scripts/office/validate.py`) is Cowork-specific and **optional** — `prd-builder.js` already patches the missing fontTable relationship via its internal `_normalizeDocx` step, so validator runs fail-closed but aren't required for output correctness.

## Cover page format (MANDATORY)

Every PRD begins with a cover page containing, in order:

1. **Title** — center, bold, 20pt, primary theme color (default DKE Blue `#1E3A8A`).
2. **Version** — `v1.0.0` for first draft; bump semver on iterations.
3. **Date Created** — locale-aware: ID = `18 April 2026`, EN = `18 April 2026` (same day/month/year order, English month names).
4. **No** — format `NNN/PRD-{ORG}/MONTH-ROMAN/YEAR`.
5. **Metadata table** (2 columns: Label | Value):
   - Product Driver
   - Product Delivery
   - Stakeholder
   - Status
6. **Page break** — separate cover from body.

**Do NOT hardcode** the cover in every PRD. Use the helper `createCoverPage()` in `scripts/lib/prd-builder.js`.

## PRD numbering — the rules

Format: `NNN/PRD-{ORG}/MONTH-ROMAN/YEAR`

- `NNN` — 3-digit sequence, **resets every year** (`001`, `002`, …, `042`, …).
- `{ORG}` — configurable uppercase slug (e.g. `DKE`, `ACME`, `TOKO`). Keep it short (2–6 chars).
- `MONTH-ROMAN` — I, II, III, IV, V, VI, VII, VIII, IX, X, XI, XII.
- `YEAR` — 4 digits.

Examples:

| Number | Meaning |
|---|---|
| `001/PRD-DKE/I/2026` | First PRD of 2026 for DKE, drafted January. |
| `015/PRD-ACME/IV/2026` | 15th PRD of 2026 for ACME Corp, drafted April. |
| `042/PRD-TOKO/X/2026` | 42nd PRD of 2026 for Toko Inc, drafted October. |

**Avoid collisions**: before using a number, check the org's PRD registry (shared drive / Notion / spreadsheet). If unsure, recommend `"highest + 1"`.

## Structure — the 16-section skeleton

Every PRD contains **at minimum** the following 16 sections. Full content guidance lives in `references/prd-structure.md`.

1. Executive Summary
2. Product Overview
3. Problem Statement (+ 4 Risks pre-flight questions)
4. Goals & Non-Goals
5. Product Metrics & Success Criteria
6. Solution Overview
7. Functional Requirements
8. Non-Functional Requirements
9. Technical Approach & Implementation Plan
10. Rollout Plan
11. Risks & Mitigation (4 Risks, 25% each)
12. Open Questions
13. Dependencies
14. Stakeholders & RACI
15. Timeline
16. Appendix (glossary, references, pre-delivery checklist)

Sections **may be added** (e.g. Event Taxonomy for analytics PRDs, Migration Plan for infra PRDs, Prompt Design for AI PRDs) but **never removed** — so reviewers can rely on coverage.

## 4 Risks framework — must be balanced

This skill adopts **Marty Cagan's 4 Risks** framework. Every PRD must address all four with roughly equal depth. Common failure mode: teams over-index on Value Risk ("will anyone use this?") and ignore Usability, Feasibility, or Business Viability — the PRD ships but the product stalls.

- **Value Risk** — will users actually want and use this?
- **Usability Risk** — can they figure it out without training?
- **Feasibility Risk** — can engineering build it with current stack and timeline?
- **Business Viability Risk** — is it healthy for the business (cost, legal, GTM, support, maintenance)?

Section 11 must have four balanced sub-sections (11.1 Value, 11.2 Usability, 11.3 Feasibility, 11.4 Business Viability), each with ≥1 concrete risk and ≥1 concrete mitigation. Bulk question lists per risk live in `references/four-risks-framework.md`.

## Writing style

- **Default language**: Bahasa Indonesia (professional register). Switch with `locale: 'en'`.
- Technical industry terms (funnel, retention, tenant, deployment, RAG, etc.) stay in English even in ID PRDs.
- Every quantitative claim needs a number **and** a source (log, query, survey, ticket system).
- Include a Glossary in the Appendix when using internal jargon.
- Full guidance: `references/writing-style.md`.

## Implementation — use the helper library, don't hardcode

The library `scripts/lib/prd-builder.js` exposes:

| Helper | Purpose |
|---|---|
| `createCoverPage(opts)` | Render cover page from required inputs; honors `theme` and `locale`. |
| `createSectionHeading(number, title)` | Level-1 heading (e.g. "1. Executive Summary"). |
| `createSubHeading(text, level)` | Level-2 / level-3 heading. |
| `createParagraph(text, opts)` | Body paragraph with inline `**bold**` parsing. |
| `createBulletList(items)` | Bulleted list. |
| `createNumberedList(items)` | Numbered list. |
| `createTable(headers, rows, opts)` | Table with themed header row + optional alt-row shading. |
| `createCodeBlock(code, language)` | Monospace code block with subtle background. |
| `createCallout(text, type)` | `info` / `warning` / `critical` callouts. |
| `createSpacer()` / `createPageBreak()` | Layout helpers. |
| `createDocument(children, opts)` | Wrap children into a Document with theme + margins. |
| `saveDocument(doc, outputPath)` | Persist to `.docx`. |
| `formatPrdNumber({ sequence, orgCode, month, year })` | Build a valid PRD number. |
| `formatLocaleDate(date, locale)` | Format the date per locale (`id` / `en`). |

**Full usage**: see `scripts/example.js`. Flow: copy template → edit `INPUTS` + section content → `node generate_<slug>_prd.js`.

## Theme customization

Default theme is **DKE Blue**. To rebrand, pass a `theme` object in `INPUTS`:

```javascript
theme: {
  primaryColor: '0F766E',   // teal (for the title, headings, table headers)
  accentColor: '14B8A6',    // hover / secondary
  font: 'Calibri',          // body font
}
```

Any field left out inherits the default. A small set of **preset themes** (`'dke-blue'`, `'corporate-neutral'`, `'modern-teal'`, `'minimal-black'`) can also be referenced by name — see `references/format.md`.

## Examples

Two reference PRDs (structure + tone only, not for verbatim copying) live in `references/examples/`:

- `saas-feature-prd-example.md` — generic SaaS product feature ("Real-time Notifications").
- `internal-tool-prd-example.md` — generic internal tool ("Employee Leave Management System").

## Pre-delivery checklist

Before sending the bundle to the user, verify:

- [ ] Cover page complete (all 8 required fields present, theme applied).
- [ ] PRD number is valid and doesn't collide with an existing PRD this year.
- [ ] All 16 standard sections are present (more is OK, fewer is not).
- [ ] 4 Risks discussed in balanced proportions (no single risk dominates section 11).
- [ ] Date format matches locale (ID: "18 April 2026", EN: "18 April 2026").
- [ ] Every metric has **definition + measurement method + target**.
- [ ] `.docx` opens in Word / LibreOffice without repair prompt (validator optional).
- [ ] Bundle folder contains `.docx` + `summary.md` + `open-questions.md` + `inputs.json` + `README.md` (add `context.json` if discovery ran).
- [ ] In Cowork: bundle is under `/sessions/.../mnt/outputs/prd-output/<slug>/` and the `.docx` is shared via a `computer://` link.
- [ ] In CLI (Claude Code / OpenCode / Openclaw): bundle is under `<cwd>/prd-output/<slug>/` and the path is printed in the reply.
- [ ] 5–8 line summary delivered in-chat (mirrors `summary.md`).
