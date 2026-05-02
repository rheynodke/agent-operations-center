/**
 * uiux-odoo-generator — odoo-theme
 *
 * Visual tokens for the Odoo 17/18 Web Backend (Enterprise). These are not
 * the actual Odoo SCSS (which is a tangle of Bootstrap + OWL + 200 modules) —
 * they're a distilled set that produces a faithful *mockup* of the Odoo
 * aesthetic as seen in docs.odoo.com/17.0 and the Odoo 17 Enterprise client.
 *
 * Emits:
 *   - tokens object (for JS consumption)
 *   - css(tokens) — full stylesheet scoped under `.odoo-screen`
 */

'use strict';

// ─────────────────────────────────────────────────────────── theme tokens

const TOKENS_V17 = {
  // Brand — signature Odoo burgundy ($o-brand-primary) + teal optional accent.
  primary:       '#714b67',   // buttons, active state, tab underline
  primaryHover:  '#5d3f56',
  primarySoft:   '#efe8ed',   // tinted background for selected rows / chip bg
  accent:        '#00a09d',   // optional / secondary actions, hyperlinks in chatter
  danger:        '#d9534f',
  warning:       '#f0ad4e',
  success:       '#5cb85c',
  info:          '#5bc0de',

  // Surfaces — Odoo 17 Enterprise uses a warm cream body, not cold gray
  bg:            '#f1eeee',   // body bg (matches $o-view-background-color)
  sheet:         '#ffffff',   // form sheet bg
  cardBg:        '#ffffff',
  headerBg:      '#f6f3f2',   // list thead + o2m th
  subtleBg:      '#fafafa',   // hover bg on list rows, selected chip bg
  navBg:         '#ffffff',   // Enterprise navbar is white (not burgundy)
  controlBg:     '#ffffff',

  // Text
  text:          '#1f1f1f',
  textStrong:    '#111111',
  textMuted:     '#7a7a7a',
  textLabel:     '#4c4c4c',
  textLink:      '#017e84',   // tealish link in chatter and tree cells

  // Borders — Odoo uses warm grays, not blue-grays
  border:        '#dedad9',
  borderStrong:  '#b8b3b2',
  divider:       '#ebe7e6',

  // Status badges (list decorations) — use pale background + strong text
  // These map onto Odoo's decoration-info / decoration-success / etc.
  badgeBlue:     '#d7e9f7',   badgeBlueFg:   '#1e4f7c',
  badgeGreen:    '#d4f0dd',   badgeGreenFg:  '#167f3c',
  badgePurple:   '#ece1ea',   badgePurpleFg: '#714b67',
  badgeOrange:   '#fde7c8',   badgeOrangeFg: '#995c00',
  badgeRed:      '#fadcde',   badgeRedFg:    '#8c2028',
  badgeGray:     '#ebe7e6',   badgeGrayFg:   '#555555',
  badgeTeal:     '#d1ece9',   badgeTealFg:   '#0a7e7c',

  // Kanban stage colors (the top-of-column progress bars)
  stageBars: ['#58c4dd', '#f5a623', '#8c54ff', '#26a65b', '#d04437', '#f6b26b'],

  // Typography — Odoo ships with Roboto + system fallback
  fontFamily:    "'Inter', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  fontSizeBase:  '13px',
  fontSizeSm:    '12px',
  fontSizeXs:    '11px',
  fontSizeLg:    '14px',
  fontSizeHead:  '26px',
  fontWeightReg: 400,
  fontWeightMed: 500,
  fontWeightBold: 700,

  // Layout
  radius:        '4px',
  radiusSm:      '3px',
  radiusLg:      '6px',
  shadow:        '0 1px 2px rgba(0,0,0,0.06)',
  shadowCard:    '0 1px 2px rgba(0,0,0,0.08)',
  shadowCardHover: '0 3px 6px rgba(0,0,0,0.12)',
  shadowLg:      '0 10px 28px rgba(0,0,0,0.18)',
};

