'use strict';
/**
 * server/lib/automation/cron.cjs
 *
 * Cron job CRUD — gateway RPC primary, direct file write fallback.
 * The OpenClaw gateway is the cron scheduler; jobs persist at
 * ~/.openclaw/cron/jobs.json and are executed by the gateway process.
 */
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OPENCLAW_HOME, getUserHome, readJsonSafe } = require('../config.cjs');

// Per-user cron file. userId === undefined / null falls back to admin's home
// for back-compat with code paths that haven't been threaded yet (e.g.
// scheduled re-pickup at gateway boot — gateways are already per-user, so the
// fallback only matters for tests).
function cronFileFor(userId) {
  const home = userId == null ? OPENCLAW_HOME : getUserHome(userId);
  return path.join(home, 'cron', 'jobs.json');
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function readCronFile(userId) {
  const data = readJsonSafe(cronFileFor(userId));
  return data || { version: 1, jobs: [] };
}

function writeCronFile(userId, data) {
  const file = cronFileFor(userId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function buildSchedule(opts) {
  const kind = opts.kind || 'cron';
  const raw  = opts.schedule || '';
  if (kind === 'every') {
    // parse interval string like "5m", "30m", "1h", "2d" into ms
    const match = String(raw).match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
    if (match) {
      const n = parseFloat(match[1]);
      const unit = (match[2] || 'm').toLowerCase();
      const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit] || 60000;
      return { kind: 'every', everyMs: Math.round(n * mult) };
    }
    return { kind: 'every', everyMs: parseInt(raw) || 300000 };
  }
  if (kind === 'at') {
    // ISO string or relative like "20m"
    const relMatch = String(raw).match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
    if (relMatch) {
      const n = parseFloat(relMatch[1]);
      const unit = relMatch[2].toLowerCase();
      const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit] || 60000;
      return { kind: 'at', atMs: Date.now() + Math.round(n * mult) };
    }
    return { kind: 'at', atMs: new Date(raw).getTime() };
  }
  // cron expression (5-field)
  const tz = opts.tz || 'UTC';
  return { kind: 'cron', cronExpr: raw, tz };
}

function buildJobFromOpts(opts, existingId) {
  const nowMs = Date.now();
  const sessionTarget = opts.session === 'custom'
    ? `session:${opts.customSessionId || 'default'}`
    : (opts.session || 'isolated');

  // Payload — shape depends on sessionTarget
  let payload;
  if (sessionTarget === 'main' || sessionTarget.startsWith('session:')) {
    payload = {
      kind: 'systemEvent',
      text: opts.systemEvent || opts.message || '',
    };
  } else {
    // isolated / current
    payload = {
      kind: 'agentTurn',
      message: opts.message || '',
      ...(opts.model        ? { model: opts.model }               : {}),
      ...(opts.thinking && opts.thinking !== 'off' ? { thinking: opts.thinking } : {}),
      ...(opts.lightContext  ? { lightContext: true }              : {}),
    };
  }

  // Delivery — gateway expects top-level `delivery` object (not `announce`)
  const deliveryMode = opts.deliveryMode || 'none';
  let delivery;
  let webhookUrl;
  if (deliveryMode === 'announce' && opts.deliveryChannel && opts.deliveryTo) {
    delivery = { channel: opts.deliveryChannel, to: opts.deliveryTo };
    if (opts.agentId) delivery.accountId = opts.agentId;
  }
  if (deliveryMode === 'webhook' && opts.deliveryWebhook) {
    webhookUrl = opts.deliveryWebhook;
  }

  const job = {
    id: existingId || crypto.randomUUID(),
    name: opts.name,
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
    enabled: true,
    createdAtMs: opts.createdAtMs || nowMs,
    updatedAtMs: nowMs,
    schedule: buildSchedule(opts),
    sessionTarget,
    ...(sessionTarget === 'main' ? { wakeMode: opts.wakeMode || 'now' } : {}),
    payload,
    ...(delivery    ? { delivery }    : {}),
    ...(webhookUrl  ? { webhookUrl }  : {}),
    ...(opts.deleteAfterRun  ? { deleteAfterRun: true }                  : {}),
    ...(opts.timeoutSeconds  ? { timeoutSeconds: Number(opts.timeoutSeconds) } : {}),
    state: opts.state || {},
  };

  return job;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function cronCreateJob(opts, gatewayProxy, userId) {
  if (gatewayProxy && gatewayProxy.isConnected) {
    try {
      const result = await gatewayProxy.cronCreate(opts);
      return result;
    } catch (err) {
      console.warn('[cron] Gateway cronCreate failed, falling back to file write:', err.message);
    }
  }
  // Fallback: write directly to the user's per-user cron file.
  const data = readCronFile(userId);
  const job = buildJobFromOpts(opts);
  data.jobs.push(job);
  writeCronFile(userId, data);
  return { job, source: 'file' };
}

async function cronUpdateJob(id, opts, gatewayProxy, userId) {
  // Gateway has no cron.update RPC — always write to file directly.
  // User must restart gateway for changes to take effect.
  const data = readCronFile(userId);
  const idx = data.jobs.findIndex((j) => j.id === id);
  if (idx === -1) throw new Error(`Cron job not found: ${id}`);
  const existing = data.jobs[idx];
  const mergedOpts = { ...existing, ...opts, createdAtMs: existing.createdAtMs };
  const updated = buildJobFromOpts(mergedOpts, existing.id);
  data.jobs[idx] = updated;
  writeCronFile(userId, data);
  return { job: updated, source: 'file' };
}

async function cronDeleteJob(id, gatewayProxy, userId) {
  // Gateway has no cron.delete RPC — always write to file directly.
  const data = readCronFile(userId);
  const before = data.jobs.length;
  data.jobs = data.jobs.filter((j) => j.id !== id);
  if (data.jobs.length === before) throw new Error(`Cron job not found: ${id}`);
  writeCronFile(userId, data);
  return { ok: true, source: 'file' };
}

async function cronRunJob(id, gatewayProxy) {
  if (!gatewayProxy || !gatewayProxy.isConnected) {
    throw Object.assign(new Error('Gateway not connected — cannot trigger cron run'), { status: 503 });
  }
  return gatewayProxy.cronRun(id);
}

async function cronGetRuns(id, limit, gatewayProxy, userId) {
  if (gatewayProxy && gatewayProxy.isConnected) {
    try {
      const result = await gatewayProxy.cronRuns(id, limit || 50);
      if (result && (result.runs || Array.isArray(result))) return result;
    } catch (err) {
      console.warn('[cron] Gateway cronRuns failed, reading from file:', err.message);
    }
  }
  // Fallback: read directly from <userHome>/cron/runs/<jobId>.jsonl
  const home = userId == null ? OPENCLAW_HOME : getUserHome(userId);
  const runsFile = path.join(home, 'cron', 'runs', `${id}.jsonl`);
  if (!fs.existsSync(runsFile)) return { runs: [] };

  const lines = fs.readFileSync(runsFile, 'utf-8').trim().split('\n').filter(Boolean);
  const n = limit || 50;
  const runs = lines
    .slice(-n)
    .reverse()
    .map((line) => {
      try {
        const r = JSON.parse(line);
        return {
          runId:      r.sessionId || r.sessionKey || String(r.runAtMs),
          jobId:      r.jobId,
          status:     r.status === 'ok' ? 'succeeded' : r.status === 'skipped' ? 'cancelled' : (r.status || 'failed'),
          startedAt:  r.runAtMs  ? new Date(r.runAtMs).toISOString()  : new Date(r.ts).toISOString(),
          endedAt:    r.ts       ? new Date(r.ts).toISOString()        : undefined,
          duration:   r.durationMs,
          cost:       r.usage?.total_tokens ? undefined : undefined,
          error:      r.error   || undefined,
          summary:    r.summary || undefined,
          delivered:  r.delivered,
          model:      r.model   || undefined,
        };
      } catch { return null; }
    })
    .filter(Boolean);

  return { runs };
}

async function cronToggleJob(id, enabled, gatewayProxy, userId) {
  // Gateway has no cron.toggle RPC — write to file directly.
  const data = readCronFile(userId);
  const idx = data.jobs.findIndex((j) => j.id === id);
  if (idx === -1) throw new Error(`Cron job not found: ${id}`);
  data.jobs[idx].enabled = enabled;
  data.jobs[idx].updatedAtMs = Date.now();
  writeCronFile(userId, data);
  return { job: data.jobs[idx], source: 'file' };
}

module.exports = {
  cronCreateJob,
  cronUpdateJob,
  cronDeleteJob,
  cronRunJob,
  cronGetRuns,
  cronToggleJob,
};

// ─── Delivery targets ─────────────────────────────────────────────────────────

function getDeliveryTargets(userId) {
  const home = userId == null ? OPENCLAW_HOME : getUserHome(userId);
  const configPath = path.join(home, 'openclaw.json');
  const cfg = readJsonSafe(configPath) || {};
  const channels = cfg.channels || {};
  const agentsDir = path.join(home, 'agents');
  const result = [];

  // ── Telegram ──────────────────────────────────────────────────────────────
  const tgAccounts = channels.telegram?.accounts || {};
  if (Object.keys(tgAccounts).length > 0) {
    const accounts = Object.entries(tgAccounts).map(([accountId]) => {
      // Collect known targets from all agent sessions for this accountId
      const targets = new Map();
      try {
        const agentDirs = fs.existsSync(agentsDir)
          ? fs.readdirSync(agentsDir).filter(d => fs.existsSync(path.join(agentsDir, d, 'sessions', 'sessions.json')))
          : [];
        for (const agentId of agentDirs) {
          const sessFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
          const sessions = readJsonSafe(sessFile) || {};
          for (const sess of Object.values(sessions)) {
            const ctx = sess.deliveryContext || sess.origin || {};
            const lastAcct = sess.lastAccountId || ctx.accountId;
            if (ctx.channel !== 'telegram') continue;
            if (lastAcct && lastAcct !== accountId) continue;
            const rawTo = ctx.to || sess.lastTo || '';
            const to = rawTo.replace('telegram:', '');
            if (!to || targets.has(to)) continue;
            const label = (sess.origin?.label || '').replace(/ id:\d+$/, '') || rawTo;
            targets.set(to, { to, label, chatType: sess.chatType || ctx.chatType });
          }
        }
      } catch {}
      return { accountId, targets: [...targets.values()] };
    });
    result.push({ channel: 'telegram', label: 'Telegram', accounts });
  }

  // ── Discord ───────────────────────────────────────────────────────────────
  const discConfig = channels.discord;
  if (discConfig?.enabled) {
    const targets = new Map();
    try {
      const agentDirs = fs.existsSync(agentsDir)
        ? fs.readdirSync(agentsDir).filter(d => fs.existsSync(path.join(agentsDir, d, 'sessions', 'sessions.json')))
        : [];
      for (const agentId of agentDirs) {
        const sessFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
        const sessions = readJsonSafe(sessFile) || {};
        for (const sess of Object.values(sessions)) {
          const ctx = sess.deliveryContext || sess.origin || {};
          if (ctx.channel !== 'discord') continue;
          const rawTo = ctx.to || sess.lastTo || '';
          if (!rawTo || targets.has(rawTo)) continue;
          const label = (sess.origin?.label || '').replace(/ id:\d+$/, '') || rawTo;
          targets.set(rawTo, { to: rawTo, label });
        }
      }
    } catch {}
    result.push({ channel: 'discord', label: 'Discord', accounts: [{ accountId: 'default', targets: [...targets.values()] }] });
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  const waAccounts = channels.whatsapp?.accounts || {};
  if (Object.keys(waAccounts).length > 0) {
    const accounts = Object.entries(waAccounts).map(([accountId]) => {
      const targets = new Map();
      try {
        const agentDirs = fs.existsSync(agentsDir)
          ? fs.readdirSync(agentsDir).filter(d => fs.existsSync(path.join(agentsDir, d, 'sessions', 'sessions.json')))
          : [];
        for (const agentId of agentDirs) {
          const sessFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
          const sessions = readJsonSafe(sessFile) || {};
          for (const sess of Object.values(sessions)) {
            const ctx = sess.deliveryContext || sess.origin || {};
            const lastAcct = sess.lastAccountId || ctx.accountId;
            if (ctx.channel !== 'whatsapp') continue;
            if (lastAcct && lastAcct !== accountId) continue;
            const rawTo = ctx.to || sess.lastTo || '';
            const to = rawTo.replace('whatsapp:', '');
            if (!to || targets.has(to)) continue;
            const label = (sess.origin?.label || '').replace(/ id:\S+$/, '') || rawTo;
            targets.set(to, { to, label });
          }
        }
      } catch {}
      return { accountId, targets: [...targets.values()] };
    });
    result.push({ channel: 'whatsapp', label: 'WhatsApp', accounts });
  }

  return result;
}

module.exports.getDeliveryTargets = getDeliveryTargets;
