'use strict';
/**
 * Bundled content for browser-harness-odoo (Layer 2).
 *
 * Files marked `protect: true` are AOC-owned (overwritten on update).
 * Files marked `protect: false` are extension points — once the user/agent
 * touches them, the installer leaves them alone.
 */

const SKILL_MD = `---
name: browser-harness-odoo
description: Built-in Layer 2 skill — Odoo-specific helpers built on browser-harness-core. Login via assigned connection, navigate modules, capture UAT-quality screenshots, generate user manuals. Inherits all Layer 1 capabilities.
type: built-in
layer: 2
inherits: browser-harness-core
---

# Browser Harness — Odoo (Layer 2)

This skill extends \`browser-harness-core\` with Odoo-specific helpers:
- **Auto-login** using an assigned AOC connection (no hardcoded credentials).
- **Module navigation** that handles Odoo's lazy-loaded UI.
- **Form helpers** for create / edit / save flows.
- **UAT-grade screenshot capture** — full-page, viewport-controlled.
- **Markdown formatters** for UAT scripts and User Manuals (Google Docs ready).

## Quickstart

\`\`\`bash
# 1. Acquire a Chrome slot from the pool (auto-boots if needed).
eval "$(browser-harness-acquire.sh --export)"

# 2. Run a domain skill scenario. Connection name comes from your assigned
#    connections (see check_connections.sh).
python3 ~/.openclaw/skills/browser-harness-odoo/domain-skills/sales/create_quotation.py \\
  --connection "DKE 17 Staging" \\
  --output ./outputs/sales-uat

# 3. Release the slot.
browser-harness-release.sh
\`\`\`

The scenario will produce:
- \`./outputs/sales-uat/screenshots/step_01_login.png\`, \`step_02_open_sales.png\`, ...
- \`./outputs/sales-uat/uat-script.md\` — Markdown UAT table with screenshot refs
- \`./outputs/sales-uat/user-manual.md\` — narrative user manual with inline screenshots

You can publish either file to Google Docs via the \`md-to-gdocs-multitab\`
or \`md-to-docx\` skills already present in your AOC.

## Library API

All helpers live under \`lib/\`. Import from your script:

\`\`\`python
import sys, os
sys.path.insert(0, os.path.expanduser("~/.openclaw/skills/browser-harness-odoo/lib"))

from odoo_login import login, get_credentials_from_aoc
from odoo_nav   import goto_module, open_menu
from odoo_form  import fill_field, click, save_record
from odoo_uat   import StepRecorder, write_uat_markdown, write_user_manual
\`\`\`

### \`odoo_login\`

| Function | Purpose |
| --- | --- |
| \`get_credentials_from_aoc(connection_name)\` | Calls AOC API with the agent's service token, returns \`{url, username, password, db?}\`. Credentials never touch disk. |
| \`login(page, url, username, password, db=None)\` | Navigate \`/web/login\`, fill form, submit, verify navbar appears. Raises on failure. |

### \`odoo_nav\`

| Function | Purpose |
| --- | --- |
| \`goto_module(page, base_url, module)\` | Direct-URL navigation (\`/odoo/<module>\`). Waits for action manager. |
| \`open_menu(page, menu_name)\` | Click sidebar menu by visible text. |

### \`odoo_form\`

| Function | Purpose |
| --- | --- |
| \`fill_field(page, name, value)\` | Fills an Odoo form field by \`name\` attribute (supports text, many2one, selection). |
| \`click(page, selector_or_text)\` | Click by CSS selector OR by visible button text. |
| \`save_record(page)\` | Click Save (cloud icon) and wait for record to be saved. |

### \`odoo_uat\`

| Function | Purpose |
| --- | --- |
| \`StepRecorder(output_dir)\` | Context manager that captures screenshots + step metadata. \`recorder.step(action, expected).screenshot(page)\`. |
| \`write_uat_markdown(steps, output_path, title)\` | Renders a UAT script as Markdown table. Image refs as relative paths. |
| \`write_user_manual(steps, output_path, title)\` | Renders a narrative user manual with inline screenshots. |

## Dependencies

Layer 2 helpers use **Playwright** for CDP control (cleaner than raw CDP for
Odoo's async UI). Install once:

\`\`\`bash
pip3 install playwright
\`\`\`

Playwright connects to the existing Chrome via \`connect_over_cdp\` — we do
NOT install a separate browser binary.

## Connecting to the acquired browser

\`\`\`python
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(os.environ["AOC_BROWSER_WS_URL"])
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    # ... use page ...
    # Don't close the browser — AOC owns its lifecycle.
\`\`\`

## Adding a new module

Create a script under \`domain-skills/<module>/\`:

\`\`\`
domain-skills/
  sales/
    create_quotation.py     # AOC-bundled reference
  purchase/                 # ← you add this
    create_po.py
\`\`\`

Reuse \`StepRecorder\` to keep output formatting consistent.

## Don'ts

- Don't hardcode credentials. Always go through \`get_credentials_from_aoc\`.
- Don't \`browser.close()\` — AOC's pool owns the Chrome lifecycle.
- Don't skip \`browser-harness-release.sh\` after your scenario.
`;

const ODOO_LOGIN_PY = `"""odoo_login — Login flow + AOC credential fetch.

Credentials are fetched from AOC server via the agent's service token. The
plaintext password is held in memory only for the duration of the login form
fill; never written to disk by this module.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def get_credentials_from_aoc(connection_name):
    """Fetch decrypted credentials for an assigned connection.

    Calls GET /api/agent/connections/by-name/<name>/credentials with the
    agent's service token. Server checks ownership/assignment. Returns a
    dict with at least { url, username, password }; \`db\` is included for
    Odoo connections.
    """
    aoc_url = os.environ.get("AOC_URL")
    aoc_token = os.environ.get("AOC_TOKEN")
    agent_id = os.environ.get("AOC_AGENT_ID")
    if not (aoc_url and aoc_token and agent_id):
        raise RuntimeError("AOC_URL / AOC_TOKEN / AOC_AGENT_ID must be set (run from agent workspace)")

    url = f"{aoc_url.rstrip('/')}/api/agent/connections/by-name/{urllib.parse.quote(connection_name)}/credentials?agentId={urllib.parse.quote(agent_id)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {aoc_token}"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Credential fetch failed (HTTP {e.code}): {body}")
    return data


def login(page, url, username, password, db=None, timeout_ms=15000):
    """Fill /web/login and verify the main navbar appears.

    Works against Odoo 14 — 17 standard login template. If your DKE fork
    has custom login fields, override the selector constants below.
    """
    base = url.rstrip("/")
    target = f"{base}/web/login"
    if db:
        target += f"?db={db}"
    page.goto(target, wait_until="domcontentloaded")

    page.fill('input[name="login"]', username)
    page.fill('input[name="password"]', password)
    if db:
        # Multi-db Odoo shows a db selector
        try:
            page.select_option('select[name="db"]', db)
        except Exception:
            pass
    page.click('button[type="submit"]')

    # Verify success: top navbar appears (works for Odoo 14+ desktop UI).
    page.wait_for_selector('header.o_main_navbar, .o_main_navbar', timeout=timeout_ms)
    return True


def assert_logged_in(page, timeout_ms=3000):
    """Raise if we don't see the Odoo main navbar (i.e. not logged in)."""
    page.wait_for_selector('header.o_main_navbar, .o_main_navbar', timeout=timeout_ms)
`;

const ODOO_NAV_PY = `"""odoo_nav — Navigate Odoo modules and menus."""
import urllib.parse


def goto_module(page, base_url, module, timeout_ms=15000):
    """Direct-URL nav to /odoo/<module>. Works for Odoo 17+. For older
    versions, fall back to /web#action=...&model=...&view_type=list."""
    base = base_url.rstrip("/")
    page.goto(f"{base}/odoo/{module}", wait_until="domcontentloaded")
    page.wait_for_selector('.o_action_manager', timeout=timeout_ms)


def open_menu(page, label, timeout_ms=8000):
    """Click a sidebar menu item by visible label. Tries common Odoo menu
    selectors before falling back to text-based locator."""
    selectors = [
        f'.o_navbar_apps_menu :text-is("{label}")',
        f'.o_menu_sections :text-is("{label}")',
        f'a.dropdown-item:has-text("{label}")',
    ]
    for s in selectors:
        try:
            page.click(s, timeout=timeout_ms / len(selectors))
            return True
        except Exception:
            continue
    page.get_by_text(label, exact=True).first.click(timeout=timeout_ms)
    return True


def wait_for_action_loaded(page, timeout_ms=10000):
    """Wait for the Odoo action manager to settle after a navigation."""
    page.wait_for_selector('.o_action_manager:not(.o_loading)', timeout=timeout_ms)
    page.wait_for_load_state('networkidle', timeout=timeout_ms)
`;

const ODOO_FORM_PY = `"""odoo_form — Form field manipulation for Odoo views."""


def fill_field(page, name, value, timeout_ms=5000):
    """Fill an Odoo form field by its \`name\` attribute.

    Handles text, many2one (selects first match), selection (dropdown),
    and date inputs. For special widgets, drop down to page.fill() with
    a custom selector.
    """
    sel = f'div[name="{name}"]'
    page.wait_for_selector(sel, timeout=timeout_ms)
    field = page.locator(sel).first

    # many2one combobox
    m2o_input = field.locator('input.o-autocomplete--input')
    if m2o_input.count() > 0:
        m2o_input.fill(str(value))
        page.wait_for_selector('.o-autocomplete--dropdown li', timeout=timeout_ms)
        page.click('.o-autocomplete--dropdown li:first-child')
        return

    # selection
    select = field.locator('select')
    if select.count() > 0:
        select.select_option(str(value))
        return

    # text / number / date / etc.
    input_ = field.locator('input, textarea').first
    input_.fill(str(value))


def click(page, selector_or_text, timeout_ms=5000):
    """Click by CSS selector OR by visible button text (fallback)."""
    try:
        page.click(selector_or_text, timeout=timeout_ms / 2)
        return
    except Exception:
        pass
    page.get_by_role("button", name=selector_or_text).first.click(timeout=timeout_ms)


def save_record(page, timeout_ms=8000):
    """Click the Save button (cloud icon in Odoo 17, 'Save' text earlier).

    Verifies the record transitions out of edit mode by waiting for the
    breadcrumb to be non-dirty.
    """
    selectors = [
        'button.o_form_button_save',          # Odoo 14-16
        'button[data-tooltip="Save manually"]',
        '.o_form_status_indicator_buttons button.fa-cloud-upload',  # Odoo 17 cloud icon
        'button:has-text("Save")',
    ]
    for s in selectors:
        loc = page.locator(s).first
        if loc.count() > 0:
            loc.click(timeout=timeout_ms / 2)
            page.wait_for_load_state('networkidle', timeout=timeout_ms)
            return
    raise RuntimeError("Could not find Odoo Save button — selectors may be stale")


def discard_record(page):
    """Discard pending changes (Odoo discard button)."""
    for s in ['button.o_form_button_cancel', 'button:has-text("Discard")']:
        loc = page.locator(s).first
        if loc.count() > 0:
            loc.click()
            return
`;

