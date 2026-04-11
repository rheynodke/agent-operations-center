// server/lib/integrations/google-sheets.cjs
'use strict';
const { google } = require('googleapis');
const { decrypt } = require('./base.cjs');

const STATUS_NORMALIZE = {
  'todo': 'todo', 'to do': 'todo', 'to-do': 'todo',
  'in progress': 'in_progress', 'inprogress': 'in_progress', 'wip': 'in_progress',
  'in review': 'in_review', 'review': 'in_review', 'in_review': 'in_review',
  'done': 'done', 'complete': 'done', 'completed': 'done', 'finished': 'done',
  'blocked': 'blocked',
};

function normalizeStatus(raw) {
  if (!raw) return 'backlog';
  return STATUS_NORMALIZE[raw.toString().toLowerCase().trim()] || 'backlog';
}

function getCredentials(config) {
  if (!config.credentials) throw new Error('No credentials in config — service account JSON required');
  const raw = decrypt(config.credentials);
  return JSON.parse(raw);
}

function getSheets(credentials) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Build column-header-to-index map from first row
function buildColIndex(headers) {
  const map = {};
  headers.forEach((h, i) => { if (h) map[h] = i; });
  return map;
}

// Convert 0-based column index to A1 column letter (0→A, 25→Z, 26→AA)
function colToLetter(idx) {
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

const GoogleSheetsAdapter = {
  type: 'google_sheets',

  validateConfig(config) {
    if (!config.spreadsheetId) return { valid: false, error: 'spreadsheetId is required' };
    if (!config.credentials)   return { valid: false, error: 'credentials (service account JSON) are required' };
    if (!config.sheetName)     return { valid: false, error: 'sheetName is required' };
    if (!config.mapping?.external_id) return { valid: false, error: 'mapping.external_id is required' };
    if (!config.mapping?.title)       return { valid: false, error: 'mapping.title is required' };
    return { valid: true };
  },

  async testConnection(config) {
    try {
      if (!config.spreadsheetId) throw new Error('spreadsheetId required');
      if (!config.credentials)   throw new Error('credentials required');
      const creds = getCredentials(config);
      const sheets = getSheets(creds);
      const res = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
      const sheetNames = res.data.sheets.map(s => s.properties.title);
      return { ok: true, sheets: sheetNames };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async listSheets(config) {
    try {
      const creds = getCredentials(config);
      const sheets = getSheets(creds);
      const res = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
      return res.data.sheets.map(s => s.properties.title);
    } catch (err) {
      throw new Error(`listSheets failed: ${err.message}`);
    }
  },

  async getHeaders(config, sheetName) {
    try {
      const creds = getCredentials(config);
      const sheets = getSheets(creds);
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: `'${sheetName}'!1:1`,
      });
      const firstRow = res.data.values?.[0] || [];
      return firstRow.map(v => v?.toString() || '').filter(Boolean);
    } catch (err) {
      throw new Error(`getHeaders failed: ${err.message}`);
    }
  },

  async fetchTickets(config) {
    const creds = getCredentials(config);
    const sheets = getSheets(creds);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `'${config.sheetName}'!A:ZZ`,
    });
    const rows = res.data.values || [];
    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h?.toString() || '');
    const colIndex = buildColIndex(headers);
    const mapping = config.mapping;

    const getVal = (row, field) => {
      const colName = mapping[field];
      if (!colName) return undefined;
      const idx = colIndex[colName];
      return idx !== undefined ? (row[idx]?.toString().trim() || '') : '';
    };

    const tickets = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const externalId = getVal(row, 'external_id');
      const title = getVal(row, 'title');
      if (!externalId || !title) continue;

      const tagsRaw = getVal(row, 'tags');
      tickets.push({
        external_id: externalId,
        title,
        description: getVal(row, 'description') || undefined,
        priority: getVal(row, 'priority')?.toLowerCase() || undefined,
        status: getVal(row, 'status') || undefined,
        tags: tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [],
      });
    }
    return tickets;
  },

  async pushStatus(config, externalId, newStatus) {
    if (!config.mapping?.status) return; // no status column mapped — skip silently

    const creds = getCredentials(config);
    const sheets = getSheets(creds);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `'${config.sheetName}'!A:ZZ`,
    });
    const rows = res.data.values || [];
    if (rows.length < 2) return;

    const headers = rows[0].map(h => h?.toString() || '');
    const colIndex = buildColIndex(headers);
    const externalIdColName = config.mapping.external_id;
    const statusColName = config.mapping.status;

    const externalIdColIdx = colIndex[externalIdColName];
    const statusColIdx = colIndex[statusColName];
    if (externalIdColIdx === undefined || statusColIdx === undefined) return;

    let targetRowNum = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][externalIdColIdx]?.toString() === externalId) {
        targetRowNum = i + 1; // 1-based sheet row
        break;
      }
    }
    if (targetRowNum === -1) return; // row not found — skip silently

    const cellRange = `'${config.sheetName}'!${colToLetter(statusColIdx)}${targetRowNum}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: cellRange,
      valueInputOption: 'RAW',
      requestBody: { values: [[newStatus]] },
    });
  },

  normalizeStatus,
};

module.exports = GoogleSheetsAdapter;
