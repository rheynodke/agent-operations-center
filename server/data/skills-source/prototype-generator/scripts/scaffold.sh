#!/bin/bash
# Prototype Generator — scaffold a single-file HTML prototype with multi-screen flow.
#
# Usage:
#   ./scaffold.sh --feature "<slug>" [--brief PATH] [--output DIR]

set -euo pipefail

FEATURE=""
BRIEF=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --feature) FEATURE="$2"; shift 2;;
    --brief)   BRIEF="$2"; shift 2;;
    --output)  OUTPUT="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-prototype-${FEATURE}/"
mkdir -p "$OUTPUT"

# README.md
cat > "${OUTPUT}/README.md" <<EOF
# Prototype: ${FEATURE}

**Date:** ${DATE}
**Brief:** ${BRIEF:-_[fill: link to design brief]_}

## How to use

\`\`\`bash
open index.html
\`\`\`

Or share via static hosting (Vercel drop, Netlify, Cloudflare Pages).

## Screens

| ID | Label | Variants |
|---|---|---|
| cart-default | Cart with items, no discount | mobile + desktop |
| cart-discount-input | Discount field expanded | mobile |
| cart-discount-valid | Code applied | mobile + desktop |
| cart-discount-invalid | Invalid code error | mobile |

> Edit screen list in this README to match actual prototype.

## Flow

\`\`\`
START → cart-default
  ↓ click "Apply Discount"
cart-discount-input
  ↓ submit valid code (e.g. "SAVE10")
cart-discount-valid (END — happy path)

ERROR PATH:
cart-discount-input
  ↓ submit invalid code
cart-discount-invalid
  ↓ click "Try again"
cart-discount-input (loop)
\`\`\`

## Direct screen links

Append \`#screen-id\` to URL to land directly on a screen:

- \`index.html#cart-default\`
- \`index.html#cart-discount-input\`
- \`index.html#cart-discount-valid\`
- \`index.html#cart-discount-invalid\`

## Known limitations / Out-of-scope

- _[fill: e.g. checkout payment step not in this prototype]_
- _[fill: e.g. real API not connected, all client-side mock]_

## Hide debug nav for usability test

Append \`?clean=1\` to URL: \`index.html?clean=1\`
EOF

# index.html (skeleton — agent fills per-screen content)
cat > "${OUTPUT}/index.html" <<'EOF'
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Prototype</title>
  <style>
    :root {
      --bg: #ffffff;
      --fg: #1a1a1a;
      --primary: #8b5cf6;
      --primary-fg: #ffffff;
      --muted: #f5f5f5;
      --muted-fg: #6b7280;
      --border: #e5e7eb;
      --error: #dc2626;
      --success: #059669;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--fg);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }
    .screen {
      display: none;
      min-height: 100vh;
      padding: 16px;
      max-width: 480px;
      margin: 0 auto;
    }
    .screen.active { display: block; }
    button, .btn {
      display: inline-block;
      padding: 12px 16px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--fg);
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.1s;
    }
    button:hover, .btn:hover { background: var(--muted); }
    .btn-primary, button.primary {
      background: var(--primary);
      color: var(--primary-fg);
      border-color: var(--primary);
    }
    .btn-primary:hover, button.primary:hover {
      filter: brightness(1.1);
    }
    input, textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
    }
    .nav-debug {
      position: fixed; bottom: 0; left: 0; right: 0;
      background: rgba(0,0,0,0.85); color: white; padding: 8px 12px;
      font-size: 11px; font-family: monospace; z-index: 999;
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
    }
    .nav-debug strong { color: #d1d5db; }
    .nav-debug a { color: #c4b5fd; text-decoration: none; }
    .nav-debug a.active { color: #fbbf24; }
    .nav-debug a:hover { text-decoration: underline; }
    body.clean .nav-debug { display: none; }

    @media (min-width: 1024px) {
      .screen { max-width: 1200px; padding: 32px; }
    }
  </style>
</head>
<body>

  <!-- Screen: cart-default -->
  <div class="screen active" data-screen-id="cart-default" id="cart-default">
    <h1>Keranjang Anda</h1>
    <p class="muted">_[fill: cart items list]_</p>
    <a href="#cart-discount-input" class="btn">+ Apply Discount Code</a>
    <button class="primary" onclick="alert('Out of scope: payment step')">Checkout</button>
  </div>

  <!-- Screen: cart-discount-input -->
  <div class="screen" data-screen-id="cart-discount-input" id="cart-discount-input">
    <h1>Kode Promo</h1>
    <input type="text" id="promo-code" placeholder="Masukkan kode" autocomplete="off">
    <button class="primary" onclick="submitPromo()">Apply</button>
    <a href="#cart-default" class="btn">Cancel</a>
  </div>

  <!-- Screen: cart-discount-valid -->
  <div class="screen" data-screen-id="cart-discount-valid" id="cart-discount-valid">
    <h1>Kode Diterapkan ✓</h1>
    <p>Discount: -10%</p>
    <a href="#cart-default" class="btn-primary btn">Lanjut Checkout</a>
  </div>

  <!-- Screen: cart-discount-invalid -->
  <div class="screen" data-screen-id="cart-discount-invalid" id="cart-discount-invalid">
    <h1 style="color: var(--error)">Kode Tidak Valid</h1>
    <p>Periksa kembali kode promo Anda.</p>
    <a href="#cart-discount-input" class="btn-primary btn">Coba Lagi</a>
    <a href="#cart-default" class="btn">Kembali</a>
  </div>

  <!-- Debug nav — hidden in clean mode -->
  <nav class="nav-debug" aria-hidden="true">
    <strong>Screens:</strong>
    <a href="#cart-default">default</a>
    <a href="#cart-discount-input">input</a>
    <a href="#cart-discount-valid">valid</a>
    <a href="#cart-discount-invalid">invalid</a>
  </nav>

  <script>
    // Hash routing
    function syncRoute() {
      const id = location.hash.slice(1) || 'cart-default';
      document.querySelectorAll('.screen').forEach(s => {
        s.classList.toggle('active', s.id === id);
      });
      document.querySelectorAll('.nav-debug a').forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === '#' + id);
      });
    }
    window.addEventListener('hashchange', syncRoute);
    syncRoute();

    // Clean mode (?clean=1) — hide debug nav for usability test
    if (new URLSearchParams(location.search).get('clean') === '1') {
      document.body.classList.add('clean');
    }

    // Promo submit handler
    function submitPromo() {
      const code = (document.getElementById('promo-code').value || '').trim().toUpperCase();
      location.hash = code === 'SAVE10' ? '#cart-discount-valid' : '#cart-discount-invalid';
    }
  </script>
</body>
</html>
EOF

echo "Wrote: ${OUTPUT}"
echo "  - README.md"
echo "  - index.html (skeleton — agent fills per-screen content)"
echo ""
echo "Next: open ${OUTPUT}index.html in browser, fill placeholders, smoke test all paths."
