/**
 * uiux-odoo-generator — odoo-renderer
 *
 * Composes high-level Odoo views from `odoo-components.js` primitives.
 *
 * Each exported renderer returns a single HTML string wrapped in
 * `<div class="odoo-screen">…</div>` which the canvas frames as a screen.
 *
 * Spec shape:
 *   { kind: 'form' | 'tree' | 'kanban' | 'wizard', ...view-specific fields }
 *
 * Theme is applied once at the canvas level via injectThemeCss(), not per
 * screen — see renderOdooCanvas() for the full assembly.
 */

'use strict';

const c = require('./odoo-components');
const theme = require('./odoo-theme');

// ────────────────────────────────────────── helpers

function wrap(inner) {
  return `<div class="odoo-screen">${inner}</div>`;
}

function topChrome(spec) {
  const nav = c.topnav({
    app: spec.app || 'Sales',
    menu: spec.menu || [],
    user: spec.user || 'My Company',
    unreadDot: spec.unreadDot !== false,
  });
  const bar = c.actionBar({
    crumbs: spec.crumbs || [],
    gear: spec.showGear !== false,
    showNew: spec.showNew !== false,
    pager: spec.pager,
  });
  return nav + bar;
}

// ────────────────────────────────────────── Form view

function renderForm(spec) {
  const {
    title,
    subtitle,
    status,        // { states: [...], current: '...' }
    headerBtns,    // [{ label, variant }]
    tabs,          // for notebook
    fieldsLeft,    // raw field specs or HTML (left column)
    fieldsRight,   // raw field specs or HTML (right column)
    chatter,       // chatter block input
    ribbon,        // optional ribbon text
  } = spec;

  const ribbonHtml = ribbon
    ? `<div style="position:absolute;top:10px;right:-30px;background:#d04437;color:#fff;padding:2px 30px;transform:rotate(30deg);font-size:11px;font-weight:700;letter-spacing:.05em">${c.esc(ribbon)}</div>`
    : '';

  const titleHtml = title
    ? `<div class="odoo-title-sub">${c.esc(spec.recordLabel || 'Record')}</div><div class="odoo-title">${c.esc(title)}</div>`
    : '';
  const subtitleHtml = subtitle ? `<div class="odoo-muted" style="margin-top:-8px;margin-bottom:12px">${c.esc(subtitle)}</div>` : '';

  const statusHtml = status ? c.statusbar(status) : '';
  const headerHtml = headerBtns && headerBtns.length ? c.headerButtons(headerBtns) : '';

  const cols = (fieldsLeft || fieldsRight)
    ? c.formColumns(fieldsLeft || [], fieldsRight || [])
    : (spec.fields ? c.formSingleColumn(spec.fields) : '');

  const tabsHtml = tabs && tabs.length ? c.notebook({ tabs }) : '';
  const chatterHtml = chatter ? c.chatter(chatter) : '';

  return wrap(`
    ${topChrome(spec)}
    ${statusHtml}
    ${headerHtml}
    <div class="odoo-sheet">
      <div class="odoo-form-sheet odoo-ribbon">
        ${ribbonHtml}
        ${titleHtml}
        ${subtitleHtml}
        ${cols}
        ${tabsHtml}
      </div>
      ${chatterHtml}
    </div>
  `);
}

// ────────────────────────────────────────── Tree / List view

