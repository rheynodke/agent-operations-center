#!/usr/bin/env node
// Demo SaaS portal for embedding the AOC chat widget — used as a realistic
// host site so you can showcase the floating chat widget in a context that
// resembles a production web app.
//
// Routes (server-rendered, share layout):
//   /            → Dashboard (stats + recent activity)
//   /customers   → Customer list
//   /orders      → Order pipeline
//   /team        → Team directory
//   /help        → FAQ — best page to demo the chat widget
//
// Usage:
//   AOC_EMBED_ID=<id> AOC_EMBED_TOKEN=<token> AOC_EMBED_SIGNING_SECRET=<secret> \
//     node packages/aoc-embed/test-host/serve.js
//
// Or rely on auto-discovery from data/aoc.db (looks up first private embed with
// production_origin = http://localhost:8000):
//   node packages/aoc-embed/test-host/serve.js
//
// Override loader base:
//   AOC_LOADER_BASE=http://localhost:5173 node packages/aoc-embed/test-host/serve.js

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const PORT = parseInt(process.env.PORT || '8000', 10);
const LOADER_BASE = process.env.AOC_LOADER_BASE || 'http://localhost:18800';

let { AOC_EMBED_ID, AOC_EMBED_TOKEN, AOC_EMBED_SIGNING_SECRET } = process.env;

// ── Embed discovery ────────────────────────────────────────────────────────
if (!AOC_EMBED_ID || !AOC_EMBED_TOKEN || !AOC_EMBED_SIGNING_SECRET) {
  const dbPath = path.resolve(__dirname, '../../../data/aoc.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`[test-host] Cannot find data/aoc.db at ${dbPath}. Set env vars manually.`);
    process.exit(1);
  }
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      `sqlite3 "${dbPath}" "SELECT id || '|' || embed_token || '|' || signing_secret FROM agent_embeds WHERE mode='private' AND production_origin = 'http://localhost:${PORT}' LIMIT 1"`,
      { encoding: 'utf8' }
    ).trim();
    if (!out) {
      console.error(`[test-host] No private embed with production_origin=http://localhost:${PORT} found in DB. Provision one in dashboard first.`);
      process.exit(1);
    }
    [AOC_EMBED_ID, AOC_EMBED_TOKEN, AOC_EMBED_SIGNING_SECRET] = out.split('|');
    console.log(`[test-host] Auto-discovered embed: ${AOC_EMBED_ID}`);
  } catch (e) {
    console.error(`[test-host] sqlite query failed:`, e.message);
    process.exit(1);
  }
}

function signJwt(visitorId, name, email) {
  return jwt.sign(
    { visitor_id: visitorId, name, email },
    AOC_EMBED_SIGNING_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' }
  );
}

// ── Demo data ──────────────────────────────────────────────────────────────
const VISITOR = {
  id: process.env.AOC_VISITOR_ID || 'demo-user-42',
  name: process.env.AOC_VISITOR_NAME || 'Anna Tanaka',
  email: process.env.AOC_VISITOR_EMAIL || 'anna@democo.test',
  role: 'Workspace admin',
};

const STATS = [
  { label: 'Monthly revenue',  value: '$124,802', delta: '+18.2%',  trend: 'up'   },
  { label: 'Active users',     value: '8,492',    delta: '+312',    trend: 'up'   },
  { label: 'New customers',    value: '147',      delta: '+22',     trend: 'up'   },
  { label: 'Open tickets',     value: '23',       delta: '-7',      trend: 'down' },
];

const ACTIVITY = [
  { who: 'Marcus Chen',     action: 'completed onboarding',        when: '4 min ago',   tag: 'onboarding' },
  { who: 'Priya Sharma',    action: 'upgraded to Enterprise plan', when: '21 min ago',  tag: 'billing'    },
  { who: 'Eko Wijaya',      action: 'created 3 new automations',   when: '1 hour ago',  tag: 'automation' },
  { who: 'Sofia Andersson', action: 'invited 2 team members',      when: '2 hours ago', tag: 'team'       },
  { who: 'David Mwangi',    action: 'connected Slack integration', when: 'Yesterday',   tag: 'integration'},
];

