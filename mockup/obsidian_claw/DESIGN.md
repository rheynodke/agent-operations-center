# Design System Document: The Ethereal Observer

## 1. Overview & Creative North Star
**The Creative North Star: "The Digital Curator"**

This design system moves beyond the utility of a standard dashboard to create a high-end, editorial environment for AI monitoring. We are not just displaying data; we are curating intelligence. The aesthetic rejects the "cluttered cockpit" trope of traditional monitoring tools in favor of **Organic Minimalist Layering**.

To break the "template" look, we employ **Intentional Asymmetry**. Instead of a rigid, centered grid, we use expansive white space (black space, in this context) to allow data "hero" moments to breathe. By pairing the utilitarian precision of *Inter* with the architectural elegance of *Manrope*, we create a visual dialogue between data and human insight. The interface should feel like a premium obsidian tablet—cool, deep, and impossibly smooth.

---

### 2. Colors: Tonal Depth & The "No-Line" Rule
The palette is rooted in absolute depth, using the purple accent not as a decoration, but as a "pulse" of activity within the void.

*   **Primary Action:** `#d0bcff` (Primary) / `#5516be` (Primary Container)
*   **Neutral Base:** `#0e0e0e` (Surface/Background)
*   **Secondary/Tertiary:** High-chroma purples and muted grays to provide "glow" rather than "color."

#### The "No-Line" Rule
**Standard 1px solid borders are strictly prohibited for sectioning.** 
Structural boundaries must be defined solely through background color shifts. For instance, a `surface-container-low` (`#131313`) card should sit on a `surface` (`#0e0e0e`) background. The human eye is sophisticated enough to perceive this 2% shift in value; a border is a "crutch" that adds visual noise.

#### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of polished obsidian.
1.  **Level 0 (Base):** `surface` (#0e0e0e) — The infinite canvas.
2.  **Level 1 (Sections):** `surface-container-low` (#131313) — Large layout blocks.
3.  **Level 2 (Interactive Elements):** `surface-container` (#191a1a) — Standard cards and modules.
4.  **Level 3 (Pop-overs):** `surface-container-high` (#1f2020) — Contextual menus and floating elements.

#### The "Glass & Gradient" Rule
To elevate the experience, use **Glassmorphism** for floating sidebars or headers. Apply `surface` with 70% opacity and a `20px` backdrop-blur. 
*   **Signature Textures:** For primary CTAs, use a subtle linear gradient from `primary` (#d0bcff) to `primary_dim` (#c4acff) at a 135-degree angle to give the button a tactile, "lit-from-within" soul.

---

### 3. Typography: Editorial Authority
We use a dual-typeface system to separate **Insight** from **Data**.

*   **Display & Headlines (Manrope):** This is our "Editorial" voice. Use `display-lg` for high-level system status and `headline-sm` for section titles. The wider apertures of Manrope feel modern and authoritative.
*   **Body & Labels (Inter):** This is our "Utility" voice. *Inter* is used for all tabular data, logs, and secondary descriptions. Its high x-height ensures readability at small scales (`label-sm`).
*   **Hierarchy Tip:** Never use `headline` and `title` at the same font weight. If the title is Bold, the headline should be Medium to create a sophisticated, rhythmic contrast.

---

### 4. Elevation & Depth: Tonal Layering
Depth is achieved through the **Layering Principle** rather than drop shadows.

*   **Ambient Shadows:** If a floating effect is required (e.g., a modal), use an ultra-diffused shadow: `box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);`. The shadow must never be "gray"; it should feel like the absence of light beneath a physical object.
*   **The "Ghost Border" Fallback:** If accessibility requirements demand a container edge, use the `outline-variant` (#484848) at **15% opacity**. This creates a "glimmer" on the edge rather than a hard line.
*   **Integrated Glass:** When nesting a card within a container, use `surface-bright` (#2c2c2c) at 5% opacity to "lift" the card naturally.

---

### 5. Components: Refined Primitives

*   **Buttons:**
    *   **Primary:** Rounded `lg` (1rem). No border. Background: `primary_container`. Text: `on_primary_container`.
    *   **Secondary:** Ghost style. No background. `Ghost Border` (15% opacity). Text: `primary`.
*   **Input Fields:**
    *   Use `surface_container_highest` (#252626) for the input track. 
    *   **State:** On focus, transition the background to `surface_bright` and add a 1px `primary` glow (using `box-shadow`, not `border`).
*   **Cards:**
    *   Strictly **No Dividers**. Separate header and body using a `3` (1rem) spacing jump or a subtle shift from `surface-container-low` to `surface-container`.
    *   **Radius:** Always use `md` (0.75rem / 12px) for cards to maintain a soft, approachable feel.
*   **Status Chips:**
    *   AI health indicators should use `tertiary_container` with `on_tertiary_container` text. The colors are muted to prevent the dashboard from looking like a "Christmas tree."
*   **The AI Pulse (Custom Component):**
    *   A small, circular element using `primary` with a CSS pulse animation (`scale` and `opacity`) to indicate live monitoring activity.

---

### 6. Do’s and Don’ts

#### Do:
*   **Embrace Spacing:** Use the `8` (2.75rem) and `10` (3.5rem) spacing tokens for top-level margins. Space is a luxury; use it.
*   **Type Contrast:** Use `on_surface_variant` (#acabaa) for secondary labels to create a clear visual hierarchy against `on_surface` (#e7e5e4) headers.
*   **Layer Depth:** Use `surface-container-lowest` (#000000) for deep-set elements like code blocks or log streams to create a "well" effect.

#### Don’t:
*   **Don't use pure white (#FFFFFF):** It is too jarring. Use `on_surface` (#e7e5e4) for maximum readability without eye strain.
*   **Don't use 1px Dividers:** They fragment the "Digital Curator" aesthetic. Use vertical white space instead.
*   **Don't use harsh corners:** Avoid the `none` or `sm` roundedness tokens for main UI elements. We want the system to feel engineered, but organic.

---

### 7. Implementation Note for Junior Designers
When in doubt, **subtract**. If a layout feels cluttered, don't add a border to separate elements—increase the padding between them using the `6` (2rem) spacing token. If an element doesn't stand out, don't make it brighter—make the background behind it deeper. Depth in this system is a journey into the dark, not a struggle for light.