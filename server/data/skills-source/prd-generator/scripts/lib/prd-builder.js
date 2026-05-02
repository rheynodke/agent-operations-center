/**
 * PRD Builder — reusable helpers for generating PRDs in a consistent format.
 *
 * Generalized from the `dke-prd` skill so any organization can adopt it.
 * Configurable via:
 *   - orgCode  — uppercase slug in PRD number (default 'DKE')
 *   - locale   — 'id' (default) | 'en'
 *   - theme    — object or preset name ('dke-blue' | 'corporate-neutral'
 *                | 'modern-teal' | 'minimal-black')
 *
 * Usage:
 *   const b = require('./lib/prd-builder');
 *   const doc = b.createDocument([
 *     ...b.createCoverPage({
 *       title: 'PRD: Real-time Notifications',
 *       version: 'v1.0.0',
 *       date: '18 April 2026',
 *       prdNumber: '007/PRD-ACME/IV/2026',
 *       productDriver: 'Dian Pratama',
 *       productDelivery: 'Web Platform Team',
 *       stakeholder: 'VP Product',
 *       status: 'Draft',
 *       theme: 'modern-teal',  // optional
 *       locale: 'en',          // optional
 *     }),
 *     b.createSectionHeading('1', 'Executive Summary'),
 *     b.createParagraph('...'),
 *   ], { theme: 'modern-teal' });
 *   await b.saveDocument(doc, '/path/to/output.docx');
 */

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak,
  ShadingType, LevelFormat, convertInchesToTwip,
} = require('docx');
const fs = require('fs');
const path = require('path');

// ───────────────────────────────────────── Theme presets ──────────
const DEFAULT_THEME = {
  primaryColor:  '1E3A8A',  // DKE Blue — title, headings, table headers
  primaryLight:  '3B82F6',
  accentColor:   '3B82F6',
  grayText:      '6B7280',
  bodyText:      '111827',
  tableRowAlt:   'F9FAFB',
  tableBorder:   'D1D5DB',
  tableHeaderText: 'FFFFFF',
  codeBg:        'F3F4F6',
  codeText:      '1F2937',
  calloutInfoBg:       'EFF6FF',
  calloutInfoBorder:   '3B82F6',
  calloutWarnBg:       'FEF3C7',
  calloutWarnBorder:   'F59E0B',
  calloutCritBg:       'FEE2E2',
  calloutCritBorder:   'EF4444',
  font:          'Calibri',
  codeFont:      'Courier New',
};

const PRESET_THEMES = {
  'dke-blue': {}, // defaults

  'corporate-neutral': {
    primaryColor: '1F2937',
    primaryLight: '4B5563',
    accentColor:  '6B7280',
  },

  'modern-teal': {
    primaryColor: '0F766E',
    primaryLight: '14B8A6',
    accentColor:  '14B8A6',
    calloutInfoBorder: '14B8A6',
    calloutInfoBg:     'CCFBF1',
  },

  'minimal-black': {
    primaryColor: '111111',
    primaryLight: '444444',
    accentColor:  '444444',
    tableRowAlt:  'F3F4F6',
  },
};

function resolveTheme(themeInput) {
  if (!themeInput) return { ...DEFAULT_THEME };
  if (typeof themeInput === 'string') {
    const preset = PRESET_THEMES[themeInput];
    if (!preset) {
      throw new Error(
        `Unknown theme preset "${themeInput}". Valid: ${Object.keys(PRESET_THEMES).join(', ')}`
      );
    }
    return { ...DEFAULT_THEME, ...preset };
  }
  if (typeof themeInput === 'object') {
    return { ...DEFAULT_THEME, ...themeInput };
  }
  throw new Error('theme must be a preset name (string) or an object');
}

