/**
 * Mockup Builder — render a set of UI screens onto a single, self-contained
 * HTML canvas with pan + zoom (inspired by Figma / Stitch / Obra Superpower UI).
 *
 * No external runtime deps — output is a single `.html` file that opens in any
 * modern browser. All CSS / JS inlined.
 *
 * Usage:
 *   const mb = require('./lib/mockup-builder');
 *   const html = mb.renderCanvas({
 *     title: 'PRD: Real-time Notifications',
 *     theme: 'modern-teal',             // preset or custom object
 *     viewport: 'desktop',              // 'desktop' | 'mobile' | 'responsive'
 *     screens: [
 *       {
 *         id: '01-login',
 *         name: '1. Login',
 *         purpose: 'Entry point for returning users.',
 *         layout: 'form',                // template
 *         components: [...],
 *         connectsTo: ['02-dashboard'],
 *       },
 *       ...
 *     ],
 *   });
 *   mb.saveCanvas(html, '/out/mockups.html');
 */

const fs = require('fs');
const path = require('path');

// ───────────────────────────────────────── Theme presets ──────────────

const THEME_PRESETS = {
  'dke-blue': {
    primary: '#1E3A8A', primaryLight: '#3B82F6', accent: '#3B82F6',
    bg: '#f4f5f7', surface: '#ffffff', text: '#111827', muted: '#6B7280',
    border: '#E5E7EB', success: '#10B981', danger: '#EF4444',
  },
  'modern-teal': {
    primary: '#0F766E', primaryLight: '#14B8A6', accent: '#14B8A6',
    bg: '#f0fdfa', surface: '#ffffff', text: '#134E4A', muted: '#64748b',
    border: '#CCFBF1', success: '#10B981', danger: '#EF4444',
  },
  'corporate-neutral': {
    primary: '#334155', primaryLight: '#64748B', accent: '#475569',
    bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b',
    border: '#e2e8f0', success: '#16a34a', danger: '#dc2626',
  },
  'minimal-black': {
    primary: '#111111', primaryLight: '#404040', accent: '#000000',
    bg: '#fafafa', surface: '#ffffff', text: '#111111', muted: '#737373',
    border: '#e5e5e5', success: '#22c55e', danger: '#ef4444',
  },
};

function resolveTheme(theme) {
  if (!theme) return THEME_PRESETS['dke-blue'];
  if (typeof theme === 'string') return THEME_PRESETS[theme] || THEME_PRESETS['dke-blue'];
  return Object.assign({}, THEME_PRESETS['dke-blue'], theme);
}

// ───────────────────────────────────────── Viewport sizes ─────────────

const VIEWPORTS = {
  desktop:    { width: 1200, height: 780, label: 'Desktop 1200×780' },
  tablet:     { width: 768,  height: 1024, label: 'Tablet 768×1024' },
  mobile:     { width: 375,  height: 812, label: 'Mobile 375×812' },
  responsive: { width: 960,  height: 640, label: 'Responsive 960×640' },
};

function resolveViewport(v) {
  if (typeof v === 'string') return VIEWPORTS[v] || VIEWPORTS.desktop;
  if (v && v.width && v.height) return Object.assign({ label: `${v.width}×${v.height}` }, v);
  return VIEWPORTS.desktop;
}