const ODOO_UAT_PY = `"""odoo_uat — Capture UAT/manual screenshots and render Markdown.

Screenshots can be annotated with a red highlight box around the focus
element, a "Step N" badge, and an optional caption — temporarily injected
as a DOM overlay before capture, then removed. This produces docs that
clearly show *where* each action happens.
"""
import os
import re
import json
from datetime import datetime
from pathlib import Path


def slugify(text, max_len=40):
    s = re.sub(r'[^a-zA-Z0-9]+', '_', text.lower()).strip('_')
    return s[:max_len] or "step"


# JS injected before screenshot to draw an annotation overlay. Self-contained
# (no external CSS), high z-index, removed by _OVERLAY_REMOVE_JS afterwards.
_OVERLAY_INJECT_JS = """
(args) => {
  const { selector, step, caption, captionPlacement } = args;
  // Remove any leftover overlay from a previous step
  document.querySelectorAll('[data-aoc-annot]').forEach(n => n.remove());

  let target = null;
  try { target = selector ? document.querySelector(selector) : null; } catch (e) {}
  if (selector && !target) {
    // Selector didn't match — still draw the step badge, just float it top-left
    const ghost = document.createElement('div');
    ghost.dataset.aocAnnot = 'badge';
    ghost.style.cssText = \`
      position:fixed; top:16px; left:16px; z-index:2147483647;
      background:#ef4444; color:white;
      font:600 14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
      padding:6px 12px; border-radius:8px;
      box-shadow:0 4px 12px rgba(0,0,0,0.25);
    \`;
    ghost.textContent = caption ? \`Step \${step}: \${caption}\` : \`Step \${step}\`;
    document.body.appendChild(ghost);
    return { matched: false };
  }
  if (!target) {
    // No selector at all → just floating step badge
    const ghost = document.createElement('div');
    ghost.dataset.aocAnnot = 'badge';
    ghost.style.cssText = \`
      position:fixed; top:16px; left:16px; z-index:2147483647;
      background:#ef4444; color:white;
      font:600 14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
      padding:6px 12px; border-radius:8px;
      box-shadow:0 4px 12px rgba(0,0,0,0.25);
    \`;
    ghost.textContent = caption ? \`Step \${step}: \${caption}\` : \`Step \${step}\`;
    document.body.appendChild(ghost);
    return { matched: false };
  }

  // Scroll target into a sensible viewport position
  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

  const r = target.getBoundingClientRect();
  // Use position:fixed so coords are viewport-relative — survives scrolling
  // already done above.
  const box = document.createElement('div');
  box.dataset.aocAnnot = 'box';
  box.style.cssText = \`
    position:fixed; left:\${r.left - 6}px; top:\${r.top - 6}px;
    width:\${r.width + 12}px; height:\${r.height + 12}px;
    border:3px solid #ef4444; border-radius:8px;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.18), 0 0 16px rgba(239,68,68,0.4);
    pointer-events:none; z-index:2147483646;
  \`;
  document.body.appendChild(box);

  // Step badge — anchored to top-left of the highlight box
  const badge = document.createElement('div');
  badge.dataset.aocAnnot = 'badge';
  const badgeTop = Math.max(8, r.top - 32);
  const badgeLeft = Math.max(8, r.left - 6);
  badge.style.cssText = \`
    position:fixed; left:\${badgeLeft}px; top:\${badgeTop}px;
    background:#ef4444; color:white;
    font:700 13px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    padding:4px 10px; border-radius:14px;
    box-shadow:0 2px 6px rgba(0,0,0,0.25);
    z-index:2147483647; white-space:nowrap;
  \`;
  badge.textContent = \`Step \${step}\`;
  document.body.appendChild(badge);

  // Caption — try to place to the right; flip to left if it'd overflow
  if (caption) {
    const cap = document.createElement('div');
    cap.dataset.aocAnnot = 'caption';
    const desiredLeft = r.right + 14;
    const placeRight = desiredLeft + 320 < window.innerWidth;
    cap.style.cssText = \`
      position:fixed;
      \${placeRight ? \`left:\${desiredLeft}px\` : \`right:\${window.innerWidth - r.left + 14}px\`};
      top:\${Math.max(8, r.top)}px;
      max-width:300px;
      background:#fef2f2; color:#7f1d1d;
      font:500 13px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
      padding:8px 12px; border-radius:6px;
      border:1px solid #fecaca;
      box-shadow:0 4px 10px rgba(0,0,0,0.12);
      z-index:2147483647;
      line-height:1.4;
    \`;
    cap.textContent = caption;
    document.body.appendChild(cap);
  }

  return { matched: true, x: r.left, y: r.top, w: r.width, h: r.height };
}
"""

_OVERLAY_REMOVE_JS = """
() => { document.querySelectorAll('[data-aoc-annot]').forEach(n => n.remove()); }
"""


class StepRecorder:
    """Records UAT steps with annotated screenshots.

    Typical usage::

        rec = StepRecorder("./outputs/sales-uat")
        rec.step("Click New", expected="Form opens").screenshot(
            page,
            target='button.o_list_button_add',
            caption='Click the "New" button'
        )
        rec.write_uat("Sales — Create Quotation")
        rec.write_manual("Creating a Quotation in Odoo Sales")

    The \`target\` selector is highlighted with a red box and a step badge.
    \`caption\` is rendered as a callout near the box. Both are temporarily
    injected DOM nodes — removed after capture.
    """

    def __init__(self, output_dir):
        self.output_dir = Path(output_dir).expanduser().resolve()
        self.screenshots_dir = self.output_dir / "screenshots"
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self.steps = []
        self._step_no = 0

    def step(self, action, expected="", note=""):
        self._step_no += 1
        self.steps.append({
            "step": self._step_no,
            "action": action,
            "expected": expected,
            "note": note,
            "screenshot": None,
            "target": None,
            "caption": None,
            "ts": datetime.utcnow().isoformat() + "Z",
        })
        return self

    def screenshot(self, page, target=None, caption=None,
                   full_page=False, settle_ms=400, viewport=None):
        """Capture an (optionally annotated) screenshot for the current step.

        Args:
            page:        Playwright Page object.
            target:      CSS selector of the element to highlight. Optional.
            caption:     Callout text shown next to the highlight. Optional.
            full_page:   If True, capture entire scrollable page (less ideal
                         when you want to focus on an area). Default False
                         (viewport-only) for cleaner UAT visuals.
            settle_ms:   Wait this many ms after injecting the overlay so the
                         browser paints it before the screenshot.
            viewport:    Optional dict {"width", "height"} to set viewport
                         before capture (per-step override).

        Returns the path to the saved screenshot.
        """
        if not self.steps:
            raise RuntimeError("Call .step() before .screenshot()")
        s = self.steps[-1]

        if viewport:
            try: page.set_viewport_size(viewport)
            except Exception: pass

        # Wait for any in-flight Odoo XHR to settle (Odoo lazy-loads widgets,
        # form data, list rows). Best-effort — short timeout.
        try: page.wait_for_load_state('networkidle', timeout=3000)
        except Exception: pass

        injected = False
        if target or caption:
            try:
                page.evaluate(_OVERLAY_INJECT_JS, {
                    "selector": target,
                    "step": s["step"],
                    "caption": caption or s["action"],
                    "captionPlacement": "auto",
                })
                injected = True
                # Give the browser a tick to paint the overlay
                page.wait_for_timeout(settle_ms)
            except Exception as e:
                s["note"] = (s.get("note") or "") + f" [annotation skipped: {e}]"

        fname = f"step_{s['step']:02d}_{slugify(s['action'])}.png"
        out = self.screenshots_dir / fname
        try:
            page.screenshot(path=str(out), full_page=full_page)
        finally:
            if injected:
                try: page.evaluate(_OVERLAY_REMOVE_JS)
                except Exception: pass

        s["screenshot"] = f"screenshots/{fname}"
        s["target"] = target
        s["caption"] = caption
        return out

    def write_uat(self, title, output_filename="uat-script.md"):
        path = self.output_dir / output_filename
        path.write_text(_render_uat_md(title, self.steps))
        return path

    def write_manual(self, title, output_filename="user-manual.md"):
        path = self.output_dir / output_filename
        path.write_text(_render_manual_md(title, self.steps))
        return path

    def write_json(self, output_filename="steps.json"):
        path = self.output_dir / output_filename
        path.write_text(json.dumps(self.steps, indent=2))
        return path


def _render_uat_md(title, steps):
    out = [f"# {title}", "", f"_Generated by AOC browser-harness on {datetime.utcnow().isoformat()}Z_", ""]
    out.append("| Step | Action | Expected Result | Screenshot |")
    out.append("|------|--------|------------------|------------|")
    for s in steps:
        ss = s.get("screenshot") or ""
        ss_md = f"![]({ss})" if ss else "—"
        action = s["action"].replace("|", "\\\\|")
        expected = (s.get("expected") or "").replace("|", "\\\\|")
        out.append(f"| {s['step']} | {action} | {expected} | {ss_md} |")
    out.append("")
    return "\\n".join(out)


def _render_manual_md(title, steps):
    out = [f"# {title}", ""]
    out.append(f"_Step-by-step user manual — generated by AOC browser-harness on {datetime.utcnow().isoformat()}Z._")
    out.append("")
    for s in steps:
        out.append(f"## Step {s['step']}: {s['action']}")
        out.append("")
        if s.get("expected"):
            out.append(f"**Expected:** {s['expected']}")
            out.append("")
        if s.get("note"):
            out.append(s["note"])
            out.append("")
        if s.get("screenshot"):
            out.append(f"![Step {s['step']} screenshot]({s['screenshot']})")
            out.append("")
    return "\\n".join(out)


def write_uat_markdown(steps, output_path, title):
    path = Path(output_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_render_uat_md(title, steps))
    return path


def write_user_manual(steps, output_path, title):
    path = Path(output_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_render_manual_md(title, steps))
    return path
`;

const SALES_CREATE_QUOTATION_PY = `"""Sales — Create Quotation (reference scenario).

This is a working, agent-runnable scenario. Use it as a template when
authoring new domain skills. It demonstrates:
  - acquiring credentials via AOC connection
  - login + module nav
  - form filling
  - per-step screenshot capture
  - UAT + user manual generation

Run:
    python3 create_quotation.py --connection "DKE 17 Staging" --output ./outputs/sales-uat

Requires Playwright:
    pip3 install playwright
"""
import argparse
import os
import sys
from pathlib import Path

# Make Layer 2 lib importable when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

from playwright.sync_api import sync_playwright

from odoo_login import get_credentials_from_aoc, login, assert_logged_in
from odoo_nav   import goto_module, wait_for_action_loaded
from odoo_form  import fill_field, click, save_record
from odoo_uat   import StepRecorder


def run(connection_name, output_dir, customer="YourCo Test", product="Service"):
    creds = get_credentials_from_aoc(connection_name)
    base_url = creds["url"].rstrip("/")

    ws_url = os.environ.get("AOC_BROWSER_WS_URL")
    if not ws_url:
        raise RuntimeError("AOC_BROWSER_WS_URL not set — run browser-harness-acquire.sh first")

    rec = StepRecorder(output_dir)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(ws_url)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context(viewport={"width": 1920, "height": 1080})
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_viewport_size({"width": 1920, "height": 1080})

        # Step 1 — Login
        # Capture the login form BEFORE submitting, with the username field
        # highlighted to show "where you enter credentials".
        rec.step("Login to Odoo", expected="Odoo dashboard appears after submitting credentials")
        page.goto(f"{base_url.rstrip('/')}/web/login", wait_until="domcontentloaded")
        page.fill('input[name="login"]', creds["username"])
        page.fill('input[name="password"]', creds["password"])
        rec.screenshot(
            page,
            target='button[type="submit"]',
            caption='Click "Log in" after entering email and password',
        )
        page.click('button[type="submit"]')
        page.wait_for_selector('header.o_main_navbar, .o_main_navbar', timeout=15000)

        # Step 2 — Navigate to Sales
        rec.step("Open the Sales module", expected="Sales dashboard / Quotations list appears")
        goto_module(page, base_url, "sales")
        wait_for_action_loaded(page)
        rec.screenshot(
            page,
            target='.o_breadcrumb, .breadcrumb',
            caption='You are now in the Sales module',
        )

        # Step 3 — Click New
        rec.step("Click 'New' to start a quotation", expected="An empty quotation form opens in edit mode")
        new_btn_selector = 'button.o_list_button_add, .o_cp_action_menus button:has-text("New"), button.btn-primary:has-text("New")'
        rec.screenshot(
            page,
            target=new_btn_selector,
            caption='Click the "New" button',
        )
        click(page, new_btn_selector)
        page.wait_for_selector('div[name="partner_id"]', timeout=10000)

        # Step 4 — Set customer
        rec.step(f"Set Customer to '{customer}'", expected=f"Customer field shows '{customer}'")
        try:
            fill_field(page, "partner_id", customer)
        except Exception as e:
            rec.steps[-1]["note"] = f"Customer fill failed gracefully: {e}. Continue with default."
        rec.screenshot(
            page,
            target='div[name="partner_id"]',
            caption=f'Customer set to "{customer}"',
        )

        # Step 5 — Add a line
        rec.step(f"Add an order line for '{product}'", expected="Line appears with the chosen product")
        try:
            click(page, '.o_field_x2many_list_row_add a, a:has-text("Add a line")')
            fill_field(page, "product_id", product)
            page.keyboard.press("Tab")
            page.wait_for_load_state('networkidle', timeout=3000)
        except Exception as e:
            rec.steps[-1]["note"] = f"Add-line skipped: {e}"
        rec.screenshot(
            page,
            target='.o_field_x2many_list_row_add, .o_form_view .o_field_x2many table tbody tr:last-child',
            caption=f'Order line for "{product}" added',
        )

        # Step 6 — Save
        rec.step("Save the quotation", expected="Quotation moves out of edit mode; quotation number appears in breadcrumb")
        save_btn_selector = 'button.o_form_button_save, button[data-tooltip="Save manually"], .o_form_status_indicator_buttons button.fa-cloud-upload'
        rec.screenshot(
            page,
            target=save_btn_selector,
            caption='Click Save (cloud icon in Odoo 17, "Save" text in earlier versions)',
        )
        try:
            save_record(page)
        except Exception as e:
            rec.steps[-1]["note"] = f"Save raised: {e}"

        # Step 7 — Confirm saved record
        rec.step("Verify the quotation is saved", expected="Breadcrumb shows the quotation number; form is read-only")
        rec.screenshot(
            page,
            target='.o_breadcrumb, .breadcrumb',
            caption='Quotation saved — note the new reference number',
        )

        assert_logged_in(page)

    rec.write_uat("Sales — Create Quotation")
    rec.write_manual("Creating a Quotation in Odoo Sales")
    rec.write_json()
    print(f"[OK] {len(rec.steps)} steps captured → {rec.output_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--connection", required=True, help='AOC connection name, e.g. "DKE 17 Staging"')
    parser.add_argument("--output", required=True, help="Output directory (will be created)")
    parser.add_argument("--customer", default="YourCo Test")
    parser.add_argument("--product", default="Service")
    args = parser.parse_args()
    run(args.connection, args.output, customer=args.customer, product=args.product)
`;

const UAT_TEMPLATE_MD = `# {title}

_Generated by AOC browser-harness on {timestamp}_

| Step | Action | Expected Result | Screenshot |
|------|--------|------------------|------------|
| 1 | … | … | ![](screenshots/step_01_…) |
`;

const MANUAL_TEMPLATE_MD = `# {title}

_Step-by-step user manual generated by AOC browser-harness on {timestamp}._

## Step 1: …

**Expected:** …

![Step 1](screenshots/step_01_…)
`;

const DOMAIN_SKILLS_README = `# domain-skills/

Each subfolder is a self-contained Odoo scenario. Bundled scenarios:

- \`sales/create_quotation.py\` — reference scenario (Sales: New Quotation)

To add your own (e.g. Purchase, Inventory, Manufacturing, HR):

1. Create \`<module>/<scenario>.py\` following the pattern in
   \`sales/create_quotation.py\`.
2. Use the helpers in \`../lib/\` (\`odoo_login\`, \`odoo_nav\`, \`odoo_form\`,
   \`odoo_uat\`).
3. Pass \`--connection\` (your AOC connection name) and \`--output\` (where to
   save screenshots + Markdown).
4. AOC won't overwrite your scripts — only \`lib/\` and \`SKILL.md\` are
   AOC-managed.
`;

// ─── v0.3.0 — Runbook system (agent-driven, deterministic replay) ──────────

