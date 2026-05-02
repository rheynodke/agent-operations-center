#!/usr/bin/env node
/**
 * uiux-odoo-generator — spec-template.js
 *
 * Emits a commented JavaScript spec stub for one of the three operating modes.
 * Pipe into a file, fill the TODOs, then run it the same way as example.js.
 *
 * Usage:
 *   node spec-template.js --kind customize  > my-customize.js
 *   node spec-template.js --kind new-module > my-module.js
 *   node spec-template.js --kind direct     > my-direct.js
 */

'use strict';

const args = process.argv.slice(2);
const kindFlag = args.indexOf('--kind');
const kind = kindFlag !== -1 ? args[kindFlag + 1] : null;

if (!kind || !['customize', 'new-module', 'direct'].includes(kind)) {
  process.stderr.write(
    'Usage: node spec-template.js --kind <customize|new-module|direct>\n'
  );
  process.exit(1);
}

const CUSTOMIZE = `#!/usr/bin/env node
/**
 * Spec stub — Mode A (Customize Existing View from Screenshot)
 *
 * PREREQUISITES before running this file:
 *   1. You have already read the user's Odoo screenshot with vision.
 *   2. You have summarized it back in 3–5 lines and the user agreed.
 *   3. You have asked 3–5 clarifying questions and received answers.
 *
 * Fill the TODOs below with the EXISTING view's fields + the requested change.
 * Then: node my-customize.js
 */
'use strict';

const path = require('path');
const r = require('./lib/odoo-renderer');
const x = require('./lib/odoo-xml');

// From screenshot breadcrumb — e.g. "Sales › Quotations › S00042"
const APP = 'Sales';                                          // TODO
const CRUMBS = ['Orders', 'Orders', 'S00042'];                // TODO
const MODEL = 'sale.order';                                   // TODO (use breadcrumb→model table)
const RECORD_ID = 'S00042';                                   // TODO

// Reuse EXACT fields seen in the screenshot, then add/modify per the user's ask.
// Keep original order; only insert the new field(s) where user asked.
const formScreen = {
  id: 'form-' + MODEL.replace(/\\./g, '-'),
  kind: 'form',
  name: '② ' + RECORD_ID + ' (customized)',
  purpose: 'AFTER view with user-requested customization',
  app: APP,
  crumbs: CRUMBS,
  status: {
    states: ['Draft', 'Sent', 'Sale', 'Done'],                // TODO from screenshot
    current: 'Sale',                                          // TODO
  },
  headerBtns: [
    // TODO: copy from screenshot + add any new buttons the user asked for
    { label: 'Send by Email', variant: 'primary' },
  ],
  title: RECORD_ID,
  fields: {
    left: [
      // TODO: copy EXACT field labels from screenshot (left column)
      { label: 'Customer', value: 'Azure Interior' },
      // { label: 'NIK', value: '3201...', isNew: true },    // example: new field user requested
    ],
    right: [
      // TODO: copy EXACT field labels from screenshot (right column)
      { label: 'Expiration', value: '02/28/2026' },
    ],
  },
  notebook: {
    tabs: [
      // TODO: copy tab titles from screenshot, mark active
      { label: 'Order Lines', active: true /*, lines: [...] */ },
      { label: 'Other Info' },
    ],
  },
  chatter: { enabled: true },                                 // TODO: set false if no chatter
  connectsTo: [],
};

const spec = {
  title: 'Odoo — ' + MODEL + ' (customized)',
  slug: MODEL.replace(/\\./g, '_') + '_customize',
  module: MODEL.replace(/\\./g, '_') + '_customize',
  theme: 'odoo-17',
  cols: 1,
  screens: [formScreen],
};

const outDir = path.join(__dirname, 'output');
r.renderBundle(spec, { outputDir: outDir });
x.renderXml(spec, { outputDir: path.join(outDir, 'xml') });
console.log('Mockup written to', outDir);
`;

