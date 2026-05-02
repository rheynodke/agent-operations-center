#!/usr/bin/env node
/**
 * uiux-odoo-generator — example.js
 *
 * End-to-end demo covering all four Odoo view types:
 *   1. Form view    — Sales Order with header buttons, statusbar, tabs, chatter
 *   2. Tree view    — Sales Orders list with filters, columns, totals footer
 *   3. Kanban view  — CRM Pipeline with stage columns and progress bars
 *   4. Wizard       — "Register Payment" modal over a tree background
 *
 * Renders both the HTML mockup bundle and the matching XML scaffold.
 *
 * Usage:
 *   node example.js
 *   UIUX_ODOO_OUTPUT_DIR=/tmp/foo node example.js
 */

'use strict';

const path = require('path');
const r = require('./lib/odoo-renderer');
const x = require('./lib/odoo-xml');

// ────────────────────────────────────────── menu + common chrome

const SALES_MENU = [
  { label: 'Orders', active: true },
  { label: 'To Invoice' },
  { label: 'Products' },
  { label: 'Reporting' },
  { label: 'Configuration' },
];

const CRM_MENU = [
  { label: 'Pipeline', active: true },
  { label: 'Leads' },
  { label: 'Reporting' },
  { label: 'Configuration' },
];

// ────────────────────────────────────────── screens

const formScreen = {
  id: 'form-sale-order',
  kind: 'form',
  name: '② Quotation – Form',
  purpose: 'Salesperson drafts a quotation for the converted lead',
  connectsTo: ['tree-sale-orders'],
  app: 'Sales',
  user: 'My Company (San Francisco)',
  menu: SALES_MENU,
  crumbs: ['Orders', 'Orders', 'S00042'],
  pager: '1 / 12',
  status: { states: ['Draft', 'Sent', 'Sale', 'Done'], current: 'Sale' },
  headerBtns: [
    { label: 'Send by Email', variant: 'primary' },
    { label: 'Confirm' },
    { label: 'Preview' },
    { label: 'Cancel', variant: 'ghost' },
  ],
  recordLabel: 'Sales Order',
  title: 'S00042',
  model: 'sale.order',
  slug: 'sale_order',
  fieldsLeft: [
    { label: 'Customer', value: 'Deco Addict', required: true, kind: 'm2oCombo', name: 'partner_id' },
    { label: 'Invoice Address', value: 'Deco Addict, 77 Santa Barbara Rd, CA 94523', name: 'partner_invoice_id' },
    { label: 'Delivery Address', value: 'Deco Addict, 77 Santa Barbara Rd, CA 94523', name: 'partner_shipping_id' },
    { label: 'Quotation Template', value: '', kind: 'm2oCombo', name: 'sale_order_template_id' },
  ],
  fieldsRight: [
    { label: 'Expiration', value: '05/12/2026', name: 'validity_date' },
    { label: 'Quotation Date', value: '04/18/2026', name: 'date_order' },
    { label: 'Pricelist', value: 'Public Pricelist (USD)', kind: 'm2oCombo', name: 'pricelist_id' },
    { label: 'Payment Terms', value: '30 Days', kind: 'm2oCombo', name: 'payment_term_id' },
  ],
  tabs: [
    {
      label: 'Order Lines',
      active: true,
      body: require('./lib/odoo-components').o2mTable({
        headers: ['Product', 'Description', 'Quantity', { label: 'Unit Price', align: 'right' }, 'Taxes', { label: 'Subtotal', align: 'right' }],
        rows: [
          [
            'Large Cabinet',
            'Large cabinet with 2 shelves and 4 drawers',
            '1.00',
            { value: '832.00', align: 'right' },
            'Tax 15%',
            { value: '$ 832.00', align: 'right' },
          ],
          [
            'Office Chair',
            'Ergonomic office chair, adjustable height',
            '3.00',
            { value: '70.00', align: 'right' },
            'Tax 15%',
            { value: '$ 210.00', align: 'right' },
          ],
          [
            'Customizable Desk',
            'Desk with customizable legs and desktop material',
            '1.00',
            { value: '800.40', align: 'right' },
            'Tax 15%',
            { value: '$ 800.40', align: 'right' },
          ],
        ],
        addLabel: 'Add a product',
      }),
      o2m: {
        field: 'order_line',
        editable: 'bottom',
        columns: [
          { label: 'Product', name: 'product_id' },
          { label: 'Description', name: 'name' },
          { label: 'Quantity', name: 'product_uom_qty' },
          { label: 'Unit Price', name: 'price_unit', widget: 'monetary' },
          { label: 'Taxes', name: 'tax_id', widget: 'many2many_tags' },
          { label: 'Subtotal', name: 'price_subtotal', widget: 'monetary', sum: 'Total' },
        ],
      },
    },
    { label: 'Optional Products', body: '<div style="padding:20px;color:#6c757d">No optional products yet</div>' },
    { label: 'Other Info', body: '<div style="padding:20px;color:#6c757d">Salesperson, tags, referrer…</div>' },
    { label: 'Customer Signature', body: '<div style="padding:20px;color:#6c757d">No signature</div>' },
  ],
  chatter: {
    followers: 2,
    date: 'Today',
    entries: [
      {
        who: 'Mitchell Admin',
        when: '10 minutes ago',
        body: 'Confirmed the delivery date with the customer.',
      },
    ],
  },
};