const RUNBOOK_SCHEMA_PY = `"""runbook_schema — Validate runbook YAML against the action whitelist.

Schema (informal):

    name: <slug>                       # required, e.g. sales-create-quotation
    title: "Human-readable title"      # required
    module: <odoo-module-slug>         # required, e.g. sales, helpdesk
    connection: "<aoc-conn-name>"      # required at run-time (can be in --vars)
    recipe: create_record              # optional: which template this follows
    vars:                              # optional defaults; CLI --vars overrides
      key: value
    steps:                             # required, 1..MAX_STEPS
      - action: <whitelisted-action>
        # ...action-specific params...

The action whitelist is the source of truth. Anything else → reject.
"""
import re

MAX_STEPS = 25
MAX_NAME_LEN = 80

# Allowed actions with their required + optional params.
# Each entry: { 'required': set, 'optional': set }
ACTION_SCHEMA = {
    'login':         {'required': set(),                          'optional': {'expected'}},
    'nav':           {'required': {'module'},                     'optional': {'expected', 'expect_after'}},
    'click':         {'required': {'target'},                     'optional': {'caption', 'expected', 'expect_after', 'wait_after_ms'}},
    'fill':          {'required': {'field', 'value'},             'optional': {'caption', 'expected', 'after_keypress'}},
    'select':        {'required': {'field', 'value'},             'optional': {'caption', 'expected'}},
    'save':          {'required': set(),                          'optional': {'caption', 'expected'}},
    'wait':          {'required': {'target'},                     'optional': {'timeout_ms', 'expected'}},
    'verify':        {'required': {'target'},                     'optional': {'contains', 'not_contains', 'text_equals', 'expected'}},
    'screenshot':    {'required': set(),                          'optional': {'target', 'caption', 'full_page'}},
    'assert_navbar': {'required': set(),                          'optional': {'expected'}},
}


VAR_RE = re.compile(r'\\$\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}')


class RunbookError(ValueError):
    pass


def validate(runbook):
    """Validate a parsed runbook dict. Raise RunbookError on any issue."""
    if not isinstance(runbook, dict):
        raise RunbookError("runbook must be a YAML mapping at top level")

    for required in ('name', 'title', 'module', 'steps'):
        if required not in runbook:
            raise RunbookError(f"missing required field: {required}")

    name = str(runbook['name'])
    if not re.match(r'^[a-z0-9][a-z0-9-]{0,' + str(MAX_NAME_LEN - 1) + r'}$', name):
        raise RunbookError(f"name must be lowercase slug (a-z0-9-), got: {name!r}")

    if not isinstance(runbook['steps'], list) or not runbook['steps']:
        raise RunbookError("steps must be a non-empty list")
    if len(runbook['steps']) > MAX_STEPS:
        raise RunbookError(f"too many steps: {len(runbook['steps'])} (max {MAX_STEPS})")

    if 'vars' in runbook and not isinstance(runbook['vars'], dict):
        raise RunbookError("vars must be a mapping")

    used_vars = set()
    declared_vars = set((runbook.get('vars') or {}).keys())

    for i, step in enumerate(runbook['steps'], 1):
        prefix = f"step {i}"
        if not isinstance(step, dict):
            raise RunbookError(f"{prefix}: must be a mapping")
        action = step.get('action')
        if action not in ACTION_SCHEMA:
            raise RunbookError(f"{prefix}: unknown action {action!r} (allowed: {sorted(ACTION_SCHEMA)})")
        spec = ACTION_SCHEMA[action]
        provided = set(step.keys()) - {'action', 'id'}
        missing = spec['required'] - provided
        if missing:
            raise RunbookError(f"{prefix} ({action}): missing required param(s) {missing}")
        unknown = provided - spec['required'] - spec['optional']
        if unknown:
            raise RunbookError(f"{prefix} ({action}): unknown param(s) {unknown}")
        # Collect var refs
        for v in step.values():
            if isinstance(v, str):
                used_vars.update(VAR_RE.findall(v))

    return {'used_vars': sorted(used_vars), 'declared_vars': sorted(declared_vars)}


def interpolate(value, vars_):
    """Substitute \${var} in a string value."""
    if not isinstance(value, str):
        return value
    def repl(m):
        k = m.group(1)
        if k not in vars_:
            raise RunbookError(f"unresolved variable: \${{{k}}}")
        return str(vars_[k])
    return VAR_RE.sub(repl, value)


def interpolate_step(step, vars_):
    """Return a copy of step with all string values var-interpolated."""
    return {k: interpolate(v, vars_) for k, v in step.items()}
`;

const DOM_SNAPSHOT_PY = `"""dom_snapshot — Compact aria-tree extractor for agent reasoning.

When an agent needs to figure out why a step failed (selector not found,
field missing, etc.), it calls this to get a minimal DOM snapshot focused
on what's currently visible. Far cheaper to send to LLM than full HTML.

Returns a dict like:
  {
    "url": "...",
    "title": "...",
    "breadcrumb": ["Sales", "Quotations", "S00042"],
    "buttons":  [{"text": "New", "selector": "...", "visible": true}, ...],
    "fields":   [{"name": "partner_id", "label": "Customer", "filled": "...", "type": "many2one"}, ...],
    "tabs":     ["Order Lines", "Optional Products", ...],
    "errors":   [...],   # any visible error toasts/messages
  }
"""
import json


# JS that runs in the page to extract a structured snapshot
_SNAPSHOT_JS = """
() => {
  const visible = (el) => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0;
  };

  // Build a CSS selector that uniquely identifies an element (best-effort)
  const selectorFor = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
    const role = el.getAttribute('role');
    const text = (el.textContent || '').trim().slice(0, 40);
    if (role) return el.tagName.toLowerCase() + '[role="' + role + '"]' + (text ? ':has-text("' + text.replace(/"/g, '\\\\"') + '")' : '');
    if (text) return el.tagName.toLowerCase() + ':has-text("' + text.replace(/"/g, '\\\\"').slice(0, 30) + '")';
    return el.tagName.toLowerCase();
  };

  const out = {
    url: location.href,
    title: document.title,
    breadcrumb: [],
    buttons: [],
    fields: [],
    tabs: [],
    errors: [],
  };

  // Breadcrumb (Odoo .breadcrumb-item / .o_breadcrumb span)
  document.querySelectorAll('.breadcrumb .breadcrumb-item, .o_breadcrumb span').forEach(el => {
    const t = (el.textContent || '').trim();
    if (t && visible(el)) out.breadcrumb.push(t);
  });

  // Visible buttons (cap at 30 to keep snapshot lean)
  let btnCount = 0;
  document.querySelectorAll('button, a.btn').forEach(el => {
    if (btnCount >= 30) return;
    if (!visible(el)) return;
    const txt = (el.textContent || '').trim();
    if (!txt) return;
    out.buttons.push({
      text: txt.slice(0, 60),
      selector: selectorFor(el),
      classes: (el.className || '').toString().slice(0, 100),
    });
    btnCount++;
  });

  // Form fields (Odoo div[name=...] convention)
  document.querySelectorAll('div[name], .o_field_widget[name]').forEach(el => {
    if (!visible(el)) return;
    const name = el.getAttribute('name');
    if (!name) return;
    const labelEl = el.closest('.o_form_view, .o_view_form, body')?.querySelector('label[for="' + name + '"]')
                  || el.previousElementSibling;
    const label = labelEl?.textContent?.trim() || '';
    const inp = el.querySelector('input, textarea, select, .o_input');
    let type = 'unknown';
    if (el.querySelector('.o-autocomplete--input')) type = 'many2one';
    else if (el.querySelector('select')) type = 'selection';
    else if (el.querySelector('.o_field_x2many')) type = 'one2many';
    else if (inp?.tagName === 'TEXTAREA') type = 'text';
    else if (inp?.type === 'checkbox') type = 'boolean';
    else if (inp?.type) type = inp.type;
    out.fields.push({
      name,
      label: label.slice(0, 60),
      filled: (inp?.value || '').slice(0, 60),
      type,
      selector: 'div[name="' + name + '"]',
    });
  });

  // Tabs (Odoo notebook tabs)
  document.querySelectorAll('.o_notebook_headers a, .nav-tabs a').forEach(el => {
    if (!visible(el)) return;
    const t = (el.textContent || '').trim();
    if (t) out.tabs.push(t);
  });

  // Error toasts / validation messages
  document.querySelectorAll('.o_notification.text-bg-danger, .o_notification_error, .text-danger:not(label):not(span)').forEach(el => {
    if (!visible(el)) return;
    const t = (el.textContent || '').trim();
    if (t) out.errors.push(t.slice(0, 200));
  });

  return out;
}
"""


def snapshot(page):
    """Run the snapshot JS and return the result dict."""
    return page.evaluate(_SNAPSHOT_JS)


def snapshot_compact_str(page, max_chars=2000):
    """Return a compact string suitable for LLM context."""
    s = snapshot(page)
    lines = [
        f"URL: {s.get('url')}",
        f"Title: {s.get('title')}",
        f"Breadcrumb: {' > '.join(s.get('breadcrumb') or [])}",
        f"Tabs: {', '.join(s.get('tabs') or [])}",
        "Buttons:",
    ]
    for b in s.get('buttons', [])[:20]:
        lines.append(f"  - {b['text']!r} → {b['selector']}")
    lines.append("Fields:")
    for f in s.get('fields', [])[:20]:
        v = f' = {f["filled"]!r}' if f.get('filled') else ''
        lines.append(f"  - {f['name']} ({f['type']}, label={f['label']!r}){v}")
    if s.get('errors'):
        lines.append("Errors:")
        for e in s['errors']:
            lines.append(f"  ! {e}")
    out = '\\n'.join(lines)
    if len(out) > max_chars:
        out = out[:max_chars] + '\\n... (truncated)'
    return out


if __name__ == '__main__':
    # Standalone CLI: connect via CDP and dump snapshot
    import argparse, os
    from playwright.sync_api import sync_playwright

    parser = argparse.ArgumentParser()
    parser.add_argument('--ws-url', default=os.environ.get('AOC_BROWSER_WS_URL'),
                        help='CDP WebSocket URL (default: $AOC_BROWSER_WS_URL)')
    parser.add_argument('--format', choices=['json', 'text'], default='text')
    parser.add_argument('--max-chars', type=int, default=2000)
    args = parser.parse_args()

    if not args.ws_url:
        raise SystemExit('AOC_BROWSER_WS_URL not set — run browser-harness-acquire.sh first')

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(args.ws_url)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        if args.format == 'json':
            print(json.dumps(snapshot(page), indent=2))
        else:
            print(snapshot_compact_str(page, max_chars=args.max_chars))
`;

