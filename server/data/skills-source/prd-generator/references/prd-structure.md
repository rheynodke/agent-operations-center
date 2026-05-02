# PRD Structure — 16-Section Skeleton

Every PRD **must** contain the 16 sections below. You may **add** domain-specific sections (e.g. "Event Taxonomy" for analytics PRDs, "Migration Plan" for infra PRDs) but you may **not remove** any of the 16 — reviewers rely on coverage.

## 1. Executive Summary

**Goal**: an exec-level reader understands the PRD's core in 30 seconds.

Minimum content (3–5 sentences or bullets):

- What is being built.
- For whom (primary persona).
- Why now (urgency).
- Expected business impact (NSM + target).
- High-level timeline.

**Tip**: include a `TL;DR` callout with NSM + top target.

## 2. Product Overview

**Goal**: product and user context.

Sub-sections:

- **2.1 Positioning** — 1–2 sentence positioning statement.
- **2.2 Value Proposition** — table: Aspect vs Business Benefit.
- **2.3 User / Personas** — 2–4 personas with jobs-to-be-done.
- **2.4 Tech Stack** — frontend / backend / database / infra.

## 3. Problem Statement

**Goal**: prove the problem is real and worth solving.

Content:

- Who has the problem (use data: logs, surveys, support tickets, queries).
- Impact if not solved (revenue risk, churn, compliance, cost).
- **Do not** discuss solutions in this section.

**Required**: a sub-section **"4 Risks Pre-flight Questions"** that forces the team to surface the 4 key risks before jumping to solutions.

## 4. Goals & Non-Goals

**Goal**: bound the scope clearly.

- **Goals** — numbered list. Each goal SMART (Specific, Measurable, Achievable, Relevant, Time-bound).
- **Non-Goals** — bulleted list. What the team explicitly will **not** do in this release.

If Non-Goals is empty, the PRD isn't focused enough.

## 5. Product Metrics & Success Criteria

**Goal**: measure success with numbers, not sentiment.

Content:

- **North Star Metric (NSM)** — a single metric that represents product value.
- **Guardrail Metrics** — metrics that must not regress (latency, error rate, CSAT).
- **Input Metrics** — supporting metrics that drive the NSM.

Required table (4 columns):

| Metric | Definition | Measurement | 3-Month Target |
|---|---|---|---|

Every metric needs an **explicit definition + measurement method + target**. A metric without a target is not a metric.

## 6. Solution Overview

**Goal**: describe the solution from the user's point of view (**what**, not yet **how**).

Content:

- End-to-end user flow (diagram — mermaid in Appendix is fine).
- External integrations (API, webhook, MCP, third-party).
- Information architecture for any new UI.

## 7. Functional Requirements

**Goal**: enumerate requirements an engineer can break into tickets.

Required table (4 columns):

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|

Priority: `P0` (must) | `P1` (should) | `P2` (nice-to-have).
Acceptance criteria must be **observable** (Given / When / Then where practical).

## 8. Non-Functional Requirements

**Goal**: quality constraints that are often overlooked.

Checklist:

- Performance (p50 / p95 latency, throughput).
- Availability / SLA.
- Security (authentication, RBAC, audit log, PII handling).
- Compliance (local privacy law — GDPR, UU PDP 27/2022, CCPA — plus any internal ISO / SOC2).
- Scalability (target concurrent users / RPS).
- Observability (logs, metrics, traces).
- Accessibility for any new UI (WCAG 2.1 AA baseline).

## 9. Technical Approach & Implementation Plan

**Goal**: engineers understand **how**.

Content:

- High-level architecture (diagram is welcome).
- New components vs. reuse of existing ones.
- Data model changes (migrations, backfills, dual-write periods).
- Key code snippets that need cross-team review.

Use `createCodeBlock()` for snippets — don't embed screenshots of code.

## 10. Rollout Plan

**Goal**: de-risk launch with staged phases.

Required table (4 columns):

| Phase | Duration | Scope | Exit Criteria |
|---|---|---|---|

Minimum phases: **Alpha (internal)** → **Beta (pilot)** → **GA (all users)**. Every phase needs quantitative exit criteria.

## 11. Risks & Mitigation (4 Risks, balanced)

**Goal**: surface risks before engineering starts.

**MANDATORY** 4 sub-sections, in order:

- **11.1 Value Risk**
- **11.2 Usability Risk**
- **11.3 Feasibility Risk**
- **11.4 Business Viability Risk**

Each sub-section: ≥1 concrete risk + ≥1 concrete mitigation. Depth roughly equal (25% each).

## 12. Open Questions

**Goal**: surface what's not answered yet.

Bulleted list. Ideally each question has:

- Owner (who finds the answer)
- Due date (when)
- Impact if unanswered

## 13. Dependencies

**Goal**: internal + external dependencies that could delay.

Bulleted list:

- Internal teams needed (DevOps, Security, Design).
- External services (vendors, SaaS APIs).
- Libraries / SDKs with version pinning.

## 14. Stakeholders & RACI

**Goal**: crystal-clear ownership.

RACI table:

| Name / Role | R | A | C | I |
|---|---|---|---|---|

R = Responsible, A = Accountable, C = Consulted, I = Informed. One piece of work has **exactly one A**.

## 15. Timeline

**Goal**: milestones with owner and target date.

Required table (4 columns):

| Milestone | Owner | Target Date | Status |
|---|---|---|---|

Status: `Planned` | `In Progress` | `Done` | `Delayed`.

## 16. Appendix

**Goal**: reference material without cluttering the main flow.

Sub-sections:

- **16.1 Glossary** — technical / internal terms.
- **16.2 References** — links to research, related docs, articles.
- **16.3 Pre-delivery Checklist** — items to verify before sign-off.

May add **16.x Changelog** once the PRD iterates.

## Domain-specific add-ons

Optional but recommended sections for specific domains:

| Domain | Extra Sections |
|---|---|
| Product Analytics | Event Taxonomy, SDK Implementation, Dashboard Blueprints, Governance |
| Infra / Migration | Migration Strategy, Rollback Plan, Data Validation |
| Integration | API Contract, Webhook Schema, Rate Limiting |
| AI / LLM | Prompt Design, Evaluation Methodology, Cost Monitoring |
| Security | Threat Model, Compliance Matrix, Penetration Test Plan |
| Mobile | Offline Behavior, App Store Review Risks, Push Notification Strategy |
| E-commerce | Pricing & Promotion Rules, Payment Flow, Fraud Considerations |

Insert these **before** section 12 (Open Questions) so the flow stays logical.
