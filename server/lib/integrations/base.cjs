// server/lib/integrations/base.cjs
'use strict';
const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

function deriveKey() {
  const token = process.env.DASHBOARD_TOKEN || 'aoc-default-insecure-key-change-in-production';
  return crypto.createHash('sha256').update(token).digest();
}

function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(data) {
  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) throw new Error('Invalid encrypted data format');
  const iv = Buffer.from(data.slice(0, colonIdx), 'hex');
  const encHex = data.slice(colonIdx + 1);
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

// Adapter interface — every integration type must implement these methods
// This is documentation; JS does not enforce interfaces
const ADAPTER_INTERFACE = {
  // type: string — unique adapter identifier e.g. 'google_sheets'
  // validateConfig(config) → { valid: bool, error?: string }
  // testConnection(config) → Promise<{ ok: bool, error?: string, sheets?: string[] }>
  // listSheets(config) → Promise<string[]>
  // getHeaders(config, sheetName) → Promise<string[]>
  // fetchTickets(config) → Promise<ExternalTicket[]>
  // pushStatus(config, externalId, newStatus) → Promise<void>
};

module.exports = { encrypt, decrypt, ADAPTER_INTERFACE };