const RUNBOOK_RUNNER_PY = `"""runbook_runner — Deterministic replay of runbook YAML.

Loads YAML → validates → connects to Chrome (CDP via $AOC_BROWSER_WS_URL) →
executes step-by-step → captures annotated screenshots → renders UAT +
User Manual markdown. On step failure: dumps DOM snapshot for the agent
to reason about, exits with structured error.

Usage:
    python3 -m runbook_runner \\
        --runbook runbooks/sales/create_quotation.yml \\
        --connection "DKE 17 Staging" \\
        --output ./outputs/sales-uat \\
        --vars customer="Test Co" product="Service" \\
        [--resume-from N] [--patch step_N.target=NEW_SELECTOR ...]

Exit codes:
    0 — all steps passed
    1 — runbook validation error (before running)
    2 — step execution failure (DOM snapshot saved)
    3 — environment error (no browser, no creds)
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import yaml  # PyYAML — bundled with Python 3 in macOS / available via pip

# Make sibling lib modules importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from runbook_schema import validate, interpolate_step, RunbookError
from odoo_login import get_credentials_from_aoc, login as do_login, assert_logged_in
from odoo_nav   import goto_module, wait_for_action_loaded
from odoo_form  import fill_field, click as do_click, save_record
from odoo_uat   import StepRecorder
import dom_snapshot


def parse_vars_kv(items):
    """Parse --vars k1=v1 k2=v2 into a dict."""
    out = {}
    for item in items or []:
        if '=' not in item:
            raise SystemExit(f"--vars: expected k=v, got: {item!r}")
        k, v = item.split('=', 1)
        out[k.strip()] = v
    return out


def parse_patches(items):
    """Parse --patch step_3.target=NEW into {3: {'target': 'NEW'}}."""
    out = {}
    for item in items or []:
        m = re.match(r'^step_(\\d+)\\.([a-zA-Z_]+)=(.*)$', item)
        if not m:
            raise SystemExit(f"--patch: expected step_N.field=value, got: {item!r}")
        step_no, field, val = int(m.group(1)), m.group(2), m.group(3)
        out.setdefault(step_no, {})[field] = val
    return out


def apply_patches(steps, patches):
    """Mutate steps list with patches keyed by 1-based step number."""
    for step_no, fields in patches.items():
        idx = step_no - 1
        if idx < 0 or idx >= len(steps):
            raise SystemExit(f"--patch step_{step_no}: out of range (have {len(steps)} steps)")
        steps[idx].update(fields)


def emit(line):
    """Print + flush so the agent can stream output."""
    print(line, flush=True)


def _click_with_tracking(page, target, timeout_ms=5000):
    """Try comma-separated selectors in order, return which one matched.

    This is what gives us selector confidence data — Playwright's native
    comma-handling treats them as a CSS \\"or\\" rather than ordered fallback.
    By splitting + trying one at a time we can record per-execution which
    selector actually fired.

    Returns: { 'matched': '<selector>', 'tried': [...] }
    """
    selectors = [s.strip() for s in target.split(',') if s.strip()]
    tried = []
    last_err = None
    per_attempt_ms = max(1500, timeout_ms // max(1, len(selectors)))
    for sel in selectors:
        tried.append(sel)
        try:
            page.locator(sel).first.click(timeout=per_attempt_ms)
            return {'matched': sel, 'tried': tried}
        except Exception as e:
            last_err = e
            continue
    raise last_err or RuntimeError(f"none of {len(selectors)} selectors matched")


def execute_step(page, step, recorder, base_url, event=None):
    """Execute a single resolved step. Raises on failure.

    \`event\` is an optional dict — if provided, this function annotates it
    with per-step metadata (matched selector, etc.) for the execution log.
    """
    action = step['action']
    event = event if event is not None else {}

    if action == 'login':
        # creds + url come from runner caller, set into recorder context
        # — see run() for setup.
        do_login(page, base_url, recorder._login_user, recorder._login_pass, db=recorder._login_db)
        recorder.screenshot(page, target='header.o_main_navbar', caption='Logged in')
        return

    if action == 'nav':
        goto_module(page, base_url, step['module'])
        wait_for_action_loaded(page)
        recorder.screenshot(page, target='.o_breadcrumb, .breadcrumb', caption=step.get('caption') or f"Opened {step['module']}")
        return

    if action == 'click':
        target = step['target']
        # screenshot BEFORE click (shows what to click)
        recorder.screenshot(page, target=target, caption=step.get('caption'))
        if ',' in target:
            # Track which fallback won
            r = _click_with_tracking(page, target, timeout_ms=step.get('wait_after_ms', 5000))
            event['matched'] = r['matched']
            event['tried'] = r['tried']
        else:
            do_click(page, target)
            event['matched'] = target
        if step.get('expect_after'):
            page.wait_for_selector(step['expect_after'], timeout=step.get('wait_after_ms', 10000))
        return

    if action == 'fill':
        fill_field(page, step['field'], step['value'])
        if step.get('after_keypress') == 'tab':
            page.keyboard.press('Tab')
        elif step.get('after_keypress') == 'enter':
            page.keyboard.press('Enter')
        recorder.screenshot(page, target=f'div[name="{step["field"]}"]', caption=step.get('caption'))
        return

    if action == 'select':
        page.locator(f'div[name="{step["field"]}"] select').first.select_option(str(step['value']))
        recorder.screenshot(page, target=f'div[name="{step["field"]}"]', caption=step.get('caption'))
        return

    if action == 'save':
        # screenshot BEFORE save (shows the save button)
        save_btn = 'button.o_form_button_save, button[data-tooltip="Save manually"], .o_form_status_indicator_buttons button.fa-cloud-upload'
        recorder.screenshot(page, target=save_btn, caption=step.get('caption') or 'Click Save')
        save_record(page)
        return

    if action == 'wait':
        page.wait_for_selector(step['target'], timeout=step.get('timeout_ms', 10000))
        return

    if action == 'verify':
        loc = page.locator(step['target']).first
        loc.wait_for(timeout=5000)
        text = loc.inner_text() or ''
        if 'contains' in step and step['contains'] not in text:
            raise RuntimeError(f"verify: expected to find {step['contains']!r} in {text!r}")
        if 'not_contains' in step and step['not_contains'] in text:
            raise RuntimeError(f"verify: expected NOT to find {step['not_contains']!r}, but it's in {text!r}")
        if 'text_equals' in step and text.strip() != step['text_equals']:
            raise RuntimeError(f"verify: expected text {step['text_equals']!r}, got {text!r}")
        recorder.screenshot(page, target=step['target'], caption=step.get('caption') or step.get('expected'))
        return

    if action == 'screenshot':
        recorder.screenshot(page, target=step.get('target'), caption=step.get('caption'),
                            full_page=bool(step.get('full_page')))
        return

    if action == 'assert_navbar':
        assert_logged_in(page)
        return

    raise RuntimeError(f"unknown action at runtime: {action}")


def run(runbook_path, output_dir, connection_name, vars_override, patches, resume_from, args_namespace=None):
    runbook_path = Path(runbook_path).resolve()
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    raw = yaml.safe_load(runbook_path.read_text())
    try:
        validate(raw)
    except RunbookError as e:
        emit(f"❌ runbook validation failed: {e}")
        sys.exit(1)

    # Merge vars: defaults from runbook < CLI override
    vars_ = dict(raw.get('vars') or {})
    vars_.update(vars_override)
    vars_['connection'] = connection_name  # always available

    steps = list(raw['steps'])
    apply_patches(steps, patches)

    # Resolve creds via AOC API (for login step)
    creds = get_credentials_from_aoc(connection_name)
    base_url = (creds.get('url') or '').rstrip('/')
    if not base_url:
        emit(f"❌ connection {connection_name!r} has no URL")
        sys.exit(3)

    ws_url = os.environ.get('AOC_BROWSER_WS_URL')
    if not ws_url:
        emit("❌ AOC_BROWSER_WS_URL not set — run browser-harness-acquire.sh first")
        sys.exit(3)

    recorder = StepRecorder(output_dir)
    # Stash creds into recorder so login step can grab them
    recorder._login_user = creds.get('username')
    recorder._login_pass = creds.get('password')
    recorder._login_db   = creds.get('db')

    title = raw.get('title') or raw['name']
    emit(f"▶ Runbook: {title}")
    emit(f"  module={raw['module']}  connection={connection_name}  steps={len(steps)}")
    emit(f"  output={output_dir}")
    if vars_override:
        emit(f"  vars override: {json.dumps(vars_override)}")
    if patches:
        emit(f"  patches: {json.dumps({f'step_{k}': v for k, v in patches.items()})}")

    failed_step = None
    step_events = []
    run_started_at = time.time()

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(ws_url)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try: page.set_viewport_size({'width': 1920, 'height': 1080})
        except Exception: pass

        for i, step in enumerate(steps, 1):
            if i < resume_from:
                emit(f"[{i:02d}/{len(steps):02d}] {step['action']:14} → ⏭  skipped (resume-from={resume_from})")
                step_events.append({'id': i, 'action': step['action'], 'skipped': True})
                continue
            resolved = interpolate_step(step, vars_)
            label = resolved['action']
            extra = []
            for k in ('module', 'target', 'field', 'value'):
                if k in resolved:
                    extra.append(f"{k}={str(resolved[k])[:40]!r}")
            emit(f"[{i:02d}/{len(steps):02d}] {label:14} {' '.join(extra)}", )

            event = {'id': i, 'action': resolved['action']}
            recorder.step(resolved.get('expected') or label, expected=resolved.get('expected') or '')
            t0 = time.time()
            try:
                execute_step(page, resolved, recorder, base_url, event=event)
                dt = time.time() - t0
                event['ok'] = True
                event['duration_ms'] = int(dt * 1000)
                step_events.append(event)
                matched_hint = f" (matched: {event['matched']})" if event.get('matched') and event.get('tried') and len(event['tried']) > 1 else ""
                emit(f"             → ✅ ok ({dt:.1f}s){matched_hint}")
            except Exception as e:
                dt = time.time() - t0
                event['ok'] = False
                event['error'] = str(e)[:300]
                event['duration_ms'] = int(dt * 1000)
                step_events.append(event)
                emit(f"             → ❌ FAIL ({dt:.1f}s): {e}")
                # Capture DOM snapshot for the agent to reason about
                try:
                    snap = dom_snapshot.snapshot_compact_str(page, max_chars=3000)
                    snap_path = output_dir / f'failure_step_{i:02d}.dom.txt'
                    snap_path.write_text(snap)
                    emit(f"             → 📋 DOM snapshot: {snap_path}")
                except Exception as snap_err:
                    emit(f"             → (DOM snapshot capture failed: {snap_err})")
                # Also a full-page screenshot at the failure
                try:
                    fail_shot = output_dir / f'failure_step_{i:02d}.png'
                    page.screenshot(path=str(fail_shot), full_page=True)
                    emit(f"             → 📸 failure screenshot: {fail_shot}")
                except Exception:
                    pass
                failed_step = i
                break

    # Always render whatever we have
    recorder.write_uat(title)
    recorder.write_manual(title)
    recorder.write_json()

    # Append execution event to history (.executions.jsonl alongside the runbook)
    try:
        from datetime import datetime, timezone
        hist_path = runbook_path.with_suffix('.executions.jsonl')
        exec_record = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'runbook': runbook_path.name,
            'status': 'failed' if failed_step is not None else 'success',
            'failed_step': failed_step,
            'duration_ms': int((time.time() - run_started_at) * 1000),
            'connection': connection_name,
            'output_dir': str(output_dir),
            'vars': {k: vars_.get(k) for k in (raw.get('vars') or {}).keys()},
            'patches_applied': {f'step_{k}': v for k, v in patches.items()} if patches else None,
            'steps': step_events,
        }
        with hist_path.open('a') as f:
            f.write(json.dumps(exec_record) + '\\n')
        emit(f"📒 execution logged: {hist_path.name}")
    except Exception as e:
        emit(f"⚠ history append failed: {e}")

    if failed_step is not None:
        emit("")
        emit(f"⛔ runbook stopped at step {failed_step}.")
        emit(f"   To retry after patching: --resume-from {failed_step} --patch step_{failed_step}.<field>=<new>")
        emit(f"   See DOM snapshot: {output_dir}/failure_step_{failed_step:02d}.dom.txt")
        sys.exit(2)

    # Patch auto-merge: if --patch was given and the full run succeeded,
    # write the patched runbook back to disk so future replays don't need
    # the same --patch flag. Set --no-save-patches to opt out.
    if patches and getattr(args_namespace, 'save_patches', True):
        try:
            updated = yaml.safe_load(runbook_path.read_text())
            for step_no, fields in patches.items():
                idx = step_no - 1
                if 0 <= idx < len(updated.get('steps', [])):
                    updated['steps'][idx].update(fields)
            # Append a comment trailer noting the merge
            patch_summary = ', '.join(f"step_{k}." + ','.join(v.keys()) for k, v in patches.items())
            yaml_text = yaml.safe_dump(updated, sort_keys=False, allow_unicode=True, width=120)
            yaml_text += f"\\n# patched by runbook-run on {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} ({patch_summary})\\n"
            runbook_path.write_text(yaml_text)
            emit(f"💾 Patches merged into {runbook_path.name}: {patch_summary}")
        except Exception as e:
            emit(f"⚠ patch auto-merge failed: {e} (run still succeeded)")

    # Selector confidence — peek at recent history, propose promotions if any
    try:
        import runbook_history
        proposals = runbook_history.propose_promotions(runbook_path, min_runs=5)
        if proposals:
            emit("")
            emit(f"💡 Selector confidence — {len(proposals)} promotion(s) suggested:")
            for p in proposals:
                emit(f"   step_{p['step_id']}: '{p['fallback']}' won {p['fallback_wins']}/{p['runs']} runs (currently primary: '{p['primary']}')")
            emit(f"   Apply with: runbook-promote-selectors.sh {runbook_path}")
    except Exception:
        pass

    emit("")
    emit(f"✅ all {len(steps)} steps passed.")
    emit(f"   UAT script:   {output_dir}/uat-script.md")
    emit(f"   User manual:  {output_dir}/user-manual.md")
    emit(f"   Screenshots:  {output_dir}/screenshots/")
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runbook', required=True, help='Path to runbook YAML')
    parser.add_argument('--connection', required=True, help='AOC connection name')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--vars', nargs='*', default=[], help='k=v overrides')
    parser.add_argument('--patch', nargs='*', default=[], help='step_N.field=value patches')
    parser.add_argument('--resume-from', type=int, default=1, help='1-based step number to start from')
    parser.add_argument('--no-save-patches', dest='save_patches', action='store_false',
                        help="Don't merge --patch values back into the runbook YAML on success")
    parser.set_defaults(save_patches=True)
    args = parser.parse_args()

    vars_override = parse_vars_kv(args.vars)
    patches = parse_patches(args.patch)

    sys.exit(run(args.runbook, args.output, args.connection, vars_override, patches, args.resume_from, args_namespace=args))


if __name__ == '__main__':
    main()
`;

const ODOO_PRIORS_MD = `# Odoo Priors — Knowledge for the Drafting Agent

When you (the agent) draft a runbook YAML, lean on these Odoo conventions
heavily. They're true for **standard Odoo 14–17** and most DKE forks.

## URL patterns

- Module entry: \`/odoo/<module-slug>\` (Odoo 17). For ≤16, use \`/web#action=...\`.
  Slugs match the technical name: \`sales\`, \`purchase\`, \`stock\` (Inventory),
  \`account\` (Accounting), \`hr\`, \`crm\`, \`project\`, \`helpdesk\`, \`mrp\` (Manufacturing).
- Login: \`/web/login\`
- Logout: \`/web/session/logout\`

## Form view conventions

| Element | Selector(s) (try in order) |
|---|---|
| Form root | \`.o_form_view\`, \`.o_view_form\` |
| Field by name | \`div[name="<field_name>"]\` |
| Required-field indicator | red asterisk in label, or \`.o_required_modifier\` |
| Edit / Save | \`button.o_form_button_save\` ≤16; \`button[data-tooltip="Save manually"]\` and \`.o_form_status_indicator_buttons button.fa-cloud-upload\` ≥17 |
| Discard | \`button.o_form_button_cancel\`, \`button:has-text("Discard")\` |
| Breadcrumb | \`.o_breadcrumb\`, \`.breadcrumb\` — text changes from "New" to record reference on save |

## List view conventions

| Element | Selector |
|---|---|
| New / Create | \`button.o_list_button_add\` ≤16; \`.o_cp_action_menus button:has-text("New")\` ≥17 |
| Search bar | \`input.o_searchview_input\` |
| Row | \`tr.o_data_row\` |
| Filters dropdown | \`button.o_searchview_dropdown_toggler\` |

## Field widget patterns

| Widget | How to fill |
|---|---|
| text / number / date | \`page.fill('div[name="X"] input', value)\` |
| many2one (autocomplete) | type into \`.o-autocomplete--input\`, then click first \`.o-autocomplete--dropdown li\` |
| selection (dropdown) | \`select.select_option(value)\` |
| boolean (toggle) | click \`input[type="checkbox"]\` |
| one2many (table) | click \`.o_field_x2many_list_row_add a\` to add row |
| reference / radio | inspect widget — varies |

## "Did it save?" — verification idioms

- Breadcrumb text changed from "New" to a record reference (e.g., S00042)
- Status indicator switches from edit-mode (cloud icon) to read-only
- URL changes to \`#id=<n>&\`

## Common error toasts

- "You cannot create a record … access right …" → permission issue, not selector
- "Validation Error" → required field missing or invalid format
- Red toast \`.o_notification.text-bg-danger\` → check \`.errors\` array in DOM snapshot

## Module-specific quirks (DKE forks)

- DKE 17: custom modules under Sales (Mobile Orders, GForm PO Orders, Sales Marketing
  Requests). When in doubt, check breadcrumb after nav.
- DKE 14: legacy form classes \`.oe_form_view\` may be present alongside modern.
- Default db: usually matches connection's \`db\` field — set in login when present.
`;

const RECIPE_TEMPLATES_MD = `# Recipe Templates

When drafting a runbook, pick the recipe that matches the user's intent,
then fill in the specifics. Don't invent your own structure — these recipes
are field-tested.

## create_record — Most common

For: "Create a quotation", "Add a product", "New ticket", etc.

\`\`\`yaml
name: <module>-create-<thing>
title: "<Module> — Create <Thing>"
module: <slug>
recipe: create_record
vars:
  # required field values for the record
  customer: "..."
  # ...
steps:
  - action: login
  - action: nav
    module: <slug>
    expected: "<Module> dashboard / list view"
  - action: click
    target: 'button.o_list_button_add, .o_cp_action_menus button:has-text("New")'
    caption: 'Click "New"'
    expect_after: 'div[name="<first-required-field>"]'
    expected: "Empty form opens"
  # repeat fill steps for each required field
  - action: fill
    field: <field-name>
    value: "\${customer}"
    expected: "Customer field populated"
  # ...more fills
  - action: save
    caption: 'Click Save'
    expected: "Record saved, breadcrumb changes"
  - action: verify
    target: '.o_breadcrumb, .breadcrumb'
    not_contains: "New"
    expected: "Breadcrumb shows record reference"
\`\`\`

## workflow_transition — Confirm / Cancel / Approve

For: "Confirm quotation", "Validate transfer", "Approve PO".

\`\`\`yaml
name: <module>-<action>-<thing>
title: "<Module> — <Action> <Thing>"
module: <slug>
recipe: workflow_transition
vars:
  record_ref: "S00042"
steps:
  - action: login
  - action: nav
    module: <slug>
  # navigate to record (search or direct URL)
  - action: click
    target: 'input.o_searchview_input'
  - action: fill
    field: search
    value: "\${record_ref}"
    after_keypress: enter
  - action: click
    target: 'tr.o_data_row:first-child'
    expect_after: '.o_form_view'
  # the action button — varies per module
  - action: click
    target: 'button:has-text("Confirm")'
    caption: 'Click "Confirm"'
    wait_after_ms: 5000
  - action: verify
    target: '.o_arrow_button_current, .o_statusbar_status .btn.active'
    contains: "<expected-state>"
    expected: "Status moved to <expected-state>"
\`\`\`

## list_filter — Apply filter, verify count

For: "Show today's orders", "Filter by customer X".

\`\`\`yaml
name: <module>-filter-<criterion>
title: "<Module> — Filter <Criterion>"
module: <slug>
recipe: list_filter
vars:
  filter_value: "..."
steps:
  - action: login
  - action: nav
    module: <slug>
  - action: click
    target: 'button.o_searchview_dropdown_toggler'
    caption: 'Open filters'
  - action: click
    target: '.o_filter_menu a:has-text("<filter-label>")'
  - action: verify
    target: '.o_pager_value, .o_searchview_facet'
    contains: "\${filter_value}"
    expected: "Filter applied; results match"
\`\`\`

## Notes on recipe choice

If user's intent doesn't fit cleanly into one recipe, **start with create_record
or workflow_transition** (most common) and adapt by adding/removing steps.
Don't invent novel structures — the runner can only execute whitelisted actions.
`;

