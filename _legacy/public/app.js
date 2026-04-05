(function() {
  'use strict';

  // --- State ---
  let token = sessionStorage.getItem('dashboard_token') || '';
  let ws = null;
  let wsReconnectTimer = null;
  let refreshTimer = null;

  // --- DOM refs ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const loginScreen = $('#login-screen');
  const dashboard = $('#dashboard');
  const tokenInput = $('#token-input');
  const connectBtn = $('#connect-btn');
  const loginError = $('#login-error');
  const logoutBtn = $('#logout-btn');
  const wsIndicator = $('#ws-indicator');
  const wsStatusText = $('#ws-status-text');
  const liveFeedToggle = $('#live-feed-toggle');
  const liveFeed = $('#live-feed');
  const feedEntries = $('#live-feed-entries');
  const feedChevron = $('#feed-chevron');
  const modalEl = $('#session-modal');
  const modalBackdrop = $('#modal-backdrop');
  const modalClose = $('#modal-close');
  let modalParentAgent = null; // track which agent opened the session detail
  let currentOpenSessionId = null; // track which session is open for auto-refresh

  // --- API helpers ---
  async function api(endpoint) {
    const res = await fetch(`/api/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      logout();
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  // --- Auth ---
  function showLogin() {
    loginScreen.classList.remove('hidden');
    dashboard.classList.add('hidden');
    tokenInput.focus();
  }

  function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    loadAllData();
    connectWebSocket();
    startAutoRefresh();
  }

  async function attemptLogin(inputToken) {
    token = inputToken.trim();
    if (!token) { showError('Please enter a token'); return; }
    connectBtn.disabled = true;
    connectBtn.querySelector('span').textContent = 'Connecting...';
    try {
      await api('dashboard');
      sessionStorage.setItem('dashboard_token', token);
      loginError.classList.add('hidden');
      showDashboard();
    } catch (err) {
      showError('Invalid token or server unreachable');
      token = '';
    } finally {
      connectBtn.disabled = false;
      connectBtn.querySelector('span').textContent = 'Connect';
    }
  }

  function logout() {
    sessionStorage.removeItem('dashboard_token');
    token = '';
    disconnectWebSocket();
    clearInterval(refreshTimer);
    showLogin();
  }

  function showError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
  }

  // --- Navigation ---
  function navigateTo(view) {
    $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    $$('.mobile-nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  }

  // --- WebSocket ---
  function connectWebSocket() {
    if (ws) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`;
    ws = new WebSocket(url);
    setWsStatus('connecting');
    ws.onopen = () => { setWsStatus('connected'); if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; } };
    ws.onmessage = (e) => { try { handleLiveEvent(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => { ws = null; setWsStatus('disconnected'); scheduleReconnect(); };
    ws.onerror = () => { ws?.close(); };
  }

  function disconnectWebSocket() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { ws.close(); ws = null; }
    setWsStatus('disconnected');
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => { wsReconnectTimer = null; if (token) connectWebSocket(); }, 5000);
  }

  function setWsStatus(status) {
    wsIndicator.className = 'ws-indicator ' + status;
    const labels = { connecting: 'Connecting...', connected: 'Live', disconnected: 'Offline' };
    wsStatusText.textContent = labels[status] || status;
  }

  // --- Live Feed ---
  // --- Live activity tracking ---
  const liveAgentActivity = new Map(); // agentId -> { detail, timestamp }
  let bannerTimeout = null;

  function handleLiveEvent(event) {
    addFeedEntry(event);
    if (['session:update', 'opencode:event', 'progress:step', 'progress:update', 'gateway:update'].includes(event.type)) {
      debouncedRefreshSessions();
      refreshOpenSession();
    }

    // Track live agent activity
    const agentId = event.agent || event.agentId;
    if (agentId) {
      let detail = '';
      if (event.type === 'session:update' && event.action === 'message') {
        detail = 'Processing message…';
      } else if (event.type === 'session:update' && event.action === 'new_session') {
        detail = 'New session started';
      } else if (event.type === 'opencode:event') {
        detail = event.tool ? `Using ${event.tool}` : 'Coding…';
      } else if (event.type === 'progress:step') {
        detail = event.detail || 'Working…';
      } else {
        detail = 'Active';
      }

      liveAgentActivity.set(agentId, { detail, timestamp: Date.now() });
      updateLiveBanner();
      updateAgentLiveStatus();

      // Auto-clear after 8s of no new activity
      setTimeout(() => {
        const entry = liveAgentActivity.get(agentId);
        if (entry && Date.now() - entry.timestamp >= 7000) {
          liveAgentActivity.delete(agentId);
          updateLiveBanner();
          updateAgentLiveStatus();
        }
      }, 8000);
    }
  }

  function updateLiveBanner() {
    const banner = $('#live-banner');
    const text = $('#live-banner-text');
    if (liveAgentActivity.size === 0) {
      banner.classList.add('hidden');
      return;
    }
    // Show most recent activity
    const entries = [...liveAgentActivity.entries()];
    const latest = entries.sort((a, b) => b[1].timestamp - a[1].timestamp)[0];
    const agentName = allAgents.find(a => a.id === latest[0])?.name || latest[0];
    text.textContent = `${agentName}: ${latest[1].detail}`;
    if (entries.length > 1) {
      text.textContent += ` (+${entries.length - 1} more)`;
    }
    banner.classList.remove('hidden');
  }

  function updateAgentLiveStatus() {
    // Update mini agent cards
    document.querySelectorAll('.agent-card-mini[data-agent-id]').forEach(card => {
      const id = card.dataset.agentId;
      const existing = card.querySelector('.agent-live-label');
      if (liveAgentActivity.has(id)) {
        card.classList.add('agent-live');
        const detail = liveAgentActivity.get(id).detail;
        if (existing) {
          existing.textContent = detail;
        } else {
          const label = document.createElement('div');
          label.className = 'agent-live-label';
          label.textContent = detail;
          card.appendChild(label);
        }
      } else {
        card.classList.remove('agent-live');
        if (existing) existing.remove();
      }
    });
    // Update full agent cards
    document.querySelectorAll('.agent-card[data-agent-id]').forEach(card => {
      const id = card.dataset.agentId;
      const existing = card.querySelector('.agent-live-label');
      if (liveAgentActivity.has(id)) {
        card.classList.add('agent-live');
        const detail = liveAgentActivity.get(id).detail;
        if (existing) {
          existing.textContent = detail;
        } else {
          const label = document.createElement('div');
          label.className = 'agent-live-label';
          label.textContent = detail;
          card.appendChild(label);
        }
      } else {
        card.classList.remove('agent-live');
        if (existing) existing.remove();
      }
    });
  }

  let feedCount = 0;
  const MAX_FEED = 200;

  function addFeedEntry(event) {
    const div = document.createElement('div');
    div.className = 'feed-entry';
    const time = new Date(event.timestamp).toLocaleTimeString('en-GB', { hour12: false });
    const type = event.eventType || event.type || 'unknown';
    let detail = '';
    if (event.type === 'opencode:event') {
      if (event.tool) detail = event.tool;
      if (event.input?.filePath) detail += ` → ${event.input.filePath}`;
      if (event.input?.command) detail += ` → ${event.input.command}`;
    } else if (event.type === 'progress:step') {
      detail = `${event.stepType || ''} ${event.detail || ''}`;
    } else if (event.type === 'session:update') {
      detail = event.file || '';
    } else {
      detail = event.file || event.message || JSON.stringify(event).slice(0, 120);
    }
    div.innerHTML = `<span class="feed-time">${time}</span><span class="feed-type ${type}">${type}</span><span class="feed-detail">${escapeHtml(detail)}</span>`;
    feedEntries.prepend(div);
    feedCount++;
    if (feedCount > MAX_FEED) { feedEntries.lastElementChild?.remove(); feedCount--; }
  }

  // --- Data Loading ---
  let allSessions = [];
  let allAgents = [];

  async function loadAllData() {
    try {
      const [dashData, sessionsData, agentsData] = await Promise.all([
        api('dashboard'), api('sessions'), api('agents'),
      ]);
      allSessions = sessionsData.sessions;
      allAgents = agentsData.agents;
      renderStats(dashData);
      renderActivityFeed(allSessions);
      renderAgentsMini(allAgents);
      renderKanban(allSessions);
      renderSessionsList(allSessions);
      renderAgentsRegistry(allAgents);
      loadCronData();
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }

  async function loadCronData() { try { const d = await api('cron'); renderCron(d.jobs); } catch {} }

  let refreshDebounce = null;
  function debouncedRefreshSessions() {
    if (refreshDebounce) return;
    refreshDebounce = setTimeout(async () => {
      refreshDebounce = null;
      try {
        const [dashData, sessionsData] = await Promise.all([api('dashboard'), api('sessions')]);
        allSessions = sessionsData.sessions;
        renderStats(dashData);
        renderActivityFeed(allSessions);
        renderKanban(allSessions);
        renderSessionsList(allSessions);
      } catch {}
    }, 2000);
  }

  function startAutoRefresh() { refreshTimer = setInterval(loadAllData, 30000); }

  // --- Helper: unified session display ---
  function getSessionDisplay(s) {
    const isGateway = s.source === 'gateway';
    const name = s.name || 'Untitled';
    const agent = s.agent || 'unknown';
    const status = s.status || 'unknown';
    const cost = s.cost || 0;

    // For gateway sessions, use updatedAt; for code-agent, use startedAt/completedAt
    const timestamp = s.updatedAt || s.completedAt || s.startedAt || 0;
    const time = formatTime(timestamp);

    // Type badge
    const typeLabel = isGateway ? (s.type || 'gateway') : 'opencode';
    const typeIcon = s.type === 'telegram' ? 'chat' :
                     s.type === 'cron' ? 'schedule' :
                     s.type === 'hook' ? 'webhook' :
                     s.type === 'opencode' ? 'code' : 'hub';

    // Status chip
    const chipClass = status === 'completed' ? 'chip--success' :
                      status === 'failed' || status === 'killed' ? 'chip--error' :
                      status === 'running' || status === 'started' || status === 'active' ? 'chip--info' :
                      status === 'idle' ? 'chip--neutral' : 'chip--neutral';

    // Meta info
    let meta = '';
    if (isGateway) {
      if (s.messageCount) meta += `${s.messageCount} msgs`;
      if (s.toolCalls) meta += ` • ${s.toolCalls} tools`;
      if (cost) meta += ` • $${cost}`;
    } else {
      if (s.duration) meta += s.duration;
      if (cost) meta += ` • $${cost}`;
      if (s.toolsUsed) meta += ` • ${s.toolsUsed} tools`;
    }

    // Agent identity icon — try exact match, then prefix match
    const agentIcon = AGENT_ICONS[agent] ||
      Object.entries(AGENT_ICONS).find(([k]) => agent.startsWith(k))?.[1] ||
      'smart_toy';

    return { name, agent, status, cost, timestamp, time, typeLabel, typeIcon, chipClass, meta, isGateway, agentIcon };
  }

  // --- Render: Stats ---
  function renderStats(data) {
    const row = $('#stats-row');
    row.innerHTML = `
      ${statCard('Gateway', 'hub', data.gateway?.status === 'running' ? 'Running' : 'Down', '', `Port ${data.gateway?.port || '—'}`, data.gateway?.status === 'running')}
      ${statCard('Sessions', 'forum', data.sessions?.total || 0, 'total', `${data.sessions?.active || 0} active • ${data.sessions?.gateway || 0} gateway`)}
      ${statCard('Agents', 'smart_toy', data.agents?.total || 0, 'provisioned', `${data.agents?.active || 0} active`)}
      ${statCard('Total Cost', 'payments', `$${data.cost?.total?.toFixed(2) || '0.00'}`, 'USD', '')}
    `;
  }

  function statCard(label, icon, value, unit, sub, isRunning) {
    return `
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">${label}</span>
          <span class="material-symbols-outlined stat-card-icon">${icon}</span>
        </div>
        <div class="stat-card-value">
          ${isRunning !== undefined ? `<div class="pulse-dot pulse-dot--success" style="margin-right:8px"></div>` : ''}
          <span class="stat-card-number">${value}</span>
          ${unit ? `<span class="stat-card-unit">${unit}</span>` : ''}
        </div>
        ${sub ? `<p class="stat-card-sub">${sub}</p>` : ''}
      </div>
    `;
  }

  // --- Render: Activity Feed ---
  function renderActivityFeed(sessions) {
    const list = $('#activity-list');
    const sorted = [...sessions].sort((a, b) => {
      const ta = a.updatedAt || new Date(a.completedAt || a.startedAt || 0).getTime();
      const tb = b.updatedAt || new Date(b.completedAt || b.startedAt || 0).getTime();
      return tb - ta;
    });
    const recent = sorted.slice(0, 10);

    if (recent.length === 0) {
      list.innerHTML = '<div class="feed-empty">No recent activity</div>';
      return;
    }

    list.innerHTML = recent.map(s => {
      const d = getSessionDisplay(s);
      return `
        <div class="activity-entry" data-session-id="${s.id}" style="cursor:pointer">
          <span class="activity-time">${d.time}</span>
          <div class="activity-body">
            <p class="activity-text">
              <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px">${d.agentIcon}</span>
              <span class="highlight">${escapeHtml(d.agent)}</span>
              ${escapeHtml(d.name.slice(0, 60))}
            </p>
            <div class="activity-meta">
              <span class="chip ${d.chipClass}">${d.status}</span>
              <span class="chip chip--neutral">${d.typeLabel}</span>
              <span style="font-size:10px;color:var(--on-surface-variant)">${d.meta}</span>
            </div>
            ${s.lastMessage ? `<p style="font-size:11px;color:var(--on-surface-variant);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.lastMessage.slice(0, 100))}</p>` : ''}
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-session-id]').forEach(el => {
      el.addEventListener('click', () => openSessionDetail(el.dataset.sessionId));
    });
  }

  // --- Render: Agents Mini ---
  const AGENT_ICONS = {
    main: 'hub', orchestrator: 'hub',
    sysadmin: 'terminal', 'odoo-sql': 'database',
    researcher: 'science', 'code-reviewer': 'code',
    pm: 'assignment', 'frontend-dev': 'palette',
    'backend-dev': 'settings', 'odoo-dev': 'build',
    'mc-gateway': 'router', gateway: 'router',
    cron: 'schedule', hook: 'webhook',
    claude: 'psychology', opencode: 'code',
  };

  function renderAgentsMini(agents) {
    const grid = $('#agent-grid-mini');
    const count = $('#agent-online-count');
    count.innerHTML = `<span style="font-size:11px;color:var(--on-surface-variant)">${agents.length} Online</span>`;
    grid.innerHTML = agents.map(a => {
      const icon = AGENT_ICONS[a.id] || AGENT_ICONS[a.role?.toLowerCase()] || 'smart_toy';
      const isActive = a.status === 'active';
      return `
        <div class="agent-card-mini" data-agent-id="${a.id}" style="cursor:pointer">
          <div class="agent-card-mini-top">
            <div class="agent-icon-box ${isActive ? '' : 'idle'}"><span class="material-symbols-outlined">${icon}</span></div>
            <span class="agent-status-chip ${isActive ? 'active' : 'idle'}">${isActive ? 'Active' : 'Idle'}</span>
          </div>
          <h4>${escapeHtml(a.name)}</h4>
          <p class="agent-model">${escapeHtml(a.model)}</p>
        </div>
      `;
    }).join('');
    grid.querySelectorAll('[data-agent-id]').forEach(el => {
      el.addEventListener('click', () => openAgentDetail(el.dataset.agentId));
    });
  }

  // --- Render: Kanban (only code-agent tasks) ---
  function renderKanban(sessions) {
    const tasks = sessions.filter(s => s.source === 'code-agent');
    const cols = { queued: [], running: [], completed: [], failed: [] };

    tasks.forEach(s => {
      const status = s.status?.toLowerCase() || 'unknown';
      if (status === 'running' || status === 'started') cols.running.push(s);
      else if (status === 'completed') cols.completed.push(s);
      else if (status === 'failed' || status === 'killed' || status === 'error') cols.failed.push(s);
      else cols.queued.push(s);
    });

    Object.keys(cols).forEach(key => {
      const container = $(`#col-${key}`);
      const countEl = $(`#count-${key}`);
      countEl.textContent = cols[key].length;

      if (cols[key].length === 0) {
        container.innerHTML = '<div style="padding:var(--space-6);text-align:center;color:var(--on-surface-variant);font-size:12px">No tasks</div>';
        return;
      }

      container.innerHTML = cols[key].map(s => {
        const d = getSessionDisplay(s);
        return `
          <div class="kanban-task-card ${key === 'running' ? 'running' : ''}" data-session-id="${s.id}">
            <div class="task-card-name">${escapeHtml(d.name.slice(0, 50))}</div>
            <div class="task-card-agent">${escapeHtml(d.agent)}</div>
            <div class="task-card-meta">
              ${s.duration ? `<span class="material-symbols-outlined">schedule</span><span>${s.duration}</span>` : ''}
              ${s.cost ? `<span>$${s.cost}</span>` : ''}
              ${s.toolsUsed ? `<span class="material-symbols-outlined">build</span><span>${s.toolsUsed}</span>` : ''}
            </div>
            ${key === 'running' ? '<div class="task-progress"><div class="task-progress-bar" style="width:60%"></div></div>' : ''}
          </div>
        `;
      }).join('');

      container.querySelectorAll('[data-session-id]').forEach(el => {
        el.addEventListener('click', () => openSessionDetail(el.dataset.sessionId));
      });
    });
  }

  // --- Render: Sessions List (gateway sessions) ---
  let sessionTypeFilter = 'all';

  function renderSessionsList(sessions) {
    const gwSessions = sessions.filter(s => s.source === 'gateway');

    // Render filter chips
    const types = ['all', ...new Set(gwSessions.map(s => s.type).filter(Boolean))];
    const filtersEl = $('#sessions-filters');
    filtersEl.innerHTML = types.map(t => `
      <button class="chip ${t === sessionTypeFilter ? 'chip--info' : 'chip--neutral'}" data-filter="${t}" style="cursor:pointer">
        ${t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)} ${t === 'all' ? `(${gwSessions.length})` : `(${gwSessions.filter(s => s.type === t).length})`}
      </button>
    `).join('');

    filtersEl.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        sessionTypeFilter = btn.dataset.filter;
        renderSessionsList(sessions);
      });
    });

    const filtered = sessionTypeFilter === 'all' ? gwSessions : gwSessions.filter(s => s.type === sessionTypeFilter);
    const listEl = $('#sessions-list');

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="feed-empty">No sessions found</div>';
      return;
    }

    listEl.innerHTML = filtered.map(s => {
      const d = getSessionDisplay(s);
      return `
        <div class="session-row" data-session-id="${s.id}" style="cursor:pointer">
          <div class="session-row-icon">
            <span class="material-symbols-outlined">${d.agentIcon}</span>
          </div>
          <div class="session-row-body">
            <div class="session-row-top">
              <span class="session-row-name">${escapeHtml(d.name)}</span>
              <span class="chip ${d.chipClass}" style="font-size:10px">${d.status}</span>
              <span class="chip chip--neutral" style="font-size:10px">${d.typeLabel}</span>
            </div>
            <div class="session-row-meta">
              <span class="material-symbols-outlined" style="font-size:13px">${d.agentIcon}</span>
              <span>${escapeHtml(d.agent)}</span>
              ${s.messageCount ? `<span style="margin-left:8px">💬 ${s.messageCount}</span>` : ''}
              ${s.toolCalls ? `<span style="margin-left:8px">🔧 ${s.toolCalls}</span>` : ''}
              ${s.cost ? `<span style="margin-left:8px">$${s.cost}</span>` : ''}
              <span style="margin-left:auto">${d.time}</span>
            </div>
            ${s.lastMessage ? `<p class="session-row-msg">${escapeHtml(s.lastMessage.slice(0, 120))}</p>` : ''}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-session-id]').forEach(el => {
      el.addEventListener('click', () => openSessionDetail(el.dataset.sessionId));
    });
  }

  // --- Render: Agents Registry ---
  function renderAgentsRegistry(agents) {
    const grid = $('#agent-grid');
    grid.innerHTML = agents.map(a => {
      const icon = AGENT_ICONS[a.id] || AGENT_ICONS[a.role?.toLowerCase()] || 'smart_toy';
      const isActive = a.status === 'active';
      // Count sessions for this agent
      const agentSessions = allSessions.filter(s => s.agent === a.id || s.agent === a.name?.toLowerCase());
      const activeSessions = agentSessions.filter(s => s.status === 'active' || s.status === 'running');
      return `
        <div class="agent-card" data-agent-id="${a.id}" style="cursor:pointer">
          <div class="agent-card-top">
            <div class="agent-card-icon"><span class="material-symbols-outlined">${icon}</span></div>
            <span class="agent-status-chip ${isActive ? 'active' : 'idle'}">${isActive ? 'Active' : 'Idle'}</span>
          </div>
          <h3>${escapeHtml(a.name)}</h3>
          <p class="agent-role">${escapeHtml(a.role || a.id)}</p>
          <p class="agent-model">${escapeHtml(a.model)}</p>
          <div class="agent-card-stats">
            <span class="material-symbols-outlined" style="font-size:14px">forum</span>
            <span>${agentSessions.length} sessions</span>
            ${activeSessions.length > 0 ? `<span class="chip chip--info" style="margin-left:4px">${activeSessions.length} active</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
    grid.querySelectorAll('[data-agent-id]').forEach(el => {
      el.addEventListener('click', () => openAgentDetail(el.dataset.agentId));
    });
  }

  // --- Agent Detail ---
  function openAgentDetail(agentId) {
    modalParentAgent = null; // reset when opening agent detail directly
    const agent = allAgents.find(a => a.id === agentId);
    if (!agent) return;

    // Find sessions for this agent
    const agentSessions = allSessions.filter(s =>
      s.agent === agentId || s.agent === agent.name?.toLowerCase()
    );

    const icon = AGENT_ICONS[agentId] || 'smart_toy';
    const isActive = agent.status === 'active';

    // Stats
    const totalCost = agentSessions.reduce((sum, s) => sum + (s.cost || 0), 0);
    const totalMessages = agentSessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);
    const activeSess = agentSessions.filter(s => s.status === 'active' || s.status === 'running').length;

    // Humanize session name
    function humanName(s) {
      const d = getSessionDisplay(s);
      let name = d.name;
      // Strip agent prefix and UUIDs
      name = name.replace(/^agent:[^:]+:?/, '');
      name = name.replace(/:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]+/gi, '');
      name = name.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]+/gi, '');
      // Clean up remaining colons and dashes
      name = name.replace(/^[:\s]+|[:\s]+$/g, '');
      // Humanize: dashes to spaces, capitalize
      if (name) {
        name = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
      return name || d.typeLabel.charAt(0).toUpperCase() + d.typeLabel.slice(1) + ' Session';
    }

    // Build modal content as full custom layout
    const modal = $('#session-modal');
    modal.classList.remove('hidden');

    // Header
    $('#modal-title').innerHTML = `
      <span class="material-symbols-outlined" style="font-size:18px;color:var(--primary);vertical-align:middle;margin-right:4px">${icon}</span>
      ${escapeHtml(agent.name)}
    `;

    // Info bar with inline stats
    $('#modal-info-bar').innerHTML = `
      <div class="info-bar-item"><span class="info-bar-label">Model</span> <span class="info-bar-value">${escapeHtml(agent.model)}</span></div>
      <div class="info-bar-item"><span class="info-bar-label">Status</span> <span class="info-bar-value"><span class="agent-status-chip ${isActive ? 'active' : 'idle'}">${isActive ? 'Active' : 'Idle'}</span></span></div>
      <div class="info-bar-item"><span class="info-bar-label">Cost</span> <span class="info-bar-value">$${totalCost.toFixed(2)}</span></div>
    `;

    // Summary stats
    $('#session-stats').innerHTML = `
      <div class="summary-stat"><div class="summary-stat-label">Sessions</div><div class="summary-stat-value">${agentSessions.length}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Active</div><div class="summary-stat-value" style="${activeSess > 0 ? 'color:var(--primary)' : ''}">${activeSess}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Messages</div><div class="summary-stat-value">${totalMessages}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Cost</div><div class="summary-stat-value">$${totalCost.toFixed(2)}</div></div>
    `;

    // Tool chart: clear
    $('#tool-chart').innerHTML = '';

    // Timeline: render as curated session list
    const timeline = $('#session-timeline');
    if (agentSessions.length === 0) {
      timeline.innerHTML = '<div class="feed-empty">No sessions for this agent</div>';
    } else {
      timeline.innerHTML = agentSessions.slice(0, 30).map((s, idx) => {
        const d = getSessionDisplay(s);
        const name = humanName(s);
        const isRunning = s.status === 'active' || s.status === 'running';
        const statusDot = isRunning ? '🟢' : s.status === 'failed' ? '🔴' : '⚪';
        const msgCount = s.messageCount || 0;
        const lastMsg = s.lastMessage ? escapeHtml(s.lastMessage.slice(0, 80)) : '';

        return `
        <div class="ad-session" data-session-id="${s.id}">
          <div class="ad-session-left">
            <span class="ad-dot">${statusDot}</span>
          </div>
          <div class="ad-session-right">
            <div class="ad-session-title">${escapeHtml(name)}</div>
            <div class="ad-session-chips">
              <span class="chip ${d.chipClass}">${d.status}</span>
              <span class="chip chip--neutral">${d.typeLabel}</span>
              ${msgCount > 0 ? `<span class="ad-msg-count">💬 ${msgCount}</span>` : ''}
              <span class="ad-time">${d.time}</span>
            </div>
            ${lastMsg ? `<div class="ad-session-preview">${lastMsg}</div>` : ''}
          </div>
        </div>`;
      }).join('');

      timeline.querySelectorAll('[data-session-id]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          modalParentAgent = agentId; // remember which agent we came from
          openSessionDetail(el.dataset.sessionId);
        });
      });
    }
  }

  // --- Render: Cron ---
  function renderCron(jobs) {
    const list = $('#cron-list');
    if (!jobs || jobs.length === 0) {
      list.innerHTML = '<div class="feed-empty">No cron jobs configured</div>';
      return;
    }
    list.innerHTML = jobs.map(j => `
      <div class="cron-card">
        <div class="cron-icon"><span class="material-symbols-outlined">schedule</span></div>
        <div class="cron-info">
          <div class="cron-name">${escapeHtml(j.name || j.id || 'Job')}</div>
          <div class="cron-schedule">${escapeHtml(j.schedule || j.cron || '')}</div>
        </div>
        <div class="cron-status-col">
          <span class="chip ${j.status === 'active' ? 'chip--success' : 'chip--neutral'}">${j.status || 'unknown'}</span>
          <div class="cron-last-run">${j.lastRun ? formatTime(j.lastRun) : 'Never'}</div>
        </div>
      </div>
    `).join('');
  }

  // --- Session Detail Modal ---
  async function openSessionDetail(sessionId) {
    try {
      currentOpenSessionId = sessionId;
      lastRenderedEventCount = 0; // reset for full render
      const session = await api(`sessions/${sessionId}`);
      renderSessionModal(session, false);
      modalEl.classList.remove('hidden');
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  }

  // Auto-refresh the open session when live events arrive
  let sessionRefreshDebounce = null;
  function refreshOpenSession() {
    if (!currentOpenSessionId || modalEl.classList.contains('hidden')) return;
    if (sessionRefreshDebounce) return; // already pending
    sessionRefreshDebounce = setTimeout(async () => {
      sessionRefreshDebounce = null;
      if (!currentOpenSessionId) return;
      try {
        const session = await api(`sessions/${currentOpenSessionId}`);
        renderSessionModal(session, true); // incremental: only new events
      } catch {}
    }, 1500); // 1.5s debounce to batch rapid updates
  }

  function closeModal() {
    // If we came from an agent detail, go back to it
    if (modalParentAgent) {
      const agentId = modalParentAgent;
      modalParentAgent = null;
      currentOpenSessionId = null;
      openAgentDetail(agentId);
      return;
    }
    currentOpenSessionId = null;
    modalEl.classList.add('hidden');
  }

  let lastRenderedEventCount = 0;

  function createProcessingIndicator() {
    const el = document.createElement('div');
    el.className = 'processing-indicator';
    el.innerHTML = '<div class="processing-dots"><span></span><span></span><span></span></div><span>Agent is processing…</span>';
    return el;
  }

  function renderTimelineEventHtml(ev) {
    const time = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString('en-GB', { hour12: false }) : '';

    if (ev.role) {
      const dotClass = ev.role === 'user' ? 'started' :
                       ev.role === 'assistant' ? 'completed' :
                       ev.role === 'tool' ? 'tool' : 'text';
      let roleLabel, roleIcon;
      if (ev.role === 'user') {
        roleLabel = ev.sender?.name || 'User';
        roleIcon = '👤';
      } else if (ev.role === 'assistant') {
        roleLabel = 'Agent';
        roleIcon = '🤖';
      } else if (ev.role === 'tool') {
        roleLabel = 'toolResult';
        roleIcon = '🔧';
      } else {
        roleLabel = ev.role;
        roleIcon = '💬';
      }

      let detail = ev.text || '';
      let toolsHtml = '';
      if (ev.tools && ev.tools.length > 0) {
        toolsHtml = ev.tools.map(t => {
          const content = escapeHtml((t.input || t.output || '').slice(0, 150));
          return `<div class="timeline-code"><strong>${escapeHtml(t.name)}</strong>${content ? ': ' + content : ''}</div>`;
        }).join('');
      }
      if (ev.role === 'tool' && detail.length > 200) {
        detail = detail.slice(0, 200) + '…';
      }

      const costHtml = ev.cost ? `<span style="font-size:10px;color:var(--on-surface-variant);margin-left:8px">$${ev.cost.toFixed(4)}</span>` : '';
      const tokenHtml = ev.tokens ? `<span style="font-size:10px;color:var(--on-surface-variant);margin-left:8px">${formatTokens(ev.tokens.total)} tok</span>` : '';

      return `
        <div class="timeline-event">
          <div class="timeline-dot ${dotClass}"></div>
          <div class="timeline-time">${time} ${costHtml} ${tokenHtml}</div>
          <div class="timeline-type">${roleIcon} ${escapeHtml(roleLabel)}</div>
          ${detail ? `<div class="timeline-detail">${escapeHtml(detail)}</div>` : ''}
          ${toolsHtml}
        </div>
      `;
    } else {
      const dotClass = ev.type === 'step_start' ? 'started' :
                       ev.type === 'step_finish' ? 'completed' :
                       ev.type === 'tool_use' ? 'tool' : 'text';
      let detail = '';
      if (ev.tool) detail = ev.tool;
      if (ev.input?.filePath) detail += ` → ${ev.input.filePath}`;
      if (ev.input?.command) detail += ` → ${ev.input.command}`;
      if (ev.text) detail = ev.text.slice(0, 150);

      const codeBlock = ev.input?.command ?
        `<div class="timeline-code">$ ${escapeHtml(ev.input.command)}</div>` :
        ev.input?.filePath ?
        `<div class="timeline-code">${escapeHtml(ev.input.filePath)}</div>` : '';

      return `
        <div class="timeline-event">
          <div class="timeline-dot ${dotClass}"></div>
          <div class="timeline-time">${time}</div>
          <div class="timeline-type">${ev.type?.replace('_', ' ') || 'event'}</div>
          <div class="timeline-detail">${escapeHtml(detail)}</div>
          ${codeBlock}
        </div>
      `;
    }
  }

  function renderSessionModal(session, incrementalUpdate) {
    const d = getSessionDisplay(session);
    const events = session.events || [];
    // Determine if the agent is truly processing right now.
    // session.status may be 'active' just because it was updated recently (within 2min),
    // but that doesn't mean the agent is currently generating a response.
    // Check the last event: if the last assistant message has a stopReason, the agent
    // finished its turn. If the last message is from the user, the agent hasn't started
    // replying yet (or already replied earlier). Only show processing if the last event
    // is an assistant message WITHOUT a stopReason (mid-stream) or a tool call in progress.
    let isActive = session.status === 'active' || session.status === 'running';
    if (isActive && events.length > 0) {
      const lastEvent = events[events.length - 1];
      // If the last event is an assistant message with a stopReason, the agent finished
      if (lastEvent.role === 'assistant' && lastEvent.stopReason) {
        isActive = false;
      }
      // If the last event is from user, agent already processed (waiting for new input)
      if (lastEvent.role === 'user') {
        isActive = false;
      }
    }

    // Always update header & stats (lightweight)
    $('#modal-title').textContent = d.name;
    $('#modal-info-bar').innerHTML = `
      <div class="info-bar-item"><span class="material-symbols-outlined">tag</span><span class="info-bar-value">${session.id?.slice(0, 12) || '—'}</span></div>
      <div class="info-bar-item"><span class="info-bar-label">Agent</span><span class="info-bar-value">${escapeHtml(d.agent)}</span></div>
      <div class="info-bar-item"><span class="info-bar-label">Type</span><span class="chip chip--neutral">${d.typeLabel}</span></div>
      <div class="info-bar-item"><span class="chip ${d.chipClass}">${d.status}</span></div>
    `;

    const isGw = session.source === 'gateway';
    $('#session-stats').innerHTML = `
      <div class="summary-stat"><div class="summary-stat-label">Messages</div><div class="summary-stat-value">${session.messageCount || events.length || 0}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Tool Calls</div><div class="summary-stat-value">${session.toolCalls || session.toolsUsed || 0}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">Cost</div><div class="summary-stat-value">$${session.cost || 0}</div></div>
      <div class="summary-stat"><div class="summary-stat-label">${isGw ? 'File Size' : 'Duration'}</div><div class="summary-stat-value">${isGw ? formatBytes(session.fileSize || 0) : (session.duration || '—')}</div></div>
    `;

    // Timeline
    const timeline = $('#session-timeline');

    if (events.length === 0) {
      timeline.innerHTML = '<div class="feed-empty">No event data available</div>';
      lastRenderedEventCount = 0;
      return;
    }

    // Incremental update: only prepend new events
    if (incrementalUpdate && events.length > lastRenderedEventCount) {
      const newEvents = events.slice(lastRenderedEventCount);
      const newHtml = newEvents.reverse().map(renderTimelineEventHtml).join('');

      // Remove old processing indicator
      const oldIndicator = timeline.querySelector('.processing-indicator');
      if (oldIndicator) oldIndicator.remove();

      // Prepend new events with animation
      const wrapper = document.createElement('div');
      wrapper.innerHTML = newHtml;
      const newNodes = [...wrapper.children];
      newNodes.forEach(node => {
        node.style.opacity = '0';
        node.style.transform = 'translateY(-8px)';
        timeline.prepend(node);
        // Animate in
        requestAnimationFrame(() => {
          node.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
          node.style.opacity = '1';
          node.style.transform = 'translateY(0)';
        });
      });

      // Add processing indicator if still active
      if (isActive) {
        timeline.prepend(createProcessingIndicator());
      }

      lastRenderedEventCount = events.length;
    } else if (!incrementalUpdate) {
      // Full render
      let html = '';
      if (isActive) {
        html += `<div class="processing-indicator">
          <div class="processing-dots"><span></span><span></span><span></span></div>
          <span>Agent is processing…</span>
        </div>`;
      }
      html += [...events].reverse().map(renderTimelineEventHtml).join('');
      timeline.innerHTML = html;
      lastRenderedEventCount = events.length;
    } else {
      // Same count, just update processing indicator
      const oldIndicator = timeline.querySelector('.processing-indicator');
      if (isActive && !oldIndicator) {
        timeline.prepend(createProcessingIndicator());
      } else if (!isActive && oldIndicator) {
        oldIndicator.remove();
      }
    }

    // Tool chart
    const toolCounts = {};
    events.forEach(e => {
      // Gateway format
      if (e.tools) {
        e.tools.forEach(t => {
          if (t.name && t.name !== 'result') {
            toolCounts[t.name] = (toolCounts[t.name] || 0) + 1;
          }
        });
      }
      // OpenCode format
      if (e.type === 'tool_use' && e.tool) {
        toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1;
      }
    });
    const maxCount = Math.max(...Object.values(toolCounts), 1);

    const chartEl = $('#tool-chart');
    if (Object.keys(toolCounts).length > 0) {
      chartEl.innerHTML = `
        <div class="chart-title">Tool Distribution</div>
        ${Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tool, count]) => `
          <div class="chart-bar-row">
            <span class="chart-bar-label">${escapeHtml(tool)}</span>
            <div class="chart-bar-track">
              <div class="chart-bar-fill" style="width:${(count / maxCount * 100)}%"></div>
            </div>
            <span class="chart-bar-count">${count}</span>
          </div>
        `).join('')}
      `;
    } else {
      chartEl.innerHTML = '';
    }
  }

  // --- Utilities ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatTime(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = typeof dateStr === 'number' ? new Date(dateStr) : new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000 && d.getDate() === now.getDate()) {
        return d.toLocaleTimeString('en-GB', { hour12: false });
      }
      return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '—';
    }
  }

  function formatTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function formatBytes(b) {
    if (!b) return '0 B';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }

  // --- Event Bindings ---
  connectBtn.addEventListener('click', () => attemptLogin(tokenInput.value));
  tokenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(tokenInput.value); });
  logoutBtn.addEventListener('click', logout);
  $$('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => { e.preventDefault(); navigateTo(tab.dataset.view); });
  });
  $$('.mobile-nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => { e.preventDefault(); navigateTo(tab.dataset.view); });
  });
  liveFeedToggle.addEventListener('click', () => { liveFeed.classList.toggle('collapsed'); });
  modalClose.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // --- Hash routing ---
  function handleHash() { navigateTo(location.hash.slice(1) || 'overview'); }
  window.addEventListener('hashchange', handleHash);

  // --- Init ---
  if (token) { api('dashboard').then(() => showDashboard()).catch(() => showLogin()); }
  else { showLogin(); }
  handleHash();

})();
