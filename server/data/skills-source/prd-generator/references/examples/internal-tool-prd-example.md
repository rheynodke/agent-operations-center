# Example PRD — Internal Tool: Employee Leave Management System

Reference PRD in the standard format for an **internal** tool (not a customer-facing SaaS). Use for structure and tone.

## Cover

| Field | Value |
|---|---|
| Title | PRD: Employee Leave Management System (ELMS) v2 |
| Version | v2.0.0 |
| Date Created | 18 April 2026 |
| No | 012/PRD-ACME/IV/2026 |
| Product Driver | Ahmad Riza (IT Lead, People Tech) |
| Product Delivery | Internal Tools Squad |
| Stakeholder | Head of HR, CFO (for compliance) |
| Status | Review |
| Locale | `id` |
| Theme | `corporate-neutral` |

## Summary preview

- **Problem**: current leave tracking in a shared spreadsheet causes 17 payroll disputes/month; HR spends ~40 hours/month reconciling leave balances manually.
- **Solution**: internal web app — employees submit leave requests; approvers see a queue; balance auto-calculated from HRIS; payroll integration via monthly export.
- **NSM**: payroll disputes per month tied to leave (target: ≤ 2/month within 90 days post-GA, down from 17).
- **Rollout**: Pilot (HR + IT teams only, 2 weeks) → Phased (by division, 4 weeks) → All employees.
- **Top risks**:
  - **Value** — employees may resist because spreadsheet is "faster"; mitigated by ≤ 10-second submission flow + Slack reminders.
  - **Usability** — approvers on mobile need one-tap approve; mitigated by mobile-responsive approval screen + email one-click.
  - **Feasibility** — HRIS integration uses vendor API with 20 RPS limit; mitigated by nightly batch sync + cached read.
  - **Business Viability** — build vs. buy debate; mitigated by 3-year TCO spreadsheet showing internal build breaks even at month 18.

## Sections present

1. Executive Summary
2. Product Overview (HRIS context, personas, tech stack)
3. Problem Statement (with 4 Risks pre-flight)
4. Goals & Non-Goals
5. Product Metrics & Success Criteria
6. Solution Overview (user flow for requester / approver / HR)
7. Functional Requirements (24 FRs, P0/P1 mix)
8. Non-Functional Requirements
9. Technical Approach & Implementation Plan (data model, HRIS integration, audit log)
10. **Compliance Matrix** (domain-specific: labor law requirements by jurisdiction)
11. Rollout Plan (Pilot / Phased / All)
12. Risks & Mitigation (4 Risks balanced)
13. Open Questions
14. Dependencies
15. Stakeholders & RACI
16. Timeline
17. Appendix (glossary, references, pre-delivery checklist)

## Patterns worth learning

1. **NSM is a business-pain number** (payroll disputes), not an adoption number.
2. **Build vs. buy** argued explicitly in Business Viability risk — with 3-year TCO numbers, not opinions.
3. **Compliance Matrix** as a domain-specific section for HR / legal-sensitive tools.
4. **One-tap approve** for mobile personas, informed by a survey showing 70% of approvers approve from mobile.
5. **Nightly batch sync** as a Feasibility mitigation for vendor API rate limits — instead of assuming the limit is fine.
6. **Corporate-neutral theme** — this is an internal tool, not a flagship product; brand-neutral colors fit the tone.

## Generated file

Output: `/sessions/<session>/mnt/outputs/PRD_Employee_Leave_Management_v2.docx`