function renderTree(spec) {
  const {
    searchChips = [],       // [{ label, color }]
    searchPlaceholder = 'Search…',
    pagerText,              // e.g. "1-7 / 7"
    columns = [],           // [{ label, align, sortable }]
    rows = [],              // [{ cells: [...], selected? }]
    footer,                 // [{ align, html }]  or string
    checkboxCol = true,
  } = spec;

  const chipsHtml = searchChips.map((ch) => `<span class="chip">${c.esc(ch.label)}<span class="x">×</span></span>`).join('');
  const search = `
    <div class="odoo-search">
      <span class="icon">🔍</span>
      ${chipsHtml}
      <input placeholder="${c.esc(searchPlaceholder)}">
      <span class="odoo-muted">▾</span>
    </div>`;
  const pagerHtml = pagerText ? `
    <div class="odoo-pager-info">
      ${c.esc(pagerText)}
      <span class="odoo-pager-btn">‹</span>
      <span class="odoo-pager-btn">›</span>
      <span class="odoo-pager-btn">≡</span>
    </div>` : '';

  const thsLeft = checkboxCol ? '<th class="checkbox-col"><input type="checkbox" disabled></th>' : '';
  const ths = thsLeft + columns.map((col) => {
    const align = col.align === 'right' ? ' class="num"' : '';
    return `<th${align}>${c.esc(col.label)}</th>`;
  }).join('');

  const trs = rows.map((row) => {
    const cells = Array.isArray(row) ? row : (row.cells || []);
    const leftCheck = checkboxCol ? '<td class="checkbox-cell"><input type="checkbox" disabled></td>' : '';
    const tds = cells.map((cell) => {
      if (cell == null) return '<td></td>';
      if (typeof cell === 'object') {
        const cls = [cell.align === 'right' ? 'num' : '', cell.primary ? 'primary' : ''].filter(Boolean).join(' ');
        const html = cell.html != null ? cell.html : c.esc(cell.value || '');
        return `<td${cls ? ` class="${cls}"` : ''}>${html}</td>`;
      }
      return `<td>${c.esc(cell)}</td>`;
    }).join('');
    return `<tr>${leftCheck}${tds}</tr>`;
  }).join('');

  let footerHtml = '';
  if (footer) {
    const leftCheck = checkboxCol ? '<td></td>' : '';
    if (Array.isArray(footer)) {
      const tds = footer.map((cell) => {
        if (cell == null) return '<td></td>';
        if (typeof cell === 'string') return `<td>${c.esc(cell)}</td>`;
        const cls = cell.align === 'right' ? ' class="num"' : '';
        const html = cell.html != null ? cell.html : c.esc(cell.value || '');
        return `<td${cls}>${html}</td>`;
      }).join('');
      footerHtml = `<tfoot><tr>${leftCheck}${tds}</tr></tfoot>`;
    } else {
      const span = columns.length + (checkboxCol ? 1 : 0);
      footerHtml = `<tfoot><tr><td colspan="${span}" class="num">${c.esc(footer)}</td></tr></tfoot>`;
    }
  }

  return wrap(`
    ${topChrome(spec)}
    <div class="odoo-list-search">
      ${search}
      ${pagerHtml}
    </div>
    <div class="odoo-list-wrap">
      <table class="odoo-table">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
        ${footerHtml}
      </table>
    </div>
  `);
}

// ────────────────────────────────────────── Kanban view

