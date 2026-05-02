/**
 * uiux-odoo-generator — odoo-xml
 *
 * Converts the same spec objects used by odoo-renderer into Odoo XML view
 * records (`ir.ui.view`). Handy as a starter scaffold for the eventual module
 * — not a drop-in replacement for a handcrafted view, but close enough to
 * save most of the typing.
 *
 * Spec shape reminder:
 *   { kind: 'form' | 'tree' | 'kanban' | 'wizard', ... }
 *
 * Each view record expects at minimum:
 *   - model   (technical name, e.g. 'sale.order')
 *   - slug    (used for record id + name, e.g. 'sale_order')
 * If a field spec has `.name`, it becomes the technical field name; otherwise
 * the label is slugified.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slug(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'field';
}

function fieldName(spec) {
  if (spec && spec.name) return spec.name;
  if (spec && spec.label) return slug(spec.label);
  return 'field';
}

/**
 * Map a renderer field spec to an XML <field> element.
 * Recognises widget hints:
 *   - monetary / binary / status / star / radio / checkbox
 *   - m2oCombo → default many2one
 *   - m2mTags  → widget="many2many_tags"
 *   - tagged (field value class) → widget="many2many_tags"
 *   - readonly → readonly="1"
 */
function renderFieldXml(spec) {
  if (typeof spec === 'string') return spec; // raw XML pass-through
  const name = fieldName(spec);
  const attrs = [`name="${esc(name)}"`];

  if (spec.widget) attrs.push(`widget="${esc(spec.widget)}"`);
  else if (spec.tagged || spec.kind === 'm2mTags') attrs.push('widget="many2many_tags"');
  else if (spec.kind === 'monetary') attrs.push('widget="monetary"');
  else if (spec.kind === 'binary') attrs.push('widget="binary"');
  else if (spec.kind === 'star') attrs.push('widget="priority"');

  if (spec.required) attrs.push('required="1"');
  if (spec.readonly) attrs.push('readonly="1"');
  if (spec.invisible) attrs.push('invisible="1"');
  if (spec.placeholder) attrs.push(`placeholder="${esc(spec.placeholder)}"`);
  if (spec.options) attrs.push(`options="${esc(typeof spec.options === 'string' ? spec.options : JSON.stringify(spec.options))}"`);
  if (spec.string && spec.string !== spec.label) attrs.push(`string="${esc(spec.string)}"`);

  return `<field ${attrs.join(' ')}/>`;
}

function renderGroup(fields, title) {
  const inner = (fields || []).map(renderFieldXml).join('\n      ');
  const titleAttr = title ? ` string="${esc(title)}"` : '';
  return `    <group${titleAttr}>\n      ${inner}\n    </group>`;
}

// ────────────────────────────────────────── Form

