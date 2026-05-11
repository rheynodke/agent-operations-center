// server/lib/embed/audit-log.cjs
// Audit log writer with per-owner AES-256-GCM encryption for sensitive context.
//
// Sensitive context data (e.g. visitor PII, matched DLP patterns) is encrypted
// with the owner's per-user key before being written to embed_audit_log.context_data.
// Public context data is stored as plaintext alongside the encrypted blob so
// read-only queries (filtering by event_type, embed_id, etc.) still work without
// needing to decrypt.
//
// context_data JSON layout:
//   { ...publicContextData, encryptedSensitive: "<iv:tag:ct>" }
//
// readEventDecrypted(event) returns { ...event, public: publicCtx, sensitive: {} | null }
'use strict';

const db = require('../db.cjs');
const enc = require('./encryption.cjs');

/**
 * Write an audit event to embed_audit_log.
 * Sensitive fields are encrypted with the owner's per-user AES-256-GCM key.
 *
 * @param {object} opts
 * @param {string}  opts.embedId
 * @param {string|null}  [opts.sessionId]
 * @param {number}  opts.ownerId
 * @param {string}  opts.eventType
 * @param {string}  [opts.severity='info']
 * @param {string|null}  [opts.origin]
 * @param {string|null}  [opts.visitorUuid]
 * @param {string|null}  [opts.ipHash]
 * @param {object|null}  [opts.sensitiveContextData]   — encrypted before storage
 * @param {object}  [opts.publicContextData]           — stored as plaintext
 * @returns {number} Row id of the inserted audit log entry
 */
function writeEvent({
  embedId,
  sessionId = null,
  ownerId,
  eventType,
  severity = 'info',
  origin = null,
  visitorUuid = null,
  ipHash = null,
  sensitiveContextData = null,
  publicContextData = {},
}) {
  let context = { ...publicContextData };

  if (sensitiveContextData && Object.keys(sensitiveContextData).length > 0) {
    const json = JSON.stringify(sensitiveContextData);
    context.encryptedSensitive = enc.encryptForOwner(ownerId, json);
  }

  return db.writeAuditEvent({
    embedId,
    sessionId,
    ownerId,
    eventType,
    severity,
    origin,
    visitorUuid,
    ipHash,
    contextData: JSON.stringify(context),
  });
}

/**
 * Decrypts the sensitive block from an audit log event row (as returned by
 * listAuditEvents / getAuditEvent). Returns the original event object plus
 * two extra fields:
 *   - public   {object}        — non-encrypted context fields
 *   - sensitive {object|null}  — decrypted sensitive payload, or null if none
 *
 * On decryption failure (wrong key, tampered data), sensitive is
 * { _error: 'decrypt-failed', _detail: <message> } so callers can distinguish
 * a missing block from a corrupted one.
 *
 * @param {object} event  — row object from listAuditEvents (camelCase)
 * @returns {object}
 */
function readEventDecrypted(event) {
  let ctx = {};
  try {
    ctx = JSON.parse(event.contextData || '{}');
  } catch {
    ctx = {};
  }

  let sensitive = null;
  if (ctx.encryptedSensitive) {
    try {
      const json = enc.decryptForOwner(event.ownerId, ctx.encryptedSensitive);
      sensitive = JSON.parse(json);
    } catch (e) {
      sensitive = { _error: 'decrypt-failed', _detail: e.message };
    }
  }

  const { encryptedSensitive, ...publicCtx } = ctx;
  return { ...event, public: publicCtx, sensitive };
}

module.exports = { writeEvent, readEventDecrypted };
