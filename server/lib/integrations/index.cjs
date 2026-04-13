// server/lib/integrations/index.cjs
'use strict';
const { encrypt, decrypt } = require('./base.cjs');
const GoogleSheetsAdapter = require('./google-sheets.cjs');

const ADAPTERS = {
  google_sheets: GoogleSheetsAdapter,
};

// NodeJS timers per integrationId
const timers = new Map();

let _db = null;
let _broadcast = null;

function init(db, broadcast) {
  _db = db;
  _broadcast = broadcast;
}

function getAdapter(type) {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`Unknown integration type: ${type}`);
  return adapter;
}

async function syncIntegration(integrationId) {
  if (!_db) return;
  const integration = _db.getIntegrationRaw(integrationId);
  if (!integration || !integration.enabled) return;

  const adapter = getAdapter(integration.type);
  _broadcast({ type: 'project:sync_start', payload: { integrationId, projectId: integration.projectId } });

  try {
    const tickets = await adapter.fetchTickets(integration.config);
    const VALID_PRIORITIES = ['urgent', 'high', 'medium', 'low'];
    let created = 0, updated = 0;

    for (const ticket of tickets) {
      const existing = _db.getTaskByExternalId(ticket.external_id, integration.type);
      const priority = VALID_PRIORITIES.includes(ticket.priority) ? ticket.priority : 'medium';

      if (!existing) {
        _db.createTask({
          title: ticket.title,
          description: ticket.description,
          priority,
          tags: ticket.tags || [],
          status: 'backlog',
          projectId: integration.projectId,
          externalId: ticket.external_id,
          externalSource: integration.type,
          requestFrom: ticket.request_from || '-',
        });
        created++;
      } else {
        // Board is master for status — only update metadata fields
        _db.updateTask(existing.id, {
          title: ticket.title,
          description: ticket.description,
          priority,
          tags: ticket.tags || [],
          requestFrom: ticket.request_from || '-',
        });
        updated++;
      }
    }

    _db.updateIntegrationSyncState(integrationId, {
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null,
    });

    _broadcast({ type: 'project:sync_complete', payload: { integrationId, projectId: integration.projectId, created, updated } });
    _broadcast({ type: 'tasks:updated', payload: _db.getAllTasks({ projectId: integration.projectId }), timestamp: new Date().toISOString() });

  } catch (err) {
    const error = err.message || 'Unknown sync error';
    _db.updateIntegrationSyncState(integrationId, { lastSyncedAt: undefined, lastSyncError: error });
    _broadcast({ type: 'project:sync_error', payload: { integrationId, projectId: integration.projectId, error } });
    console.error('[integrations] sync error for', integrationId, err);
  }
}

function scheduleIntegration(integration) {
  // Clear existing timer if any
  if (timers.has(integration.id)) {
    clearInterval(timers.get(integration.id));
    timers.delete(integration.id);
  }
  if (!integration.enabled || !integration.syncIntervalMs) return;
  const timer = setInterval(() => syncIntegration(integration.id), integration.syncIntervalMs);
  timers.set(integration.id, timer);
  console.log(`[integrations] scheduled ${integration.id} every ${integration.syncIntervalMs}ms`);
}

function unscheduleIntegration(integrationId) {
  if (timers.has(integrationId)) {
    clearInterval(timers.get(integrationId));
    timers.delete(integrationId);
  }
}

function startScheduler() {
  if (!_db) return;
  const integrations = _db.getAllIntegrations();
  for (const integration of integrations) {
    if (integration.enabled && integration.syncIntervalMs) {
      scheduleIntegration(integration);
    }
  }
  console.log(`[integrations] scheduler started (${integrations.length} integration(s))`);
}

function stopAll() {
  timers.forEach(t => clearInterval(t));
  timers.clear();
}

module.exports = {
  ADAPTERS,
  init,
  getAdapter,
  encrypt,
  decrypt,
  syncIntegration,
  scheduleIntegration,
  unscheduleIntegration,
  startScheduler,
  stopAll,
};