const NEW_MODULE = `#!/usr/bin/env node
/**
 * Spec stub — Mode B (New Module from Natural-Language Brief)
 *
 * PREREQUISITES before running this file:
 *   1. You worked through the 8-item checklist in
 *      references/odoo-module-design-brief.md with the user.
 *   2. You summarized the full design back in bullet form and the user said
 *      "ok proceed".
 *
 * Fill the TODOs below to mirror the confirmed design.
 * Then: node my-module.js
 */
'use strict';

const path = require('path');
const r = require('./lib/odoo-renderer');
const x = require('./lib/odoo-xml');

// TODO: set these from the confirmed brief
const MODULE_SLUG = 'dke_leave';                              // __manifest__.py name
const MODEL = 'dke.leave.request';
const APP_MENU = [
  { label: 'Leave Requests', active: true },
  { label: 'Allocations' },
  { label: 'Reporting' },
  { label: 'Configuration' },
];
const STATES = ['Draft', 'Submitted', 'Approved', 'Refused'];

// Screen 1 — Kanban (grouped by state)
const kanbanScreen = {
  id: 'kanban-' + MODULE_SLUG,
  kind: 'kanban',
  name: '① Kanban — by State',
  app: 'HR',
  crumbs: ['Leaves', 'Leave Requests'],
  menu: APP_MENU,
  columns: STATES.map((s) => ({
    title: s,
    count: 0,
    cards: [
      // TODO: a couple of sample cards per state
    ],
  })),
};

// Screen 2 — Form (statusbar + 2-col + tab + chatter)
const formScreen = {
  id: 'form-' + MODULE_SLUG,
  kind: 'form',
  name: '② Form — ' + MODEL,
  app: 'HR',
  crumbs: ['Leaves', 'Leave Requests', 'REQ/2026/0001'],
  menu: APP_MENU,
  status: { states: STATES, current: 'Submitted' },
  headerBtns: [
    { label: 'Submit', variant: 'primary' },
    { label: 'Approve' },
    { label: 'Refuse', variant: 'ghost' },
  ],
  title: 'REQ/2026/0001',
  fields: {
    left: [
      // TODO: from confirmed brief
      { label: 'Employee', value: 'Budi Santoso' },
      { label: 'Date From', value: '05/01/2026' },
      { label: 'Date To', value: '05/05/2026' },
      { label: 'Leave Type', value: 'Annual' },
    ],
    right: [
      { label: 'Manager', value: 'Siti Nurhaliza' },
      { label: 'Days', value: '5.00' },
      { label: 'State', value: 'Submitted' },
    ],
  },
  notebook: {
    tabs: [{ label: 'Reason', active: true, content: 'Family event…' }],
  },
  chatter: { enabled: true },
};

// Screen 3 — Tree/list (primary columns)
const treeScreen = {
  id: 'tree-' + MODULE_SLUG,
  kind: 'tree',
  name: '③ List — ' + MODEL,
  app: 'HR',
  crumbs: ['Leaves', 'Leave Requests'],
  menu: APP_MENU,
  columns: [
    // TODO: from confirmed brief
    { label: 'Reference' },
    { label: 'Employee' },
    { label: 'Date From' },
    { label: 'Date To' },
    { label: 'Type' },
    { label: 'State' },
  ],
  rows: [
    // TODO: a few sample rows
  ],
};

// Screen 4 — Wizard (if applicable)
const wizardScreen = {
  id: 'wizard-' + MODULE_SLUG,
  kind: 'wizard',
  name: '④ Wizard — Approve Multiple',
  title: 'Approve Selected Requests',
  fields: [
    { label: 'Manager Note', type: 'text' },
    { label: 'Notify Employee', type: 'boolean', value: true },
  ],
  footer: [
    { label: 'Approve All', variant: 'primary' },
    { label: 'Cancel', variant: 'ghost' },
  ],
};

const spec = {
  title: 'Odoo — ' + MODULE_SLUG,
  slug: MODULE_SLUG,
  module: MODULE_SLUG,
  theme: 'odoo-17',
  cols: 2,
  screens: [kanbanScreen, formScreen, treeScreen, wizardScreen],
};

const outDir = path.join(__dirname, 'output');
r.renderBundle(spec, { outputDir: outDir });
x.renderXml(spec, { outputDir: path.join(outDir, 'xml') });
console.log('Mockup + XML scaffold written to', outDir);
`;

const DIRECT = `#!/usr/bin/env node
/**
 * Spec stub — Mode C (Direct Spec)
 *
 * Minimal wrapper when you already know exactly what you want.
 * Fill in the screens array and run: node my-direct.js
 */
'use strict';

const path = require('path');
const r = require('./lib/odoo-renderer');
const x = require('./lib/odoo-xml');

const spec = {
  title: 'My Odoo Feature',
  slug: 'my_feature',
  module: 'my_feature',
  theme: 'odoo-17',
  cols: 2,
  screens: [
    // TODO: add form/tree/kanban/wizard objects here.
    // See references/odoo-component-schema.md for every accepted key.
  ],
};

const outDir = path.join(__dirname, 'output');
r.renderBundle(spec, { outputDir: outDir });
x.renderXml(spec, { outputDir: path.join(outDir, 'xml') });
console.log('Wrote', outDir);
`;

const templates = {
  customize: CUSTOMIZE,
  'new-module': NEW_MODULE,
  direct: DIRECT,
};

process.stdout.write(templates[kind]);