const CUSTOMERS = [
  { name: 'Northwind Trading',  email: 'ops@northwind.test',    plan: 'Enterprise', status: 'active',    joined: 'Mar 2024' },
  { name: 'Acme Robotics',      email: 'hello@acme-robo.test',  plan: 'Pro',        status: 'active',    joined: 'May 2024' },
  { name: 'Quantum Labs',       email: 'team@quantum.test',     plan: 'Pro',        status: 'trial',     joined: 'Apr 2026' },
  { name: 'Globex Corp',        email: 'admin@globex.test',     plan: 'Starter',    status: 'active',    joined: 'Feb 2025' },
  { name: 'Initech Holdings',   email: 'billing@initech.test',  plan: 'Enterprise', status: 'past due',  joined: 'Jan 2024' },
  { name: 'Stark Industries',   email: 'jarvis@stark.test',     plan: 'Pro',        status: 'active',    joined: 'Aug 2024' },
  { name: 'Wayne Enterprises',  email: 'wayne@wayne.test',      plan: 'Enterprise', status: 'active',    joined: 'Nov 2023' },
];

const ORDERS = [
  { id: 'ORD-10482', customer: 'Northwind Trading',  total: '$4,200.00', status: 'shipped',   placed: 'Today, 10:42'  },
  { id: 'ORD-10481', customer: 'Acme Robotics',      total: '$1,150.00', status: 'pending',   placed: 'Today, 09:18'  },
  { id: 'ORD-10480', customer: 'Globex Corp',        total: '$890.00',   status: 'delivered', placed: 'Yesterday'     },
  { id: 'ORD-10479', customer: 'Stark Industries',   total: '$12,400.00',status: 'shipped',   placed: 'Yesterday'     },
  { id: 'ORD-10478', customer: 'Initech Holdings',   total: '$340.00',   status: 'refunded',  placed: '2 days ago'    },
  { id: 'ORD-10477', customer: 'Quantum Labs',       total: '$2,180.00', status: 'delivered', placed: '2 days ago'    },
];

const TEAM = [
  { name: 'Anna Tanaka',     role: 'Workspace admin', email: 'anna@democo.test',   color: '#6366F1' },
  { name: 'Marcus Chen',     role: 'Engineering lead', email: 'marcus@democo.test', color: '#0EA5E9' },
  { name: 'Priya Sharma',    role: 'Product manager',  email: 'priya@democo.test',  color: '#EC4899' },
  { name: 'Eko Wijaya',      role: 'Sales operations', email: 'eko@democo.test',    color: '#F59E0B' },
  { name: 'Sofia Andersson', role: 'Customer success', email: 'sofia@democo.test', color: '#10B981' },
];

const FAQ = [
  {
    q: 'How do I invite a new team member?',
    a: 'Go to <strong>Team</strong> → click <em>Invite member</em> → enter their email and choose a role. They\'ll receive an invitation email immediately.',
  },
  {
    q: 'Can I downgrade my plan mid-cycle?',
    a: 'Yes. Plan changes take effect at the start of your next billing cycle. We\'ll pro-rate any difference automatically.',
  },
  {
    q: 'Where can I find my API key?',
    a: 'Navigate to <strong>Settings → API Access</strong>. Keys are scoped per environment (dev / staging / production). Rotate any key with a single click.',
  },
  {
    q: 'How does the support chat work?',
    a: 'Click the floating bubble in the bottom-right corner. Our AI assistant is online 24/7 and can hand off to a human agent when needed.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: 'Your workspace is retained for 30 days after cancellation. You can export everything or reactivate within that window. After 30 days data is permanently deleted.',
  },
];

