import { useState } from 'react';
import type { Embed } from '@/types/embed';
import SnippetCodeBlock from './components/SnippetCodeBlock';

type Lang = 'node' | 'python' | 'php' | 'go' | 'odoo';

const LANG_LABEL: Record<Lang, string> = {
  node: 'Node.js',
  python: 'Python',
  php: 'PHP',
  go: 'Go',
  odoo: 'Odoo',
};

export default function SnippetTab({ embed }: { embed: Embed }) {
  // Public AOC backend URL from EMBED_WIDGET_BASE_URL env (passed via admin GET).
  // Falls back to window.location.origin for very old responses without the field.
  const baseUrl = embed.widgetBaseUrl || window.location.origin;
  const [activeLang, setActiveLang] = useState<Lang>('node');

  const html = `<!-- AOC Embed: ${embed.brandName} -->
<script src="${baseUrl}/embed/${embed.id}/loader.js"
        data-token="${embed.embedToken}" defer></script>`;

  const secret = embed.signingSecret || 'YOUR_SIGNING_SECRET';

  const snippets: Record<Lang, { title: string; code: string; language: string; notes?: string }> = {
    node: {
      title: 'Node.js — JWT signing helper',
      language: 'javascript',
      code: `// npm i jsonwebtoken
const jwt = require('jsonwebtoken');
const SIGNING_SECRET = process.env.AOC_EMBED_SECRET || '${secret}';

function signVisitorJwt(visitorId, name, email) {
  return jwt.sign({ visitor_id: visitorId, name, email }, SIGNING_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

// In your template (e.g. Express + EJS):
// <script>window.AOC_EMBED_JWT = "\${signVisitorJwt(user.id, user.name, user.email)}";</script>`,
      notes: 'Inject the resulting JWT as `window.AOC_EMBED_JWT` BEFORE the loader script tag. Tokens expire in 5 minutes.',
    },
    python: {
      title: 'Python — JWT signing helper',
      language: 'python',
      code: `# pip install pyjwt
import jwt, time, os

SIGNING_SECRET = os.environ.get('AOC_EMBED_SECRET', '${secret}')

def sign_visitor_jwt(visitor_id, name, email):
    payload = {
        'visitor_id': visitor_id, 'name': name, 'email': email,
        'iat': int(time.time()), 'exp': int(time.time()) + 300,
    }
    return jwt.encode(payload, SIGNING_SECRET, algorithm='HS256')

# Flask / Django / FastAPI template:
# <script>window.AOC_EMBED_JWT = "{{ sign_visitor_jwt(user.id, user.name, user.email) }}";</script>`,
      notes: 'PyJWT returns a string in Python 3+. Inject as `window.AOC_EMBED_JWT` BEFORE the loader script tag.',
    },
    php: {
      title: 'PHP — JWT signing helper',
      language: 'php',
      code: `<?php
// composer require firebase/php-jwt
use Firebase\\JWT\\JWT;

$signing_secret = getenv('AOC_EMBED_SECRET') ?: '${secret}';

function sign_visitor_jwt($visitor_id, $name, $email) {
    global $signing_secret;
    $now = time();
    return JWT::encode([
        'visitor_id' => $visitor_id,
        'name'       => $name,
        'email'      => $email,
        'iat'        => $now,
        'exp'        => $now + 300,
    ], $signing_secret, 'HS256');
}

// In your template (Twig/Blade/raw PHP):
// <script>window.AOC_EMBED_JWT = "<?= sign_visitor_jwt($user->id, $user->name, $user->email) ?>";</script>`,
      notes: 'Make sure `firebase/php-jwt` is autoloaded. Inject the result BEFORE the loader script.',
    },
    go: {
      title: 'Go — JWT signing helper',
      language: 'go',
      code: `// go get github.com/golang-jwt/jwt/v5
package embed

import (
    "os"
    "time"
    "github.com/golang-jwt/jwt/v5"
)

var signingSecret = []byte(getEnv("AOC_EMBED_SECRET", "${secret}"))

func SignVisitorJWT(visitorID, name, email string) (string, error) {
    claims := jwt.MapClaims{
        "visitor_id": visitorID,
        "name":       name,
        "email":      email,
        "iat":        time.Now().Unix(),
        "exp":        time.Now().Add(5 * time.Minute).Unix(),
    }
    return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(signingSecret)
}

func getEnv(k, def string) string {
    v := os.Getenv(k)
    if v == "" {
        return def
    }
    return v
}`,
      notes: 'Pass the resulting token to your HTML template (e.g. via `html/template`) as `AOC_EMBED_JWT`.',
    },
    odoo: {
      title: '',
      language: '',
      code: '',   // Odoo gets its own multi-block layout below
    },
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* HTML snippet — always visible */}
      <div>
        <h3 className="font-medium mb-2">1. Loader script</h3>
        <p className="text-xs text-muted-foreground mb-2">
          Paste this into the <code>&lt;head&gt;</code> or before <code>&lt;/body&gt;</code> of every page where the widget should appear.
        </p>
        <SnippetCodeBlock title="HTML snippet" code={html} language="html" />
      </div>

      {embed.mode === 'private' && (
        <div>
          <h3 className="font-medium mb-2">2. Your signing secret</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Use this secret as the <code>AOC_EMBED_SECRET</code> env var on your backend.
            Keep it private — it's what proves to AOC that the JWT was minted by your server.
          </p>
          <SigningSecretReveal secret={embed.signingSecret || ''} />

          <h3 className="font-medium mb-2 mt-6">3. Sign per-visitor JWT — server-side</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Sign a short-lived JWT on your backend using the secret above, inject as <code>window.AOC_EMBED_JWT</code> BEFORE the loader script.
            <br />
            Pick your stack:
          </p>

          {/* Language tabs */}
          <div className="border-b border-border mb-3">
            <nav className="flex gap-1 -mb-px">
              {(Object.keys(LANG_LABEL) as Lang[]).map(lang => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`px-3 py-1.5 text-sm border-b-2 transition-colors ${
                    activeLang === lang
                      ? 'border-primary text-foreground font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {LANG_LABEL[lang]}
                </button>
              ))}
            </nav>
          </div>

          {/* Active panel */}
          {activeLang !== 'odoo' && (
            <div className="space-y-2">
              <SnippetCodeBlock
                title={snippets[activeLang].title}
                code={snippets[activeLang].code}
                language={snippets[activeLang].language}
              />
              {snippets[activeLang].notes && (
                <p className="text-xs text-muted-foreground">{snippets[activeLang].notes}</p>
              )}
            </div>
          )}

          {activeLang === 'odoo' && <OdooGuide embed={embed} baseUrl={baseUrl} secret={secret} />}
        </div>
      )}

      {embed.mode === 'public' && (
        <p className="text-xs text-muted-foreground">
          This is a <strong>public</strong> embed — visitors connect anonymously, no JWT signing needed.
          Just paste the loader snippet above into your site.
        </p>
      )}
    </div>
  );
}

/** Reveal-on-click + copy widget for the signing secret. Masked by default — clicking
 *  the eye toggles a clear-text reveal. Copy works regardless of reveal state. */
function SigningSecretReveal({ secret }: { secret: string }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!secret) {
    return (
      <div className="text-xs text-muted-foreground italic">
        Signing secret not available — reload the page or check permissions.
      </div>
    );
  }

  const masked = '•'.repeat(Math.min(secret.length, 48));

  return (
    <div className="flex items-center gap-2 p-2 border border-border rounded bg-muted font-mono text-xs">
      <code className="flex-1 break-all select-all">
        {visible ? secret : masked}
      </code>
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        className="px-2 py-1 text-muted-foreground hover:text-foreground"
        title={visible ? 'Hide' : 'Reveal'}
      >
        {visible ? '🙈 Hide' : '👁 Reveal'}
      </button>
      <button
        type="button"
        onClick={copy}
        className="px-2 py-1 text-primary hover:underline"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** Odoo-specific integration guide: module skeleton + QWeb template patch + controller. */
function OdooGuide({ embed, baseUrl, secret }: { embed: Embed; baseUrl: string; secret: string }) {
  const manifest = `# my_aoc_embed/__manifest__.py
{
    'name': 'AOC Embed for ${embed.brandName}',
    'version': '17.0.1.0.0',
    'depends': ['website'],          # or 'web' for backend-only embed
    'data': [
        'views/website_templates.xml',
    ],
    'external_dependencies': {'python': ['pyjwt']},
    'installable': True,
}`;

  const controller = `# my_aoc_embed/controllers/embed.py
import jwt, time, os
from odoo import http

AOC_EMBED_SECRET = os.environ.get(
    'AOC_EMBED_SECRET',
    '${secret}',
)

def sign_visitor_jwt(user):
    """Sign a 5-minute visitor JWT for the current Odoo user."""
    payload = {
        'visitor_id': f'odoo-user-{user.id}',
        'name': user.name or user.login,
        'email': user.email or '',
        'iat': int(time.time()),
        'exp': int(time.time()) + 300,
    }
    return jwt.encode(payload, AOC_EMBED_SECRET, algorithm='HS256')


class AocEmbedController(http.Controller):
    """Exposes the visitor JWT to QWeb templates via http.request.env.context."""

    @staticmethod
    def aoc_jwt_for_request():
        env = http.request.env
        if env.user and not env.user._is_public():
            return sign_visitor_jwt(env.user)
        return ''   # anonymous visitor — leave empty, widget will refuse to init`;

  const templateFrontend = `<!-- my_aoc_embed/views/website_templates.xml -->
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <!-- Inject the AOC embed loader on every frontend (website) page -->
    <template id="aoc_embed_loader" inherit_id="website.layout" name="AOC Embed Loader">
        <xpath expr="//body" position="inside">
            <t t-set="aoc_jwt" t-value="request.env['my_aoc_embed.embed'].sign_for_user()" t-if="not request.env.user._is_public()"/>
            <script t-if="aoc_jwt">
                window.AOC_EMBED_JWT = "<t t-out="aoc_jwt"/>";
            </script>
            <script src="${baseUrl}/embed/${embed.id}/loader.js"
                    data-token="${embed.embedToken}" defer="defer"/>
        </xpath>
    </template>
</odoo>`;

  const templateBackend = `<!-- For Odoo backend (web client) instead of website: -->
<!-- my_aoc_embed/views/web_assets.xml -->
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <template id="assets_backend_aoc" inherit_id="web.assets_backend" name="AOC Embed (Backend)">
        <xpath expr="." position="inside">
            <!-- Loader runs at the end of backend bundle -->
            <script src="${baseUrl}/embed/${embed.id}/loader.js"
                    data-token="${embed.embedToken}" defer="defer"/>
        </xpath>
    </template>

    <!-- Inject JWT via a separate template that hooks into web.layout -->
    <template id="aoc_jwt_inject" inherit_id="web.layout" name="AOC Embed JWT (Backend)">
        <xpath expr="//head" position="inside">
            <script type="text/javascript"
                    t-att-data-jwt="request.env['my_aoc_embed.embed'].sign_for_user()">
                window.AOC_EMBED_JWT = document.currentScript.dataset.jwt || '';
            </script>
        </xpath>
    </template>
</odoo>`;

  const model = `# my_aoc_embed/models/embed.py
from odoo import models, api
from ..controllers.embed import sign_visitor_jwt

class AocEmbed(models.AbstractModel):
    """Wrap JWT signing as a model method so QWeb templates can call it
       via request.env['my_aoc_embed.embed'].sign_for_user()."""
    _name = 'my_aoc_embed.embed'
    _description = 'AOC Embed JWT signer'

    @api.model
    def sign_for_user(self):
        user = self.env.user
        if user and not user._is_public():
            return sign_visitor_jwt(user)
        return ''`;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/50 dark:text-amber-200">
        <strong>Prerequisites:</strong> Odoo 17+ with the <code>website</code> module installed (or <code>web</code> for backend-only).
        Install <code>pyjwt</code> in your Odoo Python env: <code>pip install pyjwt</code>.
      </div>

      <div>
        <h4 className="text-sm font-medium mb-1">Step 1 — Module manifest</h4>
        <p className="text-xs text-muted-foreground mb-2">
          Create a new Odoo module (or add to an existing one) with this manifest. Add it to <code>addons_path</code> and install via <em>Apps</em>.
        </p>
        <SnippetCodeBlock title="__manifest__.py" code={manifest} language="python" />
      </div>

      <div>
        <h4 className="text-sm font-medium mb-1">Step 2 — JWT signing helper</h4>
        <p className="text-xs text-muted-foreground mb-2">
          Sign the visitor JWT in a controller using the current Odoo user.
          Copy your <code>AOC_EMBED_SECRET</code> value from the <strong>"Your signing secret"</strong> box at the top of this tab and
          set it as an env var on your Odoo server (don't commit the value to git).
        </p>
        <SnippetCodeBlock title="controllers/embed.py" code={controller} language="python" />
      </div>

      <div>
        <h4 className="text-sm font-medium mb-1">Step 3 — QWeb template patch (frontend / website)</h4>
        <p className="text-xs text-muted-foreground mb-2">
          Inject the loader + JWT into every website page by inheriting <code>website.layout</code>.
          The widget refuses to init if <code>aoc_jwt</code> is empty (anonymous visitor).
        </p>
        <SnippetCodeBlock title="views/website_templates.xml" code={templateFrontend} language="xml" />
      </div>

      <div>
        <h4 className="text-sm font-medium mb-1">Step 4 — QWeb model wrapper</h4>
        <p className="text-xs text-muted-foreground mb-2">
          Expose the signer to QWeb via an AbstractModel — keeps the template thin and avoids inline Python.
        </p>
        <SnippetCodeBlock title="models/embed.py" code={model} language="python" />
      </div>

      <div>
        <h4 className="text-sm font-medium mb-1">Alternative — Backend (web client) integration</h4>
        <p className="text-xs text-muted-foreground mb-2">
          To show the widget inside the Odoo backend (<code>/web</code>) instead of the public website, inherit <code>web.assets_backend</code> + <code>web.layout</code>:
        </p>
        <SnippetCodeBlock title="views/web_assets.xml" code={templateBackend} language="xml" />
      </div>

      <div className="p-3 bg-muted rounded text-xs space-y-1">
        <div className="font-medium">After install:</div>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Update apps list → install <code>my_aoc_embed</code></li>
          <li>Set <code>AOC_EMBED_SECRET</code> env var on the Odoo server, restart</li>
          <li>Visit any website page (logged in) — chat bubble should appear bottom-right</li>
          <li>If 401 on <code>/api/embed/session</code>: verify <code>signing_secret</code> matches and JWT <code>exp</code> is in the future</li>
        </ol>
      </div>
    </div>
  );
}
