# Interview Playbook — AskUserQuestion Scripts by Phase

This playbook gives the agent concrete `AskUserQuestion` batches to run through the user. Each batch is ≤ 4 questions (tool limit). Phases run in order. Skip a phase only when its inputs are already confidently known from discovery (`context.json`, uploaded docs, earlier conversation).

**Rules**:

- Never dump all questions at once. Batch by phase.
- Pre-fill options using discovery data. E.g. if `context.json.stack.frontend == 'Next.js'`, the tech-stack option list should lead with that.
- After each batch, reflect back the answers in one sentence before moving to the next batch ("Got it — PRD for ACME's real-time notifications, IT Lead is Dian, status Draft. Next up: let's nail the problem.").
- If the user explicitly opts into `template` mode, skip Phases B-D entirely and generate a blank skeleton.

## Phase A — Framing & cover-page basics

**When**: always first.

**Goal**: capture mode, title, org, people, language/theme.

### Batch A1 — mode + title + org (1 question)

```json
{
  "question": "How do you want me to run this PRD?",
  "header": "PRD mode",
  "options": [
    { "label": "Discover + interview (Recommended)", "description": "I'll scan your repo / docs / available data, then ask targeted questions to fill the gaps." },
    { "label": "Interview only", "description": "Greenfield — no repo yet. I'll walk through questions for all 16 sections." },
    { "label": "Synthesize from docs", "description": "You've uploaded research notes / interview transcripts / survey data. I'll cluster themes and slot them into the PRD." },
    { "label": "Just give me the template", "description": "Skip the interview. Output a blank 16-section skeleton I can fill in myself." }
  ]
}
```

### Batch A2 — title + org + people (up to 4 questions)

```json
[
  { "question": "What's the PRD title?",            "header": "Title",   "options": [/* generated from feature name */] },
  { "question": "Which org code should the PRD number use?", "header": "Org code", "options": [
      { "label": "DKE (default)", "description": "Use 'PRD-DKE'" },
      { "label": "Other (type yours)", "description": "E.g. ACME, TOKO, XYZ" }
    ]
  },
  { "question": "Who's the Product Driver (PM / IT Lead proposing)?", "header": "Driver", "options": [/* pre-fill from user signature or recent authors */] },
  { "question": "Who's the Product Delivery (Tech Lead executing)?",  "header": "Delivery", "options": [/* pre-fill */] }
]
```