const SALES_RUNBOOK_YML = `name: sales-create-quotation
title: "Sales — Create Quotation"
module: sales
recipe: create_record

vars:
  customer: "Test Co"
  product: "Service"

steps:
  - action: login
    expected: "Odoo navbar appears (logged in)"

  - action: nav
    module: sales
    expected: "Sales dashboard / Quotations list"

  - action: click
    target: 'button.o_list_button_add, .o_cp_action_menus button:has-text("New"), button.btn-primary:has-text("New")'
    caption: 'Click "New" to start a quotation'
    expect_after: 'div[name="partner_id"]'
    expected: "Empty quotation form opens"

  - action: fill
    field: partner_id
    value: "\${customer}"
    caption: 'Set Customer'
    expected: "Customer field populated"

  - action: click
    target: '.o_field_x2many_list_row_add a, a:has-text("Add a line")'
    caption: 'Add an order line'
    expect_after: 'tr.o_data_row'
    expected: "Empty line row appears"

  - action: fill
    field: product_id
    value: "\${product}"
    after_keypress: tab
    caption: 'Set product on line'
    expected: "Line populated with product"

  - action: save
    caption: 'Click Save (cloud icon in 17, "Save" text earlier)'
    expected: "Quotation saved, breadcrumb shows reference"

  - action: verify
    target: '.o_breadcrumb, .breadcrumb'
    not_contains: "New"
    expected: "Breadcrumb shows quotation number, not 'New'"
`;

const RUNBOOK_HISTORY_PY = `"""runbook_history — Read/analyze .executions.jsonl for runbooks.

Each runbook \`<module>/<name>.yml\` has a sibling \`<module>/<name>.executions.jsonl\`
(append-only, one event per line) written by the runner after each run.

Functions here power:
  - runbook-history.sh CLI (view recent runs, success rate, durations)
  - selector confidence promotion (after N runs, propose swap)
  - regression alerts (consecutive failures at same step)
"""
import json
from collections import Counter, defaultdict
from pathlib import Path


def history_path_for(runbook_path):
    return Path(runbook_path).with_suffix('.executions.jsonl')


def load_history(runbook_path, limit=None):
    """Yield execution events from the JSONL log, newest last.
    \`limit\` (optional) keeps the last N entries only.
    """
    p = history_path_for(runbook_path)
    if not p.exists():
        return []
    out = []
    with p.open() as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: out.append(json.loads(line))
            except json.JSONDecodeError: continue
    if limit and len(out) > limit:
        out = out[-limit:]
    return out


def summary(runbook_path, last_n=10):
    """Return a dict: total_runs, success_count, fail_count, avg_duration_ms,
    last_status, recent (list of last N), failure_pattern."""
    events = load_history(runbook_path)
    if not events:
        return {'total_runs': 0, 'recent': []}

    success = sum(1 for e in events if e.get('status') == 'success')
    fail = sum(1 for e in events if e.get('status') == 'failed')
    durations = [e.get('duration_ms', 0) for e in events if isinstance(e.get('duration_ms'), int)]
    avg_dur = sum(durations) // len(durations) if durations else 0

    # Failure pattern: which step fails most often?
    fail_counter = Counter(e.get('failed_step') for e in events if e.get('status') == 'failed')

    return {
        'total_runs': len(events),
        'success_count': success,
        'fail_count': fail,
        'avg_duration_ms': avg_dur,
        'last_status': events[-1].get('status') if events else None,
        'last_timestamp': events[-1].get('timestamp') if events else None,
        'recent': events[-last_n:],
        'failure_pattern': dict(fail_counter),
    }


def propose_promotions(runbook_path, min_runs=5, threshold_ratio=0.6):
    """Examine the last successful runs. For each click step with comma-
    separated fallback selectors, if a non-primary selector won more often
    than the primary (≥ threshold_ratio of runs), suggest a promotion.

    Returns list of {step_id, primary, fallback, fallback_wins, primary_wins, runs}.
    """
    import yaml
    runbook_path = Path(runbook_path)
    if not runbook_path.exists():
        return []
    runbook = yaml.safe_load(runbook_path.read_text())
    if not isinstance(runbook, dict): return []

    # Last N successful runs only — failure runs are noisy
    events = [e for e in load_history(runbook_path) if e.get('status') == 'success']
    if len(events) < min_runs:
        return []
    events = events[-min_runs:]

    proposals = []
    for idx, step in enumerate(runbook.get('steps') or [], 1):
        if step.get('action') != 'click': continue
        target = step.get('target') or ''
        if ',' not in target: continue
        selectors = [s.strip() for s in target.split(',') if s.strip()]
        if len(selectors) < 2: continue

        # Tally winners
        wins = Counter()
        for ev in events:
            for sev in (ev.get('steps') or []):
                if sev.get('id') == idx and sev.get('matched'):
                    wins[sev['matched']] += 1
        if not wins: continue

        primary = selectors[0]
        primary_wins = wins.get(primary, 0)
        # Find best non-primary
        best = max(((s, wins.get(s, 0)) for s in selectors if s != primary), key=lambda x: x[1], default=None)
        if not best: continue
        fallback, fallback_wins = best
        if fallback_wins == 0: continue

        ratio = fallback_wins / max(1, len(events))
        if ratio >= threshold_ratio and fallback_wins > primary_wins:
            proposals.append({
                'step_id': idx,
                'primary': primary,
                'fallback': fallback,
                'fallback_wins': fallback_wins,
                'primary_wins': primary_wins,
                'runs': len(events),
            })
    return proposals


def apply_promotions(runbook_path):
    """Apply all suggested promotions: rewrite the runbook YAML with the
    fallback selector promoted to primary position. Returns list of changes.
    """
    import yaml
    runbook_path = Path(runbook_path)
    proposals = propose_promotions(runbook_path)
    if not proposals: return []

    runbook = yaml.safe_load(runbook_path.read_text())
    applied = []
    for p in proposals:
        idx = p['step_id'] - 1
        if idx < 0 or idx >= len(runbook['steps']): continue
        step = runbook['steps'][idx]
        target = step.get('target') or ''
        selectors = [s.strip() for s in target.split(',') if s.strip()]
        new_order = [p['fallback']] + [s for s in selectors if s != p['fallback']]
        step['target'] = ', '.join(new_order)
        applied.append({'step_id': p['step_id'], 'new_primary': p['fallback'], 'old_primary': p['primary']})

    if applied:
        import time
        yaml_text = yaml.safe_dump(runbook, sort_keys=False, allow_unicode=True, width=120)
        summary = ', '.join(f"step_{a['step_id']}={a['new_primary'][:30]}" for a in applied)
        yaml_text += f"\\n# selector promotions applied {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} ({summary})\\n"
        runbook_path.write_text(yaml_text)
    return applied


def consecutive_failures(runbook_path, n=3):
    """Count consecutive failures from the end of history. Returns 0 if last
    run was success. Useful for regression alerts (\"failed N times in a row\")."""
    events = load_history(runbook_path)
    streak = 0
    for ev in reversed(events):
        if ev.get('status') == 'failed':
            streak += 1
        else:
            break
    return streak


def cli():
    import argparse, sys
    p = argparse.ArgumentParser(description='Inspect runbook execution history')
    p.add_argument('runbook', help='Path to runbook YAML (the .executions.jsonl sibling is read)')
    p.add_argument('--last', type=int, default=10, help='Show last N events (default 10)')
    p.add_argument('--format', choices=['summary', 'json', 'table'], default='summary')
    args = p.parse_args()

    s = summary(args.runbook, last_n=args.last)

    if args.format == 'json':
        print(json.dumps(s, indent=2)); return

    rb = Path(args.runbook).name
    print(f"📒 {rb}")
    print(f"   total runs: {s.get('total_runs', 0)}")
    if s.get('total_runs', 0) == 0:
        print("   (no executions yet)"); return
    pct = (s['success_count'] / s['total_runs']) * 100 if s['total_runs'] else 0
    print(f"   success: {s['success_count']}/{s['total_runs']} ({pct:.0f}%)")
    print(f"   failures: {s['fail_count']}")
    print(f"   avg duration: {s['avg_duration_ms']/1000:.1f}s")
    print(f"   last: {s['last_status']} @ {s['last_timestamp']}")
    if s.get('failure_pattern'):
        print(f"   failure pattern: {s['failure_pattern']}")
    print("")
    print(f"Recent runs ({len(s['recent'])}):")
    for ev in s['recent']:
        ts = (ev.get('timestamp') or '')[:19]
        status = ev.get('status', '?')
        icon = '✅' if status == 'success' else '❌'
        dur = ev.get('duration_ms', 0) / 1000
        n_steps = len(ev.get('steps') or [])
        fail = f" (fail@step_{ev['failed_step']})" if ev.get('failed_step') else ''
        patches = ' +patched' if ev.get('patches_applied') else ''
        print(f"   {icon} {ts}  {dur:5.1f}s  {n_steps} steps{fail}{patches}")

    # Promotion proposals
    proposals = propose_promotions(args.runbook)
    if proposals:
        print("")
        print(f"💡 Selector promotions suggested ({len(proposals)}):")
        for pr in proposals:
            print(f"   step_{pr['step_id']}: '{pr['fallback']}' won {pr['fallback_wins']}/{pr['runs']} (primary: '{pr['primary']}')")
        print(f"   Apply: runbook-promote-selectors.sh {args.runbook}")

    # Failure streak alert
    streak = consecutive_failures(args.runbook)
    if streak >= 2:
        print("")
        print(f"⚠ {streak} consecutive failures — regression suspected.")


if __name__ == '__main__':
    cli()
`;