// ───────────────────────────────────────── Locale ─────────────────
const MONTH_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const LOCALES = {
  id: {
    months: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
             'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
    labels: {
      dateCreated: 'Date Created',
      no: 'No',
      productDriver: 'Product Driver',
      productDelivery: 'Product Delivery',
      stakeholder: 'Stakeholder',
      status: 'Status',
    },
  },
  en: {
    months: ['January', 'February', 'March', 'April', 'May', 'June',
             'July', 'August', 'September', 'October', 'November', 'December'],
    labels: {
      dateCreated: 'Date Created',
      no: 'No',
      productDriver: 'Product Driver',
      productDelivery: 'Product Delivery',
      stakeholder: 'Stakeholder',
      status: 'Status',
    },
  },
};

function resolveLocale(localeInput) {
  const key = (localeInput || 'id').toLowerCase();
  if (!LOCALES[key]) {
    throw new Error(`Unknown locale "${localeInput}". Valid: ${Object.keys(LOCALES).join(', ')}`);
  }
  return LOCALES[key];
}

/**
 * Format a PRD number.
 *   formatPrdNumber({ sequence: 1, orgCode: 'ACME', month: 4, year: 2026 })
 *   → '001/PRD-ACME/IV/2026'
 */
function formatPrdNumber({ sequence, orgCode = 'DKE', month, year }) {
  if (!sequence || !month || !year) {
    throw new Error('formatPrdNumber requires sequence, month, year (orgCode optional)');
  }
  const seq = String(sequence).padStart(3, '0');
  const roman = MONTH_ROMAN[month - 1];
  if (!roman) throw new Error(`Invalid month: ${month}`);
  const org = String(orgCode).toUpperCase();
  return `${seq}/PRD-${org}/${roman}/${year}`;
}

/**
 * Format a date per locale. Returns 'DD Month-Name YYYY'.
 *   formatLocaleDate(new Date(2026, 3, 18), 'id') → '18 April 2026'
 *   formatLocaleDate(new Date(2026, 0, 3),  'en') → '3 January 2026'
 */
