# Design Research — external inspiration playbook

This playbook is for **research mode**: fetching external sites and turning them into a structured brief *before* drawing a single box.

## When to use

- New product domain you don't have a gut feel for.
- Redesign where the team keeps arguing about look-and-feel with no reference point.
- Competitive catch-up — "what does the market expect here?"
- Picking a palette / typography direction and wanting evidence, not taste.

Skip it when the team already has a strong visual direction or when the work is clearly "just a small tweak to the existing screen".

## How the tool works

`scripts/inspire.js` fetches each URL, pulls inline `<style>` + up to 6 linked stylesheets (capped at a few hundred KB each), and extracts:

- **Colors** — hex + rgb/rgba + hsl/hsla.
- **Fonts** — `font-family` declarations, deduped.
- **Font sizes** — `font-size` with units.
- **Spacings** — `padding`/`margin`/`gap` values.
- **Radii** — `border-radius` values.
- **Shadows** — `box-shadow` declarations.

It then infers a 4-role palette (primary / accent / background / text) using luminance + saturation heuristics. Optionally takes a Playwright screenshot.

**What it does _not_ do:** follow JS-hydrated content (no headless browser by default), respect paywalls, bypass Cloudflare. The token extraction is CSS-layer only.

## Choosing URLs

Aim for **3–5 URLs** that together span:

1. **Category leader** (e.g. Linear for project mgmt, Stripe for finance). They define what "premium" looks like in the space.
2. **Direct competitor** (the one your team is actually benchmarked against).
3. **Adjacent category** (someone solving a different problem with similar UI primitives — often the most interesting cross-pollination).
4. **In-house precedent** (an existing page of your own product, to anchor against). Use the local serve path if you already scanned it.
5. **The bold outlier** (something visually unusual — reminds the team that the "safe" direction is still a choice, not a default).

Avoid: 10+ URLs of the same category. Diminishing returns past 5, and the comparison table gets unreadable.

## Writing the brief from the output

The raw `inspiration.json` is dense. The deliverable for humans should be a short markdown file that answers four questions:

### 1. Where do the palettes agree?

Look at the inferred primary colors across all URLs. Do they cluster? (Most SaaS clusters in the `#2e6 … #55f` blue-purple band.) Name the cluster and call out any outliers.

### 2. What's the type personality?

List the top 1–2 font families from each URL. Group them:
- *Humanist sans* (Inter, Söhne, Graphik): neutral, widely used.
- *Grotesk* (Haas Grotesk, Neue Haas, GT America): editorial edge.
- *Geometric* (Circular, Gilroy): friendly, consumer.
- *Mono* (JetBrains Mono, IBM Plex Mono): developer tools.

The answer to "what's your type personality?" usually emerges from the majority + the one deliberate outlier.

### 3. What's the density strategy?

Look at the most common spacing values (4 / 8 / 12 / 16 / 24 px are typical). A product leaning into values like `6`, `14`, `22` is deliberately *dense* — good for pro tools, overwhelming for consumer apps.

Pick a target density tier: **Comfortable** (base spacing 16), **Compact** (base 12), **Dense** (base 8).

### 4. What single decision is the brief asking you to make?

End the brief with one question, not five. Examples:
- "Do we lean *editorial* (Grotesk + white space) or *tool* (Inter + dense grid)?"
- "Neon accent or muted accent against the dark base?"
- "Top nav or side nav?"

Research exists to make *one* choice crisper. If the brief ends with five open questions, it didn't do its job.

## Output format

Save `brief.md` in the same folder as the inspiration bundles:

```
uiux-output/
└─ design-research/
   ├─ brief.md                 ← the synthesis
   ├─ linear-app/
   │  ├─ inspiration.json
   │  ├─ inspiration.md
   │  └─ screenshot.png
   ├─ stripe-com/
   └─ …
```

The `brief.md` should be ≤ 1 page:
- 2-sentence summary.
- 4 sections answering the questions above.
- A final recommendation in 1–2 bullets.

Reviewers won't read more than that. Shorter is more useful.

## When the fetch fails

The web isn't consistent. Pages return 403, bot-block, redirect into login walls, or serve pure JS shells with no CSS.

Good fallbacks:
- Log the failure, skip to the next URL. Don't abort the batch.
- Offer the user the option to pass a **screenshot URL** (e.g. from a design gallery like Mobbin, Dribbble, or a Dribbble shot) in place of the live URL. The tool accepts any URL — it just needs CSS to extract tokens.
- If the user has a Figma file or offline screenshot, skip the fetch and go straight to manual palette extraction in the brief.

Never fabricate tokens. If extraction fails, say so.