const RUNBOOK_PUBLISH_PY = `"""runbook_publish — Publish runbook outputs to Google Drive as Google Docs.

Strategy:
  1. Convert UAT + User-Manual markdown files → docx via python-docx
     (images embedded from local screenshot paths, so they travel with
     the docx as binary).
  2. Upload docx with \`mimeType=application/vnd.google-apps.document\`
     so Drive auto-converts to a native Google Doc with images intact.
  3. (Optional) place under a named Drive folder (find or create).

Auth: relies on the standalone \`gws\` CLI (\`brew install gws\` if missing,
then \`gws auth login\` once). This is separate from AOC's google_workspace
connection — simpler for MVP, no AOC token plumbing needed for the API.

Usage:
    python3 -m runbook_publish \\
        --output-dir ./outputs/sales-uat \\
        --doc-title "Sales — Create Quotation UAT" \\
        [--drive-folder "DKE UAT Reports"]
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor
except ImportError:
    print("ERROR: python-docx not installed. Run: pip3 install --break-system-packages python-docx", file=sys.stderr)
    sys.exit(3)

GWS_BIN = shutil.which('gws') or '/opt/homebrew/bin/gws'


# ── gws CLI wrapper ──────────────────────────────────────────────────────────

def gws(args):
    """Run \`gws <args...>\` and return parsed JSON. Strips keyring banner."""
    if not Path(GWS_BIN).exists():
        raise RuntimeError(f"gws CLI not found at {GWS_BIN}. Install via 'brew install gws' (or set GWS_BIN env).")
    cmd = [GWS_BIN] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    out = (result.stdout or '').strip()
    err = (result.stderr or '').strip()
    # gws prints "Using keyring backend: keyring" before JSON output
    out_clean = re.sub(r'^Using keyring backend.*?\\n', '', out, count=1, flags=re.MULTILINE)
    if result.returncode != 0:
        # Try to surface a useful error
        msg = err or out_clean or f"exit {result.returncode}"
        if 'invalid_grant' in msg or 'expired' in msg.lower():
            raise RuntimeError("gws authentication expired. Run: gws auth login")
        raise RuntimeError(f"gws {' '.join(args)} failed: {msg[:300]}")
    if not out_clean:
        return {}
    try:
        return json.loads(out_clean)
    except json.JSONDecodeError:
        # Sometimes responses include progress lines + JSON at end
        last_brace = out_clean.rfind('{')
        if last_brace >= 0:
            try: return json.loads(out_clean[last_brace:])
            except: pass
        raise RuntimeError(f"gws returned non-JSON: {out_clean[:200]}")


def find_or_create_folder(name, parent_id=None):
    """Find a Drive folder by name (in optional parent), or create it."""
    name_escaped = name.replace("'", "\\\\'")
    q = f"mimeType='application/vnd.google-apps.folder' and name='{name_escaped}' and trashed=false"
    if parent_id:
        q += f" and '{parent_id}' in parents"
    res = gws(['drive', 'files', 'list', '--params', json.dumps({
        'q': q, 'fields': 'files(id,name)', 'pageSize': 1,
    })])
    files = res.get('files') or []
    if files:
        return files[0]['id']
    body = {'name': name, 'mimeType': 'application/vnd.google-apps.folder'}
    if parent_id:
        body['parents'] = [parent_id]
    created = gws(['drive', 'files', 'create', '--json', json.dumps(body)])
    return created['id']


def upload_as_gdoc(docx_path, doc_name, folder_id=None):
    """Upload docx → auto-convert to native Google Doc. Returns Doc URL."""
    body = {
        'name': doc_name,
        'mimeType': 'application/vnd.google-apps.document',
    }
    if folder_id:
        body['parents'] = [folder_id]
    created = gws([
        'drive', 'files', 'create',
        '--json', json.dumps(body),
        '--upload', str(docx_path),
        '--upload-content-type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ])
    return created['id'], f"https://docs.google.com/document/d/{created['id']}/edit"


# ── Markdown → docx (subset matching StepRecorder output) ────────────────────

INLINE_RE = re.compile(r'(\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|\`[^\`]+\`)')


def _add_inline_runs(paragraph, text):
    parts = INLINE_RE.split(text)
    for part in parts:
        if not part:
            continue
        run = paragraph.add_run()
        if part.startswith('**') and part.endswith('**'):
            run.text = part[2:-2]; run.bold = True
        elif part.startswith('*') and part.endswith('*'):
            run.text = part[1:-1]; run.italic = True
        elif part.startswith('\`') and part.endswith('\`'):
            run.text = part[1:-1]; run.font.name = 'Menlo'
        else:
            run.text = part


def _add_picture(doc_or_cell, src, base_dir, max_width_in=6.0, alt=''):
    if src.startswith(('http://', 'https://')):
        # External URL — python-docx can't fetch; emit as placeholder text.
        para = doc_or_cell.add_paragraph(f'[image: {alt or src}]')
        return
    full = (base_dir / src).resolve()
    if not full.exists():
        para = doc_or_cell.add_paragraph(f'[missing image: {src}]')
        return
    try:
        if hasattr(doc_or_cell, 'add_picture'):
            doc_or_cell.add_picture(str(full), width=Inches(max_width_in))
        else:
            # Cell — picture goes in a new run inside a paragraph
            para = doc_or_cell.paragraphs[0] if doc_or_cell.paragraphs else doc_or_cell.add_paragraph()
            para.add_run().add_picture(str(full), width=Inches(2.6))
    except Exception as e:
        doc_or_cell.add_paragraph(f'[image render error: {e}]')


_TABLE_SEP_RE = re.compile(r'^\\|[\\s|:\\-]+\\|\\s*$')
_IMG_RE = re.compile(r'!\\[([^\\]]*)\\]\\(([^)]+)\\)')


def md_to_docx(md_text, base_dir, output_path):
    """Convert a subset of markdown to docx. Targets StepRecorder output."""
    doc = Document()

    # Set default style fonts a bit nicer
    style = doc.styles['Normal']
    style.font.size = Pt(10.5)

    lines = md_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()

        if line.startswith('# '):
            doc.add_heading(line[2:].strip(), level=1)
        elif line.startswith('## '):
            doc.add_heading(line[3:].strip(), level=2)
        elif line.startswith('### '):
            doc.add_heading(line[4:].strip(), level=3)
        elif line.startswith('- ') or line.startswith('* '):
            p = doc.add_paragraph(style='List Bullet')
            _add_inline_runs(p, line[2:].strip())
        elif re.match(r'^\\d+\\.\\s', line):
            p = doc.add_paragraph(style='List Number')
            _add_inline_runs(p, re.sub(r'^\\d+\\.\\s', '', line))
        elif line.startswith('|') and i + 1 < len(lines) and _TABLE_SEP_RE.match(lines[i + 1]):
            # Pipe table
            header_cells = [c.strip() for c in line.strip('|').split('|')]
            j = i + 2
            data_rows = []
            while j < len(lines) and lines[j].startswith('|'):
                cells = [c.strip() for c in lines[j].strip('|').split('|')]
                data_rows.append(cells)
                j += 1
            n_cols = max(len(header_cells), max((len(r) for r in data_rows), default=0))
            table = doc.add_table(rows=1 + len(data_rows), cols=n_cols)
            try: table.style = 'Light Grid Accent 1'
            except KeyError: pass
            # header
            for k in range(n_cols):
                cell = table.cell(0, k)
                txt = header_cells[k] if k < len(header_cells) else ''
                cell.text = ''
                run = cell.paragraphs[0].add_run(txt)
                run.bold = True
            # data
            for r_idx, row in enumerate(data_rows, 1):
                for c_idx in range(n_cols):
                    cell = table.cell(r_idx, c_idx)
                    cell_text = row[c_idx] if c_idx < len(row) else ''
                    img_m = _IMG_RE.search(cell_text)
                    if img_m:
                        cell.text = ''
                        _add_picture(cell, img_m.group(2), base_dir, alt=img_m.group(1))
                    else:
                        cell.text = ''
                        _add_inline_runs(cell.paragraphs[0], cell_text)
            i = j
            continue
        elif line.startswith('!['):
            m = _IMG_RE.match(line)
            if m:
                _add_picture(doc, m.group(2), base_dir, alt=m.group(1))
            else:
                doc.add_paragraph(line)
        elif line.startswith('_') and line.endswith('_') and len(line) > 2:
            # Italic single-line note
            p = doc.add_paragraph()
            run = p.add_run(line.strip('_'))
            run.italic = True
        elif line.strip() == '':
            pass
        else:
            p = doc.add_paragraph()
            _add_inline_runs(p, line)
        i += 1

    doc.save(str(output_path))


# ── Main publish flow ────────────────────────────────────────────────────────

def md_to_docx_combined(uat_md, manual_md, base_dir, output_path):
    """Build a single docx that contains UAT first, then a page break, then
    the User Manual. Section headings are added so the Doc TOC works."""
    from docx.enum.text import WD_BREAK
    doc = Document()
    style = doc.styles['Normal']; style.font.size = Pt(10.5)

    if uat_md:
        # Render UAT inline (don't reuse md_to_docx file-saver — we need to
        # keep adding to the same Document)
        _render_md_into(doc, uat_md, base_dir)
        # page break before the manual
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    if manual_md:
        _render_md_into(doc, manual_md, base_dir)

    doc.save(str(output_path))


def _render_md_into(doc, md_text, base_dir):
    """Subset markdown renderer that appends to an existing Document.
    Mirrors md_to_docx but doesn't open/save its own file."""
    lines = md_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()

        if line.startswith('# '):
            doc.add_heading(line[2:].strip(), level=1)
        elif line.startswith('## '):
            doc.add_heading(line[3:].strip(), level=2)
        elif line.startswith('### '):
            doc.add_heading(line[4:].strip(), level=3)
        elif line.startswith('- ') or line.startswith('* '):
            p = doc.add_paragraph(style='List Bullet')
            _add_inline_runs(p, line[2:].strip())
        elif re.match(r'^\\d+\\.\\s', line):
            p = doc.add_paragraph(style='List Number')
            _add_inline_runs(p, re.sub(r'^\\d+\\.\\s', '', line))
        elif line.startswith('|') and i + 1 < len(lines) and _TABLE_SEP_RE.match(lines[i + 1]):
            header_cells = [c.strip() for c in line.strip('|').split('|')]
            j = i + 2
            data_rows = []
            while j < len(lines) and lines[j].startswith('|'):
                cells = [c.strip() for c in lines[j].strip('|').split('|')]
                data_rows.append(cells)
                j += 1
            n_cols = max(len(header_cells), max((len(r) for r in data_rows), default=0))
            table = doc.add_table(rows=1 + len(data_rows), cols=n_cols)
            try: table.style = 'Light Grid Accent 1'
            except KeyError: pass
            for k in range(n_cols):
                cell = table.cell(0, k)
                txt = header_cells[k] if k < len(header_cells) else ''
                cell.text = ''
                run = cell.paragraphs[0].add_run(txt); run.bold = True
            for r_idx, row in enumerate(data_rows, 1):
                for c_idx in range(n_cols):
                    cell = table.cell(r_idx, c_idx)
                    cell_text = row[c_idx] if c_idx < len(row) else ''
                    img_m = _IMG_RE.search(cell_text)
                    if img_m:
                        cell.text = ''
                        _add_picture(cell, img_m.group(2), base_dir, alt=img_m.group(1))
                    else:
                        cell.text = ''
                        _add_inline_runs(cell.paragraphs[0], cell_text)
            i = j
            continue
        elif line.startswith('!['):
            m = _IMG_RE.match(line)
            if m: _add_picture(doc, m.group(2), base_dir, alt=m.group(1))
            else: doc.add_paragraph(line)
        elif line.startswith('_') and line.endswith('_') and len(line) > 2:
            p = doc.add_paragraph(); run = p.add_run(line.strip('_')); run.italic = True
        elif line.strip() == '':
            pass
        else:
            p = doc.add_paragraph(); _add_inline_runs(p, line)
        i += 1


def publish(output_dir, doc_title, drive_folder=None, mode='separate'):
    """mode = 'separate' (default — 2 Docs) or 'combined' (1 Doc, both in)."""
    output_dir = Path(output_dir).expanduser().resolve()
    if not output_dir.is_dir():
        raise SystemExit(f"output dir not found: {output_dir}")

    uat_md = output_dir / 'uat-script.md'
    manual_md = output_dir / 'user-manual.md'
    if not uat_md.exists() and not manual_md.exists():
        raise SystemExit(f"no markdown files in {output_dir}")

    folder_id = None
    if drive_folder:
        print(f"📁 Resolving Drive folder: {drive_folder}", flush=True)
        folder_id = find_or_create_folder(drive_folder)
        print(f"   folder_id = {folder_id}", flush=True)

    results = []

    if mode == 'combined' and uat_md.exists() and manual_md.exists():
        print(f"📄 Building combined docx (UAT + User Manual, page-break separator)...", flush=True)
        combined_docx = output_dir / 'combined.docx'
        md_to_docx_combined(uat_md.read_text(), manual_md.read_text(), output_dir, combined_docx)
        print(f"☁️  Uploading + auto-converting to Google Doc...", flush=True)
        _, url = upload_as_gdoc(combined_docx, doc_title, folder_id)
        results.append(('Combined (UAT + Manual)', url))
        print(f"   ✅ {url}", flush=True)
        return results

    # Separate mode (default) — 2 Docs
    if uat_md.exists():
        print(f"📄 Converting UAT markdown → docx...", flush=True)
        uat_docx = output_dir / 'uat-script.docx'
        md_to_docx(uat_md.read_text(), output_dir, uat_docx)
        print(f"☁️  Uploading + auto-converting to Google Doc...", flush=True)
        _, url = upload_as_gdoc(uat_docx, f"{doc_title} — UAT", folder_id)
        results.append(('UAT Script', url))
        print(f"   ✅ {url}", flush=True)

    if manual_md.exists():
        print(f"📄 Converting User Manual markdown → docx...", flush=True)
        manual_docx = output_dir / 'user-manual.docx'
        md_to_docx(manual_md.read_text(), output_dir, manual_docx)
        print(f"☁️  Uploading + auto-converting to Google Doc...", flush=True)
        _, url = upload_as_gdoc(manual_docx, f"{doc_title} — User Manual", folder_id)
        results.append(('User Manual', url))
        print(f"   ✅ {url}", flush=True)

    return results


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output-dir', required=True)
    p.add_argument('--doc-title', required=True)
    p.add_argument('--drive-folder', default=None)
    p.add_argument('--mode', choices=['separate', 'combined'], default='separate',
                   help="separate (default): 2 Google Docs (UAT + Manual). "
                        "combined: 1 Google Doc with page break between sections.")
    args = p.parse_args()
    try:
        results = publish(args.output_dir, args.doc_title, args.drive_folder, mode=args.mode)
    except RuntimeError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(2)

    print("")
    print("📤 Published:")
    for name, url in results:
        print(f"  {name}: {url}")


if __name__ == '__main__':
    main()
`;

const RUNBOOKS_README = `# runbooks/

Each subfolder is an Odoo module. Each \`.yml\` file is a replay-able runbook.

## Bundled

- \`sales/create_quotation.yml\` — reference scenario (Sales: New Quotation)

## Adding your own

The agent will write runbooks here automatically as you give it new tasks
via chat. You can also hand-author one — match the schema in
\`lib/runbook_schema.py\` and validate with:

    runbook-validate.sh runbooks/<module>/<scenario>.yml

## Versioning

Runbooks are plain YAML files. Use git for version history. The agent
edits in place when patches are applied during execution — that's
intentional, so the next replay benefits from accumulated learning.
`;