function formatLocaleDate(date, locale = 'id') {
  const L = resolveLocale(locale);
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getDate()} ${L.months[d.getMonth()]} ${d.getFullYear()}`;
}

// Back-compat alias (for callers upgrading from dke-prd-builder.js)
const formatIndonesianDate = (date) => formatLocaleDate(date, 'id');

// ───────────────────────────────────────── Cover page ──────────────
/**
 * Generate standard cover page. Returns array of children.
 * Required opts:
 *   title, version, date, prdNumber, productDriver, productDelivery,
 *   stakeholder, status
 * Optional:
 *   theme  — preset name or object (default: DKE Blue)
 *   locale — 'id' | 'en' (default: 'id')
 */
function createCoverPage(opts) {
  const required = ['title', 'version', 'date', 'prdNumber',
                    'productDriver', 'productDelivery', 'stakeholder', 'status'];
  for (const k of required) {
    if (!opts[k]) throw new Error(`createCoverPage: required field "${k}" is empty`);
  }
  const T = resolveTheme(opts.theme);
  const L = resolveLocale(opts.locale);

  const children = [];

  // Top spacer
  children.push(new Paragraph({ text: '', spacing: { before: 1600, after: 0 } }));

  // Title
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 300 },
    children: [new TextRun({
      text: opts.title,
      bold: true,
      size: 40, // 20pt
      color: T.primaryColor,
      font: T.font,
    })],
  }));

  // Version
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 400 },
    children: [new TextRun({
      text: opts.version,
      size: 24,
      color: T.grayText,
      italics: true,
      font: T.font,
    })],
  }));

  // Date + Number
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({
      text: `${L.labels.dateCreated} : ${opts.date}`,
      size: 22,
      color: T.bodyText,
      font: T.font,
    })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 600 },
    children: [new TextRun({
      text: `${L.labels.no} : ${opts.prdNumber}`,
      size: 22,
      bold: true,
      color: T.bodyText,
      font: T.font,
    })],
  }));

  // Metadata table
  const metaRows = [
    [L.labels.productDriver, opts.productDriver],
    [L.labels.productDelivery, opts.productDelivery],
    [L.labels.stakeholder, opts.stakeholder],
    [L.labels.status, opts.status],
  ];
  children.push(_buildMetadataTable(metaRows, T));

  // Page break
  children.push(new Paragraph({ children: [new PageBreak()] }));

  return children;
}

function _buildMetadataTable(rows, T) {
  const tableRows = rows.map(([label, value]) => new TableRow({
    children: [
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: T.tableRowAlt },
        children: [new Paragraph({
          children: [new TextRun({ text: label, bold: true, size: 22, color: T.bodyText, font: T.font })],
        })],
        margins: { top: 120, bottom: 120, left: 180, right: 180 },
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          children: [new TextRun({ text: value, size: 22, color: T.bodyText, font: T.font })],
        })],
        margins: { top: 120, bottom: 120, left: 180, right: 180 },
      }),
    ],
  }));

  return new Table({
    width: { size: 70, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
    rows: tableRows,
    borders: _standardTableBorders(T),
  });
}

// ───────────────────────────────────────── Headings ────────────────
function createSectionHeading(number, title, opts = {}) {
  const T = resolveTheme(opts.theme);
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 200 },
    children: [new TextRun({
      text: `${number}. ${title}`,
      bold: true,
      size: 32, // 16pt
      color: T.primaryColor,
      font: T.font,
    })],
  });
}

function createSubHeading(text, level = 2, opts = {}) {
  const T = resolveTheme(opts.theme);
  const size = level === 2 ? 26 : 24; // 13pt / 12pt
  const heading = level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  return new Paragraph({
    heading,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({
      text,
      bold: true,
      size,
      color: T.primaryColor,
      font: T.font,
    })],
  });
}

// ───────────────────────────────────────── Body text ───────────────
function createParagraph(text, opts = {}) {
  const T = resolveTheme(opts.theme);
  const runs = _parseInlineBold(text, {
    size: opts.size || 22,
    color: opts.color || T.bodyText,
    font: T.font,
  });
  return new Paragraph({
    spacing: { before: opts.before || 80, after: opts.after || 120, line: 300 },
    alignment: opts.alignment || AlignmentType.JUSTIFIED,
    children: runs,
  });
}

/** Parse inline **bold** markers in a string to TextRun[]. */
function _parseInlineBold(text, baseStyle) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map(part => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return new TextRun({ ...baseStyle, text: part.slice(2, -2), bold: true });
    }
    return new TextRun({ ...baseStyle, text: part });
  });
}

// ───────────────────────────────────────── Lists ───────────────────
function createBulletList(items, opts = {}) {
  const T = resolveTheme(opts.theme);
  return items.map(item => new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 40, after: 40, line: 280 },
    children: _parseInlineBold(item, { size: 22, color: T.bodyText, font: T.font }),
  }));
}

function createNumberedList(items, reference = 'prd-numbered', opts = {}) {
  const T = resolveTheme(opts.theme);
  return items.map(item => new Paragraph({
    numbering: { reference, level: 0 },
    spacing: { before: 40, after: 40, line: 280 },
    children: _parseInlineBold(item, { size: 22, color: T.bodyText, font: T.font }),
  }));
}

// ───────────────────────────────────────── Tables ──────────────────
/**
 * createTable(headers, rows, opts)
 *   headers — string[]
 *   rows    — array of arrays (same length as headers)
 *   opts:
 *     columnWidths        — percentages (sum 100)
 *     alternateRowShading — bool (default true)
 *     theme               — preset name or theme object
 */
function createTable(headers, rows, opts = {}) {
  const T = resolveTheme(opts.theme);
  const alt = opts.alternateRowShading !== false;
  const widths = opts.columnWidths || headers.map(() => 100 / headers.length);

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: T.primaryColor },
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({
          text: h, bold: true, size: 22, color: T.tableHeaderText, font: T.font,
        })],
      })],
    })),
  });

  const bodyRows = rows.map((row, idx) => new TableRow({
    children: row.map((cell, i) => new TableCell({
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      shading: alt && idx % 2 === 1
        ? { type: ShadingType.CLEAR, fill: T.tableRowAlt }
        : undefined,
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({
        children: _parseInlineBold(String(cell), { size: 20, color: T.bodyText, font: T.font }),
      })],
    })),
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
    borders: _standardTableBorders(T),
  });
}

function _standardTableBorders(T) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: T.tableBorder };
  return {
    top: border, bottom: border, left: border, right: border,
    insideHorizontal: border, insideVertical: border,
  };
}

// ───────────────────────────────────────── Code block ──────────────
function createCodeBlock(code, language = '', opts = {}) {
  const T = resolveTheme(opts.theme);
  const lines = String(code).split('\n');
  const paragraphs = [];

  if (language) {
    paragraphs.push(new Paragraph({
      spacing: { before: 120, after: 0 },
      children: [new TextRun({
        text: language.toUpperCase(),
        size: 16, bold: true, color: T.grayText, font: T.font,
      })],
    }));
  }

  lines.forEach(line => {
    paragraphs.push(new Paragraph({
      spacing: { before: 0, after: 0, line: 260 },
      shading: { type: ShadingType.CLEAR, fill: T.codeBg },
      children: [new TextRun({
        text: line || ' ',
        font: T.codeFont,
        size: 18,
        color: T.codeText,
      })],
    }));
  });

  paragraphs.push(new Paragraph({ text: '', spacing: { before: 0, after: 120 } }));
  return paragraphs;
}

// ───────────────────────────────────────── Callouts ────────────────
/** type: 'info' | 'warning' | 'critical' */
function createCallout(text, type = 'info', opts = {}) {
  const T = resolveTheme(opts.theme);
  const palettes = {
    info:     { bg: T.calloutInfoBg, border: T.calloutInfoBorder, label: 'INFO' },
    warning:  { bg: T.calloutWarnBg, border: T.calloutWarnBorder, label: 'WARNING' },
    critical: { bg: T.calloutCritBg, border: T.calloutCritBorder, label: 'CRITICAL' },
  };
  const palette = palettes[type] || palettes.info;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: palette.bg },
        margins: { top: 160, bottom: 160, left: 200, right: 200 },
        children: [
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({
              text: palette.label, bold: true, size: 18, color: palette.border, font: T.font,
            })],
          }),
          new Paragraph({
            children: _parseInlineBold(text, { size: 22, color: T.bodyText, font: T.font }),
          }),
        ],
      })],
    })],
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 12, color: palette.border },
      bottom: { style: BorderStyle.SINGLE, size: 4,  color: palette.border },
      left:   { style: BorderStyle.SINGLE, size: 4,  color: palette.border },
      right:  { style: BorderStyle.SINGLE, size: 4,  color: palette.border },
    },
  });
}

// ───────────────────────────────────────── Utilities ───────────────
function createSpacer(size = 'normal') {
  const map = { small: 80, normal: 160, large: 320 };
  const amount = map[size] || map.normal;
  return new Paragraph({ text: '', spacing: { before: 0, after: amount } });
}

function createPageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// ───────────────────────────────────────── Document wrapper ────────
/**
 * opts:
 *   title, description, creator — metadata
 *   theme — preset name or theme object (sets default font & body color)
 */
function createDocument(children, opts = {}) {
  const T = resolveTheme(opts.theme);
  return new Document({
    creator: opts.creator || 'PRD Generator Skill',
    title: opts.title || 'Product Requirements Document',
    description: opts.description || 'Generated using the prd-generator skill',
    numbering: {
      config: [{
        reference: 'prd-numbered',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: T.font, size: 22, color: T.bodyText },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
          },
        },
      },
      children,
    }],
  });
}

/**
 * Post-process the docx package:
 *  - adds the `fontTable` relationship that the `docx` npm library omits,
 *    so the document passes strict OOXML validators.
 * Uses jszip (transitive dep of `docx`).
 */
async function _normalizeDocx(buffer) {
  let JSZip;
  try { JSZip = require('jszip'); } catch (e) { return buffer; } // no-op if missing

  const zip = await JSZip.loadAsync(buffer);
  const relsPath = 'word/_rels/document.xml.rels';
  const relsEntry = zip.file(relsPath);
  const fontTableEntry = zip.file('word/fontTable.xml');
  if (!relsEntry || !fontTableEntry) return buffer;

  let rels = await relsEntry.async('string');
  if (rels.includes('Target="fontTable.xml"')) return buffer; // already referenced

  // Pick the next free rId
  const ids = Array.from(rels.matchAll(/Id="rId(\d+)"/g)).map(m => Number(m[1]));
  const nextId = (ids.length ? Math.max(...ids) : 0) + 1;
  const newRel = `<Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>`;
  rels = rels.replace('</Relationships>', `${newRel}</Relationships>`);
  zip.file(relsPath, rels);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function saveDocument(doc, outputPath) {
  const raw = await Packer.toBuffer(doc);
  const buffer = await _normalizeDocx(raw);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return { path: outputPath, size: buffer.length };
}

// ───────────────────────────────────────── Output layout helpers ─────

/**
 * Slugify a PRD title for folder / file naming.
 * "PRD: Real-time Notifications for Dashboard" → "real-time-notifications-for-dashboard"
 */
function slugify(text) {
  return String(text || 'prd')
    .toLowerCase()
    .replace(/^prd[:\s-]+/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'prd';
}

/**
 * Detect a sensible output base directory for the current runtime.
 *
 * Priority:
 *   1. Explicit `opts.baseDir`
 *   2. env var `PRD_OUTPUT_DIR`
 *   3. Cowork: `/sessions/<id>/mnt/outputs` if we're inside a session
 *   4. Claude Code / OpenCode / generic CLI: `<cwd>/prd-output`
 *
 * Always returns `<base>/<slug>/` — each PRD gets its own folder so all
 * sidecar files (summary, open-questions, context, inputs) stay colocated.
 */
function resolveOutputDir(slug, opts = {}) {
  const safeSlug = slugify(slug);
  if (opts.baseDir) return path.join(opts.baseDir, safeSlug);
  if (process.env.PRD_OUTPUT_DIR) return path.join(process.env.PRD_OUTPUT_DIR, safeSlug);

  // Cowork session detection — __dirname will live under /sessions/<id>/...
  const cow = __dirname.match(/^(\/sessions\/[^/]+)/);
  if (cow) {
    const mntOutputs = path.join(cow[1], 'mnt', 'outputs');
    if (fs.existsSync(mntOutputs)) return path.join(mntOutputs, 'prd-output', safeSlug);
  }

  return path.join(process.cwd(), 'prd-output', safeSlug);
}

/**
 * Write the full PRD bundle — .docx plus side files — to a per-slug folder.
 *
 * bundle = {
 *   doc,              // docx Document
 *   slug,             // short PRD slug (e.g. 'realtime-notifications')
 *   title,            // full title, used as .docx filename
 *   summary,          // 5-8 line plain-text summary (becomes summary.md)
 *   openQuestions,    // [{ question, owner, dueDate }] → open-questions.md
 *   context,          // discovery output → context.json
 *   inputs,           // interview answers + metadata → inputs.json
 * }
 *
 * opts.baseDir overrides the auto-detected output root.
 *
 * Returns { dir, files: { docx, summary, openQuestions, context, inputs } }.
 */
async function saveBundle(bundle, opts = {}) {
  const { doc, slug, title } = bundle;
  if (!doc) throw new Error('saveBundle: bundle.doc is required');
  const realSlug = slugify(slug || title);
  const dir = resolveOutputDir(realSlug, opts);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const safeTitle = String(title || realSlug).replace(/[\\/:*?"<>|]/g, '_');
  const docxPath = path.join(dir, `${safeTitle}.docx`);
  const result = { dir, files: {} };

  const save = await saveDocument(doc, docxPath);
  result.files.docx = save.path;

  if (bundle.summary) {
    const p = path.join(dir, 'summary.md');
    fs.writeFileSync(p, String(bundle.summary).trim() + '\n');
    result.files.summary = p;
  }

  if (bundle.openQuestions) {
    const p = path.join(dir, 'open-questions.md');
    const lines = ['# Open Questions', ''];
    const items = Array.isArray(bundle.openQuestions)
      ? bundle.openQuestions
      : String(bundle.openQuestions).split('\n').filter(Boolean).map((q) => ({ question: q }));
    for (const q of items) {
      const owner = q.owner ? `Owner: ${q.owner}` : 'Owner: TBD';
      const due = q.dueDate ? `Due: ${q.dueDate}` : 'Due: TBD';
      lines.push(`- **${q.question || q}** — ${owner} · ${due}`);
    }
    fs.writeFileSync(p, lines.join('\n') + '\n');
    result.files.openQuestions = p;
  }

  if (bundle.context) {
    const p = path.join(dir, 'context.json');
    fs.writeFileSync(p, JSON.stringify(bundle.context, null, 2));
    result.files.context = p;
  }

  if (bundle.inputs) {
    const p = path.join(dir, 'inputs.json');
    const payload = Object.assign(
      { generatedAt: new Date().toISOString() },
      bundle.inputs,
    );
    fs.writeFileSync(p, JSON.stringify(payload, null, 2));
    result.files.inputs = p;
  }

  // Write an index so someone scanning the folder knows what's what.
  const readme = [
    `# ${title || realSlug}`,
    '',
    'Generated by the **prd-generator** skill.',
    '',
    '## Files in this folder',
    '',
    `- \`${path.basename(docxPath)}\` — the final PRD (.docx).`,
    bundle.summary      ? '- `summary.md` — 5-8 line exec summary (paste into Slack / email).' : null,
    bundle.openQuestions? '- `open-questions.md` — unresolved items with owner + due date.'   : null,
    bundle.context      ? '- `context.json` — discovery scan output (repo + docs + stack).'   : null,
    bundle.inputs       ? '- `inputs.json` — interview answers + metadata (for regeneration).' : null,
    '',
    `_Generated ${new Date().toISOString()}_`,
    '',
  ].filter(Boolean).join('\n');
  const readmePath = path.join(dir, 'README.md');
  fs.writeFileSync(readmePath, readme);
  result.files.readme = readmePath;

  return result;
}

