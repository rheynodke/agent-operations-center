/**
 * prd-to-mockup — Template Example.
 *
 * How to use:
 *   1. Copy this file to `generate_<slug>_mockup.js` alongside the `lib/` folder.
 *   2. Fill `SPEC` with your screens.
 *   3. Run: `node generate_<slug>_mockup.js`
 *   4. Open the printed HTML path in a browser.
 *
 * Output (single self-contained file):
 *   prd-output/<slug>/mockups.html
 *   prd-output/<slug>/screens.json
 *
 * Zero runtime dependencies — pure Node + inline CSS/JS.
 */

const mb = require('./lib/mockup-builder');

// ═══════════════════════════════════ SPEC — edit this block ════════
const SPEC = {
  title: 'PRD: Real-time In-App Notifications',
  slug:  'realtime-notifications',
  theme: 'modern-teal',        // 'dke-blue' | 'corporate-neutral' | 'modern-teal' | 'minimal-black' | {custom}
  viewport: 'desktop',         // 'desktop' | 'tablet' | 'mobile' | 'responsive'
  cols: 3,

  screens: [
    {
      id: '01-empty',
      name: 'Empty inbox',
      purpose: 'First-time state when the user has no notifications.',
      layout: 'empty',
      components: [
        { type: 'topbar', brand: 'ACME Dashboard', actions: ['Settings', 'Profile'] },
        { type: 'nav', items: [
          { label: 'Overview' },
          { label: 'Notifications', active: true },
          { label: 'Teams' },
          { label: 'Admin' },
        ]},
        { type: 'empty',
          title: 'All caught up',
          body: 'You have no active notifications. We will let you know when something needs your attention.',
          cta: 'Customize preferences' },
      ],
      connectsTo: ['02-live'],
    },
    {
      id: '02-live',
      name: 'Live notifications',
      purpose: 'User receives real-time events — bell indicator + inline list.',
      layout: 'list',
      components: [
        { type: 'topbar', brand: 'ACME Dashboard', actions: ['3 new', 'Profile'] },
        { type: 'nav', items: [
          { label: 'Overview' },
          { label: 'Notifications', active: true },
          { label: 'Teams' },
          { label: 'Admin' },
        ]},
        { type: 'heading', level: 2, text: 'Notifications' },
        { type: 'muted', text: '3 unread · Updated just now' },
        { type: 'row', children: [
          { type: 'button', label: 'Mark all read', variant: 'ghost' },
          { type: 'button', label: 'Filter', variant: 'ghost' },
        ]},
        { type: 'card',
          title: '🔴 Deploy failed — prod/api',
          body: 'Build #4812 on main failed the integration suite. Tap to view logs.',
          meta: '2 min ago · from CI' },
        { type: 'card',
          title: '🟡 SLA at risk — EU region',
          body: 'p95 latency exceeded 450ms for 10 min. Auto-scale triggered.',
          meta: '14 min ago · from Datadog' },
        { type: 'card',
          title: '🟢 Pull request merged',
          body: 'Dian merged #1423 "fix: retry logic for webhook dispatch".',
          meta: '1 h ago · from GitHub' },
      ],
      connectsTo: ['03-detail'],
    },
    {
      id: '03-detail',
      name: 'Notification detail',
      purpose: 'Full context + activity timeline for one notification.',
      layout: 'detail',
      components: [
        { type: 'topbar', brand: 'ACME Dashboard', actions: ['Back', 'Share'] },
        { type: 'heading', level: 1, text: 'Deploy failed — prod/api' },
        { type: 'muted', text: 'Build #4812 · triggered 2m ago · 3 people notified' },
        { type: 'row', children: [
          { type: 'button', label: 'Acknowledge', variant: 'primary' },
          { type: 'button', label: 'Assign', variant: 'ghost' },
          { type: 'button', label: 'Silence 1h', variant: 'ghost' },
        ]},
        { type: 'card',
          title: 'Error',
          body: 'Integration test suite "payments-webhook-e2e" failed on step 7 of 12. Retry attempted 3× unsuccessfully.' },
        { type: 'card',
          title: 'Recent activity',
          body: 'Dian (SRE) viewed · CI re-triggered twice · On-call paged.' },
      ],
      connectsTo: ['04-preferences'],
    },
    {
      id: '04-preferences',
      name: 'Notification preferences',
      purpose: 'User controls channel + severity routing.',
      layout: 'form',
      components: [
        { type: 'topbar', brand: 'ACME Dashboard', actions: ['Save', 'Cancel'] },
        { type: 'heading', level: 2, text: 'Notification preferences' },
        { type: 'muted', text: 'Route events to the right channel at the right severity.' },
        { type: 'table', headers: ['Severity', 'In-app', 'Email', 'Slack'], rows: [
          ['Critical', '✔', '✔', '✔'],
          ['Warning', '✔', '—', '✔'],
          ['Info', '✔', '—', '—'],
        ]},
        { type: 'checkbox', label: 'Quiet hours (10pm – 7am, local time)', checked: true },
        { type: 'checkbox', label: 'Digest low-priority events into a daily email', checked: false },
        { type: 'button', label: 'Save preferences', variant: 'primary' },
      ],
      connectsTo: [],
    },
    {
      id: '05-error',
      name: 'Connection lost',
      purpose: 'Websocket dropped — graceful degradation.',
      layout: 'error',
      components: [
        { type: 'topbar', brand: 'ACME Dashboard', actions: [] },
        { type: 'alert', kind: 'danger', text: 'Live updates paused — reconnecting in 5 s…' },
        { type: 'muted', text: 'We will fetch missed events automatically once the connection returns.' },
        { type: 'button', label: 'Retry now', variant: 'ghost' },
      ],
    },
  ],
};
// ═══════════════════════════════════════════════════════════════════

const { dir, files } = mb.saveMockupBundle(SPEC);
console.log(`Mockup bundle written to: ${dir}`);
for (const [k, p] of Object.entries(files)) console.log(`  ${k.padEnd(6)} ${p}`);
console.log('\nOpen mockups.html in a browser. Pan with drag, zoom with wheel, press F to fit.');