function renderFormXml(spec, opts = {}) {
  const model = opts.model || spec.model || 'my.model';
  const recordId = opts.id || spec.viewId || `view_${slug(spec.slug || spec.title || model)}_form`;
  const viewName = `${model}.form`;

  const statusbarXml = spec.status && spec.status.states
    ? `      <field name="${esc(spec.statusField || 'state')}" widget="statusbar" statusbar_visible="${spec.status.states.map(slug).join(',')}"/>`
    : '';

  const headerBtnsXml = (spec.headerBtns || []).map((b) => {
    const cls = b.variant === 'primary' ? ' class="btn-primary"' : '';
    const action = b.name || slug('action_' + (b.label || 'do'));
    return `      <button name="${esc(action)}" string="${esc(b.label)}" type="object"${cls}/>`;
  }).join('\n');

  const headerXml = (statusbarXml || headerBtnsXml)
    ? `    <header>\n${headerBtnsXml ? headerBtnsXml + '\n' : ''}${statusbarXml}\n    </header>`
    : '';

  const titleXml = spec.title
    ? `    <div class="oe_title">\n      <h1><field name="${esc(spec.titleField || 'name')}" placeholder="${esc(spec.title)}"/></h1>\n    </div>`
    : '';

  let bodyXml = '';
  if (spec.fieldsLeft || spec.fieldsRight) {
    const left = renderGroup(spec.fieldsLeft, spec.leftTitle);
    const right = renderGroup(spec.fieldsRight, spec.rightTitle);
    bodyXml = `    <group>\n${left}\n${right}\n    </group>`;
  } else if (spec.fields && spec.fields.length) {
    bodyXml = renderGroup(spec.fields);
  }

  let notebookXml = '';
  if (spec.tabs && spec.tabs.length) {
    const pages = spec.tabs.map((t) => {
      let pageBody = '';
      if (t.o2m) {
        // expected shape: { model, columns: [...], editable: 'bottom' }
        const cols = (t.o2m.columns || []).map((col) => {
          if (typeof col === 'string') return `          <field name="${esc(slug(col))}"/>`;
          const attrs = [`name="${esc(col.name || slug(col.label))}"`];
          if (col.widget) attrs.push(`widget="${esc(col.widget)}"`);
          if (col.sum) attrs.push(`sum="${esc(col.sum)}"`);
          return `          <field ${attrs.join(' ')}/>`;
        }).join('\n');
        const editable = t.o2m.editable ? ` editable="${esc(t.o2m.editable)}"` : '';
        pageBody = `        <field name="${esc(t.o2m.field || slug(t.label))}">\n          <tree${editable}>\n${cols}\n          </tree>\n        </field>`;
      } else if (t.fields && t.fields.length) {
        pageBody = t.fields.map((f) => '        ' + renderFieldXml(f)).join('\n');
      } else if (t.xml) {
        pageBody = t.xml;
      }
      return `      <page string="${esc(t.label)}">\n${pageBody}\n      </page>`;
    }).join('\n');
    notebookXml = `    <notebook>\n${pages}\n    </notebook>`;
  }

  const chatterXml = spec.chatter
    ? `  <div class="oe_chatter">\n    <field name="message_follower_ids"/>\n    <field name="activity_ids"/>\n    <field name="message_ids"/>\n  </div>`
    : '';

  const arch = [
    `<form>`,
    headerXml,
    `  <sheet>`,
    titleXml,
    bodyXml,
    notebookXml,
    `  </sheet>`,
    chatterXml,
    `</form>`,
  ].filter(Boolean).join('\n');

  return wrapRecord({ recordId, viewName, model, arch });
}

// ────────────────────────────────────────── Tree / List

function renderTreeXml(spec, opts = {}) {
  const model = opts.model || spec.model || 'my.model';
  const recordId = opts.id || spec.viewId || `view_${slug(spec.slug || spec.title || model)}_tree`;
  const viewName = `${model}.tree`;

  const cols = (spec.columns || []).map((col) => {
    const attrs = [`name="${esc(col.name || slug(col.label))}"`];
    if (col.widget) attrs.push(`widget="${esc(col.widget)}"`);
    if (col.sum) attrs.push(`sum="${esc(col.sum)}"`);
    if (col.optional) attrs.push(`optional="${esc(col.optional)}"`);
    if (col.string && col.string !== col.label) attrs.push(`string="${esc(col.string)}"`);
    return `    <field ${attrs.join(' ')}/>`;
  }).join('\n');

  const headerAttrs = [];
  if (spec.editable) headerAttrs.push(`editable="${esc(spec.editable)}"`);
  if (spec.decoration) {
    for (const [k, v] of Object.entries(spec.decoration)) headerAttrs.push(`decoration-${k}="${esc(v)}"`);
  }
  if (spec.multiEdit) headerAttrs.push('multi_edit="1"');

  const arch = `<tree${headerAttrs.length ? ' ' + headerAttrs.join(' ') : ''}>\n${cols}\n</tree>`;
  return wrapRecord({ recordId, viewName, model, arch });
}

// ────────────────────────────────────────── Kanban

