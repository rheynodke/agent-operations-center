/**
 * uiux-odoo-generator — odoo-components
 *
 * Primitive HTML fragment renderers. Each export takes a plain JS object
 * and returns a string. These are composed by odoo-renderer.js into full
 * Odoo view mockups.
 *
 * Everything is strings — no framework, no DOM, no dependencies. The output
 * is wrapped in `.odoo-screen` by the renderer, so the styling in odoo-theme
 * applies without polluting the outer canvas chrome.
 */

'use strict';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ──────────────────────────────────────────────── top-level chrome

function topnav({ app = 'Sales', menu = [], user = 'My Company', unreadDot = true } = {}) {
  const items = menu.map(m => {
    const active = m.active ? ' active' : '';
    return `<span class="item${active}">${esc(m.label)}</span>`;
  }).join('');
  return `
<div class="odoo-topnav">
  <div class="odoo-logo"><span class="odoo-logo-mark"></span>${esc(app)}</div>
  <div class="odoo-menu-items">${items}</div>
  <div class="odoo-topnav-right">
    ${unreadDot ? '<span class="odoo-icon-dot"></span>' : ''}
    <span>☎</span><span>💬</span><span>🔔</span>
    <span>${esc(user)}</span>
    <span class="odoo-avatar">${initials(user)}</span>
  </div>
</div>`;
}

function actionBar({ crumbs = [], gear = true, showNew = true, pager } = {}) {
  const crumbsHtml = crumbs.map((c, i) => {
    const cls = i === crumbs.length - 1 ? 'crumb current' : 'crumb';
    const sep = i < crumbs.length - 1 ? '<span class="sep">›</span>' : '';
    return `<span class="${cls}">${esc(c)}</span>${sep}`;
  }).join('');
  const pagerHtml = pager ? `
    <div class="odoo-pager">
      <span>${esc(pager)}</span>
      <span class="odoo-pager-btn">‹</span>
      <span class="odoo-pager-btn">›</span>
      <span class="odoo-pager-btn">≡</span>
    </div>` : '';
  return `
<div class="odoo-actionbar">
  ${showNew ? '<button class="odoo-btn-new">New</button>' : ''}
  <div class="odoo-breadcrumb">${crumbsHtml}${gear ? '<span class="gear">⚙</span>' : ''}</div>
  ${pagerHtml}
</div>`;
}

function headerButtons(buttons = []) {
  if (!buttons.length) return '';
  const html = buttons.map(b => {
    const variant = b.variant || 'default';
    const cls = variant === 'primary' ? 'odoo-header-btn primary'
      : variant === 'ghost' ? 'odoo-header-btn ghost' : 'odoo-header-btn';
    return `<button class="${cls}">${esc(b.label)}</button>`;
  }).join('');
  return `<div class="odoo-header-btns">${html}</div>`;
}

function statusbar({ states = [], current } = {}) {
  const idx = states.indexOf(current);
  const steps = states.map((s, i) => {
    const cls = s === current ? 'step current'
      : (idx >= 0 && i < idx) ? 'step done' : 'step';
    return `<div class="${cls}">${esc(s)}</div>`;
  }).join('');
  return `<div class="odoo-statusbar">${steps}</div>`;
}

// ──────────────────────────────────────────────── primitives

function field({ label, value, required, help, readonly, html, tagged }) {
  const req = required ? '<span class="req">*</span>' : '';
  const hint = help ? `<span class="help" title="${esc(help)}">?</span>` : '';
  const valCls = 'odoo-field-value' + (readonly ? ' readonly' : '') + (tagged ? ' tagged' : '');
  const body = html != null ? html : esc(value || '');
  return `
<div class="odoo-field-row">
  <div class="odoo-field-label">${esc(label)}${req}${hint}</div>
  <div class="${valCls}">${body}</div>
</div>`;
}

function checkbox({ label, checked }) {
  return `<label class="odoo-checkbox"><span class="box${checked ? ' checked' : ''}"></span>${esc(label)}</label>`;
}

function radio({ label, checked }) {
  return `<label class="odoo-radio"><span class="dot${checked ? ' checked' : ''}"></span>${esc(label)}</label>`;
}

function tag({ label, color = 'gray', removable = true }) {
  const x = removable ? '<span class="x">×</span>' : '';
  return `<span class="odoo-tag ${color}">${esc(label)}${x}</span>`;
}

function m2oCombo({ value, placeholder = 'Type to search…' }) {
  const v = value ? esc(value) : `<span class="odoo-muted">${esc(placeholder)}</span>`;
  return `<span>${v} <span class="odoo-muted">▾</span></span>`;
}

function m2mTags({ values = [] }) {
  return values.map((v) => {
    if (typeof v === 'string') return tag({ label: v });
    return tag({ label: v.label, color: v.color || 'gray', removable: v.removable !== false });
  }).join('');
}