// ───────────────────────────────────────── Utilities ──────────────────

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slug(s) {
  return String(s || 'screen').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ───────────────────────────────────────── Component renderers ────────

/**
 * Render a single component spec into HTML.
 * Accepted types (extend freely — unknown types fall through to raw html).
 */
function renderComponent(c, theme) {
  if (!c) return '';
  if (typeof c === 'string') return `<p class="body">${escapeHtml(c)}</p>`;
  const t = c.type || 'text';
  switch (t) {
    case 'heading':
      return `<h${c.level || 2} class="heading">${escapeHtml(c.text)}</h${c.level || 2}>`;
    case 'text':
    case 'p':
      return `<p class="body">${escapeHtml(c.text)}</p>`;
    case 'muted':
      return `<p class="muted">${escapeHtml(c.text)}</p>`;
    case 'button':
      return `<button class="btn ${c.variant || 'primary'}">${escapeHtml(c.label)}</button>`;
    case 'input':
      return `<label class="field"><span>${escapeHtml(c.label || '')}</span>` +
             `<input type="${c.inputType || 'text'}" placeholder="${escapeHtml(c.placeholder || '')}" ${c.value ? `value="${escapeHtml(c.value)}"` : ''}/></label>`;
    case 'select':
      return `<label class="field"><span>${escapeHtml(c.label || '')}</span>` +
             `<select>${(c.options || []).map(o => `<option>${escapeHtml(o)}</option>`).join('')}</select></label>`;
    case 'checkbox':
      return `<label class="check"><input type="checkbox" ${c.checked ? 'checked' : ''}/> ${escapeHtml(c.label || '')}</label>`;
    case 'list': {
      const items = (c.items || []).map(it => `<li>${escapeHtml(it)}</li>`).join('');
      return `<ul class="list">${items}</ul>`;
    }
    case 'card':
      return `<div class="card">
        ${c.title ? `<div class="card-title">${escapeHtml(c.title)}</div>` : ''}
        ${c.body ? `<div class="card-body">${escapeHtml(c.body)}</div>` : ''}
        ${c.meta ? `<div class="muted">${escapeHtml(c.meta)}</div>` : ''}
      </div>`;
    case 'kpi':
      return `<div class="kpi">
        <div class="kpi-label">${escapeHtml(c.label)}</div>
        <div class="kpi-value">${escapeHtml(c.value)}</div>
        ${c.delta ? `<div class="kpi-delta ${c.deltaKind || ''}">${escapeHtml(c.delta)}</div>` : ''}
      </div>`;
    case 'row':
      return `<div class="row">${(c.children || []).map(ch => renderComponent(ch, theme)).join('')}</div>`;
    case 'col':
    case 'stack':
      return `<div class="stack">${(c.children || []).map(ch => renderComponent(ch, theme)).join('')}</div>`;
    case 'nav': {
      const items = (c.items || []).map(i => {
        const active = i.active ? 'active' : '';
        return `<a class="nav-item ${active}" href="#${slug(i.label)}">${escapeHtml(i.label)}</a>`;
      }).join('');
      return `<nav class="nav">${items}</nav>`;
    }
    case 'topbar':
      return `<header class="topbar">
        <div class="brand">${escapeHtml(c.brand || 'App')}</div>
        <div class="actions">${(c.actions || []).map(a => `<span class="muted">${escapeHtml(a)}</span>`).join(' · ')}</div>
      </header>`;
    case 'table': {
      const head = `<tr>${(c.headers || []).map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
      const body = (c.rows || []).map(r => `<tr>${r.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
      return `<table class="table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    }
    case 'alert':
      return `<div class="alert ${c.kind || 'info'}">${escapeHtml(c.text)}</div>`;
    case 'empty':
      return `<div class="empty">
        <div class="empty-title">${escapeHtml(c.title || 'Nothing here yet')}</div>
        <div class="muted">${escapeHtml(c.body || '')}</div>
        ${c.cta ? `<button class="btn primary">${escapeHtml(c.cta)}</button>` : ''}
      </div>`;
    case 'avatar':
      return `<div class="avatar">${escapeHtml((c.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div>`;
    case 'spacer':
      return `<div style="height:${Number(c.size) || 16}px"></div>`;
    case 'html':
      return c.html || '';
    default:
      return `<p class="muted">[${escapeHtml(t)}]</p>`;
  }
}

// ───────────────────────────────────────── Screen layout templates ────

/**
 * If a screen has a `layout` preset but no explicit components, we auto-fill a
 * generic skeleton so screens render "something" even at low spec effort.
 */
function layoutSkeleton(layout, screen) {
  const name = screen.name || 'Screen';
  switch (layout) {
    case 'form':
      return [
        { type: 'topbar', brand: screen.brand || name, actions: ['Help'] },
        { type: 'heading', level: 2, text: screen.heading || name },
        { type: 'muted', text: screen.purpose || '' },
        { type: 'input', label: 'Email', inputType: 'email', placeholder: 'you@example.com' },
        { type: 'input', label: 'Password', inputType: 'password', placeholder: '••••••••' },
        { type: 'button', label: screen.ctaLabel || 'Continue', variant: 'primary' },
      ];
    case 'list':
      return [
        { type: 'topbar', brand: screen.brand || name, actions: ['Filter', 'Sort'] },
        { type: 'heading', level: 2, text: screen.heading || name },
        { type: 'muted', text: screen.purpose || '' },
        { type: 'list', items: ['Item A — updated 2h ago', 'Item B — updated yesterday', 'Item C — updated 3d ago'] },
      ];
    case 'detail':
      return [
        { type: 'topbar', brand: screen.brand || name, actions: ['Edit', 'Share'] },
        { type: 'heading', level: 1, text: screen.heading || 'Record detail' },
        { type: 'muted', text: screen.purpose || '' },
        { type: 'card', title: 'Summary', body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.' },
        { type: 'card', title: 'Activity', body: '3 updates in the last 24h.' },
      ];
    case 'dashboard':
      return [
        { type: 'topbar', brand: screen.brand || name, actions: ['Account'] },
        { type: 'heading', level: 2, text: screen.heading || 'Overview' },
        { type: 'row', children: [
          { type: 'kpi', label: 'Daily Active Users', value: '14.2k', delta: '+8%', deltaKind: 'up' },
          { type: 'kpi', label: 'Conversion',         value: '3.4%',  delta: '+0.3pt', deltaKind: 'up' },
          { type: 'kpi', label: 'Errors',             value: '0.12%', delta: '-40%', deltaKind: 'up' },
        ]},
        { type: 'card', title: 'Recent activity', body: 'Users, events, errors surfaced as a stream.' },
      ];
    case 'empty':
      return [
        { type: 'topbar', brand: screen.brand || name, actions: [] },
        { type: 'empty', title: 'No data yet', body: 'Once users start engaging, insights will show up here.', cta: 'Invite teammates' },
      ];
    case 'error':
      return [
        { type: 'topbar', brand: screen.brand || name, actions: [] },
        { type: 'alert', kind: 'danger', text: 'Something went wrong. Our team has been notified.' },
        { type: 'button', label: 'Retry', variant: 'ghost' },
      ];
    default:
      return [
        { type: 'topbar', brand: screen.brand || name, actions: [] },
        { type: 'heading', level: 2, text: screen.heading || name },
        { type: 'muted', text: screen.purpose || '' },
      ];
  }
}

// ───────────────────────────────────────── Layout positioning ─────────

/**
 * Place screens on the canvas. Default: simple grid (columns auto).
 * If a screen has { x, y } coords those override.
 */
function layoutScreens(screens, vp, cols = 3, gap = 140) {
  return screens.map((s, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = (typeof s.x === 'number') ? s.x : c * (vp.width + gap);
    const y = (typeof s.y === 'number') ? s.y : r * (vp.height + gap);
    return Object.assign({}, s, { _x: x, _y: y });
  });
}

// ───────────────────────────────────────── Main renderer ──────────────

function renderCanvas(spec = {}) {
  const t = resolveTheme(spec.theme);
  const vp = resolveViewport(spec.viewport);
  const title = spec.title || 'Mockup Canvas';
  const cols = spec.cols || Math.min(3, Math.max(1, Math.ceil(Math.sqrt((spec.screens || []).length))));
  const placed = layoutScreens(spec.screens || [], vp, cols);

  // Render each screen
  const screensHtml = placed.map((s, idx) => {
    const components = (s.components && s.components.length) ? s.components : layoutSkeleton(s.layout, s);
    const body = components.map(c => renderComponent(c, t)).join('\n');
    return `
  <section class="screen" id="${escapeHtml(s.id || slug(s.name) || 'screen-' + idx)}"
    style="left:${s._x}px; top:${s._y}px; width:${vp.width}px; min-height:${vp.height}px;">
    <div class="screen-label">
      <span class="screen-num">${idx + 1}</span>
      <span class="screen-name">${escapeHtml(s.name || `Screen ${idx + 1}`)}</span>
      ${s.purpose ? `<span class="screen-purpose">— ${escapeHtml(s.purpose)}</span>` : ''}
    </div>
    <div class="screen-frame">${body}</div>
  </section>`;
  }).join('\n');

  // Connections between screens (simple lines for flow viz, optional)
  const connections = [];
  placed.forEach((s, i) => {
    if (!s.connectsTo) return;
    const targets = Array.isArray(s.connectsTo) ? s.connectsTo : [s.connectsTo];
    for (const tgtId of targets) {
      const tgt = placed.find(x => (x.id || slug(x.name)) === tgtId);
      if (!tgt) continue;
      connections.push({
        from: { x: s._x + vp.width, y: s._y + vp.height / 2 },
        to:   { x: tgt._x,           y: tgt._y + vp.height / 2 },
        label: '',
      });
    }
  });

  // Build connection SVG (drawn behind screens in the viewport)
  const connsSvg = connections.length ? `
  <svg class="connections" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="${t.primary}"/>
      </marker>
    </defs>
    ${connections.map(c => {
      const mx = (c.from.x + c.to.x) / 2;
      return `<path d="M${c.from.x},${c.from.y} C${mx},${c.from.y} ${mx},${c.to.y} ${c.to.x},${c.to.y}" stroke="${t.primary}" stroke-width="2" fill="none" marker-end="url(#arrow)" opacity="0.5"/>`;
    }).join('')}
  </svg>` : '';

  const minimapItems = placed.map((s, idx) =>
    `<div class="mini-screen" data-target="${escapeHtml(s.id || slug(s.name) || 'screen-' + idx)}"
          style="left:${s._x / 20}px; top:${s._y / 20}px; width:${vp.width / 20}px; height:${vp.height / 20}px;"
          title="${escapeHtml(s.name || '')}"></div>`
  ).join('');

  const screenListItems = placed.map((s, idx) =>
    `<li><a href="#" data-goto="${escapeHtml(s.id || slug(s.name) || 'screen-' + idx)}">${idx + 1}. ${escapeHtml(s.name || 'Screen ' + (idx + 1))}</a></li>`
  ).join('');

  // The page — all CSS + JS inlined
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} — Mockup Canvas</title>
<style>
  :root {
    --primary: ${t.primary};
    --primary-light: ${t.primaryLight};
    --accent: ${t.accent};
    --bg: ${t.bg};
    --surface: ${t.surface};
    --text: ${t.text};
    --muted: ${t.muted};
    --border: ${t.border};
    --success: ${t.success};
    --danger: ${t.danger};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: var(--bg); color: var(--text); }
  .chrome {
    position: fixed; top: 0; left: 0; right: 0;
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; background: var(--surface); border-bottom: 1px solid var(--border);
    z-index: 100; font-size: 13px;
  }
  .chrome .title { font-weight: 600; color: var(--text); }
  .chrome .meta { color: var(--muted); font-size: 12px; }
  .chrome .btn-chip { background: var(--bg); border: 1px solid var(--border); padding: 6px 10px; border-radius: 8px; cursor: pointer; color: var(--text); font: inherit; }
  .chrome .btn-chip:hover { background: var(--primary); color: white; border-color: var(--primary); }
  .sidebar {
    position: fixed; top: 50px; left: 0; bottom: 0; width: 260px;
    background: var(--surface); border-right: 1px solid var(--border);
    padding: 16px; overflow-y: auto; z-index: 50; font-size: 13px;
  }
  .sidebar h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .sidebar ol { margin: 0 0 16px; padding-left: 20px; }
  .sidebar ol li { margin: 4px 0; }
  .sidebar ol li a { color: var(--text); text-decoration: none; }
  .sidebar ol li a:hover { color: var(--primary); }

  .canvas {
    position: fixed; top: 50px; left: 260px; right: 0; bottom: 0;
    overflow: hidden; cursor: grab; background: var(--bg);
    background-image: radial-gradient(circle, ${t.border} 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .canvas.grabbing { cursor: grabbing; }
  .viewport { position: absolute; top: 0; left: 0; transform-origin: 0 0; }

  .connections { position: absolute; top: 0; left: 0; width: 6000px; height: 6000px; pointer-events: none; }

  .screen {
    position: absolute;
    background: var(--surface);
    border-radius: 16px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .screen-label {
    position: absolute; top: -36px; left: 0; right: 0;
    display: flex; gap: 8px; align-items: baseline;
    font-size: 13px; color: var(--text);
  }
  .screen-num { font-weight: 600; color: var(--primary); }
  .screen-name { font-weight: 500; }
  .screen-purpose { color: var(--muted); font-weight: 400; }
  .screen-frame {
    padding: 32px; height: 100%; overflow: hidden;
    font-size: 14px; line-height: 1.5;
  }

  /* Component styles */
  .topbar { display: flex; justify-content: space-between; align-items: center; padding: 0 0 16px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
  .topbar .brand { font-weight: 600; color: var(--primary); font-size: 16px; }
  .topbar .actions { color: var(--muted); font-size: 13px; }
  .heading { color: var(--text); margin: 0 0 8px; }
  h1.heading { font-size: 28px; } h2.heading { font-size: 22px; } h3.heading { font-size: 18px; }
  .body { margin: 0 0 12px; color: var(--text); }
  .muted { color: var(--muted); margin: 0 0 12px; font-size: 13px; }
  .btn {
    padding: 10px 20px; border-radius: 8px; border: none; font: inherit; cursor: pointer;
    font-weight: 500; font-size: 14px; margin: 8px 8px 8px 0;
  }
  .btn.primary { background: var(--primary); color: white; }
  .btn.primary:hover { background: var(--primary-light); }
  .btn.ghost { background: transparent; color: var(--primary); border: 1px solid var(--primary); }
  .btn.danger { background: var(--danger); color: white; }
  .field { display: block; margin: 12px 0; }
  .field span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; font-weight: 500; }
  .field input, .field select {
    width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
    font: inherit; color: var(--text); background: var(--surface);
  }
  .field input:focus, .field select:focus { outline: 2px solid var(--primary-light); outline-offset: -1px; border-color: var(--primary); }
  .check { display: flex; align-items: center; gap: 8px; margin: 8px 0; color: var(--text); }
  .list { padding-left: 20px; }
  .list li { margin: 6px 0; color: var(--text); }
  .card {
    padding: 16px; border: 1px solid var(--border); border-radius: 10px; margin: 8px 0;
    background: var(--surface);
  }
  .card-title { font-weight: 600; margin-bottom: 6px; color: var(--text); }
  .card-body { color: var(--text); font-size: 13px; margin-bottom: 6px; }
  .kpi {
    flex: 1; min-width: 120px; padding: 16px; border-radius: 10px;
    background: var(--bg); border: 1px solid var(--border);
  }
  .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 6px; }
  .kpi-value { font-size: 22px; font-weight: 700; color: var(--text); }
  .kpi-delta { font-size: 12px; margin-top: 4px; color: var(--muted); }
  .kpi-delta.up { color: var(--success); }
  .kpi-delta.down { color: var(--danger); }
  .row { display: flex; gap: 12px; margin: 12px 0; flex-wrap: wrap; }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  .nav { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
  .nav-item { color: var(--muted); text-decoration: none; padding: 4px 0; font-size: 13px; }
  .nav-item.active { color: var(--primary); font-weight: 600; border-bottom: 2px solid var(--primary); }
  .table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0; }
  .table th { background: var(--bg); padding: 10px; text-align: left; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--border); }
  .table td { padding: 10px; border-bottom: 1px solid var(--border); color: var(--text); }
  .alert { padding: 12px 16px; border-radius: 8px; margin: 12px 0; font-size: 14px; }
  .alert.info { background: #dbeafe; color: #1e40af; }
  .alert.danger { background: #fee2e2; color: #991b1b; }
  .alert.success { background: #d1fae5; color: #065f46; }
  .empty { text-align: center; padding: 40px 16px; color: var(--muted); }
  .empty-title { font-size: 18px; color: var(--text); margin-bottom: 8px; font-weight: 500; }
  .avatar {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--primary); color: white; font-weight: 600; font-size: 13px;
  }

  /* Minimap */
  .minimap {
    position: fixed; right: 16px; bottom: 16px;
    width: 200px; height: 140px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    z-index: 90;
  }
  .minimap-inner { position: relative; width: 100%; height: 100%; }
  .mini-screen {
    position: absolute; background: var(--primary); opacity: 0.25;
    border-radius: 2px;
  }

  /* Keyboard hints */
  .hint {
    position: fixed; bottom: 16px; left: 276px;
    font-size: 11px; color: var(--muted);
    background: var(--surface); padding: 6px 10px;
    border-radius: 6px; border: 1px solid var(--border);
    z-index: 90;
  }
  kbd { background: var(--bg); border: 1px solid var(--border); border-radius: 3px; padding: 1px 4px; font-size: 10px; font-family: monospace; }
</style>
</head>
<body>
  <div class="chrome">
    <div>
      <span class="title">${escapeHtml(title)}</span>
      <span class="meta"> · ${escapeHtml(vp.label)} · ${placed.length} screens</span>
    </div>
    <div>
      <button class="btn-chip" data-zoom="0.25">25%</button>
      <button class="btn-chip" data-zoom="0.5">50%</button>
      <button class="btn-chip" data-zoom="1">100%</button>
      <button class="btn-chip" data-fit>Fit</button>
    </div>
  </div>

  <aside class="sidebar">
    <h3>Screens</h3>
    <ol>${screenListItems}</ol>
    <h3>How to navigate</h3>
    <ul style="padding-left: 18px; color: var(--muted); font-size: 12px;">
      <li>Click &amp; drag to pan.</li>
      <li>Scroll / pinch to zoom.</li>
      <li>Click a screen name to jump.</li>
      <li><kbd>F</kbd> to fit all screens.</li>
      <li><kbd>0</kbd> reset to 100%.</li>
    </ul>
  </aside>

  <div class="canvas" id="canvas">
    <div class="viewport" id="viewport">
      ${connsSvg}
      ${screensHtml}
    </div>
  </div>

  <div class="minimap"><div class="minimap-inner">${minimapItems}</div></div>
  <div class="hint">Pan: drag · Zoom: wheel · Jump: click name · Fit: <kbd>F</kbd></div>

<script>
(function() {
  const canvas = document.getElementById('canvas');
  const viewport = document.getElementById('viewport');
  let tx = 20, ty = 20, scale = 0.5;
  let isPanning = false, startX = 0, startY = 0, startTx = 0, startTy = 0;

  function apply() {
    viewport.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }
  apply();

  canvas.addEventListener('mousedown', function(e) {
    isPanning = true;
    startX = e.clientX; startY = e.clientY;
    startTx = tx; startTy = ty;
    canvas.classList.add('grabbing');
  });
  window.addEventListener('mousemove', function(e) {
    if (!isPanning) return;
    tx = startTx + (e.clientX - startX);
    ty = startTy + (e.clientY - startY);
    apply();
  });
  window.addEventListener('mouseup', function() {
    isPanning = false; canvas.classList.remove('grabbing');
  });

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const old = scale;
    const factor = Math.exp(-e.deltaY * 0.001);
    scale = Math.min(2.5, Math.max(0.1, scale * factor));
    // Keep the point under the mouse stationary
    tx = mx - (mx - tx) * (scale / old);
    ty = my - (my - ty) * (scale / old);
    apply();
  }, { passive: false });

  function fitAll() {
    const screens = document.querySelectorAll('.screen');
    if (!screens.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    screens.forEach(function(s) {
      const x = parseFloat(s.style.left), y = parseFloat(s.style.top);
      const w = parseFloat(s.style.width) || s.offsetWidth;
      const h = parseFloat(s.style.minHeight) || s.offsetHeight;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    });
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const w = maxX - minX + 200;
    const h = maxY - minY + 200;
    scale = Math.min(cw / w, ch / h, 1);
    tx = (cw - (maxX + minX) * scale) / 2;
    ty = (ch - (maxY + minY) * scale) / 2;
    apply();
  }

  document.querySelectorAll('[data-zoom]').forEach(function(b) {
    b.onclick = function() {
      scale = parseFloat(b.dataset.zoom);
      apply();
    };
  });
  document.querySelector('[data-fit]').onclick = fitAll;

  document.querySelectorAll('[data-goto]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      const el = document.getElementById(a.dataset.goto);
      if (!el) return;
      const x = parseFloat(el.style.left);
      const y = parseFloat(el.style.top);
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      scale = 0.8;
      tx = cw / 2 - (x + parseFloat(el.style.width) / 2) * scale;
      ty = ch / 2 - (y + 300) * scale;
      apply();
    });
  });

  document.querySelectorAll('.mini-screen').forEach(function(m) {
    m.addEventListener('click', function() {
      const a = document.querySelector('[data-goto="' + m.dataset.target + '"]');
      if (a) a.click();
    });
    m.style.cursor = 'pointer';
  });

  window.addEventListener('keydown', function(e) {
    if (e.key === 'f' || e.key === 'F') fitAll();
    if (e.key === '0') { scale = 1; tx = 40; ty = 40; apply(); }
  });

  // Auto-fit on load
  setTimeout(fitAll, 50);
})();
</script>
</body>
</html>`;
}

// ───────────────────────────────────────── I/O ────────────────────────

function saveCanvas(html, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, html);
  return { path: outputPath, size: Buffer.byteLength(html, 'utf8') };
}

/**
 * End-to-end convenience: render + save + write a JSON sidecar of the spec.
 * If baseDir isn't given, writes into prd-output/<slug>/ alongside the PRD.
 */
function saveMockupBundle(spec, opts = {}) {
  const slugStr = spec.slug || slug(spec.title || 'mockup');
  let dir;
  if (opts.outputDir) {
    dir = opts.outputDir;
  } else if (opts.baseDir) {
    dir = path.join(opts.baseDir, slugStr);
  } else {
    // Sit next to the PRD bundle by default
    const cow = __dirname.match(/^(\/sessions\/[^/]+)/);
    const base = cow
      ? path.join(cow[1], 'mnt', 'outputs', 'prd-output')
      : path.join(process.cwd(), 'prd-output');
    dir = path.join(base, slugStr);
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const html = renderCanvas(spec);
  const htmlPath = path.join(dir, 'mockups.html');
  fs.writeFileSync(htmlPath, html);

  const specPath = path.join(dir, 'screens.json');
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));

  return { dir, files: { html: htmlPath, spec: specPath } };
}

module.exports = {
  renderCanvas,
  renderComponent,
  layoutSkeleton,
  saveCanvas,
  saveMockupBundle,
  resolveTheme,
  resolveViewport,
  slug,
  THEME_PRESETS,
  VIEWPORTS,
};