function renderKanban(spec) {
  const { columns = [], stageBars } = spec;
  const bars = stageBars || theme.resolveTheme(spec.theme).stageBars;

  const colsHtml = columns.map((col, ci) => {
    const barColor = bars[ci % bars.length];
    // Progress bar can be an array of [{pct, color}] segments or a single number.
    let barInner = '';
    if (Array.isArray(col.progress)) {
      barInner = col.progress.map((seg) => `<span style="width:${seg.pct}%;background:${seg.color || barColor}"></span>`).join('');
    } else if (typeof col.progress === 'number') {
      barInner = `<span style="width:${col.progress}%;background:${barColor}"></span>`;
    } else {
      barInner = `<span style="width:100%;background:${barColor}"></span>`;
    }

    const cards = (col.cards || []).map((card) => {
      const tags = (card.tags || []).map((t) => typeof t === 'string' ? c.tag({ label: t, removable: false }) : c.tag({ ...t, removable: false })).join('');
      const footerParts = [];
      if (card.priority != null) footerParts.push(c.star({ on: card.priority }));
      if (card.isDone) footerParts.push('<span style="color:#5cb85c">✓</span>');
      if (card.hasAttendees) footerParts.push('👥');
      if (card.hasNote) footerParts.push('✉');
      if (card.hasFile) footerParts.push('📎');
      if (card.deadline) footerParts.push(`<span class="deadline">${c.esc(card.deadline)}</span>`);
      footerParts.push('<span class="spacer"></span>');
      if (card.assignee) footerParts.push(c.avatar({ name: card.assignee, size: 20 }));
      if (card.status) footerParts.push(c.statusDot({ kind: card.status }));

      return `
      <div class="odoo-kanban-card">
        <div class="title">${c.esc(card.title || '')}</div>
        ${card.subtitle ? `<div class="subtitle">${c.esc(card.subtitle)}</div>` : ''}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
        <div class="footer">${footerParts.join(' ')}</div>
      </div>`;
    }).join('');

    return `
    <div class="odoo-kanban-col">
      <div class="odoo-kanban-col-head">
        <div class="title-wrap"><span>${c.esc(col.title || '')}</span><span class="plus">+</span></div>
        <div class="count">${col.count != null ? col.count : (col.cards || []).length}</div>
      </div>
      <div class="odoo-kanban-col-bar">${barInner}</div>
      ${cards}
    </div>`;
  }).join('');

  return wrap(`
    ${topChrome(spec)}
    <div class="odoo-list-search">
      ${spec.filterChipsHtml || ''}
      <div class="odoo-search">
        <span class="icon">🔍</span>
        ${(spec.filterChips || []).map((ch) => `<span class="chip">${c.esc(ch.label)}<span class="x">×</span></span>`).join('')}
        <input placeholder="${c.esc(spec.searchPlaceholder || 'Search…')}">
        <span class="odoo-muted">▾</span>
      </div>
      <div class="odoo-pager-info">
        <span>⌨</span><span>⧉</span><span>≡</span><span>▤</span><span>▥</span><span>📅</span><span>📍</span><span>🎨</span><span>📊</span><span>⏲</span>
      </div>
    </div>
    <div class="odoo-kanban">
      <div class="odoo-kanban-cols">${colsHtml}</div>
    </div>
  `);
}

// ────────────────────────────────────────── Wizard (modal)

function renderWizard(spec) {
  const {
    backgroundKind = 'tree',  // 'tree' | 'form' | 'kanban' | 'blank'
    backgroundSpec,
    title = 'Wizard',
    fields = [],
    footerBtns = [{ label: 'Save', variant: 'primary' }, { label: 'Discard' }],
  } = spec;

  let bg = '';
  if (backgroundKind !== 'blank' && backgroundSpec) {
    const renderer = { form: renderForm, tree: renderTree, kanban: renderKanban }[backgroundKind] || renderTree;
    bg = renderer(backgroundSpec);
  } else {
    bg = wrap(topChrome(spec) + `<div class="odoo-sheet"><div class="odoo-form-sheet" style="height:200px"></div></div>`);
  }

  const bodyHtml = fields.length ? c.formSingleColumn(fields) : (spec.bodyHtml || '');
  const footerHtml = footerBtns.map((b) => {
    const cls = b.variant === 'primary' ? 'odoo-header-btn primary' : 'odoo-header-btn';
    return `<button class="${cls}">${c.esc(b.label)}</button>`;
  });
  const footerAssembled = [footerHtml[0] || '', '<span class="spacer"></span>', ...footerHtml.slice(1)].join(' ');

  // Inline the wizard modal layered over the background
  const modal = `
    <div class="odoo-modal-backdrop">
      <div class="odoo-modal">
        <div class="odoo-modal-head"><span>${c.esc(title)}</span><span style="cursor:pointer;color:#6c757d">×</span></div>
        <div class="odoo-modal-body">${bodyHtml}</div>
        <div class="odoo-modal-foot">${footerAssembled}</div>
      </div>
    </div>`;

  // Strip the outer .odoo-screen wrapper of bg, re-wrap with the modal on top.
  const stripped = bg.replace(/^<div class="odoo-screen">/, '').replace(/<\/div>$/, '');
  return `<div class="odoo-screen" style="position:relative">${stripped}${modal}</div>`;
}

// ────────────────────────────────────────── Canvas assembly

/**
 * Convert an Odoo screen spec into the mockup-builder screen shape
 * (single html component).
 */