const TOKENS_V16 = {
  ...TOKENS_V17,
  bg:            '#f0eeee',
  navBg:         '#875a7b',    // older darker burgundy banner + white text
  primary:       '#875a7b',
  radius:        '3px',
};

const PRESETS = {
  'odoo-17':        TOKENS_V17,
  'odoo-18':        TOKENS_V17,   // visually aligned with 17 for now
  'odoo-16':        TOKENS_V16,
  'odoo-community': TOKENS_V17,
};

function resolveTheme(name) {
  if (typeof name === 'object' && name) return { ...TOKENS_V17, ...name };
  return PRESETS[name] || TOKENS_V17;
}

// ─────────────────────────────────────────────────────────── css generator

function css(tokens = TOKENS_V17) {
  const t = tokens;
  return `
/* Odoo-mockup theme — scoped under .odoo-screen so the outer canvas keeps its own skin.
   The containing canvas is Odoo-only, so we trim the outer screen-frame padding to give
   the real-app chrome more room inside the 1200×780 viewport. */
.screen-frame { padding: 12px !important; background: ${t.bg}; }
.odoo-screen {
  font-family: ${t.fontFamily};
  font-size: ${t.fontSizeBase};
  color: ${t.text};
  background: ${t.bg};
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
.odoo-screen *, .odoo-screen *::before, .odoo-screen *::after { box-sizing: border-box; }

/* ─── Top nav (Enterprise: white bar, burgundy active underline) ─── */
.odoo-topnav {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 16px;
  height: 46px;
  background: ${t.navBg};
  border-bottom: 1px solid ${t.border};
  flex-shrink: 0;
  box-shadow: 0 1px 0 rgba(0,0,0,0.02);
}
.odoo-logo {
  display: flex; align-items: center; gap: 8px;
  font-weight: ${t.fontWeightBold};
  color: ${t.primary};
  font-size: 14px;
  letter-spacing: .01em;
}
.odoo-logo-mark { width: 22px; height: 22px; border-radius: 6px;
  background: linear-gradient(135deg, ${t.primary} 0%, ${t.accent} 100%); flex-shrink: 0; }
.odoo-menu-items { display: flex; gap: 4px; font-size: ${t.fontSizeBase}; color: ${t.text}; }
.odoo-menu-items .item { cursor: pointer; padding: 14px 10px; position: relative; color: ${t.text}; }
.odoo-menu-items .item:hover { color: ${t.primary}; }
.odoo-menu-items .item.active { color: ${t.primary}; font-weight: ${t.fontWeightMed}; }
.odoo-menu-items .item.active::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: 0;
  height: 2px; background: ${t.primary}; border-radius: 2px 2px 0 0;
}
.odoo-topnav-right { margin-left: auto; display: flex; align-items: center; gap: 12px; color: ${t.textMuted}; font-size: ${t.fontSizeSm}; }
.odoo-topnav-right > span { cursor: pointer; display: inline-flex; align-items: center; }
.odoo-icon-dot { width: 7px; height: 7px; border-radius: 50%; background: ${t.danger}; display: inline-block; position: relative; top: -6px; margin-right: -4px; }
.odoo-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: ${t.accent}; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: ${t.fontWeightMed}; flex-shrink: 0;
}

/* ─── Action bar (New button, breadcrumb, pager) ─── */
.odoo-actionbar {
  display: flex; align-items: center; gap: 14px;
  padding: 8px 16px;
  background: ${t.navBg};
  border-bottom: 1px solid ${t.border};
  flex-shrink: 0;
  min-height: 42px;
}
.odoo-btn-new {
  background: ${t.primary};
  color: #fff;
  border: 1px solid ${t.primary};
  padding: 4px 14px;
  border-radius: ${t.radius};
  font-weight: ${t.fontWeightMed};
  cursor: pointer;
  font-size: ${t.fontSizeBase};
  line-height: 1.6;
}
.odoo-btn-new:hover { background: ${t.primaryHover}; border-color: ${t.primaryHover}; }
.odoo-breadcrumb { display: flex; align-items: center; gap: 4px; font-size: ${t.fontSizeLg}; }
.odoo-breadcrumb .crumb { color: ${t.text}; cursor: pointer; padding: 2px 4px; border-radius: 3px; }
.odoo-breadcrumb .crumb:hover { background: ${t.badgeGray}; }
.odoo-breadcrumb .crumb.current { color: ${t.textStrong}; font-weight: ${t.fontWeightMed}; cursor: default; }
.odoo-breadcrumb .crumb.current:hover { background: transparent; }
.odoo-breadcrumb .sep { color: ${t.textMuted}; margin: 0 2px; }
.odoo-breadcrumb .gear { color: ${t.textMuted}; font-size: 14px; margin-left: 6px; cursor: pointer; }
.odoo-pager { margin-left: auto; display: flex; align-items: center; gap: 6px; color: ${t.textMuted}; font-size: ${t.fontSizeSm}; }
.odoo-pager-btn {
  width: 24px; height: 24px; border: 1px solid ${t.border}; border-radius: ${t.radius};
  display: inline-flex; align-items: center; justify-content: center;
  background: ${t.sheet}; cursor: pointer; color: ${t.textMuted};
}
.odoo-pager-btn:hover { background: ${t.subtleBg}; color: ${t.text}; }

/* ─── Header buttons (row of statusbar actions: Send, Confirm, Cancel…) ─── */
.odoo-header-btns {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 10px 16px 8px; background: ${t.sheet};
  max-width: 1200px; margin: 0 auto; width: 100%;
}
.odoo-header-btn {
  background: ${t.sheet}; color: ${t.text};
  border: 1px solid ${t.border};
  padding: 4px 12px; border-radius: ${t.radius};
  font-size: ${t.fontSizeSm}; cursor: pointer; font-weight: ${t.fontWeightMed};
}
.odoo-header-btn:hover { background: ${t.subtleBg}; border-color: ${t.borderStrong}; }
.odoo-header-btn.primary { background: ${t.primary}; color: #fff; border-color: ${t.primary}; }
.odoo-header-btn.primary:hover { background: ${t.primaryHover}; border-color: ${t.primaryHover}; }
.odoo-header-btn.ghost { border-color: transparent; color: ${t.textLink}; background: transparent; }
.odoo-header-btn.ghost:hover { background: ${t.subtleBg}; }

/* ─── Statusbar (draft › quotation › sales order) ─── */
.odoo-statusbar {
  display: flex; padding: 0 16px 10px; background: ${t.sheet};
  gap: 0;
  max-width: 1200px; margin: 0 auto; width: 100%;
}
.odoo-statusbar .step {
  padding: 5px 22px 5px 26px;
  font-size: ${t.fontSizeSm}; font-weight: ${t.fontWeightMed};
  background: ${t.subtleBg}; color: ${t.textMuted};
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%);
  margin-right: -10px;
  letter-spacing: .01em;
}
.odoo-statusbar .step:first-child { padding-left: 16px; clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%); }
.odoo-statusbar .step.done { background: ${t.badgeGray}; color: ${t.text}; }
.odoo-statusbar .step.current { background: ${t.primary}; color: #fff; z-index: 1; }

/* ─── Form view sheet ─── */
.odoo-sheet {
  flex: 1; overflow: auto;
  padding: 14px 16px 16px;
  background: ${t.bg};
}
.odoo-form-sheet {
  background: ${t.sheet};
  border: 1px solid ${t.border};
  border-radius: ${t.radiusLg};
  padding: 18px 28px;
  box-shadow: ${t.shadow};
  max-width: 1200px;
  margin: 0 auto;
}
.odoo-ribbon { position: relative; }
.odoo-title {
  font-size: ${t.fontSizeHead}; font-weight: ${t.fontWeightBold}; line-height: 1.2;
  margin: 0 0 14px; padding-bottom: 0; color: ${t.textStrong}; border: 0;
}
.odoo-title-sub {
  color: ${t.textMuted}; font-size: ${t.fontSizeSm}; text-transform: uppercase;
  letter-spacing: .08em; margin: 0 0 3px; font-weight: ${t.fontWeightMed};
}

.odoo-form-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 44px; margin-top: 0; }
.odoo-form-cols.single { grid-template-columns: 1fr; }
.odoo-field-row { display: grid; grid-template-columns: 150px 1fr; align-items: baseline; padding: 4px 0; gap: 10px; }
.odoo-field-label { color: ${t.textLabel}; font-size: ${t.fontSizeBase}; font-weight: ${t.fontWeightReg}; }
.odoo-field-label .req { color: ${t.danger}; margin-left: 2px; }
.odoo-field-label .help {
  display: inline-flex; width: 13px; height: 13px; border-radius: 50%;
  background: ${t.border}; color: ${t.textMuted};
  align-items: center; justify-content: center;
  font-size: 10px; margin-left: 4px; cursor: help; font-weight: ${t.fontWeightBold};
}
.odoo-field-value {
  font-size: ${t.fontSizeBase}; color: ${t.text};
  border-bottom: 1px dotted ${t.border}; padding: 2px 0 3px;
}
.odoo-field-value.readonly { border-bottom: none; color: ${t.text}; }
.odoo-field-value input, .odoo-field-value select {
  background: transparent; border: none; outline: none; width: 100%; font: inherit; color: inherit; padding: 0;
}
.odoo-field-value.tagged { border-bottom: none; }

.odoo-checkbox { display: inline-flex; align-items: center; gap: 6px; margin-right: 14px; }
.odoo-checkbox .box {
  width: 15px; height: 15px; border: 1px solid ${t.borderStrong}; border-radius: 3px;
  display: inline-block; vertical-align: middle; background: ${t.sheet}; position: relative;
}
.odoo-checkbox .box.checked { background: ${t.primary}; border-color: ${t.primary}; }
.odoo-checkbox .box.checked::after {
  content: ''; position: absolute; left: 4px; top: 1px;
  width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);
}

.odoo-radio { display: inline-flex; align-items: center; gap: 6px; margin-right: 14px; }
.odoo-radio .dot {
  width: 14px; height: 14px; border: 1.5px solid ${t.borderStrong}; border-radius: 50%;
  display: inline-block; vertical-align: middle; position: relative; background: ${t.sheet};
}
.odoo-radio .dot.checked { border-color: ${t.primary}; }
.odoo-radio .dot.checked::after {
  content: ''; position: absolute; inset: 2px; background: ${t.primary}; border-radius: 50%;
}

/* Tags (m2m or badges) */
.odoo-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 8px; border-radius: 10px;
  background: ${t.badgeGray}; color: ${t.badgeGrayFg};
  font-size: ${t.fontSizeSm}; margin: 0 3px 2px 0;
  line-height: 1.5;
}
.odoo-tag.blue    { background: ${t.badgeBlue};    color: ${t.badgeBlueFg}; }
.odoo-tag.green   { background: ${t.badgeGreen};   color: ${t.badgeGreenFg}; }
.odoo-tag.purple  { background: ${t.badgePurple};  color: ${t.badgePurpleFg}; }
.odoo-tag.orange  { background: ${t.badgeOrange};  color: ${t.badgeOrangeFg}; }
.odoo-tag.red     { background: ${t.badgeRed};     color: ${t.badgeRedFg}; }
.odoo-tag.teal    { background: ${t.badgeTeal};    color: ${t.badgeTealFg}; }
.odoo-tag .x { cursor: pointer; opacity: .5; font-size: ${t.fontSizeBase}; }
.odoo-tag .x:hover { opacity: 1; }

/* Status badges (rounded pill, used in list columns) */
.odoo-status {
  display: inline-block; padding: 2px 10px; border-radius: 10px;
  font-size: ${t.fontSizeSm}; font-weight: ${t.fontWeightMed};
  background: ${t.badgeGreen}; color: ${t.badgeGreenFg}; line-height: 1.5;
}
.odoo-status.blue    { background: ${t.badgeBlue};    color: ${t.badgeBlueFg}; }
.odoo-status.green   { background: ${t.badgeGreen};   color: ${t.badgeGreenFg}; }
.odoo-status.purple  { background: ${t.badgePurple};  color: ${t.badgePurpleFg}; }
.odoo-status.orange  { background: ${t.badgeOrange};  color: ${t.badgeOrangeFg}; }
.odoo-status.red     { background: ${t.badgeRed};     color: ${t.badgeRedFg}; }
.odoo-status.gray    { background: ${t.badgeGray};    color: ${t.badgeGrayFg}; }
.odoo-status.teal    { background: ${t.badgeTeal};    color: ${t.badgeTealFg}; }

/* Notebook (tabs) — Odoo 17 uses burgundy active underline */
.odoo-notebook { margin-top: 14px; }
.odoo-tabs { display: flex; gap: 0; border-bottom: 1px solid ${t.border}; }
.odoo-tab {
  padding: 8px 16px 7px; font-size: ${t.fontSizeBase}; cursor: pointer;
  border-bottom: 2px solid transparent;
  color: ${t.textMuted};
  font-weight: ${t.fontWeightMed};
  margin-bottom: -1px;
}
.odoo-tab:hover { color: ${t.text}; }
.odoo-tab.active { color: ${t.primary}; border-bottom-color: ${t.primary}; }
.odoo-tab-pane { padding: 12px 0 0; }

/* ─── Chatter (Odoo 17: tab bar for Send message / Log note / Activities) ─── */
.odoo-chatter {
  background: ${t.sheet};
  border: 1px solid ${t.border};
  border-radius: ${t.radiusLg};
  padding: 0;
  max-width: 1200px;
  margin: 14px auto 0;
  box-shadow: ${t.shadow};
}
.odoo-chatter-actions {
  display: flex; align-items: center; gap: 0;
  padding: 0 18px;
  border-bottom: 1px solid ${t.divider};
}
.odoo-chatter-btn {
  border: 0; background: transparent;
  padding: 10px 14px 9px; border-radius: 0;
  font-size: ${t.fontSizeBase}; cursor: pointer; color: ${t.textMuted};
  font-weight: ${t.fontWeightMed};
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.odoo-chatter-btn:hover { color: ${t.text}; }
.odoo-chatter-btn.primary {
  color: ${t.primary};
  border-bottom-color: ${t.primary};
  background: transparent;
}
.odoo-chatter-meta {
  display: flex; align-items: center; gap: 12px; margin-left: auto;
  color: ${t.textMuted}; font-size: ${t.fontSizeSm};
}
.odoo-chatter-meta > span { display: inline-flex; align-items: center; gap: 3px; }
.odoo-chatter-log { padding: 6px 18px 14px; }
.odoo-chatter-log .entry { padding: 12px 0; border-top: 1px solid ${t.divider}; display: grid; grid-template-columns: 32px 1fr; gap: 10px; }
.odoo-chatter-log .entry:first-child { border-top: 0; }
.odoo-chatter-log .who { font-weight: ${t.fontWeightMed}; color: ${t.text}; }
.odoo-chatter-log .when { color: ${t.textMuted}; font-size: ${t.fontSizeSm}; margin-left: 8px; font-weight: ${t.fontWeightReg}; }
.odoo-chatter-log .body { font-size: ${t.fontSizeBase}; color: ${t.text}; margin-top: 2px; }
.odoo-chatter-divider {
  text-align: center; color: ${t.textMuted}; font-size: ${t.fontSizeSm};
  margin: 4px 18px 0; padding: 6px 0; border-bottom: 1px solid ${t.divider};
}

/* ─── Tree / List view ─── */
.odoo-list-wrap { flex: 1; overflow: auto; background: ${t.sheet}; }
.odoo-list-search {
  display: flex; align-items: center; gap: 10px; padding: 8px 16px;
  background: ${t.sheet}; border-bottom: 1px solid ${t.border};
}
.odoo-search {
  display: flex; align-items: center; background: ${t.sheet};
  border: 1px solid ${t.border}; border-radius: ${t.radius};
  padding: 3px 8px; gap: 6px; flex: 0 1 440px;
  font-size: ${t.fontSizeBase};
  min-height: 28px;
}
.odoo-search:focus-within { border-color: ${t.primary}; }
.odoo-search .icon { color: ${t.textMuted}; }
.odoo-search .chip {
  background: ${t.primarySoft}; color: ${t.primary};
  padding: 1px 8px; border-radius: 10px; font-size: ${t.fontSizeSm};
  display: inline-flex; align-items: center; gap: 4px; font-weight: ${t.fontWeightMed};
}
.odoo-search .chip .x { opacity: .6; cursor: pointer; font-size: ${t.fontSizeBase}; }
.odoo-search input { border: none; outline: none; flex: 1; background: transparent; font: inherit; color: ${t.text}; }
.odoo-search input::placeholder { color: ${t.textMuted}; }
.odoo-pager-info { margin-left: auto; color: ${t.textMuted}; font-size: ${t.fontSizeSm}; display: flex; align-items: center; gap: 6px; }

.odoo-table { width: 100%; border-collapse: collapse; font-size: ${t.fontSizeBase}; }
.odoo-table thead th {
  background: ${t.headerBg};
  color: ${t.textLabel};
  text-align: left;
  padding: 9px 12px;
  font-weight: ${t.fontWeightMed};
  font-size: ${t.fontSizeSm};
  border-bottom: 1px solid ${t.border};
  position: sticky; top: 0;
  white-space: nowrap;
}
.odoo-table td {
  padding: 9px 12px; border-bottom: 1px solid ${t.divider};
  vertical-align: middle;
}
.odoo-table tbody tr { cursor: pointer; }
.odoo-table tbody tr:hover { background: ${t.subtleBg}; }
.odoo-table .checkbox-col, .odoo-table .checkbox-cell { width: 32px; text-align: center; }
.odoo-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.odoo-table td.primary { color: ${t.textStrong}; font-weight: ${t.fontWeightMed}; }
.odoo-table tfoot td {
  background: ${t.sheet};
  font-weight: ${t.fontWeightBold};
  color: ${t.textStrong};
  border-top: 2px solid ${t.border};
  border-bottom: 0;
  padding: 10px 12px;
}
.odoo-avatar-cell { display: inline-flex; align-items: center; gap: 6px; }

/* o2m inline table — compact, inside the form sheet */
.odoo-o2m { margin-top: 6px; }
.odoo-o2m table { width: 100%; border-collapse: collapse; font-size: ${t.fontSizeBase}; }
.odoo-o2m th {
  background: transparent; color: ${t.textLabel};
  padding: 7px 10px 6px; text-align: left;
  font-size: ${t.fontSizeSm}; font-weight: ${t.fontWeightMed};
  border-bottom: 1px solid ${t.border};
}
.odoo-o2m td { padding: 7px 10px; border-bottom: 1px solid ${t.divider}; }
.odoo-o2m tbody tr:hover { background: ${t.subtleBg}; }
.odoo-o2m .add-line {
  color: ${t.textLink}; font-size: ${t.fontSizeSm}; cursor: pointer;
  padding: 8px 10px 2px; display: inline-block; font-weight: ${t.fontWeightMed};
}
.odoo-o2m .add-line:hover { text-decoration: underline; }

/* ─── Kanban view ─── */
.odoo-kanban { flex: 1; overflow: auto; padding: 12px; background: ${t.bg}; }
.odoo-kanban-cols { display: flex; gap: 10px; align-items: flex-start; min-width: max-content; }
.odoo-kanban-col { width: 256px; min-width: 220px; background: transparent; }
.odoo-kanban-col-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 6px 4px; font-weight: ${t.fontWeightMed};
  font-size: ${t.fontSizeBase};
  color: ${t.textStrong};
}
.odoo-kanban-col-head .title-wrap { display: inline-flex; align-items: center; gap: 6px; }
.odoo-kanban-col-head .plus { color: ${t.textMuted}; cursor: pointer; font-weight: ${t.fontWeightReg}; padding: 0 2px; }
.odoo-kanban-col-head .plus:hover { color: ${t.primary}; }
.odoo-kanban-col-head .count {
  background: transparent; color: ${t.textMuted};
  padding: 0; border-radius: 0; font-size: ${t.fontSizeSm};
  font-weight: ${t.fontWeightReg};
}
.odoo-kanban-col-bar {
  height: 3px; border-radius: 2px; background: ${t.divider}; margin: 4px 0 10px;
  overflow: hidden; display: flex;
}
.odoo-kanban-col-bar span { display: block; height: 100%; }
.odoo-kanban-card {
  background: ${t.cardBg};
  border: 1px solid ${t.border};
  border-radius: ${t.radius};
  padding: 10px 12px 9px;
  margin-bottom: 8px;
  box-shadow: ${t.shadowCard};
  cursor: pointer;
  transition: box-shadow .12s ease;
}
.odoo-kanban-card:hover { box-shadow: ${t.shadowCardHover}; }
.odoo-kanban-card .title { font-weight: ${t.fontWeightMed}; margin-bottom: 2px; color: ${t.textStrong}; font-size: ${t.fontSizeBase}; }
.odoo-kanban-card .subtitle { color: ${t.textMuted}; font-size: ${t.fontSizeSm}; margin-bottom: 6px; }
.odoo-kanban-card .tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.odoo-kanban-card .footer { display: flex; align-items: center; gap: 6px; font-size: ${t.fontSizeXs}; color: ${t.textMuted}; margin-top: 6px; }
.odoo-kanban-card .footer .spacer { flex: 1; }
.odoo-kanban-card .deadline {
  font-variant-numeric: tabular-nums; border: 1px solid ${t.border};
  padding: 1px 6px; border-radius: ${t.radiusSm}; font-size: ${t.fontSizeXs}; color: ${t.text};
}
.odoo-kanban-card .star { color: ${t.warning}; font-size: 13px; cursor: pointer; }
.odoo-kanban-card .star.on { color: ${t.warning}; }
.odoo-kanban-card .star.off { color: ${t.borderStrong}; }
.odoo-status-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.odoo-status-dot.ok { background: ${t.success}; }
.odoo-status-dot.late { background: ${t.warning}; }
.odoo-status-dot.overdue { background: ${t.danger}; }
.odoo-status-dot.none { background: transparent; border: 1px solid ${t.borderStrong}; }

/* ─── Wizard modal (Odoo 17: right-aligned footer buttons) ─── */
.odoo-modal-backdrop {
  position: absolute; inset: 0;
  background: rgba(30, 20, 25, 0.40);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.odoo-modal {
  background: ${t.sheet};
  border-radius: ${t.radiusLg};
  box-shadow: ${t.shadowLg};
  width: 620px; max-width: 100%;
  max-height: 85%; display: flex; flex-direction: column;
  overflow: hidden;
}
.odoo-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; border-bottom: 1px solid ${t.divider};
  font-weight: ${t.fontWeightMed}; font-size: ${t.fontSizeLg};
  color: ${t.textStrong};
}
.odoo-modal-head .close { cursor: pointer; color: ${t.textMuted}; font-size: 18px; line-height: 1; }
.odoo-modal-head .close:hover { color: ${t.text}; }
.odoo-modal-body { padding: 16px 20px; overflow: auto; }
.odoo-modal-foot {
  padding: 12px 20px; border-top: 1px solid ${t.divider};
  display: flex; gap: 8px; justify-content: flex-start;
  background: ${t.subtleBg};
}
.odoo-modal-foot .spacer { flex: 1; }

/* Utility */
.odoo-muted { color: ${t.textMuted}; }
.odoo-link  { color: ${t.textLink}; cursor: pointer; }
.odoo-link:hover { text-decoration: underline; }
.odoo-hr { border: 0; border-top: 1px solid ${t.divider}; margin: 14px 0; }
.odoo-section-head {
  text-transform: uppercase; font-size: ${t.fontSizeSm}; color: ${t.textMuted};
  letter-spacing: .08em; margin: 14px 0 6px; font-weight: ${t.fontWeightMed};
}
`;
}

module.exports = { resolveTheme, css, PRESETS, TOKENS_V17, TOKENS_V16 };