// ── Layout ─────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: '/',          label: 'Dashboard',  icon: '◧' },
  { href: '/customers', label: 'Customers',  icon: '◐' },
  { href: '/orders',    label: 'Orders',     icon: '◑' },
  { href: '/team',      label: 'Team',       icon: '◒' },
  { href: '/help',      label: 'Help',       icon: '◓' },
];

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function layout({ title, body, active }) {
  const token = signJwt(VISITOR.id, VISITOR.name, VISITOR.email);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · DemoCo</title>
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="%236366F1"/><text x="16" y="22" font-family="system-ui" font-size="18" font-weight="700" fill="white" text-anchor="middle">D</text></svg>'
  )}">
  <style>
    :root {
      --bg: #F6F7FB;
      --panel: #FFFFFF;
      --text: #0F172A;
      --muted: #64748B;
      --border: #E2E8F0;
      --primary: #6366F1;
      --primary-soft: rgba(99, 102, 241, 0.08);
      --success: #10B981;
      --warning: #F59E0B;
      --danger: #EF4444;
      --info: #0EA5E9;
      --radius: 10px;
      --shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06);
      --shadow-lg: 0 4px 24px rgba(15, 23, 42, 0.08);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
      font-size: 14px; color: var(--text); background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
           background: #F1F5F9; padding: 1px 6px; border-radius: 4px; }

    .app { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }

    /* ── Sidebar ─────────────────────────────────────── */
    aside.sidebar {
      background: var(--panel); border-right: 1px solid var(--border);
      padding: 20px 12px; display: flex; flex-direction: column; gap: 4px;
      position: sticky; top: 0; height: 100vh;
    }
    .brand {
      display: flex; align-items: center; gap: 10px; padding: 6px 8px 18px;
      font-weight: 700; font-size: 17px;
    }
    .brand-mark {
      width: 32px; height: 32px; border-radius: 8px;
      background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
      display: grid; place-items: center; color: white; font-weight: 800; font-size: 16px;
      box-shadow: var(--shadow);
    }
    .nav-section { margin-top: 8px; padding: 0 8px 4px; font-size: 11px; font-weight: 600;
                   color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .nav-item {
      display: flex; align-items: center; gap: 10px; padding: 8px 10px;
      border-radius: 8px; color: var(--text); text-decoration: none; font-weight: 500;
      transition: background 120ms;
    }
    .nav-item:hover { background: var(--primary-soft); text-decoration: none; }
    .nav-item.active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
    .nav-item .ico { width: 18px; text-align: center; opacity: 0.7; }
    .nav-item.active .ico { opacity: 1; }
    .sidebar-spacer { flex: 1; }
    .sidebar-foot {
      border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px;
      font-size: 12px; color: var(--muted); padding-left: 8px; padding-right: 8px;
    }

    /* ── Top bar + main ──────────────────────────────── */
    main.shell { display: flex; flex-direction: column; min-height: 100vh; }
    .topbar {
      background: var(--panel); border-bottom: 1px solid var(--border);
      padding: 14px 28px; display: flex; align-items: center; gap: 16px;
      position: sticky; top: 0; z-index: 10;
    }
    .topbar h1 { margin: 0; font-size: 18px; font-weight: 600; }
    .search {
      flex: 1; max-width: 420px;
      display: flex; align-items: center; gap: 8px;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 6px 12px; color: var(--muted);
    }
    .search input { border: 0; background: transparent; flex: 1; outline: none; font-size: 13px; color: var(--text); }
    .topbar-right { display: flex; align-items: center; gap: 14px; margin-left: auto; }
    .bell {
      position: relative; cursor: pointer; color: var(--muted); padding: 6px;
    }
    .bell .dot {
      position: absolute; top: 4px; right: 4px;
      width: 8px; height: 8px; border-radius: 50%; background: var(--danger);
      border: 2px solid var(--panel);
    }
    .user-pill {
      display: flex; align-items: center; gap: 10px;
      padding: 4px 10px 4px 4px; border-radius: 24px;
      border: 1px solid var(--border); background: var(--bg);
    }
    .avatar {
      width: 32px; height: 32px; border-radius: 50%;
      display: grid; place-items: center; color: white; font-weight: 600; font-size: 12px;
      background: linear-gradient(135deg, #6366F1 0%, #EC4899 100%);
    }
    .user-pill .name { font-weight: 500; font-size: 13px; }
    .user-pill .role { color: var(--muted); font-size: 11px; }

    .content { padding: 28px; max-width: 1280px; width: 100%; }
    .page-header {
      display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px;
      flex-wrap: wrap; gap: 12px;
    }
    .page-header h2 { margin: 0; font-size: 24px; font-weight: 700; }
    .page-header .subtitle { color: var(--muted); margin-top: 4px; }
    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 8px; font-weight: 500; font-size: 13px;
      background: var(--primary); color: white; border: 0; cursor: pointer;
      transition: opacity 120ms;
    }
    .btn:hover { opacity: 0.92; }
    .btn.btn-outline { background: transparent; color: var(--text); border: 1px solid var(--border); }
    .btn.btn-outline:hover { background: var(--bg); }

    /* ── Panels + cards ──────────────────────────────── */
    .panel {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow);
    }
    .panel-head {
      padding: 16px 20px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .panel-head h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .panel-body { padding: 16px 20px; }

    .stat-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;
    }
    .stat-card { padding: 18px 20px; }
    .stat-card .label { font-size: 12px; color: var(--muted); text-transform: uppercase;
                        letter-spacing: 0.5px; font-weight: 600; }
    .stat-card .value { font-size: 26px; font-weight: 700; margin: 6px 0; }
    .stat-card .delta { font-size: 12px; font-weight: 600; }
    .delta.up { color: var(--success); }
    .delta.down { color: var(--success); /* fewer tickets = good */ }
    .delta.down.bad { color: var(--danger); }

    /* ── Tables ──────────────────────────────────────── */
    table.data { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.data th {
      text-align: left; padding: 10px 14px; color: var(--muted);
      font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border); background: #FAFBFC;
    }
    table.data td {
      padding: 12px 14px; border-bottom: 1px solid var(--border);
    }
    table.data tr:last-child td { border-bottom: 0; }
    table.data tr:hover td { background: var(--bg); }

    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 12px;
      font-size: 11px; font-weight: 600;
    }
    .b-active   { background: #DCFCE7; color: #166534; }
    .b-trial    { background: #DBEAFE; color: #1E40AF; }
    .b-pastdue  { background: #FEE2E2; color: #991B1B; }
    .b-shipped  { background: #E0E7FF; color: #3730A3; }
    .b-pending  { background: #FEF3C7; color: #92400E; }
    .b-delivered{ background: #DCFCE7; color: #166534; }
    .b-refunded { background: #F1F5F9; color: #475569; }
    .b-onboarding { background: #FCE7F3; color: #9D174D; }
    .b-billing    { background: #FFEDD5; color: #9A3412; }
    .b-automation { background: #DDD6FE; color: #5B21B6; }
    .b-team       { background: #CFFAFE; color: #155E75; }
    .b-integration{ background: #FCE7F3; color: #831843; }

    /* ── Team cards ──────────────────────────────────── */
    .team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .team-card { padding: 20px; display: flex; align-items: center; gap: 14px; }
    .team-card .avatar-lg {
      width: 48px; height: 48px; border-radius: 50%;
      display: grid; place-items: center; color: white; font-weight: 700; font-size: 16px;
    }
    .team-card .meta-name { font-weight: 600; }
    .team-card .meta-role { font-size: 12px; color: var(--muted); }
    .team-card .meta-email { font-size: 12px; color: var(--muted); margin-top: 2px; }

    /* ── FAQ ─────────────────────────────────────────── */
    .faq-item { border-top: 1px solid var(--border); }
    .faq-item:first-child { border-top: 0; }
    .faq-q {
      padding: 16px 20px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;
      font-weight: 500; user-select: none;
    }
    .faq-q .chev { color: var(--muted); transition: transform 200ms; }
    .faq-item.open .faq-q .chev { transform: rotate(180deg); }
    .faq-a { display: none; padding: 0 20px 16px; color: var(--muted); line-height: 1.6; }
    .faq-item.open .faq-a { display: block; }

    /* ── Hero callout (Help page) ────────────────────── */
    .hero {
      background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
      color: white; padding: 28px 32px; border-radius: var(--radius);
      margin-bottom: 24px; display: flex; align-items: center; gap: 24px;
    }
    .hero .hero-text { flex: 1; }
    .hero h2 { margin: 0 0 6px; font-size: 22px; }
    .hero p { margin: 0; opacity: 0.92; }
    .hero .hero-cta { font-size: 32px; }

    /* ── Footer ──────────────────────────────────────── */
    footer.app-foot {
      padding: 16px 28px; color: var(--muted); font-size: 12px;
      border-top: 1px solid var(--border); background: var(--panel);
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      flex-wrap: wrap;
    }
    .demo-tag {
      display: inline-flex; align-items: center; gap: 6px;
      background: #FEF3C7; color: #92400E;
      padding: 4px 10px; border-radius: 12px; font-weight: 600;
    }

    @media (max-width: 880px) {
      .app { grid-template-columns: 1fr; }
      aside.sidebar { position: static; height: auto; flex-direction: row; overflow-x: auto; }
      .sidebar-spacer, .sidebar-foot { display: none; }
      .stat-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">D</div>
        <span>DemoCo</span>
      </div>
      <div class="nav-section">Workspace</div>
      ${NAV_ITEMS.map(item => `
        <a href="${item.href}" class="nav-item ${active === item.href ? 'active' : ''}">
          <span class="ico">${item.icon}</span> ${item.label}
        </a>
      `).join('')}
      <div class="sidebar-spacer"></div>
      <div class="sidebar-foot">
        <div>Demo portal · v1.0</div>
        <div style="margin-top:4px">Embed: <code>${AOC_EMBED_ID.slice(0, 8)}…</code></div>
      </div>
    </aside>

    <main class="shell">
      <div class="topbar">
        <div class="search">
          <span>⌕</span>
          <input type="text" placeholder="Search customers, orders, or anything…">
          <span style="font-size:11px; padding: 2px 6px; background: var(--border); border-radius: 4px;">⌘K</span>
        </div>
        <div class="topbar-right">
          <span class="demo-tag">⚡ Demo portal</span>
          <span class="bell" title="Notifications">🔔<span class="dot"></span></span>
          <div class="user-pill">
            <div class="avatar">${initials(VISITOR.name)}</div>
            <div>
              <div class="name">${VISITOR.name}</div>
              <div class="role">${VISITOR.role}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="content">
        ${body}
      </div>

      <footer class="app-foot">
        <div>© 2026 DemoCo · This is a demo host site for the AOC Embed widget.</div>
        <div>Loader: <code>${LOADER_BASE}</code></div>
      </footer>
    </main>
  </div>

  <script>
    // FAQ accordion (used on /help)
    document.querySelectorAll('.faq-q').forEach(q => {
      q.addEventListener('click', () => q.parentElement.classList.toggle('open'));
    });
    // Cmd+K focuses search
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector('.search input')?.focus();
      }
    });
  </script>

  <!-- ── AOC Embed widget ───────────────────────────────────────────── -->
  <script>window.AOC_EMBED_JWT = ${JSON.stringify(token)};</script>
  <script src="${LOADER_BASE}/embed/${AOC_EMBED_ID}/loader.js?_=${Date.now()}"
          data-token="${AOC_EMBED_TOKEN}" defer></script>
</body>
</html>`;
}

// ── Pages ──────────────────────────────────────────────────────────────────
function pageDashboard() {
  return `
    <div class="page-header">
      <div>
        <h2>Welcome back, ${VISITOR.name.split(' ')[0]} 👋</h2>
        <div class="subtitle">Here's what's happening across your workspace today.</div>
      </div>
      <div>
        <button class="btn btn-outline">Export</button>
        <button class="btn">+ New report</button>
      </div>
    </div>

    <div class="stat-grid">
      ${STATS.map((s, i) => `
        <div class="panel stat-card">
          <div class="label">${s.label}</div>
          <div class="value">${s.value}</div>
          <div class="delta ${s.trend} ${i === 3 && s.trend === 'down' ? '' : ''}">
            ${s.trend === 'up' ? '↑' : '↓'} ${s.delta} <span style="color:var(--muted);font-weight:500"> vs last month</span>
          </div>
        </div>
      `).join('')}
    </div>

    <div style="display:grid; grid-template-columns: 2fr 1fr; gap: 16px;">
      <div class="panel">
        <div class="panel-head">
          <h3>Recent activity</h3>
          <a href="#" style="font-size:13px;">View all →</a>
        </div>
        <table class="data">
          <thead>
            <tr><th>User</th><th>Action</th><th>Category</th><th style="text-align:right">When</th></tr>
          </thead>
          <tbody>
            ${ACTIVITY.map(a => `
              <tr>
                <td><strong>${a.who}</strong></td>
                <td>${a.action}</td>
                <td><span class="badge b-${a.tag}">${a.tag}</span></td>
                <td style="text-align:right; color:var(--muted)">${a.when}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Quick actions</h3></div>
        <div class="panel-body" style="display:flex; flex-direction:column; gap:8px;">
          <a href="/customers" class="btn btn-outline" style="justify-content:flex-start">👥 Add customer</a>
          <a href="/orders" class="btn btn-outline" style="justify-content:flex-start">📦 Create order</a>
          <a href="/team" class="btn btn-outline" style="justify-content:flex-start">✉ Invite teammate</a>
          <a href="/help" class="btn btn-outline" style="justify-content:flex-start">💬 Contact support</a>
        </div>
      </div>
    </div>
  `;
}

function pageCustomers() {
  return `
    <div class="page-header">
      <div>
        <h2>Customers</h2>
        <div class="subtitle">${CUSTOMERS.length} workspaces · ${CUSTOMERS.filter(c => c.status === 'active').length} active</div>
      </div>
      <div>
        <button class="btn btn-outline">Import</button>
        <button class="btn">+ Add customer</button>
      </div>
    </div>
    <div class="panel">
      <table class="data">
        <thead><tr><th>Customer</th><th>Email</th><th>Plan</th><th>Status</th><th>Joined</th></tr></thead>
        <tbody>
          ${CUSTOMERS.map(c => `
            <tr>
              <td><strong>${c.name}</strong></td>
              <td style="color:var(--muted)">${c.email}</td>
              <td>${c.plan}</td>
              <td><span class="badge b-${c.status.replace(' ', '')}">${c.status}</span></td>
              <td style="color:var(--muted)">${c.joined}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function pageOrders() {
  return `
    <div class="page-header">
      <div>
        <h2>Orders</h2>
        <div class="subtitle">${ORDERS.length} orders this week</div>
      </div>
      <div><button class="btn">+ Create order</button></div>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:16px;">
      ${['All', 'Pending', 'Shipped', 'Delivered', 'Refunded'].map((f, i) => `
        <button class="btn ${i === 0 ? '' : 'btn-outline'}">${f}</button>
      `).join('')}
    </div>
    <div class="panel">
      <table class="data">
        <thead><tr><th>Order #</th><th>Customer</th><th>Total</th><th>Status</th><th style="text-align:right">Placed</th></tr></thead>
        <tbody>
          ${ORDERS.map(o => `
            <tr>
              <td><strong>${o.id}</strong></td>
              <td>${o.customer}</td>
              <td>${o.total}</td>
              <td><span class="badge b-${o.status}">${o.status}</span></td>
              <td style="text-align:right; color:var(--muted)">${o.placed}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function pageTeam() {
  return `
    <div class="page-header">
      <div>
        <h2>Team</h2>
        <div class="subtitle">${TEAM.length} members in your workspace</div>
      </div>
      <div><button class="btn">✉ Invite member</button></div>
    </div>
    <div class="team-grid">
      ${TEAM.map(t => `
        <div class="panel team-card">
          <div class="avatar-lg" style="background:${t.color}">${initials(t.name)}</div>
          <div>
            <div class="meta-name">${t.name}</div>
            <div class="meta-role">${t.role}</div>
            <div class="meta-email">${t.email}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function pageHelp() {
  return `
    <div class="hero">
      <div class="hero-text">
        <h2>Need a hand?</h2>
        <p>Our AI assistant is online 24/7 and ready to help. Tap the chat bubble in the bottom-right →</p>
      </div>
      <div class="hero-cta">💬</div>
    </div>

    <div class="page-header">
      <div>
        <h2>Frequently asked questions</h2>
        <div class="subtitle">Quick answers to common questions. Can't find what you need? Use the chat.</div>
      </div>
    </div>

    <div class="panel">
      ${FAQ.map(item => `
        <div class="faq-item">
          <div class="faq-q">
            <span>${item.q}</span>
            <span class="chev">▾</span>
          </div>
          <div class="faq-a">${item.a}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function page404() {
  return `
    <div class="page-header">
      <div>
        <h2>404 — Page not found</h2>
        <div class="subtitle">The page you're looking for doesn't exist. <a href="/">Back to dashboard</a></div>
      </div>
    </div>
  `;
}

// ── Server ─────────────────────────────────────────────────────────────────
const ROUTES = {
  '/':          { title: 'Dashboard', render: pageDashboard },
  '/customers': { title: 'Customers', render: pageCustomers },
  '/orders':    { title: 'Orders',    render: pageOrders    },
  '/team':      { title: 'Team',      render: pageTeam      },
  '/help':      { title: 'Help',      render: pageHelp      },
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  const route = ROUTES[urlPath];
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(layout({ title: '404', body: page404(), active: null }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(layout({ title: route.title, body: route.render(), active: urlPath }));
});

server.listen(PORT, () => {
  console.log(`[test-host] DemoCo portal running on http://localhost:${PORT}`);
  console.log(`[test-host] Routes: ${Object.keys(ROUTES).join(', ')}`);
  console.log(`[test-host] Embed loader from: ${LOADER_BASE}`);
});