function renderKanbanXml(spec, opts = {}) {
  const model = opts.model || spec.model || 'my.model';
  const recordId = opts.id || spec.viewId || `view_${slug(spec.slug || spec.title || model)}_kanban`;
  const viewName = `${model}.kanban`;

  const groupBy = spec.groupBy || 'stage_id';
  const usedFields = new Set([groupBy]);
  (spec.columns || []).forEach(() => {}); // kanban columns are runtime-derived
  const sampleCard = (spec.columns && spec.columns[0] && spec.columns[0].cards && spec.columns[0].cards[0]) || {};
  const cardFields = [];

  function addField(name) {
    if (!name) return;
    if (usedFields.has(name)) return;
    usedFields.add(name);
    cardFields.push(`    <field name="${esc(name)}"/>`);
  }

  addField('name');
  if (sampleCard.subtitle) addField(spec.subtitleField || 'partner_id');
  if (sampleCard.assignee) addField(spec.assigneeField || 'user_id');
  if (sampleCard.priority != null) addField(spec.priorityField || 'priority');
  if (sampleCard.tags) addField(spec.tagsField || 'tag_ids');
  if (sampleCard.deadline) addField(spec.deadlineField || 'date_deadline');

  const fieldsXml = [`    <field name="${esc(groupBy)}"/>`, ...cardFields].join('\n');

  const cardXml = `      <div t-attf-class="oe_kanban_card oe_kanban_global_click">
        <div class="o_kanban_record_top">
          <strong class="o_kanban_record_title"><field name="name"/></strong>
          ${sampleCard.priority != null ? `<field name="${esc(spec.priorityField || 'priority')}" widget="priority"/>` : ''}
        </div>
        ${sampleCard.subtitle ? `<div class="o_kanban_record_subtitle"><field name="${esc(spec.subtitleField || 'partner_id')}"/></div>` : ''}
        ${sampleCard.tags ? `<field name="${esc(spec.tagsField || 'tag_ids')}" widget="many2many_tags"/>` : ''}
        <div class="o_kanban_record_bottom">
          <div class="oe_kanban_bottom_left">
            ${sampleCard.deadline ? `<field name="${esc(spec.deadlineField || 'date_deadline')}" widget="date"/>` : ''}
          </div>
          <div class="oe_kanban_bottom_right">
            ${sampleCard.assignee ? `<field name="${esc(spec.assigneeField || 'user_id')}" widget="many2one_avatar_user"/>` : ''}
          </div>
        </div>
      </div>`;

  const arch = `<kanban default_group_by="${esc(groupBy)}" class="o_kanban_small_column">
${fieldsXml}
  <templates>
    <t t-name="kanban-box">
${cardXml}
    </t>
  </templates>
</kanban>`;

  return wrapRecord({ recordId, viewName, model, arch });
}

// ────────────────────────────────────────── Wizard

function renderWizardXml(spec, opts = {}) {
  const model = opts.model || spec.model || 'my.wizard';
  const recordId = opts.id || spec.viewId || `view_${slug(spec.slug || spec.title || model)}_wizard`;
  const viewName = `${model}.wizard.form`;

  const body = (spec.fields || []).length
    ? renderGroup(spec.fields)
    : '    <group/>';

  const footerBtns = (spec.footerBtns || [{ label: 'Save', variant: 'primary' }, { label: 'Cancel' }]).map((b) => {
    if ((b.label || '').toLowerCase().match(/cancel|discard/)) {
      return `      <button string="${esc(b.label)}" class="btn-secondary" special="cancel"/>`;
    }
    const cls = b.variant === 'primary' ? ' class="btn-primary"' : '';
    const action = b.name || slug('action_' + (b.label || 'confirm'));
    return `      <button name="${esc(action)}" string="${esc(b.label)}" type="object"${cls}/>`;
  }).join('\n');

  const arch = `<form string="${esc(spec.title || 'Wizard')}">
${body}
  <footer>
${footerBtns}
  </footer>
</form>`;

  return wrapRecord({ recordId, viewName, model, arch });
}

// ────────────────────────────────────────── Wrapper

function wrapRecord({ recordId, viewName, model, arch }) {
  return `<record id="${esc(recordId)}" model="ir.ui.view">
  <field name="name">${esc(viewName)}</field>
  <field name="model">${esc(model)}</field>
  <field name="arch" type="xml">
${arch.split('\n').map((l) => l ? '    ' + l : l).join('\n')}
  </field>
</record>`;
}

// ────────────────────────────────────────── Public dispatcher

