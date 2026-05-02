# Output Format — HTML Prototype Bundle

## Output structure

```
outputs/{date}-prototype-{feature}/
├── index.html          # Single self-contained, multi-screen entry
├── README.md           # Screen list, flow, direct links, limitations
├── screens/            # OPTIONAL: per-screen partial HTML if split
└── assets/             # OPTIONAL: images (prefer base64 inline)
```

## index.html requirements

- Single self-contained file (CSS inline, no external CDN)
- System font stack only (`system-ui, -apple-system, ...`)
- Multi-screen via hash routing (`#screen-id`)
- Each screen: `<div class="screen" data-screen-id="..." id="...">`
- Default mobile-first responsive; desktop breakpoint at ≥1024px
- Debug nav at bottom-fixed (hide via `body.clean` class + `?clean=1` URL flag)
- Hash-routing JS: small inline `<script>` updating screen visibility on `hashchange`

## README.md requirements

1. Title + Date + Brief link
2. How to use (open index.html or share link)
3. Screen list table — id + label + viewport variants
4. Flow diagram (text-form, no image required)
5. Direct screen links (for testers to land directly)
6. Known limitations / Out-of-scope
7. Clean mode instruction (hide debug nav)

## Hash-routing convention

- `index.html` → default screen (first in list)
- `index.html#screen-id` → specific screen
- `index.html?clean=1` → hide debug nav
- `index.html?clean=1#screen-id` → both

## Screen ID convention

- `kebab-case`
- Format: `{flow}-{state}` e.g. `cart-default`, `cart-discount-input`, `signup-step-2-validation`
- ≤ 32 chars

## Anti-pattern

- ❌ External CDN dependency
- ❌ Build step required (no React, Vue, etc.)
- ❌ Dead-end click target
- ❌ Lorem ipsum di critical content
- ❌ Missing `data-screen-id` attribute
- ❌ Mobile-only or desktop-only — both required
- ❌ Skip README.md — testers gak punya context
- ❌ Production-grade quality — prototype is for validation, not ship
