/**
 * fetch-inspiration.js — Analyze an external web UI for design-inspiration.
 *
 * Hybrid approach:
 *   1. HTML + CSS scrape (always) — pulls HTML, inlined <style> blocks, and
 *      linked stylesheets; extracts design tokens (colors, fonts, spacing,
 *      radii) ranked by frequency. Zero deps — Node built-in https/http only.
 *   2. Screenshot (optional) — if Playwright is installed (`npm i playwright`
 *      in the work dir), we take a full-page PNG. Otherwise the run emits a
 *      helpful note and carries on with HTML-only analysis.
 *
 * Output: { url, title, tokens: {...}, screenshotPath?, notes: [...] }
 *
 * Usage:
 *   const fi = require('./lib/fetch-inspiration');
 *   const insp = await fi.analyzeUrl('https://stripe.com');
 *   fi.saveInspiration(insp, './inspiration/stripe/');
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

// ───────────────────────────────────────── HTTP(S) fetch helper ─────────

function fetchUrl(targetUrl, { maxBytes = 2 * 1024 * 1024, timeoutMs = 8000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const lib = parsed.protocol === 'http:' ? http : https;
    const opts = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.path || '/',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (compatible; uiux-generator/1.0; +skill)',
        'Accept': 'text/html,text/css,*/*;q=0.5',
      }, headers),
      timeout: timeoutMs,
    };
    const req = lib.request(opts, (res) => {
      // Follow redirects (max 3 hops)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && !opts._hops) {
        res.resume();
        const next = url.resolve(targetUrl, res.headers.location);
        return resolve(fetchUrl(next, { maxBytes, timeoutMs, headers }));
      }
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));

      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > maxBytes) {
          req.destroy();
          return reject(new Error(`Response exceeded ${maxBytes} bytes`));
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        finalUrl: targetUrl,
      }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error(`Timeout after ${timeoutMs}ms`)); });
    req.on('error', reject);
    req.end();
  });
}

// ───────────────────────────────────────── HTML helpers ─────────────────

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractLinkedStylesheets(html, baseUrl) {
  const out = [];
  const re = /<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const hrefMatch = m[0].match(/href=["']([^"']+)["']/i);
    if (hrefMatch) {
      try { out.push(url.resolve(baseUrl, hrefMatch[1])); } catch (_) {}
    }
  }
  return out;
}

function extractInlineStyles(html) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out.join('\n');
}

// ───────────────────────────────────────── Token extraction ─────────────

const COLOR_RE = /#([0-9a-fA-F]{3,8})\b|rgba?\(\s*\d+[^)]*\)|hsla?\(\s*\d+[^)]*\)/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}]+)/gi;
const FONT_SIZE_RE = /font-size\s*:\s*([0-9.]+(?:px|rem|em|pt))/gi;
const PAD_MARGIN_RE = /(?:padding|margin|gap)\s*:\s*([^;}]+)/gi;
const RADIUS_RE = /border-radius\s*:\s*([0-9.]+(?:px|rem|em|%))/gi;
const SHADOW_RE = /box-shadow\s*:\s*([^;}]+)/gi;

function normalizeColor(c) {
  c = c.trim().toLowerCase();
  if (c.startsWith('#')) {
    // Expand 3-char hex to 6-char
    if (c.length === 4) {
      return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    if (c.length === 5) {
      // 4-char (with alpha) — normalize
      return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] + c[4] + c[4];
    }
    return c;
  }
  return c;
}

function countMatches(text, regex) {
  const counts = new Map();
  let m;
  const re = new RegExp(regex.source, regex.flags);
  while ((m = re.exec(text)) !== null) {
    const val = (m[1] || m[0]).trim();
    counts.set(val, (counts.get(val) || 0) + 1);
  }
  return counts;
}