function renderScreenXml(spec, opts = {}) {
  switch (spec.kind) {
    case 'form':   return renderFormXml(spec, opts);
    case 'tree':
    case 'list':   return renderTreeXml(spec, opts);
    case 'kanban': return renderKanbanXml(spec, opts);
    case 'wizard': return renderWizardXml(spec, opts);
    default: throw new Error(`Unknown kind: ${spec.kind}`);
  }
}

/**
 * Render a full Odoo canvas as an XML module fragment:
 *   <odoo>
 *     <data>
 *       <record …>…</record>
 *       <record …>…</record>
 *     </data>
 *   </odoo>
 */
function renderCanvasXml(odooCanvas, opts = {}) {
  const module = opts.module || odooCanvas.module || slug(odooCanvas.slug || odooCanvas.title || 'my_module');
  const records = (odooCanvas.screens || []).map((s) => {
    const m = s.model || opts.model || `${module}.${slug(s.kind)}`;
    return renderScreenXml(s, { model: m, id: s.viewId });
  }).join('\n\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data>
${records.split('\n').map((l) => l ? '        ' + l : l).join('\n')}
    </data>
</odoo>
`;
}

function manifestStub(odooCanvas, opts = {}) {
  const name = opts.name || odooCanvas.title || 'My Module';
  const module = opts.module || slug(odooCanvas.slug || name);
  return `# -*- coding: utf-8 -*-
{
    'name': '${name.replace(/'/g, "\\'")}',
    'version': '17.0.1.0.0',
    'summary': 'Auto-generated scaffold from uiux-odoo-generator',
    'category': 'Extra Tools',
    'author': 'uiux-odoo-generator',
    'license': 'LGPL-3',
    'depends': ['base', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'views/${module}_views.xml',
    ],
    'installable': True,
    'application': False,
}
`;
}

/**
 * Save all XML artifacts for an Odoo canvas:
 *   <dir>/views/<module>_views.xml     — combined <odoo>/<data> fragment
 *   <dir>/views/screens/<slug>.xml     — one file per screen (easier to diff)
 *   <dir>/__manifest__.py              — manifest stub
 */
function saveOdooXml(odooCanvas, opts = {}) {
  const slugName = odooCanvas.slug || slug(odooCanvas.title || 'my_module');
  let dir;
  if (opts.outputDir) dir = opts.outputDir;
  else if (opts.baseDir) dir = path.join(opts.baseDir, slugName);
  else if (process.env.UIUX_ODOO_OUTPUT_DIR) dir = path.join(process.env.UIUX_ODOO_OUTPUT_DIR, slugName, 'xml');
  else {
    const cow = __dirname.match(/^(\/sessions\/[^/]+)/);
    const base = cow
      ? path.join(cow[1], 'mnt', 'outputs', 'uiux-odoo-output')
      : path.join(process.cwd(), 'uiux-odoo-output');
    dir = path.join(base, slugName, 'xml');
  }

  const viewsDir = path.join(dir, 'views');
  const screensDir = path.join(viewsDir, 'screens');
  fs.mkdirSync(screensDir, { recursive: true });

  const module = opts.module || slug(slugName);
  const combinedPath = path.join(viewsDir, `${module}_views.xml`);
  fs.writeFileSync(combinedPath, renderCanvasXml(odooCanvas, opts));

  const screenFiles = {};
  for (const screen of odooCanvas.screens || []) {
    const id = screen.id || slug(screen.name || screen.kind);
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<odoo>\n    <data>\n${renderScreenXml(screen, { model: screen.model || `${module}.${slug(screen.kind)}`, id: screen.viewId }).split('\n').map((l) => l ? '        ' + l : l).join('\n')}\n    </data>\n</odoo>\n`;
    const p = path.join(screensDir, `${id}.xml`);
    fs.writeFileSync(p, xml);
    screenFiles[id] = p;
  }

  const manifestPath = path.join(dir, '__manifest__.py');
  fs.writeFileSync(manifestPath, manifestStub(odooCanvas, opts));

  return { dir, files: { combined: combinedPath, manifest: manifestPath, screens: screenFiles } };
}

module.exports = {
  esc, slug, fieldName,
  renderFormXml, renderTreeXml, renderKanbanXml, renderWizardXml,
  renderScreenXml, renderCanvasXml, manifestStub, saveOdooXml,
};
