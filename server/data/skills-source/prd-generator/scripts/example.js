/**
 * PRD Generator — Template Example.
 *
 * How to use:
 *   1. Copy this file to `generate_<slug>_prd.js`
 *      (e.g. `generate_realtime_notifications_prd.js`).
 *   2. Change the values in `const INPUTS = {...}` to match your PRD.
 *   3. Edit each section's content below.
 *   4. Run: `node generate_<slug>_prd.js`
 *
 * Output layout:
 *   The script writes a FOLDER (not just a single .docx):
 *
 *     prd-output/<slug>/
 *     ├── <title>.docx        ← the PRD
 *     ├── summary.md          ← 5-8 line exec summary (paste in Slack/email)
 *     ├── open-questions.md   ← unresolved items with owner + due date
 *     ├── context.json        ← discovery scan output (optional)
 *     ├── inputs.json         ← interview answers snapshot (for regeneration)
 *     └── README.md           ← folder index
 *
 *   Base dir auto-detected:
 *     - Cowork    → /sessions/<id>/mnt/outputs/prd-output/<slug>/
 *     - CLI agent → <cwd>/prd-output/<slug>/
 *     - Override  → set PRD_OUTPUT_DIR env var, or pass baseDir to saveBundle()
 *
 * Key configuration knobs:
 *   - INPUTS.orgCode  — used in the PRD number (e.g. 'DKE', 'ACME', 'TOKO')
 *   - INPUTS.locale   — 'id' (default) | 'en'
 *   - INPUTS.theme    — 'dke-blue' (default) | 'corporate-neutral' | 'modern-teal'
 *                       | 'minimal-black' | { primaryColor, accentColor, font }
 */

const b = require('./lib/prd-builder');

// ═══════════════════════════════════ INPUT — edit this block ═══════
const INPUTS = {
  // Cover
  title: 'PRD: [Feature / Initiative Title]',
  slug:  'prd-template-example',               // folder name under prd-output/
  version: 'v1.0.0',
  date: b.formatLocaleDate(new Date(), 'id'),  // auto-today, swap to 'en' if needed
  orgCode: 'DKE',                              // 'DKE' | 'ACME' | 'TOKO' | ...
  prdNumber: b.formatPrdNumber({ sequence: 1, orgCode: 'DKE', month: 4, year: 2026 }),
  productDriver: 'Name (PM / IT Lead)',
  productDelivery: 'Name (Engineer / Tech Lead)',
  stakeholder: 'Name (Sponsor / User Representative)',
  status: 'Draft', // Draft | Review | Approved | Abandoned

  // Style
  locale: 'id',        // 'id' | 'en'
  theme: 'dke-blue',   // preset name or custom object

  // Output override (optional — leave null to auto-detect)
  baseDir: null,       // e.g. '/home/me/prds' — skips auto-detection
};
// ═══════════════════════════════════════════════════════════════════

// Propagate theme/locale to every helper call
const H = {
  theme: INPUTS.theme,
  locale: INPUTS.locale,
};