function monetary({ value, currency = 'Rp', taxInclusive } = {}) {
  const amt = value == null ? '' : value;
  const inc = taxInclusive ? `<span class="odoo-muted" style="margin-left:6px">(= ${esc(taxInclusive)})</span>` : '';
  return `<span>${esc(currency)} ${esc(amt)}</span>${inc}`;
}

function binary({ label = 'Upload your file', filename } = {}) {
  if (filename) return `<span>📎 <span class="odoo-link">${esc(filename)}</span></span>`;
  return `<span class="odoo-link">📎 ${esc(label)}</span>`;
}

function status({ label, color = 'green' } = {}) {
  return `<span class="odoo-status ${color}">${esc(label)}</span>`;
}

function avatar({ name, size = 24 } = {}) {
  return `<span class="odoo-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${initials(name)}</span>`;
}

function statusDot({ kind = 'none' } = {}) {
  return `<span class="odoo-status-dot ${kind}"></span>`;
}

function star({ on } = {}) {
  return `<span class="star ${on ? 'on' : 'off'}">${on ? '★' : '☆'}</span>`;
}

// ──────────────────────────────────────────────── container composites

function notebook({ tabs = [] } = {}) {
  if (!tabs.length) return '';
  const activeIdx = Math.max(0, tabs.findIndex(t => t.active));
  const head = tabs.map((t, i) => {
    const cls = i === activeIdx ? 'odoo-tab active' : 'odoo-tab';
    return `<div class="${cls}">${esc(t.label)}</div>`;
  }).join('');
  const pane = tabs[activeIdx]?.body || '';
  return `
<div class="odoo-notebook">
  <div class="odoo-tabs">${head}</div>
  <div class="odoo-tab-pane">${pane}</div>
</div>`;
}

function o2mTable({ headers = [], rows = [], addLabel = 'Add a line' } = {}) {
  const ths = headers.map((h) => `<th>${esc(typeof h === 'string' ? h : h.label)}</th>`).join('');
  const trs = rows.map((r) => {
    const cells = (Array.isArray(r) ? r : r.cells || []).map((c) => {
      if (c == null) return '<td></td>';
      if (typeof c === 'object') {
        const clsParts = [];
        if (c.align === 'right') clsParts.push('num');
        if (c.primary) clsParts.push('primary');
        const clsAttr = clsParts.length ? ` class="${clsParts.join(' ')}"` : '';
        const html = c.html != null ? c.html : esc(c.value != null ? c.value : '');
        return `<td${clsAttr}>${html}</td>`;
      }
      return `<td>${esc(c)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `
<div class="odoo-o2m">
  <table><thead><tr>${ths}</tr></thead><tbody>${trs || ''}</tbody></table>
  <a class="add-line">+ ${esc(addLabel)}</a>
</div>`;
}

function chatter({ showWhatsApp = true, entries = [], followers = 0, date } = {}) {
  const actions = [
    '<button class="odoo-chatter-btn primary">Send message</button>',
    '<button class="odoo-chatter-btn">Log note</button>',
    showWhatsApp ? '<button class="odoo-chatter-btn">WhatsApp</button>' : '',
    '<button class="odoo-chatter-btn">Activities</button>',
  ].filter(Boolean).join('');
  const log = entries.map((e) => `
    <div class="entry">
      <span class="odoo-avatar">${initials(e.who || 'OdooBot')}</span>
      <div>
        <div><span class="who">${esc(e.who || 'OdooBot')}</span><span class="when">- ${esc(e.when || 'just now')}</span></div>
        <div class="body">${e.bodyHtml || esc(e.body || '')}</div>
      </div>
    </div>`).join('');
  const dateLine = date ? `<div class="odoo-chatter-divider">${esc(date)}</div>` : '';
  return `
<div class="odoo-chatter">
  <div class="odoo-chatter-actions">
    ${actions}
    <div class="odoo-chatter-meta">
      <span>🔍</span><span>📎<sup>0</sup></span><span>👤<sup>${followers}</sup></span>
      <span class="odoo-link">Follow</span>
    </div>
  </div>
  ${dateLine}
  <div class="odoo-chatter-log">${log}</div>
</div>`;
}

// Column helpers for the form view — accept either an array of field rows or
// pre-rendered HTML to keep composition flexible.
function formColumns(left = [], right = []) {
  const L = left.map((f) => typeof f === 'string' ? f : field(f)).join('');
  const R = right.map((f) => typeof f === 'string' ? f : field(f)).join('');
  return `<div class="odoo-form-cols"><div>${L}</div><div>${R}</div></div>`;
}

function formSingleColumn(fields = []) {
  const F = fields.map((f) => typeof f === 'string' ? f : field(f)).join('');
  return `<div class="odoo-form-cols single"><div>${F}</div></div>`;
}

module.exports = {
  esc, initials,
  topnav, actionBar, headerButtons, statusbar,
  field, checkbox, radio,
  tag, m2oCombo, m2mTags, monetary, binary, status, avatar, statusDot, star,
  notebook, o2mTable, chatter, formColumns, formSingleColumn,
};