// SKILL.md rewritten as a *playbook* the agent literally executes
// step-by-step. Inspired by Obra's superpowers — skills as state machines.
const SKILL_MD_V3 = `---
name: browser-harness-odoo
description: Built-in Layer 2 skill — drives the user through Odoo UAT/User-Manual generation. Handles two cases internally: starting from scratch, or working from a user-provided draft. Inherits browser-harness-core. Strict approval at every gate.
type: built-in
layer: 2
inherits: browser-harness-core
---

# browser-harness-odoo — Skill Playbook

> You (the agent) **literally follow** this playbook step-by-step.
> STOP at every "ASK USER" gate and wait for their reply before proceeding.
> Never skip a gate. Never auto-execute past strict approval points.

## Path setup — do this once per shell session

All scripts referenced below live inside this skill folder:

\`\`\`bash
export PATH="$HOME/.openclaw/skills/browser-harness-odoo/scripts:$PATH"
\`\`\`

Run that **once** at the start of any task that uses this skill. After that,
the bare script names below resolve automatically.

## VOICE & TONE — read this before every reply

You are talking to a real person (developer, QA engineer, PM) on Telegram /
Discord / WhatsApp. Sound like a helpful colleague, not a tool reading
internal docs out loud.

### NEVER say to the user (these are internal jargon)

- "greenfield" / "brownfield" / "Path A" / "Path B"
- "playbook" / "STOP gate" / "STRICT approval"
- "runbook" — call it **test script** or just **the script**
- "YAML" — call it **the script** or **draft** when shown in chat
- "scenario" / "primitives" / "validator" / "schema"
- "STRICT STOP" / "auto-execute" / "intent classifier"
- file paths like \`~/.openclaw/skills/.../runbooks/...\` (only mention the AOC connection name)
- shell commands like \`runbook-run.sh\` etc — those are *your* tools, not theirs

### Voice

- Match the user's language. If they DM in Bahasa Indonesia, reply in Bahasa
  (casual but professional — "lo/gue" is fine if they use it; otherwise
  "kamu/saya"). If they use English, reply in English.
- Use 1–2 short sentences per turn before any action. No bullet-list dump
  unless you're presenting a draft.
- Drop emoji unless the user uses them first. One per message max.
- When asking questions: ask only what's missing. If they already gave you
  the module + connection, don't re-ask.

### Translate internal concepts when speaking to the user

| Internal | What you say to the user |
|---|---|
| "greenfield" | "saya bikinin dari awal" |
| "brownfield" | "saya pakai draft kamu" |
| "draft runbook YAML" | "draft test script" / "ini draftnya" |
| "execute the runbook" | "saya jalanin", "saya test di Odoo sekarang" |
| "patch step N selector" | "saya benerin step N" |
| "DOM snapshot" | "yang ada di halaman saat ini" |
| "publish to Google Doc" | "upload ke Google Docs" |

## ENTRY: Detect user intent (silently)

When invoked, decide internally — **do not** echo the classification:

| Signal | Internal route |
|---|---|
| Asks for a UAT/test/manual without sharing a draft, or only gives a module name | route A (you draft from scratch) |
| User pastes a UAT table, numbered steps, prose script, or YAML; says "jalankan ini" / "follow this" | route B (you import their draft) |
| Ambiguous | ASK once, naturally: *"Lo udah punya draft test-nya, atau saya bikinin dari awal aja?"* |

Once decided, proceed to the matching steps below. Don't tell the user
which "path" you took — just act.

---

## ROUTE A — User wants you to draft from scratch

### A.1. Ask only what's missing — STOP for user reply

Look at what they already said. Only ask what you don't know yet. Phrase it
as a colleague would, not a form. Example phrasings:

> Boleh, saya bikinin. Beberapa hal yang saya butuh:
>
> – Modul Odoo-nya yang mana? (mis. Sales / Purchase / Inventory / Helpdesk)
> – Setelah scenario jadi, indikator suksesnya apa? (mis. quotation tersimpan, ticket masuk ke status In Progress)
> – Connection-nya pakai yang mana? Saya cek udah ada **DKE 17 Staging** sama
>   **Odoo 17 DKE Staging** — itu yang lo mau dipake?

If they already named the connection in their first message, skip that
bullet. If they already named the module, skip that one. **Don't repeat
back what they already told you.**

### A.2. Ask for the test data — STOP for user reply

Based on module + goal, ask only the field values you'll need to fill in.
Phrase as part of normal conversation:

> Last thing: data buat di-test-nya pakai apa? Misal customer "DKE Demo",
> product "Service", qty 1 — kalau ada preferensi sendiri kasih tau, kalau
> bebas saya pakai contoh aja.

### A.3. Draft the test script (silently, in your own reasoning)

You construct the script as YAML in your head — but **don't tell the user
you're "drafting a runbook"**. Use:

- Recipe templates: see \`lib/recipe_templates.md\`
- Odoo conventions: see \`lib/odoo_priors.md\`
- Allowed actions: login, nav, click, fill, select, save, wait, verify, screenshot, assert_navbar

Validate before showing:

\`\`\`bash
runbook-validate.sh /tmp/draft.yml
\`\`\`

If invalid, fix silently and re-validate. The user shouldn't see the
schema error — they'll see the polished result.

### A.4. Present the draft — STOP for approval

Show the YAML in a fenced code block (it's compact and review-friendly).
Frame the message naturally:

> Ini draft test script-nya:
>
> \`\`\`yaml
> [...validated YAML...]
> \`\`\`
>
> Confidence saya 4/5 — bagian Customer field saya tebak pakai \`partner_id\`
> yang standar; kalau di custom DKE namanya beda kasih tau.
>
> Approve / mau diubah / redraft?

If your confidence is high (5/5) and nothing is custom, drop the confidence
mention — sounds more natural. Save the line for when there's something
genuinely uncertain.

**Wait for explicit "ok" / "approve" / "jalanin" before A.5.** If they say
edit, apply the change in your head and re-show. If they say redraft,
restart from A.3 with their new direction.

### A.5 / B.5 — Execute

Save the approved script (you handle the file path internally), reserve a
browser, and run. Tell the user **once** that you're starting:

> Sip, saya jalanin sekarang. Akan kelihatan progress per step di sini.

Use these tools (don't tell user the commands, just run them):

\`\`\`bash
eval "$(browser-harness-acquire.sh --export)"
runbook-run.sh --runbook <internal-path> --connection "<conn>" --output ./outputs/<task> --vars …
\`\`\`

As steps complete, post compact progress updates. **Don't** dump the raw
runner output verbatim. Translate to natural language and combine multiple
steps into one update if they pass quickly:

✅ Good:
> Step 1–3 ✓ (login, buka Sales, klik New)
> Step 4–6 ✓ (isi customer, tambah line, save)
> Selesai. 6 step semua sukses, screenshot udah ke-capture per step.

❌ Bad (raw runner output dumped):
> \`[01/08] login — ok (1.2s)\`
> \`[02/08] nav module='sales' — ok (0.8s)\`
> ...

### A.6 / B.6 — When a step fails — STOP for approval

If runner exits with failure, you'll see a step number and a DOM snapshot
file. Read it silently, then explain in plain language:

> Step 4 (isi customer) gagal — selector \`partner_id\` gak ketemu di
> halaman. Lihat di DOM, sepertinya field-nya nama-nya \`partner_invoice_id\`
> di custom DKE. Saya benerin pake itu, lanjut?

If user "yes", retry from that step with the patched value. If fails again,
propose ONE more patch. After 2 failed retries, hand back to user:

> Saya udah coba 2 cara, masih gagal. Bisa lo cek manual sebentar di
> Odoo, terus kasih tau saya selector field yang bener?

### A.7 / B.7 — Release the browser

Always release the slot when done (success or failure). User doesn't need
to know about this — just do it.

\`\`\`bash
browser-harness-release.sh
\`\`\`

### A.8 / B.8 — Wrap up + publish — ASK USER

After success, summarize **briefly** and ask about publishing:

> Done. Test script + user manual udah jadi, screenshot per step lengkap.
>
> Mau saya upload ke Google Docs? Kalau iya kasih tau folder Drive-nya
> (atau bilang "lokal aja" kalau cukup di workspace).

On "yes" + folder, run:

\`\`\`bash
runbook-publish.sh <output-dir> --doc-title "<module> — <scenario>" --drive-folder "<folder>"
\`\`\`

Reply with the Doc URLs naturally:

> Done. Ini link-nya:
> – UAT script: <url>
> – User manual: <url>
> Tinggal di-share ke tim.

**Auth fallback:** if \`gws\` reports auth expired, tell user in plain
language:

> Token Google Workspace di server udah expired — bisa dikamu jalanin
> \`gws auth login\` sekali di Mac mini-nya, terus saya retry?

### A.9 / B.9 — Patch persistence (automatic, no user message needed)

If during execution you applied any patches AND the run succeeded
end-to-end, the runner automatically merges those fixes back into the
saved test script on disk. Next time the same test is run, it'll start
with the corrected selectors — no need to patch again.

This happens silently. **Don't tell the user "patches merged into YAML"** —
they don't need to know. If they ask why a re-run is faster, you can
mention "saya udah update test scriptnya dengan fix yang barusan, jadi
sekarang langsung jalan tanpa retry."

Pass \`--no-save-patches\` to opt out for a one-off run that shouldn't
modify the canonical runbook.

### A.10. Self-learning loop — selector confidence (after enough runs)

Every run appends an event to \`<runbook>.executions.jsonl\` next to the
runbook YAML. For \`click\` steps with comma-separated fallback selectors
(\`'A, B, C'\`), the runner records **which selector actually matched** per
run. Over time this becomes selector-confidence data.

**After ≥ 5 successful runs**, the runner auto-emits a suggestion when a
non-primary fallback wins ≥ 60% of runs:

\`\`\`
💡 Selector confidence — 1 promotion(s) suggested:
   step_3: 'div[name="X"]' won 4/5 runs (currently primary: '.legacy-X')
   Apply with: runbook-promote-selectors.sh sales/create_quotation
\`\`\`

If user approves, run:

\`\`\`bash
runbook-promote-selectors.sh sales/create_quotation
# or, dry-run first:
runbook-promote-selectors.sh sales/create_quotation --dry-run
\`\`\`

The promoter rewrites the runbook YAML with the winning selector moved to
primary position. Future replays start with the more reliable selector
first → faster + fewer flakes.

**Strict approval rule still applies** — promotions are *suggested*, never
auto-applied. The user runs the promote command manually after they see
the proposal.

### Inspecting history

Anytime, you can show the user execution stats:

\`\`\`bash
runbook-history.sh sales/create_quotation [--last 10] [--format summary|json|table]
\`\`\`

Output: total runs, success rate, avg duration, last status, failure
pattern (which step fails most often), recent runs, and any pending
selector promotion proposals.

---

## ROUTE B — User already has a draft

### B.1. Receive their draft (silently)

They've pasted something resembling a UAT script. Could be:
- Markdown table (Step / Action / Expected)
- Numbered list ("1. Login, 2. Click New, …")
- Freeform prose ("First login, then open Sales…")
- YAML / JSON
- A screenshot of a Word doc — extract text first

Don't ask them to "convert to YAML" or "give me a runbook" — just work with
what they gave you.

### B.2. Interpret it (silently)

For each line you parse:

- Identify the action (login / nav / click / fill / save / verify)
- Pick the best Odoo selector based on conventions
- Lift values into variables if they look reusable

When uncertain, mark internally with a \`# TODO: confirm\` and flag it to
the user in plain language at the present step.

### B.3. Validate silently
\`\`\`bash
runbook-validate.sh /tmp/imported.yml
\`\`\`
Fix issues without bothering the user.

### B.4. Present your interpretation — STOP for approval

Phrase as a colleague double-checking, not as a system review:

> Saya udah baca draft-mu, ini interpretasi-nya:
>
> \`\`\`yaml
> [...YAML...]
> \`\`\`
>
> Beberapa yang saya tebak (kasih tau kalau salah):
>
> – step 4 "Customer = X" saya pasang ke field \`partner_id\` (standar Odoo);
>   kalau di DKE namanya beda kasih tau
> – step 6 "Save" saya tambah verify breadcrumb biar yakin tersimpan
>
> OK lanjut, atau ada yang mau dibenerin dulu?

**Wait for explicit "ok" before B.5.**

### B.5–B.8: same execution flow as A.5–A.8

(Steps below apply to both routes from here on.)

---

## STRICT RULES

1. **Never auto-execute** without explicit user approval. "ok"/"approve"/"yes" only.
2. **Never apply a patch** during execution without asking.
3. **Never invent action types** outside the whitelist in \`lib/runbook_schema.py\`.
4. **Cap output**: max 25 steps per runbook. If user's request needs more,
   split into multiple runbooks.
5. **Cap retries**: max 2 patch attempts per step before escalating to user.
6. **Cap LLM context**: when reasoning about a failure, only inject the failed
   step + DOM snapshot + last 2 successful steps. Don't dump the whole runbook.
7. **No credential mention**: never echo \`creds.password\` or any field marked
   secret in your replies. The runner handles login internally.

## Tools available

| Tool | Purpose |
|---|---|
| \`runbook-validate.sh <path>\` | Schema check |
| \`runbook-run.sh --runbook X --connection Y --output Z [--vars] [--patch] [--resume-from N]\` | Execute |
| \`runbook-list.sh [module]\` | List existing runbooks |
| \`runbook-show.sh <module>/<scenario>\` | Cat a runbook YAML |
| \`runbook-history.sh <module>/<scenario> [--last N]\` | View execution history + stats + promotion proposals |
| \`runbook-promote-selectors.sh <module>/<scenario> [--dry-run]\` | Apply selector confidence promotions |
| \`runbook-publish.sh <output-dir> --doc-title "..." [--drive-folder "..."] [--mode separate\\|combined]\` | Publish to Google Doc(s) |
| \`dom-snapshot.sh\` | Compact DOM tree from current Chrome page |
| \`browser-harness-acquire.sh --export\` | Reserve a Chrome slot |
| \`browser-harness-release.sh\` | Release the slot |
| \`check_connections.sh\` | List AOC connections assigned to you |

## Files

- \`lib/runbook_schema.py\` — action whitelist + validator
- \`lib/runbook_runner.py\` — replay engine (writes \`.executions.jsonl\`)
- \`lib/runbook_publish.py\` — md → docx → Google Doc pipeline
- \`lib/runbook_history.py\` — read execution log, propose selector promotions
- \`lib/dom_snapshot.py\` — aria-tree extractor
- \`lib/odoo_login.py\`, \`odoo_nav.py\`, \`odoo_form.py\`, \`odoo_uat.py\` — primitives
- \`lib/odoo_priors.md\` — Odoo conventions cheat sheet
- \`lib/recipe_templates.md\` — skeleton runbooks per scenario type
- \`runbooks/<module>/<scenario>.yml\` — saved runbooks (replay-able)

## Glossary

- **Greenfield**: user starts from scratch, agent drafts everything.
- **Brownfield**: user has a partial draft, agent imports + executes.
- **Replay**: re-running a saved runbook deterministically (zero LLM cost).
- **Patch**: a targeted runtime fix to a single step's selector or value.
- **Recipe**: skeleton runbook for a common scenario type (create_record etc).
`;

// ─── Shell wrapper scripts (live under scripts/ in the skill folder) ────────
// These are the agent-facing entry points. Previously dumped in
// ~/.openclaw/scripts/ as flat shared scripts; now treated as skill artifacts.

const SH_BROWSER_HARNESS_ACQUIRE = `#!/usr/bin/env bash
# browser-harness-acquire — Reserve a Chrome pool slot for the current agent.
#
# Auto-boots Chrome if no slot is up. Outputs JSON with the CDP details.
# Usage:
#   eval "\$(./browser-harness-acquire.sh --export)"
#   ./browser-harness-release.sh
#
# Optional args:
#   --slot <n>     pick a specific slot
#   --export       emit \`export FOO=bar\` lines instead of JSON

set -euo pipefail

source "\${OPENCLAW_HOME:-\$HOME/.openclaw}/.aoc_env"
[ -f "\$PWD/.aoc_agent_env" ] && source "\$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env"

[ -z "\${AOC_TOKEN:-}" ] && { echo "ERROR: AOC_TOKEN not configured" >&2; exit 1; }
[ -z "\${AOC_URL:-}" ]   && { echo "ERROR: AOC_URL not configured" >&2; exit 1; }
[ -z "\${AOC_AGENT_ID:-}" ] && { echo "ERROR: AOC_AGENT_ID not configured — run from agent workspace" >&2; exit 1; }

SLOT_ID=0
EXPORT_MODE=0
while [ \$# -gt 0 ]; do
  case "\$1" in
    --slot)   SLOT_ID="\$2"; shift 2 ;;
    --export) EXPORT_MODE=1; shift ;;
    *) echo "Unknown arg: \$1" >&2; exit 2 ;;
  esac
done

TMPFILE=\$(mktemp /tmp/aoc-browser-acquire-XXXXXX.json)
trap "rm -f \$TMPFILE" EXIT

HTTP_CODE=\$(curl -s -o "\$TMPFILE" -w "%{http_code}" \\
  -X POST "\$AOC_URL/api/browser-harness/acquire" \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"slotId\\":\$SLOT_ID,\\"agentId\\":\\"\$AOC_AGENT_ID\\"}" 2>/dev/null) || true

if [ "\$HTTP_CODE" != "200" ]; then
  echo "ERROR: acquire failed (HTTP \$HTTP_CODE)" >&2
  cat "\$TMPFILE" >&2
  echo "" >&2
  exit 1
fi

if [ "\$EXPORT_MODE" = "1" ]; then
  python3 -c "
import json, sys
d = json.load(open('\$TMPFILE'))
print(f'export AOC_BROWSER_SLOT_ID={d[\\"slotId\\"]}')
print(f'export AOC_BROWSER_PORT={d[\\"port\\"]}')
print(f'export AOC_BROWSER_PROFILE={json.dumps(d[\\"profile\\"])}')
print(f'export AOC_BROWSER_WS_URL={json.dumps(d[\\"webSocketDebuggerUrl\\"])}')
"
else
  cat "\$TMPFILE"
fi
`;