// Build document children
const children = [
  // ── Cover page ───────────────────────────────────────────────────
  ...b.createCoverPage(INPUTS),

  // ── 1. Executive Summary ─────────────────────────────────────────
  b.createSectionHeading('1', 'Executive Summary', H),
  b.createParagraph(
    'Summarize in 3–5 sentences: what will be built, for whom, why now, ' +
    'the expected business impact. An exec reader should grasp the PRD core ' +
    'without reading any other section.',
    H
  ),
  b.createCallout(
    '**TL;DR** — State the North Star Metric (NSM), primary target, and timeline here.',
    'info', H
  ),

  // ── 2. Product Overview ──────────────────────────────────────────
  b.createSectionHeading('2', 'Product Overview', H),
  b.createSubHeading('2.1 Positioning', 2, H),
  b.createParagraph('A 1–2 sentence positioning statement.', H),

  b.createSubHeading('2.2 Value Proposition', 2, H),
  b.createTable(
    ['Aspect', 'Business Benefit'],
    [
      ['Aspect A', 'Benefit A'],
      ['Aspect B', 'Benefit B'],
    ],
    { columnWidths: [30, 70], theme: INPUTS.theme }
  ),

  b.createSubHeading('2.3 Users / Personas', 2, H),
  ...b.createBulletList([
    '**Persona 1** — brief description, pain point, jobs-to-be-done.',
    '**Persona 2** — brief description, pain point, jobs-to-be-done.',
  ], H),

  b.createSubHeading('2.4 Tech Stack', 2, H),
  ...b.createBulletList([
    '**Frontend**: (e.g. Next.js 15, React 19, Tailwind v4)',
    '**Backend**: (e.g. Node.js + Express + TypeScript)',
    '**Database**: (e.g. PostgreSQL + pgvector)',
    '**Infra**: (e.g. Docker Compose, GitHub Actions CI)',
  ], H),

  // ── 3. Problem Statement ─────────────────────────────────────────
  b.createSectionHeading('3', 'Problem Statement', H),
  b.createParagraph(
    'Who has what problem? Supporting data (logs, surveys, tickets)? ' +
    'Impact if not solved? Do not discuss solutions in this section.',
    H
  ),

  b.createSubHeading('3.1 Pre-flight 4 Risks Questions', 2, H),
  b.createParagraph('Before jumping to a solution, answer these 4 key questions:', H),
  ...b.createBulletList([
    '**Value Risk** — Do users actually want this? What evidence do we have?',
    '**Usability Risk** — Can they use it easily? Who is most likely to fail?',
    '**Feasibility Risk** — Can engineering build this with current stack & timeline?',
    '**Business Viability Risk** — Is this healthy for the business? (cost, legal, support, GTM)',
  ], H),

  // ── 4. Goals & Non-Goals ─────────────────────────────────────────
  b.createSectionHeading('4', 'Goals & Non-Goals', H),
  b.createSubHeading('4.1 Goals', 2, H),
  ...b.createNumberedList([
    'Goal 1 — specific, measurable, timeboxed.',
    'Goal 2 — specific, measurable, timeboxed.',
    'Goal 3 — specific, measurable, timeboxed.',
  ], 'prd-numbered', H),

  b.createSubHeading('4.2 Non-Goals', 2, H),
  ...b.createBulletList([
    'What we explicitly will **not** do in this release.',
    'Scope deferred to a later phase.',
  ], H),

  // ── 5. Product Metrics & Success Criteria ────────────────────────
  b.createSectionHeading('5', 'Product Metrics & Success Criteria', H),
  b.createParagraph(
    '**North Star Metric (NSM)**: a single metric that represents product ' +
    'value. Every supporting metric should connect back to the NSM.',
    H
  ),
  b.createTable(
    ['Metric', 'Definition', 'Measurement', '3-Month Target'],
    [
      ['NSM', 'Definition of NSM', 'Query / event source', '[Target]'],
      ['Acquisition metric', 'Definition', 'Data source', '[Target]'],
      ['Activation metric', 'Definition', 'Data source', '[Target]'],
      ['Retention metric', 'Definition', 'Data source', '[Target]'],
    ],
    { columnWidths: [20, 30, 30, 20], theme: INPUTS.theme }
  ),

  // ── 6. Solution Overview ─────────────────────────────────────────
  b.createSectionHeading('6', 'Solution Overview', H),
  b.createParagraph('Describe the solution from the user\'s point of view (what, not how).', H),
  ...b.createBulletList([
    'Primary end-to-end user flow.',
    'External integrations (API, webhook, MCP).',
    'State diagram / wireframe where relevant.',
  ], H),

  // ── 7. Functional Requirements ───────────────────────────────────
  b.createSectionHeading('7', 'Functional Requirements', H),
  b.createTable(
    ['ID', 'Requirement', 'Priority', 'Acceptance Criteria'],
    [
      ['FR-01', 'Feature description', 'P0', 'Given-When-Then pass condition'],
      ['FR-02', 'Feature description', 'P1', 'Given-When-Then pass condition'],
      ['FR-03', 'Feature description', 'P2', 'Given-When-Then pass condition'],
    ],
    { columnWidths: [10, 40, 15, 35], theme: INPUTS.theme }
  ),

  // ── 8. Non-Functional Requirements ───────────────────────────────
  b.createSectionHeading('8', 'Non-Functional Requirements', H),
  ...b.createBulletList([
    '**Performance** — e.g. p95 latency < 2s.',
    '**Availability** — e.g. SLA 99.9%.',
    '**Security** — authentication, RBAC, audit log.',
    '**Compliance** — local privacy law (GDPR / UU PDP / CCPA), PII masking.',
    '**Scalability** — target concurrent users / RPS.',
    '**Observability** — logs, metrics, traces.',
  ], H),

  // ── 9. Technical Approach & Implementation Plan ──────────────────
  b.createSectionHeading('9', 'Technical Approach & Implementation Plan', H),
  b.createParagraph('High-level architecture, new components, data-model changes.', H),
  b.createSubHeading('9.1 Example Snippet', 2, H),
  ...b.createCodeBlock(
`// Key code to be reviewed by engineering
async function handleRequest(req, res) {
  const result = await service.process(req.body);
  return res.json(result);
}`,
    'javascript', H
  ),

  // ── 10. Rollout Plan ─────────────────────────────────────────────
  b.createSectionHeading('10', 'Rollout Plan', H),
  b.createTable(
    ['Phase', 'Duration', 'Scope', 'Exit Criteria'],
    [
      ['Alpha (internal)', '1 week', 'Internal team', 'Zero P0 bugs'],
      ['Beta (pilot)', '2 weeks', '10–20 chosen users', 'NPS ≥ 30'],
      ['GA (all users)', '-', 'All tenants', 'Rollback plan ready'],
    ],
    { theme: INPUTS.theme }
  ),

  // ── 11. Risks & Mitigation (4 Risks balanced) ────────────────────
  b.createSectionHeading('11', 'Risks & Mitigation', H),
  b.createCallout(
    'The 4 risks are discussed with **equal weight** (~25% each). ' +
    'Avoid over-indexing on Value Risk alone.',
    'warning', H
  ),
  b.createSubHeading('11.1 Value Risk', 2, H),
  ...b.createBulletList(['Risk: …', 'Mitigation: …'], H),
  b.createSubHeading('11.2 Usability Risk', 2, H),
  ...b.createBulletList(['Risk: …', 'Mitigation: …'], H),
  b.createSubHeading('11.3 Feasibility Risk', 2, H),
  ...b.createBulletList(['Risk: …', 'Mitigation: …'], H),
  b.createSubHeading('11.4 Business Viability Risk', 2, H),
  ...b.createBulletList(['Risk: …', 'Mitigation: …'], H),

  // ── 12. Open Questions ───────────────────────────────────────────
  b.createSectionHeading('12', 'Open Questions', H),
  ...b.createBulletList([
    'Questions still unanswered before sign-off.',
    'Tag each with an owner + due date where possible.',
  ], H),

  // ── 13. Dependencies ─────────────────────────────────────────────
  b.createSectionHeading('13', 'Dependencies', H),
  ...b.createBulletList([
    'Upstream system / API',
    'Design system component',
    'Third-party SaaS / vendor',
  ], H),

  // ── 14. Stakeholders & RACI ──────────────────────────────────────
  b.createSectionHeading('14', 'Stakeholders & RACI', H),
  b.createTable(
    ['Name / Role', 'Responsible', 'Accountable', 'Consulted', 'Informed'],
    [
      ['Product Driver', 'v', '', '', ''],
      ['Tech Lead', 'v', 'v', '', ''],
      ['QA Lead', '', '', 'v', ''],
      ['Sponsor', '', 'v', '', 'v'],
    ],
    { theme: INPUTS.theme }
  ),

  // ── 15. Timeline ─────────────────────────────────────────────────
  b.createSectionHeading('15', 'Timeline', H),
  b.createTable(
    ['Milestone', 'Owner', 'Target Date', 'Status'],
    [
      ['Kick-off', 'PM', '[date]', 'Planned'],
      ['Design review', 'Design', '[date]', 'Planned'],
      ['Code complete', 'Eng', '[date]', 'Planned'],
      ['Launch', 'PM', '[date]', 'Planned'],
    ],
    { theme: INPUTS.theme }
  ),

  // ── 16. Appendix ─────────────────────────────────────────────────
  b.createSectionHeading('16', 'Appendix', H),
  b.createSubHeading('16.1 Glossary', 2, H),
  ...b.createBulletList([
    '**NSM** — North Star Metric.',
    '**RACI** — Responsible, Accountable, Consulted, Informed.',
    '**4 Risks** — Value, Usability, Feasibility, Business Viability (Marty Cagan).',
  ], H),

  b.createSubHeading('16.2 References', 2, H),
  ...b.createBulletList([
    'Marty Cagan — *Inspired* & *Empowered*.',
    'Internal doc: [link].',
    'User research / historical data: [link].',
  ], H),

  b.createSubHeading('16.3 Pre-delivery Checklist', 2, H),
  ...b.createBulletList([
    'Cover page complete (8 fields).',
    'PRD number valid, no collision.',
    'All 16 sections present (extras OK).',
    '4 Risks discussed with balanced depth.',
    'Every metric has definition + measurement + target.',
    '.docx validation passes.',
  ], H),
];