function topByFrequency(counts, n = 10, normalize = (x) => x) {
  const byKey = new Map();
  for (const [k, v] of counts.entries()) {
    const nk = normalize(k);
    byKey.set(nk, (byKey.get(nk) || 0) + v);
  }
  return Array.from(byKey.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

function extractTokens(cssText) {
  const colors = new Map();
  const fonts = new Map();
  const fontSizes = new Map();
  const spacings = new Map();
  const radii = new Map();
  const shadows = new Map();

  // Colors (scan whole text — matches CSS + attribute values)
  let m;
  const colorRe = new RegExp(COLOR_RE.source, 'g');
  while ((m = colorRe.exec(cssText)) !== null) {
    const c = normalizeColor(m[0]);
    // Skip transparent / pure white / pure black (too common to be "brand")
    if (/^rgba?\(0,\s*0,\s*0,\s*0/.test(c)) continue;
    colors.set(c, (colors.get(c) || 0) + 1);
  }

  // Fonts
  const fontRe = new RegExp(FONT_FAMILY_RE.source, 'gi');
  while ((m = fontRe.exec(cssText)) !== null) {
    const first = m[1].split(',')[0].replace(/["']/g, '').trim();
    if (first && first.length < 60) fonts.set(first, (fonts.get(first) || 0) + 1);
  }

  const fsRe = new RegExp(FONT_SIZE_RE.source, 'gi');
  while ((m = fsRe.exec(cssText)) !== null) fontSizes.set(m[1].trim(), (fontSizes.get(m[1].trim()) || 0) + 1);

  const spRe = new RegExp(PAD_MARGIN_RE.source, 'gi');
  while ((m = spRe.exec(cssText)) !== null) {
    // Only count simple values (single number, not multi)
    const val = m[1].trim();
    if (/^[0-9.]+(?:px|rem|em)$/.test(val)) spacings.set(val, (spacings.get(val) || 0) + 1);
  }

  const rdRe = new RegExp(RADIUS_RE.source, 'gi');
  while ((m = rdRe.exec(cssText)) !== null) radii.set(m[1].trim(), (radii.get(m[1].trim()) || 0) + 1);

  const shRe = new RegExp(SHADOW_RE.source, 'gi');
  while ((m = shRe.exec(cssText)) !== null) {
    const s = m[1].trim();
    if (s !== 'none') shadows.set(s, (shadows.get(s) || 0) + 1);
  }

  return {
    colors:    topByFrequency(colors, 12, normalizeColor),
    fonts:     topByFrequency(fonts, 5),
    fontSizes: topByFrequency(fontSizes, 8),
    spacings:  topByFrequency(spacings, 8),
    radii:     topByFrequency(radii, 5),
    shadows:   topByFrequency(shadows, 3),
  };
}

// ───────────────────────────────────────── Palette inference ────────────

function inferPalette(colors) {
  // Pick the top few colors and try to label them.
  // Heuristic: brightest saturated = primary; darkest = text; lightest = bg.
  if (!colors.length) return {};
  const hexes = colors.filter((c) => /^#[0-9a-f]{6,8}$/.test(c.value)).map((c) => c.value);
  if (!hexes.length) return { primary: colors[0].value };

  function lum(hex) {
    const v = hex.slice(1, 7);
    const r = parseInt(v.slice(0, 2), 16) / 255;
    const g = parseInt(v.slice(2, 4), 16) / 255;
    const b = parseInt(v.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function sat(hex) {
    const v = hex.slice(1, 7);
    const r = parseInt(v.slice(0, 2), 16) / 255;
    const g = parseInt(v.slice(2, 4), 16) / 255;
    const b = parseInt(v.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }

  const sorted = hexes.slice();
  const byDark = sorted.slice().sort((a, b) => lum(a) - lum(b));
  const byLight = sorted.slice().sort((a, b) => lum(b) - lum(a));
  const bySat = sorted.slice().sort((a, b) => sat(b) - sat(a));

  return {
    primary: bySat[0] || hexes[0],
    text:    byDark[0] || '#111111',
    bg:      byLight[0] || '#ffffff',
    accent:  bySat[1] || bySat[0] || hexes[0],
  };
}

// ───────────────────────────────────────── Playwright screenshot (optional) ─

async function takeScreenshot(targetUrl, outPath, { fullPage = true, timeoutMs = 15000 } = {}) {
  let playwright;
  try { playwright = require('playwright'); } catch (_) {
    return { skipped: true, reason: 'Playwright not installed. `npm i playwright` in the work dir to enable screenshots.' };
  }
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }});
    const page = await ctx.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: outPath, fullPage });
    return { path: outPath };
  } catch (err) {
    return { skipped: true, reason: String(err && err.message || err) };
  } finally {
    if (browser) await browser.close();
  }
}

// ───────────────────────────────────────── Main ─────────────────────────

async function analyzeUrl(targetUrl, opts = {}) {
  const notes = [];
  const result = { url: targetUrl, generatedAt: new Date().toISOString() };

  // 1) HTML fetch
  let htmlRes;
  try {
    htmlRes = await fetchUrl(targetUrl);
  } catch (err) {
    throw new Error(`Failed to fetch ${targetUrl}: ${err.message}`);
  }
  result.title = extractTitle(htmlRes.body);

  // 2) Collect CSS from inline <style> + linked stylesheets
  const inline = extractInlineStyles(htmlRes.body);
  const stylesheets = extractLinkedStylesheets(htmlRes.body, targetUrl);
  const cssChunks = [inline];
  const maxSheets = opts.maxSheets || 6;
  for (const sheetUrl of stylesheets.slice(0, maxSheets)) {
    try {
      const s = await fetchUrl(sheetUrl, { maxBytes: 1024 * 1024, timeoutMs: 6000 });
      cssChunks.push(s.body);
    } catch (err) {
      notes.push(`Skipped stylesheet ${sheetUrl}: ${err.message}`);
    }
  }
  if (stylesheets.length > maxSheets) {
    notes.push(`Inspected ${maxSheets}/${stylesheets.length} stylesheets (cap).`);
  }
  const css = cssChunks.join('\n');

  // 3) Token extraction
  const tokens = extractTokens(css);
  tokens.palette = inferPalette(tokens.colors);
  result.tokens = tokens;

  // 4) Optional screenshot
  if (opts.screenshotPath) {
    const shot = await takeScreenshot(targetUrl, opts.screenshotPath);
    if (shot.path) result.screenshotPath = shot.path;
    if (shot.skipped) notes.push(`Screenshot skipped: ${shot.reason}`);
  }

  result.notes = notes;
  return result;
}

function saveInspiration(result, dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'inspiration.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  const md = [
    `# Design Inspiration — ${result.title || result.url}`,
    '',
    `**URL**: ${result.url}`,
    `**Analyzed**: ${result.generatedAt}`,
    '',
    '## Inferred palette',
    '',
    Object.entries(result.tokens.palette || {})
      .map(([k, v]) => `- **${k}**: \`${v}\``).join('\n'),
    '',
    '## Top colors (by frequency)',
    '',
    (result.tokens.colors || []).slice(0, 8).map((c) => `- \`${c.value}\` × ${c.count}`).join('\n'),
    '',
    '## Fonts',
    '',
    (result.tokens.fonts || []).map((f) => `- ${f.value} × ${f.count}`).join('\n') || '- _none detected_',
    '',
    '## Spacing scale',
    '',
    (result.tokens.spacings || []).map((s) => `- ${s.value} × ${s.count}`).join('\n') || '- _none detected_',
    '',
    '## Radii',
    '',
    (result.tokens.radii || []).map((r) => `- ${r.value} × ${r.count}`).join('\n') || '- _none detected_',
    '',
    '## Notes',
    '',
    (result.notes || []).map((n) => `- ${n}`).join('\n') || '- _none_',
    '',
  ].join('\n');
  const mdPath = path.join(dir, 'inspiration.md');
  fs.writeFileSync(mdPath, md);

  return { dir, files: { json: jsonPath, md: mdPath, screenshot: result.screenshotPath || null } };
}

module.exports = {
  fetchUrl,
  analyzeUrl,
  saveInspiration,
  extractTokens,
  inferPalette,
  takeScreenshot,
};
