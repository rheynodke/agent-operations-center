# Example PRD — SaaS Feature: Real-time Notifications

Reference PRD in the standard format. **Use for structure and tone, not for verbatim copying.**

## Cover

| Field | Value |
|---|---|
| Title | PRD: Real-time In-App Notifications for Team Dashboard |
| Version | v1.0.0 |
| Date Created | 18 April 2026 |
| No | 007/PRD-ACME/IV/2026 |
| Product Driver | Dian Pratama (PM, Collaboration) |
| Product Delivery | Web Platform Team |
| Stakeholder | VP Product, Head of Customer Success |
| Status | Draft |
| Locale | `id` |
| Theme | `dke-blue` (default) |

## Summary preview

- **Problem**: 68% of team admins miss critical dashboard events because updates only arrive via email digest (measured from 3-month ticket analysis; N=214 customers).
- **Solution**: in-app real-time notifications (websocket) + browser push + a notification inbox UI.
- **NSM**: 7-day acknowledged-notification rate (% of critical events acknowledged within 7 days of occurrence).
- **Target**: lift 7-day acknowledge rate from 41% → 70% within 3 months of GA.
- **Rollout**: Alpha (internal, 1 week) → Beta (20 pilot customers, 3 weeks) → GA (all workspaces).
- **Top risks covered balanced**:
  - **Value** — some personas prefer email-only; mitigated by per-user channel preferences.
  - **Usability** — notification fatigue; mitigated by priority grouping + snooze + daily summary fallback.
  - **Feasibility** — websocket scale to 50k concurrent; mitigated by staged rollout + load test on staging.
  - **Business Viability** — infra cost at scale; mitigated by connection pooling + tiered plan gating.

## Sections present (16 standard + 2 domain-specific)

1. Executive Summary
2. Product Overview (positioning, personas, tech stack)
3. Problem Statement (with 4 Risks pre-flight questions)
4. Goals & Non-Goals
5. Product Metrics & Success Criteria (NSM + 8 supporting metrics)
6. Solution Overview (user flow, IA, integration points)
7. Functional Requirements (18 FRs, P0/P1/P2 mix)
8. Non-Functional Requirements (performance, security, compliance, observability)
9. Technical Approach & Implementation Plan (websocket infra, delivery worker, fallback to email)
10. **Notification Taxonomy** (domain-specific: notification types, priority, channel matrix)
11. Rollout Plan (Alpha/Beta/GA)
12. Risks & Mitigation (4 Risks balanced)
13. **Observability & Runbook** (domain-specific: key metrics, alerts, on-call)
14. Open Questions
15. Dependencies
16. Stakeholders & RACI
17. Timeline
18. Appendix (glossary, references, pre-delivery checklist)

## Patterns worth learning

1. **NSM tied to value delivered** ("acknowledged notification") rather than activity ("notifications sent").
2. **Metrics table is the contract**: every row has definition + measurement + target.
3. **Domain-specific sections** (Notification Taxonomy, Observability) added without removing any of the 16 standard ones.
4. **Channel preferences as mitigation** for Value Risk — not everyone wants notifications.
5. **Tiered plan gating** as Business Viability mitigation — high-concurrency workspaces route to paid tier.
6. **Browser push opt-in flow** in Usability — recognized high-friction surface, budget allocated for a 2-min tutorial.

## Generated file

Output: `/sessions/<session>/mnt/outputs/PRD_Real_Time_Notifications.docx`
