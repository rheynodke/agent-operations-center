# PRD Writing Style Guide (ID + EN)

Writing conventions for PRDs generated with this skill. Supports Bahasa Indonesia (default) and English.

## General principles (both languages)

1. **Clear > clever** — avoid long-winded sentences and unnecessary jargon.
2. **Data > opinion** — every quantitative claim carries a number and source.
3. **Action > description** — active voice, explicit subject.
4. **Consistent** — one term, one meaning across the document.

## Language selection

Set the `locale` field in `INPUTS`:

- `locale: 'id'` (default) — Bahasa Indonesia, professional register.
- `locale: 'en'` — English.

The locale controls:

- Date formatting (ID and EN both use `DD Month YYYY`, but with localized month names).
- Default paragraph language.
- The cover page metadata labels (`Product Driver`, `Stakeholder`, `Status` are kept in English because RACI / status terms are industry-standard).

Technical industry terms (funnel, retention, tenant, deployment, latency, throughput, feature flag, RAG, embedding, webhook, NSM) stay in **English** in both locales — don't force a translation.

## ID-specific conventions

- **Terms with a common Indonesian equivalent**: use Indonesian.
  - `pengguna` not `user` (except in compound terms: `user flow`, `user story`).
  - `pelanggan` not `customer`.
  - `pemangku kepentingan` not `stakeholder` (but `stakeholder` is fine in RACI context).
  - `keluaran` / `hasil` not `output`.
- **Abbreviations / acronyms**: spell out on first use, then abbreviate.
  - ✅ "Product Requirements Document (PRD)... selanjutnya PRD ini..."
  - ❌ "PRD ini..." (tanpa definisi di awal)
- **Active voice preferred**.
  - ✅ "Tim engineering akan membangun API endpoint baru."
  - ❌ "API endpoint baru akan dibangun."
- Avoid filler phrases: "pada dasarnya", "secara umum", "bisa dibilang".
- Avoid intensifiers without data: "sangat", "luar biasa", "cukup". Replace with numbers.

## EN-specific conventions

- Prefer short, active sentences: "The engineering team will build X" not "X will be built".
- Spell out acronyms on first use, then abbreviate.
- Avoid filler: "basically", "in general", "kind of".
- Avoid unsupported intensifiers: "very important", "extremely fast". Replace with numbers: "40% of users reported latency >2s (survey, N=150)".

## Formatting

### Bold (`**…**`)

For key terms and labels. Don't use for emotional emphasis.

- ✅ "**North Star Metric**: Active Paying Users per Month"
- ❌ "This is super **important**!"

### Italics

Rarely. Only for titles of works (books, papers) or non-standard foreign terms.

### Bullet lists

- One idea per bullet.
- Parallel grammar (all nouns, or all verb phrases).
- Max 7 bullets per group; more than that → use a table or sub-grouping.

### Numbered lists

Use when order matters (process steps, priority order). Otherwise use bullets.

### Tables

Header row in bold. Short cell values (1 line ideal). If a value gets long, pull it into its own section with a heading.

## Tone

- **Neutral-professional**, not casual or promotional.
- Avoid marketing adjectives: "revolutionary", "game-changing", "best-in-class".
- Acknowledge uncertainty: "We don't know X yet — validation planned in beta" beats forcing claims without data.
- Be critical of your own ideas: the Risks section must name real risks, not straw risks that are easy to mitigate.

## Numbers, dates, units

### Numbers
- **ID locale**: thousands separator = dot, decimal = comma. `50.000 pengguna`, `2,5 detik`.
- **EN locale**: thousands separator = comma, decimal = dot. `50,000 users`, `2.5 seconds`.

### Percent
No space: `40%` (both locales).

### Currency
- Indonesian Rupiah: `Rp50.000.000` or `IDR 50.000.000`.
- US Dollar: `USD 500/month` or `$500/month`.
- Other currencies: use 3-letter ISO code.

### Dates
Always `DD <Month-Name> YYYY`:

- ID: `18 April 2026`, `3 Januari 2026`.
- EN: `18 April 2026`, `3 January 2026`.

Forbidden: `18/04/2026`, `April 18, 2026`, `18-04-26`.

### Technical units
Use standard symbols: `ms`, `s`, `GB`, `MB`, `req/s`, `RPS`.

## Sourcing claims

Every quantitative claim needs a source. Citation format:

- "**62% of users follow up slowly** (source: invoice-aging query, March 2026, N=450 active customers)."
- "**p95 AI-chat latency currently 4.2s** (source: Datadog APM, last 7 days)."

When the source is confidential, use `[internal source]` and name a PIC who can verify.

## Naming products / systems

Use the official product name, consistent throughout the PRD. Don't mix internal codenames and external names.

- ✅ "DKE Easy Connected" (consistent across the doc).
- ❌ "DEC / Easy Connected / DKE ERP" (three variants in one PRD).

## Good vs. bad examples

| Bad | Good |
|---|---|
| "This feature will probably be really cool for users." | "This feature targets the 40% of sales users who currently spend 2 hours/day on manual follow-up." |
| "We should ship this ASAP." | "Launch target Q2 2026 to capture pre-Ramadhan demand." |
| "Performance needs to be good." | "p95 response time ≤ 2s on 95% of requests, measured in Datadog APM." |
| "A lot of users want this." | "87 feature requests in support Slack in March 2026; 23 top-tier customers mentioned it in business reviews." |
| "The solution is simple." | "Integration via existing webhook; estimated 5 engineer-days per backend team spike on 15 April." |

## Review checklist

Before submitting a PRD, re-read and confirm:

- [ ] No quantitative claim without a number + source.
- [ ] No marketing adjective without data.
- [ ] All technical terms defined in Glossary (if they're not industry-standard).
- [ ] Date format matches locale.
- [ ] Acronyms spelled out on first use.
- [ ] Active voice > passive (Ctrl+F "akan di-" for ID or "will be" for EN — if many, refactor).
- [ ] Every risk in section 11 has a concrete mitigation (not generic "will be monitored").