const treeScreen = {
  id: 'tree-sale-orders',
  kind: 'tree',
  name: '③ Sales Orders – List',
  purpose: 'Confirmed orders land here; salesperson opens one to register payment',
  connectsTo: ['wizard-register-payment'],
  app: 'Sales',
  user: 'My Company (San Francisco)',
  menu: SALES_MENU,
  crumbs: ['Orders', 'Orders'],
  pager: '1-6 / 6',
  model: 'sale.order',
  slug: 'sale_order',
  searchChips: [{ label: 'Status: Sales Order' }, { label: 'Salesperson: Mitchell Admin' }],
  searchPlaceholder: 'Search…',
  pagerText: '1-6 / 6',
  columns: [
    { label: 'Number', name: 'name' },
    { label: 'Creation Date', name: 'create_date' },
    { label: 'Commitment Date', name: 'commitment_date' },
    { label: 'Customer', name: 'partner_id' },
    { label: 'Salesperson', name: 'user_id' },
    { label: 'Company', name: 'company_id' },
    { label: 'Total', align: 'right', name: 'amount_total', widget: 'monetary', sum: 'Total' },
    { label: 'Invoice Status', name: 'invoice_status' },
    { label: 'Status', name: 'state' },
  ],
  rows: [
    ['S00038', '04/02/2026', '04/16/2026', 'Deco Addict', 'Mitchell Admin', 'My Company',
      { value: '$ 1,842.40', align: 'right', primary: true },
      { html: '<span class="odoo-status green">Fully Invoiced</span>' },
      { html: '<span class="odoo-status green">Sales Order</span>' }],
    ['S00039', '04/05/2026', '04/19/2026', 'Azure Interior', 'Marc Demo', 'My Company',
      { value: '$ 2,100.00', align: 'right', primary: true },
      { html: '<span class="odoo-status yellow">To Invoice</span>' },
      { html: '<span class="odoo-status green">Sales Order</span>' }],
    ['S00040', '04/09/2026', '04/23/2026', 'Brandon Freeman', 'Mitchell Admin', 'My Company',
      { value: '$ 530.25', align: 'right', primary: true },
      { html: '<span class="odoo-status green">Fully Invoiced</span>' },
      { html: '<span class="odoo-status green">Sales Order</span>' }],
    ['S00041', '04/11/2026', '04/25/2026', 'Gemini Furniture', 'Marc Demo', 'My Company',
      { value: '$ 940.00', align: 'right', primary: true },
      { html: '<span class="odoo-status yellow">To Invoice</span>' },
      { html: '<span class="odoo-status green">Sales Order</span>' }],
    ['S00042', '04/15/2026', '04/30/2026', 'Deco Addict', 'Mitchell Admin', 'My Company',
      { value: '$ 1,842.40', align: 'right', primary: true },
      { html: '<span class="odoo-status yellow">To Invoice</span>' },
      { html: '<span class="odoo-status green">Sales Order</span>' }],
    ['S00043', '04/17/2026', '05/01/2026', 'Lumber Inc', 'Marc Demo', 'My Company',
      { value: '$ 3,210.00', align: 'right', primary: true },
      { html: '<span class="odoo-status gray">Nothing to Invoice</span>' },
      { html: '<span class="odoo-status gray">Quotation Sent</span>' }],
  ],
  footer: [
    null, null, null, null, null, null,
    { value: '$ 10,465.05', align: 'right' },
    null, null,
  ],
};