// ───────────────────────────────────────── Validators ──────────────
/**
 * Validate PRD number format: NNN/PRD-{ORG}/MONTH-ROMAN/YEAR
 * Returns { valid, message }.
 */
function validatePrdNumber(num) {
  const re = /^(\d{3})\/PRD-([A-Z]{2,6})\/(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\/(\d{4})$/;
  const m = String(num).match(re);
  if (!m) {
    return {
      valid: false,
      message: `PRD number "${num}" does not match NNN/PRD-{ORG}/MONTH-ROMAN/YEAR`,
    };
  }
  return { valid: true, message: 'OK', parts: { seq: m[1], org: m[2], month: m[3], year: m[4] } };
}

// ───────────────────────────────────────── Exports ─────────────────
module.exports = {
  // content helpers
  createCoverPage,
  createSectionHeading,
  createSubHeading,
  createParagraph,
  createBulletList,
  createNumberedList,
  createTable,
  createCodeBlock,
  createCallout,
  createSpacer,
  createPageBreak,
  createDocument,
  saveDocument,
  saveBundle,
  // output layout
  slugify,
  resolveOutputDir,
  // utilities
  formatPrdNumber,
  formatLocaleDate,
  formatIndonesianDate,      // back-compat alias
  validatePrdNumber,
  resolveTheme,
  resolveLocale,
  // constants
  DEFAULT_THEME,
  PRESET_THEMES,
  LOCALES,
  MONTH_ROMAN,
  // legacy alias so dke-prd-builder.js callers can swap imports
  COLORS: DEFAULT_THEME,
};
