'use strict';

/**
 * Source of truth for all broadcastable WS event types. Mirror of
 * `src/types/index.ts` → `WsEventType`.
 *
 * Why this file exists: pre-Sprint-2, server emitted free-form `type` strings
 * with no validation. A rename on one side silently broke the other. Now:
 *
 *   const { ev } = require('./ws-events.cjs');
 *   broadcast({ type: ev.AGENTS_UPDATED, payload: {...} });
 *
 * The constants pin every emit site to a known event. `assertEventType()`
 * is wired into the broadcast function so any literal typo throws at
 * runtime in dev (not silently in prod).
 */

const EVENT_TYPES = Object.freeze({
  // Lifecycle
  INIT:                       'init',
  CONNECTED:                  'connected',
  // Agents & sessions
  AGENTS_UPDATED:             'agents:updated',
  AGENT_STATUS:               'agent:status',
  AGENT_DEPLOYED:             'agent:deployed',
  AGENT_DECOMMISSIONED:       'agent:decommissioned',
  SUBAGENT_UPDATE:            'subagent:update',
  SESSIONS_UPDATED:           'sessions:updated',
  SESSION_UPDATE:             'session:update',
  SESSION_ABORTED:            'session:aborted',
  SESSION_LIVE_EVENT:         'session:live-event',
  // Tasks & cron
  TASKS_UPDATED:              'tasks:updated',
  TASK_INTERRUPTED:           'task:interrupted',
  TASK_COMMENT_ADDED:         'task:comment_added',
  TASK_COMMENT_EDITED:        'task:comment_edited',
  TASK_COMMENT_DELETED:       'task:comment_deleted',
  TASK_OUTPUT_ADDED:          'task:output_added',
  TASK_OUTPUT_REMOVED:        'task:output_removed',
  CRON_UPDATED:               'cron:updated',
  CRON_UPDATE:                'cron:update',
  // Activity / alerts / feed
  ACTIVITY_EVENT:             'activity:event',
  LIVE_ENTRY:                 'live:entry',
  ALERT_NEW:                  'alert:new',
  ALERT_ACKNOWLEDGED:         'alert:acknowledged',
  // Progress
  OPENCODE_EVENT:             'opencode:event',
  PROGRESS_UPDATE:            'progress:update',
  PROGRESS_STEP:              'progress:step',
  // Gateway
  GATEWAY_CONNECTED:          'gateway:connected',
  GATEWAY_DISCONNECTED:       'gateway:disconnected',
  GATEWAY_EVENT:              'gateway:event',
  GATEWAY_LOG:                'gateway:log',
  // Chat
  CHAT_MESSAGE:               'chat:message',
  CHAT_TOOL:                  'chat:tool',
  CHAT_EVENT:                 'chat:event',
  CHAT_SESSIONS_CHANGED:      'chat:sessions-changed',
  CHAT_DONE:                  'chat:done',
  CHAT_PROGRESS:              'chat:progress',
  // Rooms
  ROOM_MESSAGE:               'room:message',
  ROOM_CREATED:               'room:created',
  ROOM_DELETED:               'room:deleted',
  ROOM_STOP:                  'room:stop',
  // Skills / connections / projects
  SKILLS_UPDATED:             'skills:updated',
  CONNECTION_AUTH_COMPLETED:  'connection:auth_completed',
  CONNECTION_AUTH_EXPIRED:    'connection:auth_expired',
  CONNECTION_SHARE_CHANGED:   'connection:share_changed',
  PROJECT_SYNC_START:         'project:sync_start',
  PROJECT_SYNC_COMPLETE:      'project:sync_complete',
  PROJECT_SYNC_ERROR:         'project:sync_error',
  // Workflow runs
  WORKFLOW_RUN_START:         'workflow:run_start',
  WORKFLOW_RUN_COMPLETE:      'workflow:run_complete',
  WORKFLOW_STEP_START:        'workflow:step_start',
  WORKFLOW_STEP_COMPLETE:     'workflow:step_complete',
  WORKFLOW_STEP_FAILED:       'workflow:step_failed',
  WORKFLOW_APPROVAL_NEEDED:   'workflow:approval_needed',
  // Onboarding
  ONBOARDING_PHASE:           'onboarding:phase',
  // Processing indicators
  PROCESSING_END:             'processing_end',
});

const EVENT_VALUES = new Set(Object.values(EVENT_TYPES));

/**
 * Throws if `type` isn't a registered WS event. Wire this into broadcast()
 * so typos become loud at the call site.
 *
 * Set AOC_WS_STRICT=0 to log-instead-of-throw (useful for incremental
 * adoption where a downstream emit site hasn't been migrated yet).
 */
function assertEventType(type) {
  if (EVENT_VALUES.has(type)) return;
  const msg = `[ws] unregistered event type "${type}". Add it to server/lib/ws-events.cjs and src/types/index.ts.`;
  if (process.env.AOC_WS_STRICT === '0') {
    console.warn(msg);
    return;
  }
  throw new Error(msg);
}

module.exports = {
  ev: EVENT_TYPES,
  EVENT_TYPES,
  EVENT_VALUES,
  assertEventType,
};