const SH_BROWSER_HARNESS_RELEASE = `#!/usr/bin/env bash
# browser-harness-release — Release a Chrome pool slot back to the pool.
# Idempotent. Idle slots auto-quit after the configured GC timeout.

set -euo pipefail

source "\${OPENCLAW_HOME:-\$HOME/.openclaw}/.aoc_env"
[ -f "\$PWD/.aoc_agent_env" ] && source "\$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env"

[ -z "\${AOC_TOKEN:-}" ] && { echo "ERROR: AOC_TOKEN not configured" >&2; exit 1; }
[ -z "\${AOC_URL:-}" ]   && { echo "ERROR: AOC_URL not configured" >&2; exit 1; }

SLOT_ID="\${AOC_BROWSER_SLOT_ID:-1}"
while [ \$# -gt 0 ]; do
  case "\$1" in
    --slot) SLOT_ID="\$2"; shift 2 ;;
    *) echo "Unknown arg: \$1" >&2; exit 2 ;;
  esac
done

curl -s -X POST "\$AOC_URL/api/browser-harness/release" \\
  -H "Authorization: Bearer \$AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"slotId\\":\$SLOT_ID}" || true
echo ""
`;

const SH_RUNBOOK_VALIDATE = `#!/usr/bin/env bash
# runbook-validate — Validate a runbook YAML against the action whitelist.
set -euo pipefail

RUNBOOK="\${1:-}"
[ -z "\$RUNBOOK" ] && { echo "Usage: \$0 <runbook.yml>" >&2; exit 2; }
[ ! -f "\$RUNBOOK" ] && { echo "Not found: \$RUNBOOK" >&2; exit 2; }

LIB_DIR="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/lib"
[ ! -d "\$LIB_DIR" ] && { echo "browser-harness-odoo not installed" >&2; exit 3; }

python3 - "\$RUNBOOK" <<PY
import sys, yaml
sys.path.insert(0, "\$LIB_DIR")
from runbook_schema import validate, RunbookError

path = sys.argv[1]
try:
    raw = yaml.safe_load(open(path))
except Exception as e:
    print(f"YAML parse error: {e}", file=sys.stderr)
    sys.exit(1)
try:
    info = validate(raw)
except RunbookError as e:
    print(f"INVALID: {e}", file=sys.stderr)
    sys.exit(1)
print(f"OK: {raw.get('name')!r} — {len(raw['steps'])} steps; vars used={info['used_vars']}; declared={info['declared_vars']}")
PY
`;

const SH_RUNBOOK_RUN = `#!/usr/bin/env bash
# runbook-run — Execute a runbook YAML against the assigned Odoo connection.
# Streams per-step status; captures annotated screenshots; writes UAT/Manual md.

set -euo pipefail

source "\${OPENCLAW_HOME:-\$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
[ -f "\$PWD/.aoc_agent_env" ] && source "\$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env"

LIB_DIR="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/lib"
[ ! -d "\$LIB_DIR" ] && { echo "browser-harness-odoo not installed" >&2; exit 3; }

if [ -z "\${AOC_BROWSER_WS_URL:-}" ]; then
  echo "ERROR: AOC_BROWSER_WS_URL not set." >&2
  echo "Run first: eval \\"\\\$(\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/scripts/browser-harness-acquire.sh --export)\\"" >&2
  exit 3
fi

cd "\$LIB_DIR"
exec python3 -m runbook_runner "\$@"
`;

const SH_RUNBOOK_LIST = `#!/usr/bin/env bash
# runbook-list — List saved runbooks under browser-harness-odoo skill.
set -euo pipefail
ROOT="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/runbooks"
[ ! -d "\$ROOT" ] && { echo "(no runbooks yet)"; exit 0; }

FILTER="\${1:-}"
if [ -n "\$FILTER" ]; then
  [ ! -d "\$ROOT/\$FILTER" ] && { echo "(no runbooks for module: \$FILTER)"; exit 0; }
  ROOT="\$ROOT/\$FILTER"
fi

python3 - "\$ROOT" <<'PY'
import os, sys, yaml
root = sys.argv[1]
rows = []
for dirpath, _, files in os.walk(root):
    for f in files:
        if not f.endswith('.yml') and not f.endswith('.yaml'): continue
        path = os.path.join(dirpath, f)
        try:
            d = yaml.safe_load(open(path))
            module = d.get('module', '?')
            name = d.get('name', f)
            title = d.get('title', '')
            n = len(d.get('steps') or [])
            rel = os.path.relpath(path, root)
            rows.append((module, name, n, title, rel))
        except Exception as e:
            rows.append(('?', f, 0, f'(parse error: {e})', os.path.relpath(path, root)))
rows.sort()
if not rows:
    print('(no runbooks)')
else:
    for module, name, n, title, rel in rows:
        print(f'  [{module:12}] {name:35} {n:>2} steps  — {title}')
        print(f'                {rel}')
PY
`;

const SH_RUNBOOK_SHOW = `#!/usr/bin/env bash
# runbook-show — Print a runbook YAML.
set -euo pipefail
ARG="\${1:-}"
[ -z "\$ARG" ] && { echo "Usage: \$0 <module>/<scenario> | <path>" >&2; exit 2; }

ROOT="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/runbooks"

if [ -f "\$ARG" ]; then
  cat "\$ARG"; exit 0
fi
for ext in yml yaml; do
  P="\$ROOT/\$ARG.\$ext"
  [ -f "\$P" ] && { cat "\$P"; exit 0; }
done
echo "Not found: \$ARG (looked under \$ROOT/)" >&2
exit 1
`;

const SH_RUNBOOK_PUBLISH = `#!/usr/bin/env bash
# runbook-publish — Publish UAT + user-manual markdown to Google Docs.

set -euo pipefail

OUT_DIR="\${1:-}"
shift || true

DOC_TITLE=""
DRIVE_FOLDER=""
MODE="separate"
while [ \$# -gt 0 ]; do
  case "\$1" in
    --doc-title)    DOC_TITLE="\$2"; shift 2 ;;
    --drive-folder) DRIVE_FOLDER="\$2"; shift 2 ;;
    --mode)         MODE="\$2"; shift 2 ;;
    *) echo "Unknown arg: \$1" >&2; exit 2 ;;
  esac
done

[ -z "\$OUT_DIR" ]    && { echo "Usage: \$0 <output-dir> --doc-title \\"...\\" [--drive-folder \\"...\\"]" >&2; exit 2; }
[ -z "\$DOC_TITLE" ]  && { echo "ERROR: --doc-title is required" >&2; exit 2; }
[ ! -d "\$OUT_DIR" ]  && { echo "Not a dir: \$OUT_DIR" >&2; exit 2; }

LIB_DIR="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/lib"
[ ! -d "\$LIB_DIR" ] && { echo "browser-harness-odoo not installed" >&2; exit 3; }

cd "\$LIB_DIR"

ARGS=(--output-dir "\$OUT_DIR" --doc-title "\$DOC_TITLE" --mode "\$MODE")
[ -n "\$DRIVE_FOLDER" ] && ARGS+=(--drive-folder "\$DRIVE_FOLDER")

exec python3 -m runbook_publish "\${ARGS[@]}"
`;

const SH_RUNBOOK_HISTORY = `#!/usr/bin/env bash
# runbook-history — Inspect a runbook's execution history.
set -euo pipefail
ARG="\${1:-}"
[ -z "\$ARG" ] && { echo "Usage: \$0 <module>/<scenario> | <path> [--last N] [--format ...]" >&2; exit 2; }
shift || true

LIB_DIR="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/lib"
[ ! -d "\$LIB_DIR" ] && { echo "browser-harness-odoo not installed" >&2; exit 3; }

ROOT="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/runbooks"
RUNBOOK=""
if [ -f "\$ARG" ]; then
  RUNBOOK="\$ARG"
else
  for ext in yml yaml; do
    if [ -f "\$ROOT/\$ARG.\$ext" ]; then RUNBOOK="\$ROOT/\$ARG.\$ext"; break; fi
  done
fi
[ -z "\$RUNBOOK" ] && { echo "Runbook not found: \$ARG" >&2; exit 1; }

cd "\$LIB_DIR"
exec python3 -m runbook_history "\$RUNBOOK" "\$@"
`;

const SH_RUNBOOK_PROMOTE_SELECTORS = `#!/usr/bin/env bash
# runbook-promote-selectors — Apply selector promotions based on history.
set -euo pipefail
ARG="\${1:-}"
[ -z "\$ARG" ] && { echo "Usage: \$0 <module>/<scenario> | <path> [--dry-run]" >&2; exit 2; }
DRY=0
[ "\${2:-}" = "--dry-run" ] && DRY=1

LIB_DIR="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/lib"
[ ! -d "\$LIB_DIR" ] && { echo "browser-harness-odoo not installed" >&2; exit 3; }

ROOT="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/runbooks"
RUNBOOK=""
if [ -f "\$ARG" ]; then
  RUNBOOK="\$ARG"
else
  for ext in yml yaml; do
    if [ -f "\$ROOT/\$ARG.\$ext" ]; then RUNBOOK="\$ROOT/\$ARG.\$ext"; break; fi
  done
fi
[ -z "\$RUNBOOK" ] && { echo "Runbook not found: \$ARG" >&2; exit 1; }

cd "\$LIB_DIR"
python3 - "\$RUNBOOK" "\$DRY" <<'PY'
import sys
sys.path.insert(0, '.')
import runbook_history
runbook = sys.argv[1]
dry = sys.argv[2] == '1'
proposals = runbook_history.propose_promotions(runbook)
if not proposals:
    print(f'No promotions to apply (need ≥ 5 successful runs with consistent fallback wins).')
    sys.exit(0)
print(f'{len(proposals)} promotion(s) {"proposed (dry-run)" if dry else "applying"}:')
for p in proposals:
    print(f"  step_{p['step_id']}: promote '{p['fallback']}' (won {p['fallback_wins']}/{p['runs']}) over '{p['primary']}' (won {p['primary_wins']})")
if dry:
    print('Dry-run — runbook NOT modified. Re-run without --dry-run to apply.')
    sys.exit(0)
applied = runbook_history.apply_promotions(runbook)
print('')
print(f'✅ {len(applied)} change(s) written to {runbook}')
PY
`;

const SH_DOM_SNAPSHOT = `#!/usr/bin/env bash
# dom-snapshot — Compact DOM/aria tree of the current page in the acquired Chrome.
set -euo pipefail

LIB_DIR="\${OPENCLAW_HOME:-\$HOME/.openclaw}/skills/browser-harness-odoo/lib"
[ ! -d "\$LIB_DIR" ] && { echo "browser-harness-odoo not installed" >&2; exit 3; }

if [ -z "\${AOC_BROWSER_WS_URL:-}" ]; then
  source "\${OPENCLAW_HOME:-\$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
  [ -f "\$PWD/.aoc_agent_env" ] && source "\$PWD/.aoc_agent_env"
  [ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env"
fi

[ -z "\${AOC_BROWSER_WS_URL:-}" ] && {
  echo "ERROR: AOC_BROWSER_WS_URL not set. Run browser-harness-acquire.sh --export first." >&2
  exit 3
}

cd "\$LIB_DIR"
exec python3 -m dom_snapshot "\$@"
`;

const BUNDLE = {
  files: [
    { relPath: 'SKILL.md',                                   content: SKILL_MD_V3,            protect: true  },
    { relPath: 'lib/odoo_login.py',                          content: ODOO_LOGIN_PY,          protect: true  },
    { relPath: 'lib/odoo_nav.py',                            content: ODOO_NAV_PY,            protect: true  },
    { relPath: 'lib/odoo_form.py',                           content: ODOO_FORM_PY,           protect: true  },
    { relPath: 'lib/odoo_uat.py',                            content: ODOO_UAT_PY,            protect: true  },
    { relPath: 'lib/runbook_schema.py',                      content: RUNBOOK_SCHEMA_PY,      protect: true  },
    { relPath: 'lib/runbook_runner.py',                      content: RUNBOOK_RUNNER_PY,      protect: true  },
    { relPath: 'lib/runbook_publish.py',                     content: RUNBOOK_PUBLISH_PY,     protect: true  },
    { relPath: 'lib/runbook_history.py',                     content: RUNBOOK_HISTORY_PY,     protect: true  },
    { relPath: 'lib/dom_snapshot.py',                        content: DOM_SNAPSHOT_PY,        protect: true  },
    { relPath: 'lib/odoo_priors.md',                         content: ODOO_PRIORS_MD,         protect: true  },
    { relPath: 'lib/recipe_templates.md',                    content: RECIPE_TEMPLATES_MD,    protect: true  },
    { relPath: 'templates/uat-script.md',                    content: UAT_TEMPLATE_MD,        protect: true  },
    { relPath: 'templates/user-manual.md',                   content: MANUAL_TEMPLATE_MD,     protect: true  },
    { relPath: 'domain-skills/README.md',                    content: DOMAIN_SKILLS_README,   protect: true  },
    { relPath: 'domain-skills/sales/create_quotation.py',    content: SALES_CREATE_QUOTATION_PY, protect: false },
    { relPath: 'runbooks/README.md',                         content: RUNBOOKS_README,        protect: true  },
    { relPath: 'runbooks/sales/create_quotation.yml',        content: SALES_RUNBOOK_YML,      protect: false },
    // Shell wrappers — agent-facing entry points (live with the skill, not in flat ~/.openclaw/scripts/).
    { relPath: 'scripts/browser-harness-acquire.sh',         content: SH_BROWSER_HARNESS_ACQUIRE,   protect: true, exec: true },
    { relPath: 'scripts/browser-harness-release.sh',         content: SH_BROWSER_HARNESS_RELEASE,   protect: true, exec: true },
    { relPath: 'scripts/runbook-validate.sh',                content: SH_RUNBOOK_VALIDATE,          protect: true, exec: true },
    { relPath: 'scripts/runbook-run.sh',                     content: SH_RUNBOOK_RUN,               protect: true, exec: true },
    { relPath: 'scripts/runbook-list.sh',                    content: SH_RUNBOOK_LIST,              protect: true, exec: true },
    { relPath: 'scripts/runbook-show.sh',                    content: SH_RUNBOOK_SHOW,              protect: true, exec: true },
    { relPath: 'scripts/runbook-publish.sh',                 content: SH_RUNBOOK_PUBLISH,           protect: true, exec: true },
    { relPath: 'scripts/runbook-history.sh',                 content: SH_RUNBOOK_HISTORY,           protect: true, exec: true },
    { relPath: 'scripts/runbook-promote-selectors.sh',       content: SH_RUNBOOK_PROMOTE_SELECTORS, protect: true, exec: true },
    { relPath: 'scripts/dom-snapshot.sh',                    content: SH_DOM_SNAPSHOT,              protect: true, exec: true },
  ],
};

module.exports = BUNDLE;
