# Output Format — Usability Testing

3 documents per cycle:

## 1. Test Plan (pre-test)

`outputs/YYYY-MM-DD-usability-plan-{feature}.md`

Required sections:
1. Test goal (specific, measurable)
2. Mode (moderated / unmoderated / guerilla)
3. Sample target (n, segment, recruitment criteria)
4. Task scenarios (5-7 tasks, story-driven, no leading language)
5. Success criteria per task (completion + time threshold + error threshold + severity)
6. Test environment (prototype link, recording setup, NDA)
7. Pilot test note

## 2. Per-Session Notes (during test)

`outputs/YYYY-MM-DD-usability-session-{feature}-{P_id}.md`

Per-task entry:
- Start time
- Steps observed
- Verbatim quotes
- End time + completion (yes/no/partial)
- Error count

Plus: SUS questionnaire raw responses (10 items, 1-5).

## 3. Final Report (post-test)

`outputs/YYYY-MM-DD-usability-report-{feature}.md`

Required sections:
1. Executive Summary — overall TCR + SUS + top 3 recommendations
2. Test Plan Reference — links to plan + session notes
3. Participants table
4. Per-Task Results table — TCR + time + errors + severity per task
5. SUS Score — per participant + average + benchmark verdict
6. Issues Identified — Major / Moderate / Minor sections
7. Recommendations — ranked by impact
8. Gate Decision — PASS / REDESIGN / CONDITIONAL checkbox
9. Sign-off — UX Lead + PM + (CPO if conditional)
10. Next Steps

## Hard gate thresholds

- **TCR ≥ 80%** for critical-path features (no exception without CPO override)
- **SUS ≥ 68** = above average; <68 → flag for redesign even if TCR passes
- **Sample n ≥ 5** Nielsen rule; <5 → directional findings only

## Severity rules (strict)

- **Major** — blocks task completion or causes giving up. Must-fix before PRD lock.
- **Moderate** — slows significantly or causes frustration. Should-fix in next iteration.
- **Minor** — cosmetic or preference. Backlog for polish.

## Anti-pattern

- ❌ Sample <5 tanpa flag
- ❌ Moderator hint / lead during session
- ❌ Skip SUS questionnaire
- ❌ Success criteria post-hoc
- ❌ TCR <80% rationalized
- ❌ No recording, no detailed notes
- ❌ Leading language di task scenarios
- ❌ Skip pilot test