// ═══════════════════════════════════ Generate & save ════════════════
const numCheck = b.validatePrdNumber(INPUTS.prdNumber);
if (!numCheck.valid) {
  console.warn(`WARN: ${numCheck.message}`);
}

const doc = b.createDocument(children, {
  title: INPUTS.title,
  description: `PRD ${INPUTS.prdNumber}`,
  theme: INPUTS.theme,
});

// Side files — fill these in alongside the section content so the generated
// folder is useful on its own, not just a .docx.
const summary = `
# ${INPUTS.title}

- **PRD**: ${INPUTS.prdNumber}
- **Driver**: ${INPUTS.productDriver}
- **Delivery**: ${INPUTS.productDelivery}
- **Status**: ${INPUTS.status}

Replace this with 5–8 lines covering the NSM, top 2 goals,
rollout plan, and top risk per category.
`;

const openQuestions = [
  // { question: 'Baseline NSM value?', owner: 'PM', dueDate: '2026-04-25' },
];

b.saveBundle({
  doc,
  slug:  INPUTS.slug,
  title: INPUTS.title,
  summary,
  openQuestions,
  // context: require('./context.json'),   // populate from discover.js output
  inputs: INPUTS,
}, { baseDir: INPUTS.baseDir })
  .then(({ dir, files }) => {
    console.log(`PRD bundle written to: ${dir}`);
    for (const [k, p] of Object.entries(files)) console.log(`  ${k.padEnd(14)} ${p}`);
  })
  .catch(err => {
    console.error('ERROR:', err);
    process.exit(1);
  });
