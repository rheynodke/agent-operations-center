# PRD Format — Cover, Metadata, Numbering, Theme, Locale

This document defines the mandatory cover page and numbering rules, plus the configurable theme and locale settings.

## Cover page layout

Order (top to bottom):

1. **Top spacer** — ≈1.6 inch / 2 cm visual margin.
2. **Title** — center, bold, 20pt, **primary theme color** (default `#1E3A8A` DKE Blue).
3. **Version** — center, italic, 12pt, gray (`#6B7280`).
   - Format: `v<MAJOR>.<MINOR>.<PATCH>`, start at `v1.0.0`.
4. **Date Created** — center, 11pt, locale-aware (see below).
5. **No** — center, bold, 11pt — the PRD number.
6. **Metadata table** — center, 70% width, 2 columns (Label 30% | Value 70%).
7. **Page break** — separate cover from body.

## Metadata table (4 mandatory rows)

| Label | Value |
|---|---|
| Product Driver | PM / IT Lead who proposed the initiative |
| Product Delivery | Engineer / Tech Lead executing |
| Stakeholder | Sponsor / user representative |
| Status | `Draft` \| `Review` \| `Approved` \| `Abandoned` |

**Status lifecycle**:

```
Draft  →  Review  →  Approved
                 ↘  Abandoned  (closed without implementation)
```

## PRD numbering

### Format

```
NNN/PRD-{ORG}/MONTH-ROMAN/YEAR
```

| Segment | Meaning |
|---|---|
| `NNN` | 3-digit sequence (`001`…`999`), **resets every year** |
| `PRD-{ORG}` | Literal `PRD-` followed by uppercase org code (e.g. `PRD-DKE`, `PRD-ACME`) |
| `MONTH-ROMAN` | Roman numerals: I, II, III, IV, V, VI, VII, VIII, IX, X, XI, XII |
| `YEAR` | 4 digits (e.g. `2026`) |

### Valid examples

| Number | Meaning |
|---|---|
| `001/PRD-DKE/I/2026` | PRD 1 of 2026 for DKE, drafted January. |
| `015/PRD-ACME/IV/2026` | PRD 15 of 2026 for ACME, drafted April. |
| `042/PRD-TOKO/X/2026` | PRD 42 of 2026 for Toko, drafted October. |

### Invalid examples

| Number | Problem |
|---|---|
| `1/PRD-DKE/IV/2026` | `NNN` must be 3 digits (→ `001`) |
| `001/PRD-DKE/04/2026` | Month must be Roman (→ `IV`) |
| `001/PRD-DKE/IV/26` | Year must be 4 digits (→ `2026`) |
| `001-PRD-DKE-IV-2026` | Separator must be `/`, not `-` |
| `001/PRD-dke/IV/2026` | Org code must be uppercase |

### Registering the number

Before using a number, confirm it's not taken for the current year:

1. Check the org's PRD registry (shared drive / Notion / spreadsheet).
2. If there's no registry, ask the previous Product Driver.
3. When unsure, take `max(existing) + 1`.
4. After approval, update the registry so other teams don't collide.

## Date locales

Two locales supported:

### `locale: 'id'` (default — Bahasa Indonesia)

Format: `DD <Nama-Bulan-ID> YYYY`

Examples: `18 April 2026`, `3 Januari 2026`, `25 Desember 2026`.

Month names: Januari, Februari, Maret, April, Mei, Juni, Juli, Agustus, September, Oktober, November, Desember.

### `locale: 'en'` (English)

Format: `DD <Month-Name-EN> YYYY` (same day-month-year order, English month names).

Examples: `18 April 2026`, `3 January 2026`, `25 December 2026`.

### Forbidden formats (both locales)

- `April 18, 2026` (US-style comma)
- `18/04/2026` (numeric)
- `18-04-26` (short numeric)
- `2026-04-18` (ISO — acceptable in code, not in cover)

Helper: `formatLocaleDate(date, locale)` returns the correct format.

## Theme customization

Passing a `theme` object into the cover and document helpers rebrands the PRD. All fields optional — omitted ones inherit the default.

### Schema

```javascript
theme: {
  primaryColor: '1E3A8A',   // hex (no #) — title, section headings, table header bg
  accentColor:  '3B82F6',   // hex — callout borders, secondary accents
  grayText:     '6B7280',   // hex — version line, captions
  bodyText:     '111827',   // hex — paragraph body
  tableRowAlt:  'F9FAFB',   // hex — alternating table row shading
  codeBg:       'F3F4F6',   // hex — code block background
  codeText:     '1F2937',   // hex — code text color
  font:         'Calibri',  // body font family
  codeFont:     'Courier New', // monospace font
}
```

### Preset themes

The builder library exposes named presets. Pass `theme: 'dke-blue'` (string) instead of an object.

| Preset | Primary | Accent | Vibe |
|---|---|---|---|
| `dke-blue` | `#1E3A8A` | `#3B82F6` | Corporate blue — the default. |
| `corporate-neutral` | `#1F2937` | `#6B7280` | Neutral gray, works with any brand. |
| `modern-teal` | `#0F766E` | `#14B8A6` | Modern tech, fresh. |
| `minimal-black` | `#111111` | `#444444` | High-contrast, print-friendly. |

Teams can add more presets by extending `PRESET_THEMES` in `scripts/lib/prd-builder.js`.

## Visual identity (default theme)

| Element | Color | Size | Use |
|---|---|---|---|
| Title | `#1E3A8A` | 20pt bold | Cover title |
| Section heading | `#1E3A8A` | 16pt bold | "1. Executive Summary" |
| Sub-heading | `#1E3A8A` | 13pt bold | "1.1 Context" |
| Body text | `#111827` | 11pt regular | Paragraphs |
| Secondary text | `#6B7280` | 10–11pt | Version, caption |
| Table header | bg `#1E3A8A`, text `#FFFFFF` | 11pt bold | Table headers |
| Code block | bg `#F3F4F6`, text `#1F2937` | 9pt Courier | Snippets |

Default body font: **Calibri 11pt**. Default code font: **Courier New 9pt**. Page margins: **1 inch (2.54 cm)** all sides.