const kanbanScreen = {
  id: 'kanban-crm',
  kind: 'kanban',
  name: '① CRM Pipeline – Kanban',
  purpose: 'Salesperson qualifies a lead and moves it to "Won" — triggers a quotation',
  connectsTo: ['form-sale-order'],
  app: 'CRM',
  user: 'My Company (San Francisco)',
  menu: CRM_MENU,
  crumbs: ['Pipeline'],
  model: 'crm.lead',
  slug: 'crm_lead',
  groupBy: 'stage_id',
  filterChips: [{ label: 'My Pipeline' }],
  searchPlaceholder: 'Search…',
  columns: [
    {
      title: 'New',
      count: 4,
      progress: [{ pct: 60, color: '#017e84' }, { pct: 20, color: '#f0ad4e' }, { pct: 20, color: '#d04437' }],
      cards: [
        { title: 'Office Design Project', subtitle: 'Deco Addict', tags: [{ label: 'Office', color: 'blue' }], priority: true, assignee: 'Mitchell Admin', deadline: '04/20/2026', status: 'green' },
        { title: '5 Chairs', subtitle: 'Brandon Freeman', tags: ['Product'], priority: false, assignee: 'Marc Demo', deadline: '04/22/2026', status: 'amber' },
        { title: 'Redesign storage', subtitle: 'Azure Interior', priority: false, assignee: 'Marc Demo' },
        { title: 'Custom Desk', subtitle: 'Gemini Furniture', priority: false, hasNote: true },
      ],
    },
    {
      title: 'Qualified',
      count: 3,
      progress: [{ pct: 70, color: '#017e84' }, { pct: 30, color: '#f0ad4e' }],
      cards: [
        { title: 'Delivery Robot', subtitle: 'Ready Mat', tags: [{ label: 'Hardware', color: 'purple' }, { label: 'Robotics', color: 'teal' }], priority: true, assignee: 'Mitchell Admin', deadline: '05/02/2026', status: 'green' },
        { title: 'Quote for 100 Chairs', subtitle: 'Deco Addict', tags: [{ label: 'Bulk', color: 'orange' }], priority: true, assignee: 'Marc Demo', deadline: '04/25/2026' },
        { title: 'Office Desks', subtitle: 'Lumber Inc', priority: false, assignee: 'Mitchell Admin', hasFile: true },
      ],
    },
    {
      title: 'Proposition',
      count: 2,
      progress: [{ pct: 100, color: '#017e84' }],
      cards: [
        { title: 'Lamp', subtitle: 'Think Big Systems', tags: [{ label: 'Lighting', color: 'yellow' }], priority: true, assignee: 'Marc Demo', deadline: '04/24/2026', status: 'green' },
        { title: '3 Computer Desks', subtitle: 'Azure Interior', tags: [{ label: 'Office', color: 'blue' }], priority: false, assignee: 'Mitchell Admin', deadline: '04/26/2026' },
      ],
    },
    {
      title: 'Won',
      count: 2,
      progress: [{ pct: 100, color: '#5cb85c' }],
      cards: [
        { title: 'Interest in your customizable desks', subtitle: 'Azure Interior', tags: ['Deal'], priority: true, isDone: true, assignee: 'Mitchell Admin' },
        { title: 'Consulting Package', subtitle: 'Deco Addict', priority: true, isDone: true, assignee: 'Marc Demo' },
      ],
    },
  ],
};

const wizardScreen = {
  id: 'wizard-register-payment',
  kind: 'wizard',
  name: '④ Register Payment – Wizard',
  purpose: 'Create Payment closes the loop — invoice status turns Paid',
  app: 'Sales',
  user: 'My Company (San Francisco)',
  menu: SALES_MENU,
  crumbs: ['Orders', 'Orders'],
  backgroundKind: 'tree',
  backgroundSpec: treeScreen,
  title: 'Register Payment',
  model: 'account.payment.register',
  slug: 'register_payment',
  fields: [
    { label: 'Journal', value: 'Bank', required: true, kind: 'm2oCombo', name: 'journal_id' },
    { label: 'Payment Method', value: 'Manual', kind: 'm2oCombo', name: 'payment_method_line_id' },
    { label: 'Recipient Bank Account', value: 'BNI 1234567890', kind: 'm2oCombo', name: 'partner_bank_id' },
    { label: 'Amount', value: '1,842.40 USD', kind: 'monetary', name: 'amount' },
    { label: 'Payment Date', value: '04/18/2026', required: true, name: 'payment_date' },
    { label: 'Memo', value: 'S00042', name: 'communication' },
  ],
  footerBtns: [
    { label: 'Create Payment', variant: 'primary', name: 'action_create_payments' },
    { label: 'Discard' },
  ],
};

// ────────────────────────────────────────── canvas spec

const canvas = {
  title: 'Odoo 17 — Lead-to-Cash Workflow',
  slug: 'odoo_17_lead_to_cash',
  module: 'odoo_17_lead_to_cash',
  theme: 'odoo-17',
  viewport: 'desktop',
  cols: 2,                         // 2×2 grid: Kanban | Form  /  Tree | Wizard
  screens: [kanbanScreen, formScreen, treeScreen, wizardScreen],
};

// ────────────────────────────────────────── run

function main() {
  const htmlOut = r.saveOdooCanvas(canvas);
  const xmlOut = x.saveOdooXml(canvas, { module: canvas.module });

  console.log('\n✔ Odoo canvas rendered');
  console.log(`  html     ${htmlOut.files.html}`);
  console.log(`  spec     ${htmlOut.files.spec}`);
  console.log(`  xml      ${xmlOut.files.combined}`);
  console.log(`  manifest ${xmlOut.files.manifest}`);
  console.log(`  screens  ${Object.keys(xmlOut.files.screens).length} per-screen XML files`);
  console.log(`  → serve: node scripts/serve.js --root ${path.dirname(htmlOut.files.html)}\n`);
}

if (require.main === module) main();
module.exports = { canvas };