function toMockupScreen(odooScreen) {
  const kind = odooScreen.kind;
  let html;
  switch (kind) {
    case 'form':   html = renderForm(odooScreen);   break;
    case 'tree':   html = renderTree(odooScreen);   break;
    case 'list':   html = renderTree(odooScreen);   break;
    case 'kanban': html = renderKanban(odooScreen); break;
    case 'wizard': html = renderWizard(odooScreen); break;
    default: html = `<div class="odoo-screen"><div class="odoo-sheet"><div class="odoo-form-sheet">Unknown kind: ${c.esc(kind)}</div></div></div>`;
  }
  // Pixel-coordinate passthrough — only set if explicitly provided.
  // Grid indices go through `gridCol`/`gridRow` (resolved at the canvas layer).
  const out = {
    id: odooScreen.id,
    name: odooScreen.name || kind,
    purpose: odooScreen.purpose,
    layout: 'html',
    components: [{ type: 'html', html }],
    connectsTo: odooScreen.connectsTo || [],
  };
  if (typeof odooScreen.px === 'number') out.x = odooScreen.px;
  if (typeof odooScreen.py === 'number') out.y = odooScreen.py;
  return out;
}

/**
 * Build a mockup-builder-compatible SPEC from an Odoo canvas spec.
 * Returns { spec, themeCss } — the caller injects themeCss into the final HTML.
 */
function buildCanvasSpec(odooCanvas) {
  const themeTokens = theme.resolveTheme(odooCanvas.theme || 'odoo-17');
  const themeCss = theme.css(themeTokens);

  const mbSpec = {
    title: odooCanvas.title || 'Odoo Canvas',
    slug: odooCanvas.slug || 'odoo-canvas',
    theme: 'minimal-black',          // outer canvas uses a neutral theme
    viewport: odooCanvas.viewport || 'desktop',
    cols: odooCanvas.cols,
    screens: (odooCanvas.screens || []).map((s) => ({ ...toMockupScreen(s), theme: odooCanvas.theme })),
  };
  return { mbSpec, themeCss };
}

// ────────────────────────────────────────── full save wrapper

const fs = require('fs');
const path = require('path');
const mb = require('./mockup-builder');

/**
 * Render + save an Odoo canvas. Injects the Odoo CSS into the mockup-builder
 * HTML once (all `.odoo-screen` elements inherit from it) and writes the
 * bundle alongside screens.json.
 *
 * Respects:
 *   opts.outputDir  — explicit target folder
 *   opts.baseDir    — parent dir (slug is appended)
 *   env UIUX_ODOO_OUTPUT_DIR — global override
 * Falls back to Cowork mnt/outputs/uiux-odoo-output/<slug>/ or CWD equivalent.
 */
function saveOdooCanvas(odooCanvas, opts = {}) {
  const { mbSpec, themeCss } = buildCanvasSpec(odooCanvas);
  const slug = mbSpec.slug;

  let dir;
  if (opts.outputDir) dir = opts.outputDir;
  else if (opts.baseDir) dir = path.join(opts.baseDir, slug);
  else if (process.env.UIUX_ODOO_OUTPUT_DIR) dir = path.join(process.env.UIUX_ODOO_OUTPUT_DIR, slug);
  else {
    const cow = __dirname.match(/^(\/sessions\/[^/]+)/);
    const base = cow
      ? path.join(cow[1], 'mnt', 'outputs', 'uiux-odoo-output')
      : path.join(process.cwd(), 'uiux-odoo-output');
    dir = path.join(base, slug);
  }
  fs.mkdirSync(dir, { recursive: true });

  let html = mb.renderCanvas(mbSpec);
  // Inject Odoo theme CSS right before </head>.
  const themed = html.replace('</head>', `<style>${themeCss}</style>\n</head>`);

  const htmlPath = path.join(dir, 'mockups.html');
  fs.writeFileSync(htmlPath, themed);

  const specPath = path.join(dir, 'screens.json');
  fs.writeFileSync(specPath, JSON.stringify(odooCanvas, null, 2));

  // Machine-readable marker so preview/serve tooling can find the bundle dir
  // without re-importing this module.
  try { console.log(`[uiux-output] ${dir}`); } catch {}

  return { dir, files: { html: htmlPath, spec: specPath } };
}

module.exports = {
  renderForm, renderTree, renderKanban, renderWizard,
  toMockupScreen, buildCanvasSpec, saveOdooCanvas,
};