Follow-up (via a smaller batch A3 only if the user didn't supply a stakeholder in free-text):

- "Who's the primary stakeholder / sponsor?" → free-text via the Other-option path.

### Batch A4 — language + theme (conditional)

Skip if the user's message language is obvious and no theme variation is needed. Otherwise:

```json
[
  { "question": "Which language should the PRD be drafted in?", "header": "Language", "options": [
      { "label": "Bahasa Indonesia (default)", "description": "Formal-profesional ID." },
      { "label": "English", "description": "Formal professional EN." }
    ]
  },
  { "question": "Brand theme for the cover?", "header": "Theme", "options": [
      { "label": "DKE Blue (default)", "description": "Corporate blue." },
      { "label": "Corporate Neutral", "description": "Neutral grays, brand-agnostic." },
      { "label": "Modern Teal", "description": "Fresh teal accent." },
      { "label": "Minimal Black", "description": "High-contrast, print-friendly." }
    ]
  }
]
```

## Phase B — Problem + users + metrics baseline

**Goal**: make the Problem Statement non-fluffy. Every claim needs a number + source; gather both here or flag for Open Questions.

### Batch B1 — problem evidence

```json
[
  { "question": "What's the core problem this PRD is solving?", "header": "Problem", "options": [/* pre-filled with agent's guess from context */] },
  { "question": "Who has this problem, and how many of them?", "header": "Affected users", "options": [
      { "label": "A specific persona (you'll describe)", "description": "E.g. 'Team admins managing 50+ members'" },
      { "label": "A segment of existing users", "description": "You'll estimate the size from existing analytics." },
      { "label": "We don't know yet", "description": "Will be flagged as an Open Question with a due date." }
    ]
  },
  { "question": "What's the strongest evidence that this problem is real and big?", "header": "Evidence", "options": [
      { "label": "Support ticket / complaint volume", "description": "I'll help you structure the citation." },
      { "label": "Survey / interview result", "description": "Share N and the headline number." },
      { "label": "Product analytics / log data", "description": "I can help query if a connector is configured." },
      { "label": "Competitor parity gap", "description": "We need this to match a competitor feature." }
    ]
  }
]
```

### Batch B2 — users + metrics baseline

```json
[
  { "question": "Who's the primary persona?", "header": "Persona", "options": [/* pre-fill from discovery */] },
  { "question": "Do you already have a baseline for the North Star Metric?", "header": "NSM baseline", "options": [
      { "label": "Yes — I'll provide the number", "description": "I'll cite it in the metrics table." },
      { "label": "It's in our analytics; let me check", "description": "I'll flag and we can edit later." },
      { "label": "No baseline yet", "description": "We'll set a target and measure post-launch." }
    ]
  },
  { "question": "Which guardrail metric is the most at risk of regressing?", "header": "Guardrail", "options": [
      { "label": "Latency (p95 / p99)", "description": "E.g. dashboard load time." },
      { "label": "Error / crash rate", "description": "Stability metric." },
      { "label": "Cost per user / transaction", "description": "Unit economics." },
      { "label": "CSAT / NPS", "description": "User sentiment." }
    ]
  }
]
```

## Phase C — Goals, non-goals, rollout, constraints

### Batch C1 — goals + non-goals

```json
[
  { "question": "What's the #1 outcome you'd call success?", "header": "Top goal", "options": [/* pre-filled from NSM */] },
  { "question": "What's explicitly out of scope for this release?", "header": "Non-goals", "options": [
      { "label": "A named feature we're deferring", "description": "You'll name it." },
      { "label": "A persona we're not serving yet", "description": "E.g. free-tier users." },
      { "label": "A region / locale we're not covering", "description": "E.g. EU-only." },
      { "label": "Nothing — everything is in scope", "description": "Warning: empty Non-Goals suggests under-scoping." }
    ]
  }
]
```

### Batch C2 — rollout + timeline

```json
[
  { "question": "Rollout shape you prefer?", "header": "Rollout", "options": [
      { "label": "Alpha → Beta → GA (Recommended)", "description": "Internal → pilot → everyone. Standard 3-phase." },
      { "label": "Feature-flag gradual %", "description": "1% → 10% → 50% → 100% over 2-3 weeks." },
      { "label": "Big-bang launch", "description": "One-shot release. Risky but sometimes needed." },
      { "label": "Pilot with one named customer", "description": "B2B design-partner style." }
    ]
  },
  { "question": "Target launch date?", "header": "Timeline", "options": [
      { "label": "End of this quarter", "description": "" },
      { "label": "End of next quarter", "description": "" },
      { "label": "Specific date (you'll enter)", "description": "" },
      { "label": "As soon as possible, no fixed date", "description": "Flag: missing timeline makes prioritization ambiguous." }
    ]
  }
]
```

### Batch C3 — known constraints

```json
[
  { "question": "Which of these constraints apply?", "header": "Constraints", "multiSelect": true, "options": [
      { "label": "Regulatory / compliance", "description": "GDPR, UU PDP, HIPAA, PCI-DSS, SOC2." },
      { "label": "Data residency", "description": "Data must stay in a specific region." },
      { "label": "Third-party contractual limit", "description": "E.g. vendor rate limit, SLA floor." },
      { "label": "Internal tech-debt blocker", "description": "Must unblock a legacy system first." }
    ]
  }
]
```

## Phase D — Domain add-ons (conditional)

Trigger this phase **only** when the feature falls into one of these domains. Add the extra section(s) before Section 12 (Open Questions) per `references/prd-structure.md`.

### Batch D — domain-specific

```json
{
  "question": "Does this PRD need any of these domain sections?",
  "header": "Domain add-ons",
  "multiSelect": true,
  "options": [
    { "label": "Product Analytics", "description": "Event Taxonomy, SDK Implementation, Dashboard Blueprints, Governance." },
    { "label": "AI / LLM", "description": "Prompt Design, Evaluation Methodology, Cost Monitoring." },
    { "label": "Infra / Migration", "description": "Migration Strategy, Rollback Plan, Data Validation." },
    { "label": "Security", "description": "Threat Model, Compliance Matrix, Penetration Test Plan." }
  ]
}
```

If user selects a domain, ask one focused follow-up per domain (e.g. for AI: "What's the expected per-request token cost?"; for Analytics: "What tracking SDK?").

## Phase E — 4 Risks challenge (mandatory, see SKILL.md Phase 3)

After all the above batches, issue a **4 Risks challenge** round — no AskUserQuestion needed, just pointed questions in chat. The goal is to force the user to produce evidence or concede an Open Question.

Template:

> "Before I draft, let me push back on the 4 Risks so we don't miss anything:
> - **Value** — [pointed question referencing their earlier answers]
> - **Usability** — [pointed question]
> - **Feasibility** — [pointed question]
> - **Business Viability** — [pointed question]
> Please either give me the data or tell me which ones to log as Open Questions with an owner + due date."

## Phase F — Pre-generation sign-off

Before running `node generate_<slug>_prd.js`, show the user a **plaintext summary**:

```
I'm about to generate the PRD. Quick sanity check:

Title: PRD: Real-time In-App Notifications for Team Dashboard
Number: 007/PRD-ACME/IV/2026
NSM: 7-day acknowledged-notification rate (41% → 70% in 3 months)
Top goals: 1) Lift acknowledge rate 2) Reduce MTTA to <30min 3) Ship by Q2 2026
Rollout: Alpha (1w) → Beta (3w, 20 customers) → GA (8 Jun 2026)
Top risks per category:
  Value       — Adoption cannibalized by email preference
  Usability   — Browser push opt-in friction
  Feasibility — Socket.io at 50k concurrent untested
  Business    — Infra +$3.2k/month unbudgeted

Open Questions (3): [bullets]

OK to generate, or want to adjust anything?
```

Only after explicit sign-off → generate the .docx.
