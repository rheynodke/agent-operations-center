/**
 * uiux-generator — Template Example
 *
 * Full demo of the UI Designer workflow:
 *   1. Renders a multi-screen mockup canvas (reusing lib/mockup-builder.js).
 *   2. Saves it to <outputs>/uiux-output/<slug>/mockups.html.
 *   3. Prints instructions for running an audit or launching the live server.
 *
 * Copy this file → edit SPEC → run `node generate_<slug>_canvas.js`.
 *
 * Zero runtime deps.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const mb = require('./lib/mockup-builder');

function outputsDir() {
  if (process.env.UIUX_OUTPUT_DIR) return process.env.UIUX_OUTPUT_DIR;
  const cow = __dirname.match(/^(\/sessions\/[^/]+)/);
  if (cow) {
    const mnt = path.join(cow[1], 'mnt', 'outputs');
    if (fs.existsSync(mnt)) return path.join(mnt, 'uiux-output');
  }
  return path.join(process.cwd(), 'uiux-output');
}

// ═══════════════════════════════════ SPEC — edit this block ═════════
const SPEC = {
  title: 'Inventory Dashboard — UI Prototype',
  slug: 'inventory-dashboard',
  theme: 'modern-teal',
  viewport: 'desktop',
  cols: 3,

  screens: [
    {
      id: '01-login',
      name: 'Login',
      purpose: 'Employee signs in with corporate email.',
      layout: 'form',
      components: [
        { type: 'topbar', brand: 'InventoryIQ', actions: ['Help'] },
        { type: 'heading', level: 2, text: 'Sign in to InventoryIQ' },
        { type: 'muted', text: 'Use your corporate email to continue.' },
        { type: 'input', label: 'Email', inputType: 'email', placeholder: 'name@company.com' },
        { type: 'input', label: 'Password', inputType: 'password', placeholder: '••••••••' },
        { type: 'checkbox', label: 'Remember this device', checked: false },
        { type: 'button', label: 'Sign in', variant: 'primary' },
      ],
      connectsTo: ['02-dashboard'],
    },
    {
      id: '02-dashboard',
      name: 'Dashboard',
      purpose: 'Operations view — key metrics + recent activity.',
      layout: 'dashboard',
      components: [
        { type: 'topbar', brand: 'InventoryIQ', actions: ['Search', 'Profile'] },
        { type: 'nav', items: [
          { label: 'Dashboard', active: true },
          { label: 'Items' },
          { label: 'Warehouses' },
          { label: 'Reports' },
        ]},
        { type: 'heading', level: 2, text: 'Overview' },
        { type: 'row', children: [
          { type: 'kpi', label: 'SKUs in stock', value: '12,480', delta: '+2.1%', deltaKind: 'up' },
          { type: 'kpi', label: 'Low-stock alerts', value: '37', delta: '+6', deltaKind: 'down' },
          { type: 'kpi', label: 'Pending receipts', value: '89', delta: '−3', deltaKind: 'up' },
          { type: 'kpi', label: 'Stock value', value: 'Rp 18.2 B', delta: '+1.4%', deltaKind: 'up' },
        ]},
        { type: 'card',
          title: 'Recent movements',
          body: '12 receipts · 31 picks · 4 adjustments in the last hour.',
          meta: 'Live · updated 1 min ago' },
        { type: 'card',
          title: 'Warehouses needing attention',
          body: 'Jakarta-01 (low binding-tape), Surabaya-02 (cooler power flagged).',
          meta: '2 warehouses' },
      ],
      connectsTo: ['03-items'],
    },
    {
      id: '03-items',
      name: 'Items list',
      purpose: 'Search + filter SKUs across warehouses.',
      layout: 'list',
      components: [
        { type: 'topbar', brand: 'InventoryIQ', actions: ['+ Add item', 'Export'] },
        { type: 'nav', items: [
          { label: 'Dashboard' },
          { label: 'Items', active: true },
          { label: 'Warehouses' },
          { label: 'Reports' },
        ]},
        { type: 'heading', level: 2, text: 'Items' },
        { type: 'muted', text: '12,480 items · updated 2 min ago' },
        { type: 'row', children: [
          { type: 'input', label: 'Search', inputType: 'text', placeholder: 'SKU, name, barcode…' },
          { type: 'select', label: 'Warehouse', options: ['All', 'Jakarta-01', 'Surabaya-02', 'Bandung-03'] },
          { type: 'button', label: 'Filter', variant: 'ghost' },
        ]},
        { type: 'card', title: 'SKU-8821 · Thermal paper roll 80mm',
          body: '1,284 in stock across 3 warehouses · Reorder at 500.',
          meta: 'Last movement: 12 min ago' },
        { type: 'card', title: 'SKU-3319 · Shrink wrap 450mm × 300m',
          body: '42 in stock · Below reorder point (200).',
          meta: 'Low-stock alert' },
        { type: 'card', title: 'SKU-1107 · Pallet wood 1200 × 1000',
          body: '380 in stock · Next delivery Mon 09:00.',
          meta: 'Replenishment scheduled' },
      ],
      connectsTo: ['04-detail'],
    },
    {
      id: '04-detail',
      name: 'Item detail',
      purpose: 'Full record view for a single SKU.',
      layout: 'detail',
      components: [
        { type: 'topbar', brand: 'InventoryIQ', actions: ['← Back', 'Edit', 'Print'] },
        { type: 'heading', level: 1, text: 'SKU-3319 · Shrink wrap 450mm × 300m' },
        { type: 'muted', text: 'Created 2024-11-12 · Owner: Warehouse Ops · 3 warehouses' },
        { type: 'row', children: [
          { type: 'button', label: 'Create PO', variant: 'primary' },
          { type: 'button', label: 'Adjust stock', variant: 'ghost' },
          { type: 'button', label: 'Move between WH', variant: 'ghost' },
        ]},
        { type: 'alert', kind: 'danger', text: 'Below reorder point (42 / 200). PO suggested.' },
        { type: 'card',
          title: 'Stock by warehouse',
          body: 'Jakarta-01: 12 · Surabaya-02: 20 · Bandung-03: 10',
          meta: 'Total: 42' },
        { type: 'card',
          title: 'Recent movements',
          body: '3 picks today · 1 cycle-count adjustment · no receipts in the last 14 days.',
          meta: 'Activity' },
      ],
      connectsTo: ['05-empty'],
    },
    {
      id: '05-empty',
      name: 'Empty — no low-stock',
      purpose: 'Filter returns zero — graceful empty state.',
      layout: 'empty',
      components: [
        { type: 'topbar', brand: 'InventoryIQ', actions: [] },
        { type: 'empty',
          title: 'No low-stock items 🎉',
          body: 'Every SKU is above its reorder point. Keep an eye on incoming receipts.',
          cta: 'See all items' },
      ],
      connectsTo: ['06-error'],
    },
    {
      id: '06-error',
      name: 'Sync failed',
      purpose: 'Warehouse sync service is down.',
      layout: 'error',
      components: [
        { type: 'topbar', brand: 'InventoryIQ', actions: [] },
        { type: 'alert', kind: 'danger', text: 'Warehouse sync offline — numbers may be stale by up to 15 minutes.' },
        { type: 'muted', text: 'We will reconnect automatically. Stock movements are queued locally.' },
        { type: 'button', label: 'Retry now', variant: 'ghost' },
      ],
    },
  ],
};
// ═══════════════════════════════════════════════════════════════════

const outRoot = outputsDir();
fs.mkdirSync(outRoot, { recursive: true });

const { dir, files } = mb.saveMockupBundle(SPEC, { baseDir: outRoot });
console.log(`Canvas bundle written to: ${dir}`);
for (const [k, p] of Object.entries(files)) console.log(`  ${k.padEnd(8)} ${p}`);

console.log(`
Next steps:
  → Open in browser:   open ${files.html}
  → Live-reload:       node scripts/serve.js --root ${dir}
  → Full repo audit:   node scripts/audit.js  --repo <your-repo> --out ${path.join(outRoot, 'audit')}
  → Inspiration grab:  node scripts/inspire.js --urls https://linear.app --out ${path.join(outRoot, 'inspiration')}
`);
